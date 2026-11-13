import type { Chapter, Novel } from '@/types/novel'

interface ReviewInvalidationScope { requests: string[][]; completedSources: Map<string, string> }
const scopes = new WeakMap<Novel, ReviewInvalidationScope>()

/** Clear one chapter's active review while retaining its durable review history. */
export function clearChapterReview(chapter: Chapter) {
  chapter.contentReviewSignature = ''
  chapter.contentReviewCoverage = undefined
  if (['completed', 'reviewed', 'finalized'].includes(chapter.status)) chapter.status = 'writing'
}

/** Register a conservative invalidation request without importing the heavy projection coordinator. */
export function registerChapterReviewInvalidation(novel: Novel, chapterIds: string[]): string[] {
  const requested = new Set(chapterIds)
  const ids = novel.chapters.filter(chapter => requested.has(chapter.id) && chapter.content.trim()).map(chapter => chapter.id)
  const scope = scopes.get(novel)
  if (scope) scope.requests.push(ids)
  else for (const chapter of novel.chapters) if (requested.has(chapter.id)) clearChapterReview(chapter)
  return ids
}

/** Own candidate decisions change review inputs, not the already extracted manuscript. */
export function retainCompletedCandidateSource(novel: Novel, chapterId: string) {
  const chapter = novel.chapters.find(row => row.id === chapterId)
  if (chapter?.status === 'completed') scopes.get(novel)?.completedSources.set(chapterId, chapter.content)
}

/** Open the private per-novel registration scope used by the transaction coordinator. */
export function beginChapterReviewInvalidationScope(novel: Novel) {
  if (scopes.has(novel)) throw new Error('故事审核事务不能嵌套执行')
  const scope: ReviewInvalidationScope = { requests: [], completedSources: new Map() }
  scopes.set(novel, scope)
  return scope
}

/** Close the registration scope and return all requests made during the operation. */
export function endChapterReviewInvalidationScope(novel: Novel): string[][] {
  const requests = scopes.get(novel)?.requests || []
  scopes.delete(novel)
  return requests
}
