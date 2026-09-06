// @vitest-environment happy-dom
// Regression tests promoted from the audit reproductions. Synthetic DB only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { useNovelStore } from './novel'
import { loadAllNovelsFromDb, saveNovelToDb } from '@/services/db/novels'
import { parseProjectBackup } from '@/services/projectBackup'

vi.mock('@/services/db/novels', () => ({
  loadAllNovelsFromDb: vi.fn().mockResolvedValue([]), saveNovelToDb: vi.fn().mockResolvedValue(undefined),
  deleteNovelFromDb: vi.fn(), clearAllNovelsFromDb: vi.fn(),
}))
vi.mock('@/services/db/chapterRevisions', () => ({}))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
  vi.mocked(loadAllNovelsFromDb).mockResolvedValue([])
  vi.mocked(saveNovelToDb).mockReset().mockResolvedValue(undefined)
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

function createBook() {
  const store = useNovelStore()
  return store.addNovel({ genre: '', subGenre: '', tags: [], targetWordCountMin: 1, targetWordCountMax: 2,
    writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() })
}

describe('persistence audit regressions', () => {
  it('saves a changed knowledge binding even without any other edits', async () => {
    const store = useNovelStore()
    await store.initStore()
    const book = createBook()
    await store.saveNovelNow(book.id)
    await nextTick()
    vi.mocked(saveNovelToDb).mockClear()
    store.bindKnowledgeBase(book.id, 'new-kb')
    await nextTick()
    await vi.advanceTimersByTimeAsync(2000)
    expect(saveNovelToDb).toHaveBeenCalled()
    expect(vi.mocked(saveNovelToDb).mock.calls.slice(-1)[0]?.[0].knowledgeBaseIds).toEqual(['new-kb'])
    vi.mocked(saveNovelToDb).mockClear()
    store.unbindKnowledgeBase(book.id, 'new-kb')
    await vi.advanceTimersByTimeAsync(2000)
    expect(vi.mocked(saveNovelToDb).mock.calls.slice(-1)[0]?.[0].knowledgeBaseIds).toEqual([])
  })

  it('does not resolve saveNovelNow until edits made during a prior write are saved', async () => {
    const store = useNovelStore()
    const book = createBook()
    let finishFirst!: () => void
    vi.mocked(saveNovelToDb).mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve }))
    const initialSave = store.saveNovelNow(book.id)
    await nextTick()
    // Frozen time: revisions must work even when timestamps are identical.
    store.updateTitle(book.id, '写入期间修改的标题')
    const secondSave = store.saveNovelNow(book.id)
    finishFirst()
    await Promise.all([initialSave, secondSave])
    expect(vi.mocked(saveNovelToDb).mock.calls.slice(-1)[0]?.[0].title).toBe('写入期间修改的标题')
  })

  it('retains a persistent error and retries the latest revision after disk failure', async () => {
    const store = useNovelStore()
    await store.initStore()
    const book = createBook()
    vi.mocked(saveNovelToDb).mockRejectedValueOnce(new Error('磁盘空间不足'))
    await expect(store.saveNovelNow(book.id)).rejects.toThrow('磁盘空间不足')
    expect(store.saveError).toBe('磁盘空间不足')
    expect(store.hasPendingSaves).toBe(true)
    store.updateTitle(book.id, '失败后继续编辑')
    await store.flushPendingSaves()
    expect(store.saveError).toBe('')
    expect(store.hasPendingSaves).toBe(false)
    expect(vi.mocked(saveNovelToDb).mock.calls.slice(-1)[0]?.[0].title).toBe('失败后继续编辑')
  })

  it('drains edits that arrive during a close/import flush', async () => {
    const store = useNovelStore()
    await store.initStore()
    const book = createBook()
    let finishFirst!: () => void
    vi.mocked(saveNovelToDb).mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve }))
    const flushing = store.flushPendingSaves()
    await nextTick()
    store.updateTitle(book.id, '关闭前写入期间的新修改')
    finishFirst()
    await flushing
    expect(store.hasPendingSaves).toBe(false)
    expect(vi.mocked(saveNovelToDb).mock.calls.slice(-1)[0]?.[0].title).toBe('关闭前写入期间的新修改')
  })

  it('rejects incomplete backup records before allowing a destructive import', () => {
    expect(() => parseProjectBackup(JSON.stringify({
      format: 'ai-novel-writer-backup', version: 1, exportedAt: '2026-09-05',
      novels: [{ id: 'malformed', chapters: [] }], knowledgeBases: [{ id: 'kb-without-entries' }],
    }))).toThrow()
  })
})
