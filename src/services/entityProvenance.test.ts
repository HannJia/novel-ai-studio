import { describe, expect, it } from 'vitest'
import type { Novel } from '@/types/novel'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import {
  appendEntityRevision,
  captureEntityRevision,
  getEntityHistory,
  getEntitySourceIssues,
  projectCanonicalEntities,
} from './entityProvenance'
import type { EntityRevision, EntitySource } from '@/types/entityProvenance'

function chapter(id: string, index: number, content: string) {
  return { id, chapterIndex: index, content, title: `第${index + 1}章` }
}

function sourceFor(chapterId: string, chapterIndex: number, content: string, quote: string, startOffset?: number): EntitySource {
  return {
    kind: 'chapter', chapterId, chapterIndex, sourceVersionId: buildAnalysisSourceVersionId(content),
    evidence: [{ quote, ...(startOffset === undefined ? {} : { startOffset, endOffset: startOffset + quote.length }) }],
  }
}

function character(name = '林澈') {
  return {
    id: 'character-1', name, aliases: [], identity: '主角', personality: '冷静', powerLevel: '一阶', faction: '无',
    status: '活跃', firstAppearChapter: 0, description: 'desc', relationships: [], events: [],
  }
}

function event(title = '夺钥') {
  return {
    id: 'event-1', chapterIndex: 0, title, description: 'desc', characters: [], type: '主线',
    source: 'user', timestamp: '2026-01-01T00:00:00.000Z',
  }
}

function novel(overrides: Partial<Record<string, unknown>> = {}): Novel {
  return {
    id: 'novel-1', title: 'test', genre: '', subGenre: '', genreLabel: '', subGenreLabel: '', tags: [],
    targetWordCountMin: 1, targetWordCountMax: 2, currentWordCount: 0, writingStyle: '平实', settings: {},
    outline: '', synopsis: '', volumes: [], chapters: [], characters: [], chatHistory: [], knowledgeBaseIds: [],
    eventLog: [], dataPanels: [], dataPanelChanges: [], status: 'writing', createdAt: '', updatedAt: '',
    ...overrides,
  } as unknown as Novel
}

function revision(kind: 'character' | 'event', entityId: string, id: string, source: EntitySource, changes: EntityRevision['changes'], appliedAt = id): EntityRevision {
  return { id, entityType: kind, entityId, source, appliedAt, changes }
}

