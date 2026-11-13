import { describe, expect, it } from 'vitest'
import type { KnowledgeSummaryCoverage } from '@/types/knowledge'
import type { Novel } from '@/types/novel'
import type { StoryMemoryRecord, StoryMemoryScope } from '@/types/storyMemory'
import {
  assertStoryMemoryRecord,
  createStoryMemoryBinding,
  formatStoryMemoryContext,
  getStoryMemoryStatus,
  resolveStoryMemorySource,
  storyMemorySignature,
} from './storyMemory'

const NOW = '2026-10-28T00:00:00.000Z'

function makeNovel(): Novel {
  const chapters = [
    { id: 'c1', volumeIndex: 0, chapterIndex: 0, title: '晨雾', content: '甲😀乙', summary: '', wordCount: 4 },
    { id: 'c2', volumeIndex: 0, chapterIndex: 1, title: '渡口', content: '第二章正文', summary: '', wordCount: 6 },
    { id: 'c3', volumeIndex: 1, chapterIndex: 2, title: '夜城', content: '第三章正文', summary: '', wordCount: 6 },
  ]
  const volumes = [
    { id: 'v1', volumeIndex: 0, title: '第一卷', theme: '', summary: '', keyTurningPoints: '', characterChanges: '', estimatedChapters: 2, estimatedWordCount: 1 },
    { id: 'v2', volumeIndex: 1, title: '第二卷', theme: '', summary: '', keyTurningPoints: '', characterChanges: '', estimatedChapters: 1, estimatedWordCount: 1 },
  ]
  return { id: 'novel-1', chapters, volumes } as unknown as Novel
}

function makeRecord(novel: Novel, scope: StoryMemoryScope, title = '正文记忆', summary = '已写正文内容'): StoryMemoryRecord {
  return {
    id: `record-${title}`,
    novelId: novel.id,
    title,
    scope,
    summary,
    source: createStoryMemoryBinding(novel, scope, summary, 'author', NOW),
    history: [],
  }
}

function makeCoverage(novel: Novel, scope: StoryMemoryScope): KnowledgeSummaryCoverage {
  const source = resolveStoryMemorySource(novel, scope)
  return {
    version: 1,
    strategy: 'full-source-hierarchical',
    sources: source.chapters.map(chapter => ({
      entryId: chapter.chapterId,
      sourceVersionId: chapter.sourceVersionId,
      contentLength: chapter.content.length,
      ranges: [{ start: 0, end: chapter.content.length }],
    })),
    leafCount: source.chapters.length,
    requestCount: source.chapters.length,
    inputTokens: 1,
    outputTokens: 1,
    usageEstimated: false,
  }
}

