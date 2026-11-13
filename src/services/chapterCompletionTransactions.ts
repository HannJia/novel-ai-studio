import type { Novel } from '@/types/novel'
import type { StoryAggregate } from './storyAggregate'
import type { ReviewKnowledgeRevisions } from './reconstructionReviewVersion'
import { buildChapterReviewSignature, buildReviewContextVersion } from './reconstructionReviewVersion'
import { storyDecisionSourceVersion, finalizeStoryChapter } from './storyDecisions'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import { canFinalizeChapter } from './reconstructionReview'
import { isReviewCoverageComplete } from './chapterReviewAcceptance'
import { inspectChapterLength, resolveChapterLengthPolicy } from './chapterLength'
import { getChapterSummaryStatus } from './derivedSources'
import { captureChapterAnalysisBaseline } from './chapterAnalysisTransactions'
import { captureDataClockBaseline, confirmStoryTimeRelative, queueDataPanelAutomation } from './dataPanelTransactions'
import { projectStoryTime } from './storyTime'

export function captureCompletionClock(novel: Novel, chapterId: string) {
  const chapter = novel.chapters.find(row => row.id === chapterId)
  return JSON.stringify([novel.id, chapterId, chapter?.chapterIndex, chapter?.content, chapter?.storyDay, chapter?.storyDaysElapsed, captureDataClockBaseline(novel)])
}

/** Explicit author confirmation, independent of completion. The durable chapter day is the retry receipt. */
export function confirmCompletionClock(aggregate: StoryAggregate, chapterId: string, days: number, baseline: string,
  now: string, nextId: () => string) {
  const { novel } = aggregate
  const chapter = novel.chapters.find(row => row.id === chapterId)
  if (!chapter || chapter.status === 'locked') throw new Error('章节不存在或已锁定。')
  if (!Number.isFinite(days) || days < 0) throw new Error('请填写有效的非负推进天数。')
  const currentTime = projectStoryTime(novel, chapter)
  if (currentTime.known && currentTime.elapsedDays === days) return false
  if (currentTime.known) throw new Error('本章时间已经记录，请在故事时间面板核对修改，不能重复推进。')
  if (captureCompletionClock(novel, chapterId) !== baseline) throw new Error('正文或故事时间已变化，请重新核对确认。')
  if (aggregate.workspace.candidates.some(row => row.chapterId === chapter.id && row.type === 'timeline'
    && ['proposed', 'deferred'].includes(row.status) && (!row.sourceVersionId || row.sourceVersionId === buildAnalysisSourceVersionId(chapter.content)))) {
    throw new Error('本章已有时间候选，请先确认或忽略该候选，避免重复推进。')
  }
  confirmStoryTimeRelative(aggregate, chapterId, days, captureDataClockBaseline(novel), now, nextId, 'author')
  return true
}

export interface ChapterCompletionInput {
  chapterId: string
  content: string
  reviewVersion: string
  analysisComplete: boolean
  analysisBaseline: string
}

/** Called only inside transactStory: proposals and the formal status publish together. No model calls. */
export function commitChapterCompletion(aggregate: StoryAggregate, input: ChapterCompletionInput, now: string,
  nextId: () => string, knowledge: ReviewKnowledgeRevisions = []) {
  const { novel, workspace } = aggregate
  const chapter = novel.chapters.find(row => row.id === input.chapterId)
  if (!chapter || chapter.status === 'locked' || chapter.content !== input.content) throw new Error('章节或正文已变化，请重新完成本章。')
  const version = storyDecisionSourceVersion(aggregate, chapter.id, knowledge)
  if (version !== input.reviewVersion) throw new Error('审核输入已经变化，请重新审核后完成本章。')
  if (getChapterSummaryStatus(chapter) !== 'current') throw new Error('章节总结尚未保存或已经过期。')
  const signature = buildChapterReviewSignature(chapter.content, buildReviewContextVersion(novel, chapter, knowledge,
    workspace.creationDraft, workspace.canonMutations, workspace.storyMemories))
  const review = workspace.chapterReviews?.find(row => row.chapterId === chapter.id && row.sourceVersionId === version)
  const findings = new Map(review?.findings.map(row => [row.id, row]))
  for (const row of workspace.reviewFindings.filter(row => row.chapterId === chapter.id)) findings.set(row.id, row)
  if (!review || !canFinalizeChapter({ ...review, findings: [...findings.values()] }, version)
    || chapter.contentReviewSignature !== signature || !isReviewCoverageComplete(chapter.contentReviewCoverage, signature, chapter.content)) {
    throw new Error('章节审核未通过或已过期，请重新审核。')
  }
  if (inspectChapterLength(chapter.content, resolveChapterLengthPolicy(novel.chapterLengthPolicy)).status !== 'within') throw new Error('章节篇幅尚未达标。')
  const contentVersion = buildAnalysisSourceVersionId(chapter.content)
  const pending = workspace.candidates.filter(row => row.chapterId === chapter.id
    && (!row.sourceVersionId || row.sourceVersionId === contentVersion) && ['proposed', 'deferred'].includes(row.status)).length
  if (!pending && chapter.status === 'finalized' && review.status === 'approved') return { pending: 0, changed: false }
  if (!input.analysisComplete) throw new Error('章节分析尚未成功保存，本章尚未完成。')
  if (input.analysisBaseline !== captureChapterAnalysisBaseline(novel, chapter, workspace.canonMutations)) throw new Error('分析依据已经变化，请重新分析后完成本章。')
  const queued = queueDataPanelAutomation(novel, chapter.chapterIndex, input.content, now, nextId)
  if (storyDecisionSourceVersion(aggregate, chapter.id, knowledge) !== version) throw new Error('自动提案改变了审核输入，请重新审核。')
  if (pending) {
    const changed = chapter.status !== 'completed' || queued.changed
    chapter.status = 'completed'
    if (changed) { chapter.updatedAt = now; novel.updatedAt = now }
    return { pending, changed }
  }
  finalizeStoryChapter(aggregate, chapter.id, version, now, knowledge)
  return { pending: 0, changed: true }
}
