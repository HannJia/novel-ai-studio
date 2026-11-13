import type { Chapter, Novel } from '@/types/novel'
import type { CandidateChange, ChapterReview } from '@/types/reconstruction'
import type { StoredReviewCoverage } from './chapterReviewCoverage'
import type { ChapterReviewSubmission } from './chapterReviewTransactions'
import { buildChapterReviewSignature, buildChapterReviewSourceVersion } from './chapterReviewIdentity'
import { projectChapterReview, type ChapterReviewSources } from './chapterReviewProjection'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import { buildContinuityFindings, mergeReviewFindings, parseReviewFindings } from './reconstructionFindings'
import { contentReviewVerdict } from './contentReview'
import { isFindingBlocking } from './reconstructionReview'
export type { ChapterReviewSources } from './chapterReviewProjection'

/** The same chapter source, local checks and prompt builder for editor, batch and candidate inspections. */
export function buildChapterReviewInput(novel: Novel, chapter: Chapter, sources: ChapterReviewSources = {}, content = chapter.content) {
  // Capture the same data for identity, local checks and every model-request slice.
  // Vue proxies cannot be passed to structuredClone, so use the persisted JSON shape.
  const captured = JSON.parse(JSON.stringify({ novel, chapter, sources })) as { novel: Novel; chapter: Chapter; sources: ChapterReviewSources }
  novel = captured.novel; chapter = captured.chapter; sources = captured.sources
  const target = { ...chapter, content }
  const projected = projectChapterReview(novel, target, sources)
  const { contextVersion } = projected
  return {
    chapterId: chapter.id, content, ...projected,
    signature: buildChapterReviewSignature(content, contextVersion),
    sourceVersionId: buildChapterReviewSourceVersion(content, contextVersion),
  }
}

export type ChapterReviewInput = ReturnType<typeof buildChapterReviewInput>
type ReviewChecks = Pick<ChapterReviewInput, 'chapterId' | 'content' | 'sourceVersionId' | 'localBlock' | 'alerts'>

export function mergeLocalChapterReview(input: Pick<ReviewChecks, 'localBlock'>, report: string) {
  return input.localBlock && !report.startsWith(input.localBlock)
    ? [input.localBlock, report].join('\n\n---\n\n') : report
}

export function buildChapterReviewResult(input: ReviewChecks, report: string,
  reviews: ChapterReview[], candidates: CandidateChange[], now: string, alreadyMerged = false): { report: string; review: ChapterReview } {
  const merged = alreadyMerged ? report : mergeLocalChapterReview(input, report)
  const bodyVersion = buildAnalysisSourceVersionId(input.content)
  const findings = mergeReviewFindings(
    parseReviewFindings({ chapterId: input.chapterId, sourceVersionId: bodyVersion, content: input.content, report: merged }),
    buildContinuityFindings({ chapterId: input.chapterId, sourceVersionId: bodyVersion, content: input.content, alerts: input.alerts }),
  )
  const deterministicChecksPassed = !input.localBlock && input.alerts.length === 0
  const semanticChecksPassed = contentReviewVerdict(merged) === 'passed'
  const previous = reviews.find(row => row.chapterId === input.chapterId && row.sourceVersionId === input.sourceVersionId)
  return { report: merged,
    review: { id: previous?.id || 'review:' + input.chapterId + ':' + input.sourceVersionId,
      chapterId: input.chapterId, sourceVersionId: input.sourceVersionId, startedAt: previous?.startedAt || now, completedAt: now,
      deterministicChecksPassed, semanticChecksPassed, findings,
      candidateChanges: candidates.filter(row => row.chapterId === input.chapterId && (!row.sourceVersionId || row.sourceVersionId === bodyVersion)),
      status: deterministicChecksPassed && semanticChecksPassed && !findings.some(isFindingBlocking) ? 'ready_to_finalize' : 'needs_revision',
    },
  }
}

export function buildChapterReviewSubmission(input: ChapterReviewInput, report: string,
  coverage: StoredReviewCoverage, reviews: ChapterReview[], candidates: CandidateChange[], now: string, alreadyMerged = false): ChapterReviewSubmission {
  return { chapterId: input.chapterId, content: input.content, coverage,
    ...buildChapterReviewResult(input, report, reviews, candidates, now, alreadyMerged) }
}