describe('story memory source resolution', () => {
  it('resolves a non empty scene range without splitting a UTF16 surrogate pair', () => {
    const novel = makeNovel()
    const scope: StoryMemoryScope = { kind: 'scene', chapterId: 'c1', startOffset: 1, endOffset: 3 }
    const source = resolveStoryMemorySource(novel, scope)
    expect(source.chapters[0]).toMatchObject({
      chapterId: 'c1', content: '😀', startOffset: 1, endOffset: 3,
    })
    expect(source.chapters[0].sourceVersionId).toContain('|range:1:3')
    expect(() => resolveStoryMemorySource(novel, { ...scope, startOffset: 2 })).toThrow()
    expect(() => resolveStoryMemorySource(novel, { ...scope, endOffset: 2 })).toThrow()
  })

  it('rejects duplicate ids or chapter indexes and resolves volume and book boundaries', () => {
    const novel = makeNovel()
    const volume = resolveStoryMemorySource(novel, { kind: 'volume', volumeId: 'v1', throughChapterId: 'c2' })
    expect(volume.chapters.map(chapter => chapter.chapterId)).toEqual(['c1', 'c2'])
    const book = resolveStoryMemorySource(novel, { kind: 'book', throughChapterId: 'c3' })
    expect(book.chapters.map(chapter => chapter.chapterId)).toEqual(['c1', 'c2', 'c3'])
    expect(() => resolveStoryMemorySource(novel, { kind: 'volume', volumeId: 'v1', throughChapterId: 'c3' })).toThrow()

    const duplicate = makeNovel()
    duplicate.chapters[1].id = duplicate.chapters[0].id
    expect(() => resolveStoryMemorySource(duplicate, { kind: 'book', throughChapterId: 'c3' })).toThrow()
    const duplicateIndex = makeNovel()
    duplicateIndex.chapters[1].chapterIndex = duplicateIndex.chapters[0].chapterIndex
    expect(() => resolveStoryMemorySource(duplicateIndex, { kind: 'book', throughChapterId: 'c3' })).toThrow()

    const reordered = makeNovel()
    const original = resolveStoryMemorySource(reordered, { kind: 'book', throughChapterId: 'c3' }).versionId
    reordered.chapters.reverse()
    expect(resolveStoryMemorySource(reordered, { kind: 'book', throughChapterId: 'c3' }).versionId).toBe(original)
    const emptyBody = makeNovel()
    emptyBody.chapters[1].content = ''
    expect(() => resolveStoryMemorySource(emptyBody, { kind: 'volume', volumeId: 'v1', throughChapterId: 'c2' })).toThrow()
    const noVolumes = makeNovel()
    noVolumes.volumes = []
    noVolumes.chapters.forEach(chapter => { chapter.volumeIndex = -1 })
    expect(resolveStoryMemorySource(noVolumes, { kind: 'book', throughChapterId: 'c3' }).chapters).toHaveLength(3)
    expect(resolveStoryMemorySource(noVolumes, { kind: 'scene', chapterId: 'c1', startOffset: 0, endOffset: 1 }).chapters[0].content).toBe('甲')
    expect(() => resolveStoryMemorySource(noVolumes, { kind: 'volume', volumeId: 'v1', throughChapterId: 'c3' })).toThrow()
    const futureBlank = makeNovel()
    futureBlank.chapters[2].content = '   '
    expect(resolveStoryMemorySource(futureBlank, { kind: 'volume', volumeId: 'v1', throughChapterId: 'c2' }).chapters).toHaveLength(2)
    const selectedBlank = makeNovel()
    selectedBlank.chapters[1].content = '  '
    expect(() => resolveStoryMemorySource(selectedBlank, { kind: 'volume', volumeId: 'v1', throughChapterId: 'c2' })).toThrow()
  })

  it('invalidates source versions for source edits, deletion, movement, and inserted source chapters', () => {
    const novel = makeNovel()
    const scope: StoryMemoryScope = { kind: 'volume', volumeId: 'v1', throughChapterId: 'c2' }
    const record = makeRecord(novel, scope)
    expect(getStoryMemoryStatus(novel, record)).toBe('current')

    const changed = makeNovel()
    changed.chapters[1].content = '重写正文！' // same UTF16 length as the original
    expect(getStoryMemoryStatus(changed, record)).toBe('stale')

    const deleted = makeNovel()
    deleted.chapters = [deleted.chapters[0], deleted.chapters[2]]
    expect(getStoryMemoryStatus(deleted, record)).toBe('stale')

    const moved = makeNovel()
    moved.chapters[1].volumeIndex = 1
    expect(getStoryMemoryStatus(moved, record)).toBe('stale')

    const inserted = makeNovel()
    inserted.chapters[1].chapterIndex = 2
    inserted.chapters.splice(1, 0, {
      id: 'inserted', volumeIndex: 0, chapterIndex: 1, title: '新章', content: '新正文', summary: '', wordCount: 3,
    } as never)
    expect(getStoryMemoryStatus(inserted, record)).toBe('stale')

    const summaryEdited = makeNovel()
    summaryEdited.chapters[1].summary = '新的正式章节总结'
    expect(getStoryMemoryStatus(summaryEdited, record)).toBe('current')
  })
})

