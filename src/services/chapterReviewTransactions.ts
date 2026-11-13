import type { ChapterReview, ReviewFinding } from '@/types/reconstruction'
import type { StoryAggregate } from './storyAggregate'
import type { StoredReviewCoverage } from './chapterReviewCoverage'
import type { ReviewKnowledgeRevisions } from './reconstructionReviewVersion'
import { buildChapterReviewSignature, buildReviewContextVersion } from './reconstructionReviewVersion'
import { storyDecisionSourceVersion } from './storyDecisions'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import { contentReviewVerdict } from './contentReview'
import { isFindingBlocking } from './reconstructionReview'
import { isReviewCoverageComplete } from './chapterReviewAcceptance'

export interface ChapterReviewSubmission {
  chapterId: string
  content: string
  report: string
  review: ChapterReview
  coverage: StoredReviewCoverage
}

function sameFinding(left: ReviewFinding, right: ReviewFinding) {
  return left.id === right.id && left.chapterId === right.chapterId && left.sourceVersionId === right.sourceVersionId
    && left.type === right.type && left.severity === right.severity && left.title === right.title
    && left.explanation === right.explanation && left.suggestedFix === right.suggestedFix
    && left.blocksFinalization === right.blocksFinalization && JSON.stringify(left.evidence) === JSON.stringify(right.evidence)
}

/** Save one completed inspection with its manuscript report. Progress checkpoints remain separate. */
export function saveChapterReviewSnapshot(aggregate: StoryAggregate, input: ChapterReviewSubmission, now: string,
  knowledge: ReviewKnowledgeRevisions = []) {
  const { novel, workspace } = aggregate
  const chapter = novel.chapters.find(row => row.id === input.chapterId)
  if (!chapter || chapter.status === 'locked' || chapter.content !== input.content) throw new Error('正文已变化或章节已锁定，审核结果未保存。')
  const version = storyDecisionSourceVersion(aggregate, chapter.id, knowledge)
  if (input.review.chapterId !== chapter.id || input.review.sourceVersionId !== version) throw new Error('审核依据已变化，请重新审核。')
  const signature = buildChapterReviewSignature(chapter.content, buildReviewContextVersion(novel, chapter, knowledge,
    workspace.creationDraft, workspace.canonMutations, workspace.storyMemories))
  if (!input.report.trim() || !isReviewCoverageComplete(input.coverage, signature, chapter.content)) throw new Error('审核报告或覆盖尚未完整，未保存为已完成审核。')
  const bodyVersion = buildAnalysisSourceVersionId(chapter.content)
  if (input.review.findings.some(row => row.chapterId !== chapter.id || row.sourceVersionId !== bodyVersion)
    || new Set(input.review.findings.map(row => row.id)).size !== input.review.findings.length) throw new Error('审核问题的来源或编号无效，未保存。')
  const replaced = (workspace.chapterReviews || []).filter(row => row.chapterId === chapter.id && row.sourceVersionId === version)
  if ((workspace.chapterReviews || []).some(row => row.id === input.review.id
    && (row.chapterId !== chapter.id || row.sourceVersionId !== version))) throw new Error('审核记录编号冲突，未保存。')
  const previous = replaced[replaced.length - 1]
  const findings = input.review.findings.map(row => {
    const old = workspace.reviewFindings.find(value => sameFinding(value, row))
    return old && previous?.findings.some(value => sameFinding(value, row)) && old.status !== 'stale'
      ? { ...row, status: old.status, authorNote: old.authorNote } : row
  })
  const verdict = contentReviewVerdict(input.report)
  if (verdict === 'unknown') throw new Error('审核报告格式未能识别，未保存为已完成审核。')
  const semanticChecksPassed = verdict === 'passed'
  const archives = [...new Map([...replaced.flatMap(row => row.findingReconciliations || []),
    ...(input.review.findingReconciliations || [])].map(row => [row.id, row])).values()]
  const review: ChapterReview = { ...input.review, id: previous?.id || input.review.id,
    startedAt: previous?.startedAt || input.review.startedAt, completedAt: input.review.completedAt || now,
    findings, semanticChecksPassed, candidateChanges: workspace.candidates.filter(row => row.chapterId === chapter.id
      && (!row.sourceVersionId || row.sourceVersionId === bodyVersion)),
    status: input.review.deterministicChecksPassed && semanticChecksPassed && !findings.some(isFindingBlocking)
      ? 'ready_to_finalize' : 'needs_revision',
    ...(archives.length ? { findingReconciliations: archives } : {}),
  }
  const reviewMeaning = (value: ChapterReview) => {
    const { startedAt: _start, completedAt: _end, ...rest } = value
    return JSON.stringify(rest)
  }
  if (replaced.length === 1 && previous && chapter.contentReview === input.report && chapter.contentReviewSignature === signature
    && JSON.stringify(chapter.contentReviewCoverage) === JSON.stringify(input.coverage)
    && JSON.stringify(workspace.reviewFindings.filter(row => row.chapterId === chapter.id)) === JSON.stringify(findings)
    && reviewMeaning(previous) === reviewMeaning(review)) return { review: previous, changed: false }
  workspace.reviewFindings = [...workspace.reviewFindings.filter(row => row.chapterId !== chapter.id), ...findings]
  workspace.chapterReviews = [...(workspace.chapterReviews || []).filter(row => !(row.chapterId === chapter.id && row.sourceVersionId === version)), review]
  Object.assign(chapter, { contentReview: input.report, contentReviewSignature: signature, contentReviewCoverage: input.coverage, updatedAt: now })
  if (review.status === 'needs_revision' && ['reviewed', 'completed', 'finalized'].includes(chapter.status)) chapter.status = 'writing'
  novel.updatedAt = now
  return { review, changed: true }
}
