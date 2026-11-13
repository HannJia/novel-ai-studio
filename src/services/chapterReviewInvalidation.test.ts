import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { characterStateFixture, stateTestTime as now } from '@/test/characterStateFixture'
import type { ChapterReview, ReconstructionWorkspaceSnapshot } from '@/types/reconstruction'
import { buildChapterReviewSignature, buildChapterReviewSourceVersion, buildReviewContextVersion } from './reconstructionReviewVersion'
import { withStoryReviewInvalidation, invalidateChapterReviews } from './chapterReviewInvalidation'
import { registerChapterReviewInvalidation, retainCompletedCandidateSource } from './chapterReviewInvalidationRequests'

const coverageFor = (signature: string, source: string, overrides: Record<string, unknown> = {}) => ({
  signature, totalChunks: 1, completedChunks: 1, coveredCharacters: source.length, totalCharacters: source.length,
  globalStatus: 'not-needed' as const, status: 'complete' as const, ...overrides,
})

function review(chapterId: string, sourceVersionId: string): ChapterReview {
  return { id: 'review-1', chapterId, sourceVersionId, startedAt: now, completedAt: now, deterministicChecksPassed: true,
    semanticChecksPassed: true, findings: [], candidateChanges: [], status: 'ready_to_finalize' }
}

describe('chapter review invalidation coordinator', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('keeps the public invalidation helper conservative outside a transaction', () => {
    const { novel } = characterStateFixture()
    const chapter = novel.chapters[0]
    chapter.content = '已写正文'; chapter.status = 'finalized'; chapter.contentReviewSignature = 'old'
    expect(invalidateChapterReviews(novel, [chapter.id])).toEqual([chapter.id])
    expect(chapter.contentReviewSignature).toBe('')
    expect(chapter.status).toBe('writing')
  })

  it('updates a directly returned registration array in place when the input is unchanged', () => {
    const { novel } = characterStateFixture(), chapter = novel.chapters[0]
    chapter.content = '保留审核的正文'; chapter.status = 'finalized'; chapter.contentReviewSignature = 'existing'
    const workspace: ReconstructionWorkspaceSnapshot = { candidates: [], reviewFindings: [], chapterReviews: [], aiRuns: [], canonMutations: [] }
    let retained: string[] | undefined
    const result = withStoryReviewInvalidation({ novel, workspace }, [], () => {
      retained = registerChapterReviewInvalidation(novel, [chapter.id])
      novel.updatedAt = '2026-10-31T00:00:00.000Z'
      return retained
    })
    expect(result.value).toBe(retained)
    expect(retained).toEqual([])
    expect(chapter.contentReviewSignature).toBe('existing')
    expect(chapter.status).toBe('finalized')
  })

  it.each([
    ['missing coverage', undefined],
    ['failed coverage', { status: 'failed', completedChunks: 0, coveredCharacters: 0 }],
    ['incomplete coverage', { completedChunks: 0, coveredCharacters: 0 }],
  ])('does not preserve a matching signature with %s', (_label, changes) => {
    const { novel } = characterStateFixture(), chapter = novel.chapters[0]
    chapter.content = '需要完整审核的正文'; chapter.status = 'finalized'
    const workspace: ReconstructionWorkspaceSnapshot = { candidates: [], reviewFindings: [], chapterReviews: [], aiRuns: [], canonMutations: [] }
    let sourceVersionId = ''
    withStoryReviewInvalidation({ novel, workspace }, [], () => {
      novel.outline += '新增设定'
      const context = buildReviewContextVersion(novel, chapter), signature = buildChapterReviewSignature(chapter.content, context)
      sourceVersionId = buildChapterReviewSourceVersion(chapter.content, context)
      chapter.contentReviewSignature = signature
      chapter.contentReviewCoverage = changes === undefined ? undefined : coverageFor(signature, chapter.content, changes)
      ;(workspace.chapterReviews ||= []).push(review(chapter.id, sourceVersionId))
    })
    expect(chapter.contentReviewSignature).toBe('')
    expect(chapter.contentReviewCoverage).toBeUndefined()
    expect(chapter.status).toBe('writing')
  })

  it('preserves a current, source-matched review only when coverage is complete', () => {
    const { novel } = characterStateFixture(), chapter = novel.chapters[0]
    chapter.content = '完整审核的正文'; chapter.status = 'finalized'
    const workspace: ReconstructionWorkspaceSnapshot = { candidates: [], reviewFindings: [], chapterReviews: [], aiRuns: [], canonMutations: [] }
    withStoryReviewInvalidation({ novel, workspace }, [], () => {
      novel.outline += '新增设定'
      const context = buildReviewContextVersion(novel, chapter), signature = buildChapterReviewSignature(chapter.content, context)
      const sourceVersionId = buildChapterReviewSourceVersion(chapter.content, context)
      chapter.contentReviewSignature = signature
      chapter.contentReviewCoverage = coverageFor(signature, chapter.content)
      ;(workspace.chapterReviews ||= []).push(review(chapter.id, sourceVersionId))
    })
    expect(chapter.contentReviewSignature).not.toBe('')
    expect(chapter.contentReviewCoverage?.status).toBe('complete')
    expect(chapter.status).toBe('finalized')
  })

  it('rejects a historical report with the wrong source even when the signature is current', () => {
    const { novel } = characterStateFixture(), chapter = novel.chapters[0]
    chapter.content = '来源必须匹配的正文'; chapter.status = 'finalized'
    const workspace: ReconstructionWorkspaceSnapshot = { candidates: [], reviewFindings: [], chapterReviews: [], aiRuns: [], canonMutations: [] }
    withStoryReviewInvalidation({ novel, workspace }, [], () => {
      novel.outline += '新增设定'
      const context = buildReviewContextVersion(novel, chapter), signature = buildChapterReviewSignature(chapter.content, context)
      chapter.contentReviewSignature = signature
      chapter.contentReviewCoverage = coverageFor(signature, chapter.content)
      ;(workspace.chapterReviews ||= []).push(review(chapter.id, 'historical-source'))
    })
    expect(chapter.contentReviewSignature).toBe('')
    expect(chapter.status).toBe('writing')
  })

  it('reports a changed global input for rereview even without a graph range', () => {
    const { novel } = characterStateFixture(), chapter = novel.chapters[0]
    chapter.content = '全局输入变化的正文'; chapter.status = 'finalized'
    const workspace: ReconstructionWorkspaceSnapshot = { candidates: [], reviewFindings: [], chapterReviews: [], aiRuns: [], canonMutations: [] }
    const result = withStoryReviewInvalidation({ novel, workspace }, [], () => {
      novel.outline += '全局设定变化'
      return [] as string[]
    })
    expect(result.reviewChapterIds).toContain(chapter.id)
    expect(result.value).toEqual([])
  })

  it.each([false, true])('retains only an identical completed candidate source (body changed=%s)', changed => {
    const { novel } = characterStateFixture(), chapter = novel.chapters[0]
    chapter.status = 'completed'; chapter.contentReviewSignature = 'old'
    const workspace: ReconstructionWorkspaceSnapshot = { candidates: [], reviewFindings: [], chapterReviews: [], aiRuns: [], canonMutations: [] }
    withStoryReviewInvalidation({ novel, workspace }, [], () => {
      retainCompletedCandidateSource(novel, chapter.id)
      novel.outline += '入典后需重审的依据'
      if (changed) chapter.content += '正文改动'
    })
    expect(chapter.contentReviewSignature).toBe('')
    expect(chapter.status).toBe(changed ? 'writing' : 'completed')
  })
})