describe('story memory bindings and status', () => {
  it('requires complete AI coverage, deep copies it, and allows author confirmation without coverage', () => {
    const novel = makeNovel()
    const scope: StoryMemoryScope = { kind: 'book', throughChapterId: 'c2' }
    expect(() => createStoryMemoryBinding(novel, scope, 'AI 回顾', 'ai', NOW)).toThrow()
    const coverage = makeCoverage(novel, scope)
    const binding = createStoryMemoryBinding(novel, scope, 'AI 回顾', 'ai', NOW, coverage)
    expect(binding.coverage).toEqual(coverage)
    expect(binding.coverage).not.toBe(coverage)
    coverage.sources[0].ranges[0].end = 0
    expect(binding.coverage!.sources[0].ranges[0].end).toBeGreaterThan(0)
    expect(getStoryMemoryStatus(novel, {
      id: 'ai-record', novelId: novel.id, title: 'AI', scope, summary: 'AI 回顾', source: binding, history: [],
    })).toBe('current')

    const wrongCoverage = makeCoverage(novel, scope)
    wrongCoverage.sources[0].sourceVersionId = 'wrong'
    expect(() => createStoryMemoryBinding(novel, scope, 'AI 回顾', 'ai', NOW, wrongCoverage)).toThrow()

    const author = createStoryMemoryBinding(novel, scope, '作者回顾', 'author', NOW, coverage)
    expect(author).not.toHaveProperty('coverage')
    expect(author.origin).toBe('author')
    expect(author.confirmedAt).toBe(NOW)
    expect(createStoryMemoryBinding(novel, scope, 'a'.repeat(6001), 'author', NOW)).toHaveProperty('value')
    expect(() => createStoryMemoryBinding(novel, scope, 'a'.repeat(6001), 'ai', NOW, coverage)).toThrow()

    const repeatedContentNovel = makeNovel()
    repeatedContentNovel.chapters[1].content = repeatedContentNovel.chapters[0].content
    const repeatedScope: StoryMemoryScope = { kind: 'book', throughChapterId: 'c2' }
    const repeatedSource = resolveStoryMemorySource(repeatedContentNovel, repeatedScope)
    expect(repeatedSource.chapters[0].sourceVersionId).not.toBe(repeatedSource.chapters[1].sourceVersionId)
    const repeatedCoverage = makeCoverage(repeatedContentNovel, repeatedScope)
    expect(createStoryMemoryBinding(repeatedContentNovel, repeatedScope, '重复正文回顾', 'ai', NOW, repeatedCoverage)).toHaveProperty('coverage')
  })

  it('does not fall back to history when the current source is stale', () => {
    const novel = makeNovel()
    const scope: StoryMemoryScope = { kind: 'scene', chapterId: 'c2', startOffset: 0, endOffset: 2 }
    const record = makeRecord(novel, scope)
    record.history = [{
      id: 'old', title: '旧记忆', summary: record.source.value, scope, source: record.source, replacedAt: NOW,
    }]
    const changed = makeNovel()
    changed.chapters[1].content = '不同正文'
    expect(getStoryMemoryStatus(changed, record)).toBe('stale')
  })
})

