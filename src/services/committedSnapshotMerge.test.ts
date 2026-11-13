import { describe, expect, it } from 'vitest'
import { mergeCommittedSnapshot } from './committedSnapshotMerge'

describe('mergeCommittedSnapshot', () => {
  it('allows shared evidence objects but rejects a real ancestor cycle', () => {
    const evidence = { quote: '同一段正文证据' }
    const shared = { candidate: { evidence }, record: { evidence } }
    expect(mergeCommittedSnapshot<Record<string, unknown>>({}, shared, {})).toEqual(shared)
    const cycle: { parent?: unknown } = {}
    cycle.parent = cycle
    expect(() => mergeCommittedSnapshot({}, cycle, {})).toThrow('循环引用')
  })
  it('keeps an in-memory正文 edit while committing a transaction that changed人物', () => {
    const before = { chapters: [{ id: 'chapter-1', content: '原正文' }], characters: [{ id: 'character-1', name: '旧名' }] }
    const committed = { chapters: [{ id: 'chapter-1', content: '原正文' }], characters: [{ id: 'character-1', name: '新名' }] }
    const current = { chapters: [{ id: 'chapter-1', content: '作者继续写的正文' }], characters: [{ id: 'character-1', name: '旧名' }] }

    expect(mergeCommittedSnapshot(before, committed, current)).toEqual({
      chapters: [{ id: 'chapter-1', content: '作者继续写的正文' }],
      characters: [{ id: 'character-1', name: '新名' }],
    })
  })

  it('does not resurrect a chapter or candidate deleted by the author', () => {
    const before = {
      chapters: [{ id: 'chapter-1', content: '正文' }],
      candidates: [{ id: 'candidate-1', value: '候选' }],
    }
    const committed = {
      chapters: [{ id: 'chapter-1', content: '事务修改正文' }],
      candidates: [{ id: 'candidate-1', value: '事务修改候选' }],
    }
    const current = { chapters: [], candidates: [] }

    expect(mergeCommittedSnapshot(before, committed, current)).toEqual({ chapters: [], candidates: [] })
  })

  it('applies a transaction row deletion only when current kept that row unchanged', () => {
    const before = [{ id: 'candidate-1', value: '候选' }]
    const committed: typeof before = []
    expect(mergeCommittedSnapshot(before, committed, before)).toEqual([])
    expect(mergeCommittedSnapshot(before, committed, [{ id: 'candidate-1', value: '作者修改' }]))
      .toEqual([{ id: 'candidate-1', value: '作者修改' }])
  })

  it('merges different fields of the same id and lets current win the same-field conflict', () => {
    const before = [{ id: 'character-1', name: '旧名', role: '旧角色' }]
    const committed = [{ id: 'character-1', name: '事务名', role: '旧角色', age: 20 }]
    const current = [{ id: 'character-1', name: '作者名', role: '新角色' }]

    expect(mergeCommittedSnapshot(before, committed, current)).toEqual([
      { id: 'character-1', name: '作者名', role: '新角色', age: 20 },
    ])
  })

  it('removes an optional field when the author did not change it, while retaining an author edit', () => {
    type SettingsSnapshot = { settings: { note?: string; color: string } }
    const before: SettingsSnapshot = { settings: { note: '旧说明', color: '蓝' } }
    const committed: SettingsSnapshot = { settings: { color: '蓝' } }
    expect(mergeCommittedSnapshot(before, committed, { settings: { note: '旧说明', color: '蓝' } }))
      .toEqual({ settings: { color: '蓝' } })
    expect(mergeCommittedSnapshot(before, committed, { settings: { note: '作者说明', color: '蓝' } }))
      .toEqual({ settings: { note: '作者说明', color: '蓝' } })
  })

  it('keeps current order and concurrent additions, then appends committed-only additions', () => {
    const before = [{ id: 'a', value: 1 }, { id: 'b', value: 2 }]
    const committed = [{ id: 'b', value: 20 }, { id: 'a', value: 1 }, { id: 'c', value: 3 }]
    const current = [{ id: 'x', value: 99 }, { id: 'b', value: 2 }, { id: 'a', value: 10 }, { id: 'y', value: 100 }]

    expect(mergeCommittedSnapshot(before, committed, current)).toEqual([
      { id: 'x', value: 99 }, { id: 'b', value: 20 }, { id: 'a', value: 10 }, { id: 'y', value: 100 }, { id: 'c', value: 3 },
    ])
  })

  it('applies a committed reorder when current is unchanged, but keeps current order once it has changed', () => {
    const before = [{ id: 'a' }, { id: 'b' }]
    const committed = [{ id: 'b' }, { id: 'a' }]
    expect(mergeCommittedSnapshot(before, committed, before)).toEqual(committed)
    expect(mergeCommittedSnapshot(before, committed, [{ id: 'a' }, { id: 'b', edited: true }]))
      .toEqual([{ id: 'a' }, { id: 'b', edited: true }])
  })

  it('treats omitted optional fields and undefined as the same JSON state', () => {
    type OptionalSnapshot = { note?: string }
    const before: OptionalSnapshot = { note: '说明' }
    const committed: OptionalSnapshot = { note: undefined }
    const current: OptionalSnapshot = { note: '作者保留' }
    expect(mergeCommittedSnapshot(before, committed, current)).toEqual(current)
    expect(mergeCommittedSnapshot(before, committed, { note: undefined })).toEqual({})
  })

  it('uses current for non-id arrays and for arrays with missing or duplicate ids', () => {
    expect(mergeCommittedSnapshot([1, 2], [1, 3], [1, 4])).toEqual([1, 4])
    expect(mergeCommittedSnapshot([{ value: 1 }], [{ value: 2 }], [{ value: 3 }])).toEqual([{ value: 3 }])
    expect(mergeCommittedSnapshot([{ id: 'a' }, { id: 'a' }], [{ id: 'a' }], [{ id: 'b' }]))
      .toEqual([{ id: 'b' }])
  })

  it('handles empty id arrays when a transaction adds a row', () => {
    expect(mergeCommittedSnapshot([], [{ id: 'new-row' }], [])).toEqual([{ id: 'new-row' }])
  })

  it('returns a detached result and rejects prototype-pollution keys', () => {
    const before = { nested: { value: 1 } }
    const committed = { nested: { value: 2 } }
    const current = { nested: { value: 3 } }
    const result = mergeCommittedSnapshot(before, committed, current)
    expect(result).toEqual(current)
    expect(result).not.toBe(current)
    expect((result as typeof current).nested).not.toBe(current.nested)
    expect(() => mergeCommittedSnapshot({ ['__proto__']: { polluted: true } }, {}, {})).toThrow()
    expect(() => mergeCommittedSnapshot({}, { nested: { constructor: 1 } }, {})).toThrow()
  })
})
