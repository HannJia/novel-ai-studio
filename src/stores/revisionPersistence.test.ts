import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref, type EffectScope } from 'vue'
import { createRevisionPersistence } from './revisionPersistence'

const scopes: EffectScope[] = []
function gate() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('persistence scope disposal', () => {
  it.each(['save', 'transaction'] as const)('does not restart autosave after an in-flight %s completes on a disposed scope', async mode => {
    const items = ref([{ id: 'synthetic-book', title: '原稿', note: '' }])
    const entered = gate(), finish = gate()
    const write = vi.fn(async (_snapshot: typeof items.value[number]) => {})
    write.mockImplementationOnce(async () => { entered.release(); await finish.promise })
    const scope = effectScope(); scopes.push(scope)
    const persistence = scope.run(() => createRevisionPersistence(items, ref(true), write))!
    persistence.adopt()
    const saving = mode === 'save' ? persistence.saveNow(items.value[0].id)
      : persistence.transact(items.value[0].id, async draft => {
        draft.title = '已确认的修改'
        return { value: draft.id, persist: () => write(draft) }
      })
    await entered.promise
    items.value[0].note = '保存期间继续写下的备注'
    persistence.markDirty(items.value[0].id)
    scope.stop()
    finish.release()
    await saving

    expect(persistence.hasPendingSaves.value).toBe(true)
    expect(items.value[0].note).toBe('保存期间继续写下的备注')
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(3000)
    expect(write).toHaveBeenCalledTimes(1)

    // A caller may explicitly drain remaining author edits before removing its
    // storage. Stopping automatic timers must not discard these dirty revisions.
    await persistence.flush()
    expect(write).toHaveBeenCalledTimes(2)
    expect(write.mock.calls[1][0].note).toBe('保存期间继续写下的备注')
    expect(persistence.hasPendingSaves.value).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
})