describe('story memory context and backup validation', () => {
  it('filters future records, marks written coverage boundaries, and keeps complete entries', () => {
    const novel = makeNovel()
    const past = makeRecord(novel, { kind: 'scene', chapterId: 'c1', startOffset: 0, endOffset: 1 }, '过去', '甲')
    const future = makeRecord(novel, { kind: 'scene', chapterId: 'c3', startOffset: 0, endOffset: 2 }, '未来', '不应出现')
    const context = formatStoryMemoryContext(novel, [future, past], 2, 1800)
    expect(context).toContain('已写正文回顾')
    expect(context).toContain('覆盖 第 1 章片段 0–1')
    expect(context).toContain('甲')
    expect(context).not.toContain('不应出现')
    expect(context).not.toContain('规划')
  })

  it('keeps disjoint scenes from one chapter and lets a full range cover a narrow range', () => {
    const novel = makeNovel()
    const firstScene = makeRecord(novel, { kind: 'scene', chapterId: 'c1', startOffset: 0, endOffset: 1 }, '开头场景', '开头信息')
    const secondScene = makeRecord(novel, { kind: 'scene', chapterId: 'c1', startOffset: 3, endOffset: 4 }, '结尾场景', '结尾信息')
    const disjoint = formatStoryMemoryContext(novel, [firstScene, secondScene], 1, 1800)
    expect(disjoint).toContain('开头信息')
    expect(disjoint).toContain('结尾信息')

    const narrow = makeRecord(novel, { kind: 'scene', chapterId: 'c1', startOffset: 1, endOffset: 3 }, '窄场景', '窄范围信息')
    const full = makeRecord(novel, { kind: 'volume', volumeId: 'v1', throughChapterId: 'c1' }, '整章广回顾', '整章信息')
    const covered = formatStoryMemoryContext(novel, [narrow, full], 1, 1800)
    expect(covered).toContain('整章信息')
    expect(covered).not.toContain('窄范围信息')
  })

  it('signs every eligible current record even when formatting budget omits it', () => {
    const novel = makeNovel()
    const short = makeRecord(novel, { kind: 'scene', chapterId: 'c1', startOffset: 0, endOffset: 1 }, '短', '短回顾')
    const long = makeRecord(novel, { kind: 'scene', chapterId: 'c2', startOffset: 0, endOffset: 2 }, '长', '长'.repeat(6001))
    const future = makeRecord(novel, { kind: 'scene', chapterId: 'c3', startOffset: 0, endOffset: 2 }, '未来', '未来回顾')
    const records = [future, long, short]
    expect(getStoryMemoryStatus(novel, long)).toBe('current')
    const formatted = formatStoryMemoryContext(novel, records, 2, 100)
    const signature = storyMemorySignature(novel, records, 2)
    expect(formatted).not.toContain('长'.repeat(100))
    expect(signature).toContain('长'.repeat(6001))
    expect(signature).not.toContain('未来回顾')

    const reordered = storyMemorySignature(novel, [short, future, long], 2)
    expect(reordered).toBe(signature)
    long.history.push({ id: 'history-only', title: 'h', summary: 'h', scope: long.scope, source: { ...long.source, value: 'h' }, replacedAt: NOW })
    expect(storyMemorySignature(novel, records, 2)).toBe(signature)
  })

  it('strictly validates record shape, dates, limits, and unique history ids', () => {
    const novel = makeNovel()
    const record = makeRecord(novel, { kind: 'book', throughChapterId: 'c1' })
    expect(() => assertStoryMemoryRecord(record, novel.id)).not.toThrow()
    expect(() => assertStoryMemoryRecord({ ...record, title: '' }, novel.id)).toThrow()
    expect(() => assertStoryMemoryRecord({ ...record, title: 'x'.repeat(201) }, novel.id)).toThrow()
    expect(() => assertStoryMemoryRecord({ ...record, summary: 'x'.repeat(12001) }, novel.id)).toThrow()
    expect(() => assertStoryMemoryRecord({ ...record, source: { ...record.source, confirmedAt: 'not-a-date' } }, novel.id)).toThrow()
    expect(() => assertStoryMemoryRecord({ ...record, source: { ...record.source, confirmedAt: '2026-02-30T00:00:00.000Z' } }, novel.id)).toThrow()
    expect(() => assertStoryMemoryRecord({ ...record, source: { ...record.source, value: '内部不一致' } }, novel.id)).toThrow()
    expect(() => assertStoryMemoryRecord({ ...record, history: [
      { id: 'same', title: 'a', summary: 'a', scope: record.scope, source: record.source, replacedAt: NOW },
      { id: 'same', title: 'b', summary: 'b', scope: record.scope, source: record.source, replacedAt: NOW },
    ] }, novel.id)).toThrow()
    expect(() => assertStoryMemoryRecord({ ...record, history: Array.from({ length: 21 }, (_, index) => ({
      id: `r-${index}`, title: 'a', summary: 'a', scope: record.scope, source: record.source, replacedAt: NOW,
    })) }, novel.id)).toThrow()
    expect(() => assertStoryMemoryRecord(record, 'another-novel')).toThrow()
    expect(getStoryMemoryStatus(novel, { ...record, source: { ...record.source, value: '另一个总结' } })).toBe('unverified')
  })
})
