import { describe, expect, it } from 'vitest'
import { deriveReviewCenter } from './reviewCenter'
import { buildChapterReviewSourceVersion } from '@/services/chapterReviewIdentity'
import { buildChapterReviewSignature } from '@/services/chapterReviewIdentity'
import { buildAnalysisSourceVersionId } from '@/services/reconstructionCandidates'
import type { Chapter, Novel } from '@/types/novel'
import type { CandidateChange } from '@/types/reconstruction'

const chapter = (over: Partial<Chapter> = {}): Chapter => ({ id: 'c1', volumeIndex: -1, chapterIndex: 0, title: '第一章', content: '正文内容', summary: '', wordCount: 4, status: 'writing', createdAt: '', updatedAt: '', ...over })
const novel = (chapters: Chapter[]): Novel => ({ id: 'n1', title: '测试', genre: '', subGenre: '', genreLabel: '', subGenreLabel: '', tags: [], targetWordCountMin: 1, targetWordCountMax: 2, currentWordCount: chapters.reduce((sum, row) => sum + row.wordCount, 0), writingStyle: {} as Novel['writingStyle'], writingMode: 'manual', settings: {} as Novel['settings'], outline: '', synopsis: '', volumes: [], chapters, characters: [], chatHistory: [], knowledgeBaseIds: [], eventLog: [], storyArcs: [], chapterPlans: [], storyStateProposals: [], dataPanels: [], dataPanelChanges: [], chapterLengthPolicy: { minWords: 1, targetWords: 5, maxWords: 100 }, status: 'writing', createdAt: '', updatedAt: '' })