describe('entity provenance', () => {
  it('captures creation, changed fields, explicit same-value confirmation, and rejects invalid fields', () => {
    const before = character()
    const after = { ...before, personality: '温柔' }
    const created = captureEntityRevision('character', undefined, before, { kind: 'author' }, '2026-01-01', 'r1')
    expect(created.changes[0]).toEqual({ field: '$exists', after: true })
    expect(created.changes.some(change => change.field === 'name' && change.after === '林澈')).toBe(true)
    const update = captureEntityRevision('character', before, after, { kind: 'author' }, '2026-01-02', 'r2', ['name', '$exists'])
    expect(update.changes.map(change => change.field)).toEqual(['name', '$exists'])
    expect(() => captureEntityRevision('character', before, after, { kind: 'author' }, 'now', 'bad', ['unknown'])).toThrow()
  })

  it('appends by id without changing canonical fields', () => {
    const item = character() as { provenance?: { revisions: EntityRevision[] }; name: string }
    const first = captureEntityRevision('character', undefined, item, { kind: 'author' }, 'now', 'r1')
    appendEntityRevision(item, first)
    appendEntityRevision(item, first)
    expect(item.provenance?.revisions).toHaveLength(1)
    expect(item.name).toBe('林澈')
  })

  it('validates body versions, offsets, and ambiguous repeated evidence', () => {
    const content = '钥匙在桌上。钥匙在桌上。'
    const item = character() as Record<string, unknown>
    item.provenance = { revisions: [revision('character', 'character-1', 'r1', sourceFor('c1', 0, content, '钥匙在桌上。'), [{ field: '$exists', after: true }]) ] }
    const issues = getEntitySourceIssues(novel({ chapters: [chapter('c1', 0, content)], characters: [item] }), 'character', item)
    expect(issues.some(issue => issue.reason.includes('evidence_ambiguous'))).toBe(true)
    const history = getEntityHistory(novel({ chapters: [chapter('c1', 0, content)] }), 'character', item)
    expect(history[0].issue).toContain('evidence_ambiguous')
  })

  it('reports deleted and moved chapters without accepting their revisions', () => {
    const content = '林澈进入城门。'
    const item = character() as Record<string, unknown>
    item.provenance = { revisions: [revision('character', 'character-1', 'missing', sourceFor('deleted', 2, content, content), [{ field: 'name', after: '林澈' }])] }
    const deleted = getEntityHistory(novel({ chapters: [] }), 'character', item)
    expect(deleted[0].issue).toBe('chapter_missing')

    const moved = getEntityHistory(novel({ chapters: [chapter('moved', 1, content)] }), 'character', {
      ...item,
      provenance: { revisions: [revision('character', 'character-1', 'moved', sourceFor('moved', 2, content, content), [{ field: 'name', after: '林澈' }])] },
    })
    expect(moved[0].issue).toBe('chapter_index_mismatch')
  })

  it('reconstructs field history, keeps invalid fields unknown, and excludes invalid creation', () => {
    const content = '林澈拿到了钥匙。'
    const base = character()
    const create = captureEntityRevision('character', undefined, base, sourceFor('c1', 0, content, '林澈拿到了钥匙。', 0), '2026-01-01', 'create')
    const changed = captureEntityRevision('character', base, { ...base, personality: '勇敢' }, sourceFor('c1', 0, content, '林澈拿到了钥匙。', 0), '2026-01-02', 'change', ['personality'])
    const raw = { ...base, personality: '勇敢', provenance: { revisions: [create, changed] } }
    const result = projectCanonicalEntities(novel({ chapters: [chapter('c1', 0, content)], characters: [raw] }))
    expect(result.characters[0].personality).toBe('勇敢')
    const invalid = { ...raw, provenance: { revisions: [{ ...create, source: sourceFor('c1', 0, '改稿后的正文', '林澈拿到了钥匙。') }] } }
    const invalidResult = projectCanonicalEntities(novel({ chapters: [chapter('c1', 0, '改稿后的正文')], characters: [invalid] }))
    expect(invalidResult.characters).toHaveLength(0)
  })

  it('does not leak future values, honors story ordering, and is idempotent through nested projection', () => {
    const c0 = '林澈初见。'
    const c1 = '林澈变得勇敢。'
    const base = character()
    const create = captureEntityRevision('character', undefined, base, sourceFor('c0', 0, c0, c0, 0), '2026-01-01', 'create')
    const early = captureEntityRevision('character', base, { ...base, personality: '冷静' }, sourceFor('c0', 0, c0, c0, 0), '2026-01-02', 'early', ['personality'])
    const late = captureEntityRevision('character', base, { ...base, personality: '勇敢' }, sourceFor('c1', 1, c1, c1, 0), '2026-01-03', 'late', ['personality'])
    const raw = { ...base, personality: '冷静', provenance: { revisions: [create, late, early] } }
    const first = projectCanonicalEntities(novel({ chapters: [chapter('c0', 0, c0), chapter('c1', 1, c1)], characters: [raw] }), 1)
    expect(first.characters[0].personality).toBe('冷静')
    const nestedNovel = novel({ chapters: [chapter('c0', 0, c0), chapter('c1', 1, c1)], characters: first.characters, eventLog: [] })
    const second = projectCanonicalEntities(nestedNovel, 1)
    expect(second.characters[0].personality).toBe('冷静')
    expect(second.issues).toEqual(first.issues)
  })

  it('does not let a same-length rewritten chapter lose to an older later-offset revision', () => {
    const oldContent = '林澈拿到旧钥匙。'
    const newContent = '林澈拿到新钥匙。'
    expect(oldContent.length).toBe(newContent.length)
    const base = character()
    const create = captureEntityRevision('character', undefined, base, sourceFor('c1', 0, oldContent, oldContent, 0), '2026-01-01', 'create')
    const oldRevision = captureEntityRevision('character', base, { ...base, personality: '旧确认' }, sourceFor('c1', 0, oldContent, oldContent, 0), '2026-01-02', 'old', ['personality'])
    const newRevision = captureEntityRevision('character', base, { ...base, personality: '新确认' }, sourceFor('c1', 0, newContent, newContent, 0), '2026-01-03', 'new', ['personality'])
    const raw = { ...base, personality: '新确认', provenance: { revisions: [create, oldRevision, newRevision] } }
    const result = projectCanonicalEntities(novel({ chapters: [chapter('c1', 0, newContent)], characters: [raw] }))
    expect(result.characters[0].personality).toBe('新确认')
    expect(result.issues.some(issue => issue.revisionId === 'old' && issue.reason === 'source_version_mismatch')).toBe(false)
    expect(result.issues.some(issue => issue.reason === 'raw_mismatch' && issue.field === 'personality')).toBe(false)
    const history = getEntityHistory(novel({ chapters: [chapter('c1', 0, newContent)] }), 'character', raw)
    expect(history.find(item => item.revision.id === 'old')?.issue).toBe('source_version_mismatch')
  })

  it('keeps fields independent and does not silently fall back after an invalid latest update', () => {
    const content = '林澈在城门前停下。'
    const base = character()
    const create = captureEntityRevision('character', undefined, base, sourceFor('c1', 0, content, content, 0), '2026-01-01', 'create')
    const invalid = captureEntityRevision('character', base, { ...base, personality: '新性格' }, sourceFor('c1', 0, '另一版正文', content, 0), '2026-01-02', 'invalid', ['personality'])
    const raw = { ...base, personality: '新性格', provenance: { revisions: [create, invalid] } }
    const result = projectCanonicalEntities(novel({ chapters: [chapter('c1', 0, content)], characters: [raw] }))
    expect(result.characters[0].name).toBe('林澈')
    expect(result.characters[0].personality).toBe('')
    expect(result.issues.some(issue => issue.field === 'personality' && issue.reason.includes('source_version_mismatch'))).toBe(true)
  })

  it('reports a concurrent raw edit instead of treating it as an author confirmation', () => {
    const content = '林澈回到城中。'
    const base = character()
    const create = captureEntityRevision('character', undefined, base, sourceFor('c1', 0, content, content, 0), '2026-01-01', 'create')
    const confirmed = captureEntityRevision('character', base, { ...base, personality: '勇敢' }, sourceFor('c1', 0, content, content, 0), '2026-01-02', 'confirmed', ['personality'])
    const raw = { ...base, personality: '并发手改', provenance: { revisions: [create, confirmed] } }
    const result = projectCanonicalEntities(novel({ chapters: [chapter('c1', 0, content)], characters: [raw] }))
    expect(result.characters[0].personality).toBe('')
    expect(result.issues.some(issue => issue.field === 'personality' && issue.reason === 'raw_mismatch')).toBe(true)
  })

  it('seeds the author baseline for a first update and preserves it before the boundary', () => {
    const content = '林澈在城门前停下。'
    const before = character()
    const after = { ...before, personality: '勇敢' }
    const firstUpdate = captureEntityRevision(
      'character', before, after,
      sourceFor('c1', 1, content, content, 0), '2026-01-01', 'first-update', ['$exists', 'personality'],
    )
    const raw = { ...after, provenance: { revisions: [firstUpdate] } }
    const current = projectCanonicalEntities(novel({ chapters: [chapter('c1', 1, content)], characters: [raw] }), 2)
    expect(current.characters[0].name).toBe('林澈')
    expect(current.characters[0].personality).toBe('勇敢')

    const earlier = projectCanonicalEntities(novel({ chapters: [chapter('c1', 1, content)], characters: [raw] }), 1)
    expect(earlier.characters[0].name).toBe('林澈')
    expect(earlier.characters[0].personality).toBe('冷静')
    expect(earlier.issues.some(issue => issue.reason === 'future_source')).toBe(false)
  })

  it('uses author baselines globally and applies only later chapter writes per field', () => {
    const earlyText = '林澈初见。'
    const lateText = '林澈变勇。'
    const base = character()
    const early = revision('character', 'character-1', 'early', sourceFor('early', 0, earlyText, earlyText, 0), [
      { field: 'personality', before: '冷静', after: '旧章节' },
    ])
    const author = captureEntityRevision(
      'character', undefined, { ...base, personality: '作者基线' }, { kind: 'author' }, '2026-01-02', 'author',
    )
    const late = revision('character', 'character-1', 'late', sourceFor('late', 2, lateText, lateText, 0), [
      { field: 'personality', before: '作者基线', after: '章后' },
    ])
    const raw = { ...base, personality: '章后', provenance: { revisions: [early, author, late] } }
    const full = projectCanonicalEntities(novel({
      chapters: [chapter('early', 0, earlyText), chapter('late', 2, lateText)], characters: [raw],
    }))
    expect(full.characters[0].personality).toBe('章后')
    const beforeLate = projectCanonicalEntities(novel({
      chapters: [chapter('early', 0, earlyText), chapter('late', 2, lateText)], characters: [raw],
    }), 2)
    expect(beforeLate.characters[0].personality).toBe('作者基线')
  })

  it('compares raw values with append order and makes mismatches unknown', () => {
    const earlyText = '林澈初见。'
    const lateText = '林澈变勇。'
    const base = character()
    const create = captureEntityRevision('character', undefined, base, { kind: 'author' }, '2026-01-01', 'create')
    const late = revision('character', 'character-1', 'late', sourceFor('late', 2, lateText, lateText, 0), [
      { field: 'personality', after: '勇敢' },
    ])
    const early = revision('character', 'character-1', 'early', sourceFor('early', 0, earlyText, earlyText, 0), [
      { field: 'personality', after: '冷静' },
    ])
    const raw = { ...base, personality: '勇敢', provenance: { revisions: [create, late, early] } }
    const result = projectCanonicalEntities(novel({
      chapters: [chapter('early', 0, earlyText), chapter('late', 2, lateText)], characters: [raw],
    }))
    expect(result.characters[0].personality).toBe('')
    expect(result.issues.some(issue => issue.field === 'personality' && issue.revisionId === 'early' && issue.reason === 'raw_mismatch')).toBe(true)
  })

  it('checks raw mismatch at a finite boundary when the latest write is already in scope', () => {
    const content = '林澈初见。'
    const base = character()
    const create = captureEntityRevision('character', undefined, base, { kind: 'author' }, '2026-01-01', 'create')
    const past = revision('character', 'character-1', 'past', sourceFor('c0', 0, content, content, 0), [
      { field: 'personality', after: '章节确认' },
    ])
    const raw = { ...base, personality: '并发手改', provenance: { revisions: [create, past] } }
    const result = projectCanonicalEntities(novel({ chapters: [chapter('c0', 0, content)], characters: [raw] }), 1)
    expect(result.characters[0].personality).toBe('')
    expect(result.issues.some(issue => issue.field === 'personality' && issue.revisionId === 'past' && issue.reason === 'raw_mismatch')).toBe(true)
  })

  it('silently excludes a future-only creation at an earlier boundary', () => {
    const content = '林澈初见。'
    const created = captureEntityRevision(
      'character', undefined, character(), sourceFor('future', 2, content, content, 0), '2026-01-01', 'future-create',
    )
    const raw = { ...character(), provenance: { revisions: [created] } }
    const result = projectCanonicalEntities(novel({ chapters: [chapter('future', 2, content)], characters: [raw] }), 2)
    expect(result.characters).toHaveLength(0)
    expect(result.issues).toEqual([])
  })

  it('does not turn a later chapter update into a baseline before chapter creation', () => {
    const content = '林澈初见。'
    const base = character()
    const created = captureEntityRevision(
      'character', undefined, base, sourceFor('c1', 1, content, content, 0), '2026-01-01', 'created',
    )
    const createdEntity = { ...base, provenance: { revisions: [created] } }
    const updated = { ...createdEntity, personality: '后来确认' }
    const update = captureEntityRevision(
      'character', createdEntity, updated, sourceFor('c1', 1, content, content, 0), '2026-01-02', 'later-update', ['personality'],
    )
    expect(update.baseline).toBeUndefined()
    const raw = { ...updated, provenance: { revisions: [created, update] } }
    const earlier = projectCanonicalEntities(novel({ chapters: [chapter('c1', 1, content)], characters: [raw] }), 1)
    expect(earlier.characters).toHaveLength(0)
    expect(earlier.issues).toEqual([])

    const current = projectCanonicalEntities(novel({ chapters: [chapter('c1', 1, content)], characters: [raw] }))
    expect(current.characters[0].personality).toBe('后来确认')
  })

  it('requires exact quotes and safe integer offsets without trimming', () => {
    const content = '林澈进入城门。'
    const item = character() as Record<string, unknown>
    item.provenance = { revisions: [revision('character', 'character-1', 'bad-evidence', sourceFor('c1', 0, content, ' 林澈进入城门。'), [{ field: '$exists', after: true }])] }
    const result = projectCanonicalEntities(novel({ chapters: [chapter('c1', 0, content)], characters: [item] }))
    expect(result.characters).toHaveLength(0)
    expect(result.issues.some(issue => issue.reason.includes('evidence_not_found'))).toBe(true)
  })

  it('keeps source ai events without provenance out of facts', () => {
    const result = projectCanonicalEntities(novel({ eventLog: [{ ...event(), source: 'ai' }] }))
    expect(result.events).toHaveLength(0)
    expect(result.issues[0].reason).toBe('source_ai_without_provenance')
  })

  it('does not seed an AI event from an unrelated partial update', () => {
    const content = '城门关闭。'
    const before = { ...event(), source: 'ai' as const, status: 'developing' as const }
    const after = { ...before, status: 'resolved' as const }
    const chapterUpdate = captureEntityRevision(
      'event', before, after, sourceFor('c1', 0, content, content, 0), '2026-01-01', 'ai-status', ['status'],
    )
    expect(chapterUpdate.baseline).toBeUndefined()
    const raw = { ...after, provenance: { revisions: [chapterUpdate] } }
    const result = projectCanonicalEntities(novel({ chapters: [chapter('c1', 0, content)], eventLog: [raw] }))
    expect(result.events).toHaveLength(0)
    expect(result.issues.some(issue => issue.reason === 'entity_existence_unconfirmed')).toBe(true)

    const authorTargetOnly = captureEntityRevision(
      'event', before, { ...before, targetChapter: 3 }, { kind: 'author' }, '2026-01-02', 'ai-target', ['targetChapter'],
    )
    expect(authorTargetOnly.baseline).toBeUndefined()
    const targetOnly = { ...before, targetChapter: 3, provenance: { revisions: [authorTargetOnly] } }
    expect(projectCanonicalEntities(novel({ eventLog: [targetOnly] })).events).toHaveLength(0)

    const authorConfirmation = captureEntityRevision(
      'event', before, { ...before, title: '作者确认事件' }, { kind: 'author' }, '2026-01-03', 'ai-confirm', ['$exists', 'title'],
    )
    const confirmed = { ...before, title: '作者确认事件', provenance: { revisions: [authorConfirmation] } }
    const confirmedResult = projectCanonicalEntities(novel({ eventLog: [confirmed] }))
    expect(confirmedResult.events).toHaveLength(1)
    expect(confirmedResult.events[0].title).toBe('作者确认事件')
  })
})
