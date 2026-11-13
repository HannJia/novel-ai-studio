import type { Novel } from '@/types/novel'
import type { KnowledgeBase } from '@/types/knowledge'
import type { StoryAggregate } from './storyAggregate'
import { buildReviewContextVersion, buildChapterReviewSignature, buildChapterReviewSourceVersion } from './reconstructionReviewVersion'
import { isReviewCoverageComplete } from './chapterReviewAcceptance'
import { beginChapterReviewInvalidationScope, clearChapterReview, endChapterReviewInvalidationScope, registerChapterReviewInvalidation } from './chapterReviewInvalidationRequests'

interface ReviewIdentity { signature: string; sourceVersionId: string }

/** During a story transaction, defer legacy invalidation requests until actual inputs are compared. */
export function invalidateChapterReviews(novel: Novel, chapterIds: string[]): string[] {
  return registerChapterReviewInvalidation(novel, chapterIds)
}

function reviewInputs(aggregate: StoryAggregate, knowledge: KnowledgeBase[]): Map<string, ReviewIdentity> {
  const { novel, workspace } = aggregate
  return new Map(novel.chapters.filter(chapter => chapter.content.trim()).map(chapter => {
    const context = buildReviewContextVersion(novel, chapter, knowledge, workspace.creationDraft, workspace.canonMutations, workspace.storyMemories)
    return [chapter.id, { signature: buildChapterReviewSignature(chapter.content, context),
      sourceVersionId: buildChapterReviewSourceVersion(chapter.content, context) }]
  }))
}

/** Run one synchronous mutation against a private aggregate, before its atomic durable save. */
export function withStoryReviewInvalidation<R>(aggregate: StoryAggregate, knowledge: KnowledgeBase[], operation: () => R) {
  const { novel, workspace } = aggregate
  const capturedKnowledge = JSON.parse(JSON.stringify(knowledge)) as KnowledgeBase[]
  const before = reviewInputs(aggregate, capturedKnowledge)
  const priorReports = new Set((workspace.impactReports || []).map(report => report.id))
  let value: R
  let requests: string[][] = []
  const scope = beginChapterReviewInvalidationScope(novel)
  try {
    value = operation()
    if (value && typeof (value as { then?: unknown }).then === 'function') throw new Error('故事事务修改必须同步完成')
  } finally { requests = endChapterReviewInvalidationScope(novel) }
  const after = reviewInputs(aggregate, capturedKnowledge), invalidated = new Set<string>()
  for (const chapter of novel.chapters) {
    const previous = before.get(chapter.id), current = after.get(chapter.id)
    if (previous?.signature === current?.signature) continue
    // Accepting an already reviewed candidate may publish its matching report in this transaction.
    const matchingReview = current && chapter.contentReviewSignature === current.signature
      && isReviewCoverageComplete(chapter.contentReviewCoverage, current.signature, chapter.content)
      && workspace.chapterReviews?.some(review => review.chapterId === chapter.id
        && review.sourceVersionId === current.sourceVersionId && review.completedAt !== undefined
        && review.status !== 'running' && review.status !== 'failed')
    if (matchingReview) continue
    clearChapterReview(chapter)
    // Keep the analysis receipt only for an explicit own-candidate acceptance and
    // an identical body. Review signature/coverage remain cleared until rereview.
    if (scope.completedSources.get(chapter.id) === chapter.content) chapter.status = 'completed'
    if (current) invalidated.add(chapter.id)
  }
  // Keep every returned registration array live while narrowing it to the actual
  // invalidation set. This also updates arrays retained by callers or result objects.
  for (const requested of requests) requested.splice(0, requested.length, ...requested.filter(id => invalidated.has(id)))
  for (const report of workspace.impactReports || []) if (!priorReports.has(report.id)) {
    report.reviewPolicy = 'changed-inputs'
    report.reviewChapterIds = [...invalidated]
  }
  return { value, reviewChapterIds: [...invalidated], assertKnowledgeCurrent(currentKnowledge: KnowledgeBase[]) {
    const current = reviewInputs(aggregate, currentKnowledge)
    if (current.size !== after.size || [...after].some(([id, input]) => current.get(id)?.signature !== input.signature)) {
      throw new Error('知识库参考已变化，本次故事修改未保存，请核对后重试。')
    }
  } }
}