describe('deriveReviewCenter', () => {
  it('groups chapters into review states and queue items', () => {
    const first = chapter(), second = chapter({ id: 'c2', chapterIndex: 1, content: '', wordCount: 0 })
    const result = deriveReviewCenter({ novel: novel([first, second]), findings: [], candidates: [], reviews: [], impactReports: [], contextVersion: () => 'ctx' })
    expect(result.rows.map(row => row.status)).toEqual(['needs_review', 'empty'])
    expect(result.queue[0]).toMatchObject({ kind: 'review', chapterId: 'c1' })
    expect(result.totals.needsReview).toBe(1)
  })

  it('marks a current review ready and keeps pending findings in the queue', () => {
    const row = chapter({ content: '足够的正文', wordCount: 5 })
    const version = buildChapterReviewSourceVersion(row.content, 'ctx')
    row.contentReviewSignature = buildChapterReviewSignature(row.content, 'ctx')
    row.contentReviewCoverage = { signature: row.contentReviewSignature, totalChunks: 1, completedChunks: 1, coveredCharacters: row.content.length, totalCharacters: row.content.length, globalStatus: 'not-needed', status: 'complete' }
    const result = deriveReviewCenter({ novel: novel([row]), findings: [], candidates: [], impactReports: [], contextVersion: () => 'ctx', reviews: [{ id: 'r', chapterId: row.id, sourceVersionId: version, startedAt: '2026-01-01', completedAt: '2026-01-02', deterministicChecksPassed: true, semanticChecksPassed: true, findings: [], candidateChanges: [], status: 'ready_to_finalize' }] })
    expect(result.rows[0].status).toBe('ready')
    expect(result.totals.reviewed).toBe(1)
  })

  it('does not show an old impact reason after the chapter is reviewed against the current context', () => {
    const row = chapter({ content: '设定更新后的正文', wordCount: 8 })
    const version = buildChapterReviewSourceVersion(row.content, 'ctx')
    row.contentReviewSignature = buildChapterReviewSignature(row.content, 'ctx')
    row.contentReviewCoverage = { signature: row.contentReviewSignature, totalChunks: 1, completedChunks: 1, coveredCharacters: row.content.length, totalCharacters: row.content.length, globalStatus: 'not-needed', status: 'complete' }
    const result = deriveReviewCenter({
      novel: novel([row]), findings: [], candidates: [], contextVersion: () => 'ctx',
      reviews: [{ id: 'current', chapterId: row.id, sourceVersionId: version, startedAt: '2026-01-01', completedAt: '2026-01-02', deterministicChecksPassed: true, semanticChecksPassed: true, findings: [], candidateChanges: [], status: 'ready_to_finalize' }],
      impactReports: [{ id: 'impact-1', novelId: 'n1', version: 1, createdAt: '2025-12-01', beforeVersion: 'before', afterVersion: 'after', changes: [], affected: [], mentions: [], reviewPolicy: 'all-written', reviewChapterIds: [row.id] }],
    })
    expect(result.rows[0].status).toBe('ready')
    expect(result.rows[0].invalidationReason).toBe('')
  })

  const reviewedChapter = (content: string, ctx: string, over: Partial<Chapter> = {}) => {
    const row = chapter({ content, wordCount: content.length, ...over })
    row.contentReviewSignature = buildChapterReviewSignature(content, ctx)
    row.contentReviewCoverage = { signature: row.contentReviewSignature, totalChunks: 1, completedChunks: 1, coveredCharacters: content.length, totalCharacters: content.length, globalStatus: 'not-needed', status: 'complete' }
    const review = { id: 'r-' + row.id, chapterId: row.id, sourceVersionId: buildChapterReviewSourceVersion(content, ctx), startedAt: '2026-01-01', completedAt: '2026-01-02', deterministicChecksPassed: true, semanticChecksPassed: true, findings: [], candidateChanges: [], status: 'ready_to_finalize' as const }
    return { row, review }
  }

  it('does not show coverage left over from an earlier version of the text as current', () => {
    const { row, review } = reviewedChapter('修改之前的正文', 'ctx')
    row.content = '修改之后的完全不同的正文内容'
    row.wordCount = row.content.length
    const result = deriveReviewCenter({ novel: novel([row]), findings: [], candidates: [], impactReports: [], contextVersion: () => 'ctx', reviews: [review] })
    expect(result.rows[0].coveragePercent).toBe(0)
    expect(result.rows[0].reviewStale).toBe(true)
    expect(result.rows[0].heat).toBe('stale')
  })

  it('separates a chapter that was never reviewed from one whose review has gone stale', () => {
    const never = chapter({ id: 'never', chapterIndex: 0, content: '从未审校的正文', wordCount: 7 })
    const { row: stale, review } = reviewedChapter('曾经审校过的正文', 'old-ctx', { id: 'stale', chapterIndex: 1 })
    const result = deriveReviewCenter({ novel: novel([never, stale]), findings: [], candidates: [], impactReports: [], contextVersion: () => 'new-ctx', reviews: [review] })
    expect(result.rows.map(row => row.reviewStale)).toEqual([false, true])
    expect(result.rows.map(row => row.heat)).toEqual(['drafting', 'stale'])
    expect(result.rows[0].status).toBe('needs_review')
    expect(result.rows[1].status).toBe('needs_review')
    expect(result.totals.needsReview).toBe(2)
    expect(result.totals.stale).toBe(1)
    expect(result.queue.map(item => item.title)).toEqual(['本章尚未审校', '审核已失效，需要重新审校'])
  })

  it('keeps a finalized chapter stale when its review no longer matches the current context', () => {
    const { row, review } = reviewedChapter('已经定稿的正文', 'old-ctx', { status: 'finalized' })
    const result = deriveReviewCenter({ novel: novel([row]), findings: [], candidates: [], impactReports: [], contextVersion: () => 'new-ctx', reviews: [review] })
    expect(result.rows[0].status).toBe('finalized')
    expect(result.rows[0].reviewStale).toBe(true)
    expect(result.rows[0].heat).toBe('stale')
    expect(result.totals.stale).toBe(1)
    expect(result.totals.needsReview).toBe(0)
  })

  it('does not say a never-reviewed chapter was invalidated just because an impact report mentions it', () => {
    const never = chapter({ id: 'never', content: '从未审校的正文', wordCount: 7 })
    const { row: reviewed, review } = reviewedChapter('审校过的正文', 'old-ctx', { id: 'reviewed', chapterIndex: 1 })
    const impact = { id: 'impact-1', novelId: 'n1', version: 1 as const, createdAt: '2025-12-01', beforeVersion: 'before', afterVersion: 'after', changes: [], affected: [], mentions: [], reviewPolicy: 'all-written' as const, reviewChapterIds: ['never', 'reviewed'] }
    const result = deriveReviewCenter({ novel: novel([never, reviewed]), findings: [], candidates: [], impactReports: [impact], contextVersion: () => 'new-ctx', reviews: [review] })
    expect(result.rows[0].reviewStale).toBe(false)
    expect(result.rows[0].invalidationReason).toBe('尚未完成本章审校')
    expect(result.rows[1].reviewStale).toBe(true)
    expect(result.rows[1].invalidationReason).not.toBe('')
    expect(result.queue.find(item => item.chapterId === 'never')?.detail).toBe('尚未完成本章审校')
  })

  it('does not mark a current finalized chapter or an empty chapter stale', () => {
    const { row, review } = reviewedChapter('已经定稿的正文', 'ctx', { id: 'done', status: 'finalized' })
    const empty = chapter({ id: 'blank', chapterIndex: 1, content: '', wordCount: 0 })
    const planned = chapter({ id: 'plan', chapterIndex: 2, content: '', wordCount: 0, sceneNotes: [{ id: 's', title: '场景', summary: '' }] as unknown as Chapter['sceneNotes'] })
    const result = deriveReviewCenter({ novel: novel([row, empty, planned]), findings: [], candidates: [], impactReports: [], contextVersion: () => 'ctx', reviews: [review] })
    expect(result.rows.map(item => item.heat)).toEqual(['final', 'idea', 'outlined'])
    expect(result.totals.stale).toBe(0)
  })

  it('orders the queue by severity, then chapter, and labels each item with its real level and type', () => {
    const first = chapter({ id: 'a', chapterIndex: 0, content: '甲章正文内容', wordCount: 6 })
    const second = chapter({ id: 'b', chapterIndex: 1, content: '乙章正文内容', wordCount: 6 })
    const finding = (id: string, chapterId: string, severity: 'blocker' | 'warning' | 'suggestion', type: 'knowledge' | 'timeline' | 'pacing', title: string) => ({
      id, chapterId, type, severity, title, explanation: '说明', sourceVersionId: buildAnalysisSourceVersionId(chapterId === 'a' ? first.content : second.content),
      evidence: [], blocksFinalization: severity === 'blocker', status: 'open' as const,
    })
    const result = deriveReviewCenter({
      novel: novel([first, second]), candidates: [], reviews: [], impactReports: [], contextVersion: () => 'ctx',
      findings: [finding('f1', 'b', 'suggestion', 'pacing', '节奏问题'), finding('f2', 'b', 'blocker', 'knowledge', '知情问题'), finding('f3', 'a', 'warning', 'timeline', '时间问题')],
    })
    const findings = result.queue.filter(item => item.kind === 'finding')
    expect(findings.map(item => [item.level, item.chapterIndex, item.category])).toEqual([
      ['blocker', 1, '知情冲突'], ['warning', 0, '时间线'], ['suggestion', 1, '节奏'],
    ])
    expect(result.queue[result.queue.length - 1].kind).toBe('review')
  })

  it('shows readable event titles for causality candidates without exposing serialized IDs', () => {
    const row = chapter({ content: '火灾导致盐价上涨', wordCount: 8 })
    const data = novel([row])
    data.eventLog = [
      { id: 'event-fire', chapterIndex: 0, title: '盐仓失火', description: '', characters: [], type: '主线', timestamp: '' },
      { id: 'event-price', chapterIndex: 0, title: '盐价上涨', description: '', characters: [], type: '主线', timestamp: '' },
    ]
    const candidate: CandidateChange = {
      id: 'cause-candidate', novelId: data.id, chapterId: row.id, type: 'event_causality',
      proposedValue: JSON.stringify({ fromEventId: 'event-fire', toEventId: 'event-price', relation: 'causes', explanation: '火灾导致盐价上涨' }),
      evidence: [], status: 'proposed', createdAt: '', updatedAt: '',
    }
    const malformed = { ...candidate, id: 'malformed-candidate', proposedValue: '{"fromEventId":"internal-event-id"' }

    const result = deriveReviewCenter({ novel: data, findings: [], candidates: [candidate, malformed], reviews: [], impactReports: [], contextVersion: () => 'ctx' })
    const detail = result.queue.find(item => item.kind === 'candidate')?.detail || ''
    const malformedDetail = result.queue.find(item => item.id === 'candidate:malformed-candidate')?.detail || ''

    expect(detail).toContain('盐仓失火')
    expect(detail).toContain('盐价上涨')
    expect(detail).toContain('导致')
    expect(detail).not.toContain('event-fire')
    expect(detail).not.toContain('event-price')
    expect(detail).not.toContain('fromEventId')
    expect(malformedDetail).toBe('候选内容无法解析，请在写作台核对。')
    expect(malformedDetail).not.toContain('internal-event-id')
  })
})
