import type { AiChapterDraft } from '@/types/reconstruction'
import type { Chapter } from '@/types/novel'
import type { StoryAggregate } from './storyAggregate'
import { buildAutonomousDraftNovel, editAutonomousDraft } from './autonomousDrafts'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import { buildChapterReviewSignature, buildChapterReviewSourceVersion, buildReviewContextVersion, type ReviewKnowledgeRevisions } from './reconstructionReviewVersion'
import { markCandidateStaleIfSourceChanged } from './reconstructionReview'
import { countNovelWords } from '@/utils/format'
import { isReviewCoverageComplete } from './chapterReviewAcceptance'
import { captureStoryImpact } from './storyImpactAnalysis'
import { appendStoryImpactReport, invalidateWrittenChapterReviews } from './storyImpactTransactions'

export function decideAutonomousDraft(aggregate: StoryAggregate, runId: string, expected: AiChapterDraft,
  action: 'edit' | 'accept' | 'reject', content: string | undefined, knowledge: ReviewKnowledgeRevisions, now: string): AiChapterDraft {
  const { novel, workspace } = aggregate
  const run = workspace.aiRuns?.find(row => row.id === runId), draft = run?.chapterDrafts?.find(row => row.id === expected.id)
  if (!run || !draft || JSON.stringify(draft) !== JSON.stringify(expected)) throw new Error('候选稿已经变化，请重新打开后处理。')
  if (run.status === 'running' || run.status === 'queued') throw new Error('请先暂停任务，再处理候选稿。')
  if (draft.status !== 'pending') throw new Error('这份候选稿已经处理。')
  if (action === 'reject') { draft.status = 'rejected'; draft.updatedAt = now; run.updatedAt = now; return draft }
  const view = buildAutonomousDraftNovel(novel, run, draft.chapterIndex)
  const chapter = novel.chapters.find(row => row.id === draft.chapterId)!
  const target = view.chapters.find(row => row.id === chapter.id)!
  if (action === 'edit' && content !== undefined) target.content = content
  const contextVersion = buildReviewContextVersion(view, target, knowledge, workspace.creationDraft, workspace.canonMutations, workspace.storyMemories)
  if (action === 'edit') {
    const edited = editAutonomousDraft(draft, content ?? draft.content, contextVersion, now)
    Object.assign(draft, edited)
    // Optional fields removed by the pure edit must also disappear from the persisted record.
    for (const key of ['report', 'review', 'reviewCoverage', 'analysisError', 'generationFinishReason'] as const) {
      if (edited[key] === undefined) delete draft[key]
    }
    if (run.status !== 'cancelled') { run.status = 'paused'; run.checkpoint = `chapter-${draft.chapterIndex}:started` }
    run.updatedAt = now
    return draft
  }
  if (run.chapterDrafts!.some(row => row.chapterIndex < draft.chapterIndex && row.status !== 'accepted')) throw new Error('请先按章节顺序接受前面的候选稿。')
  if (contextVersion !== draft.contextVersion) throw new Error('候选稿的写作依据已经变化，请核对并保存候选稿后重新审核。')
  const bodyVersion = buildAnalysisSourceVersionId(draft.content)
  if (draft.stage === 'analyzed' && (!draft.review || draft.review.chapterId !== chapter.id
    || !isReviewCoverageComplete(draft.reviewCoverage, buildChapterReviewSignature(draft.content, contextVersion), draft.content)
    || draft.review.sourceVersionId !== buildChapterReviewSourceVersion(draft.content, contextVersion)
    || draft.review.findings.some(row => row.chapterId !== chapter.id || row.sourceVersionId !== bodyVersion)
    || draft.review.candidateChanges.some(row => row.chapterId !== chapter.id || row.sourceVersionId !== bodyVersion
      || row.novelId !== undefined && row.novelId !== novel.id))) {
    throw new Error('候选稿的审核或提取结果不属于当前正文，请重新保存并审核。')
  }
  const before = captureStoryImpact(novel, workspace)
  const signature = (row: Chapter) => buildChapterReviewSignature(row.content, buildReviewContextVersion(novel, row, knowledge,
    workspace.creationDraft, workspace.canonMutations, workspace.storyMemories))
  const inputs = new Map(novel.chapters.map(row => [row.id, signature(row)]))
  const contentChanged = chapter.content !== draft.content
  if (contentChanged) {
    const snapshot = JSON.stringify({ title: chapter.title, content: chapter.content, summary: chapter.summary, summarySource: chapter.summarySource, status: chapter.status })
    chapter.versions = [...(chapter.versions || []), { id: 'accept:' + draft.id + ':' + now, label: '接受自动候选稿前版本', savedAt: now, snapshot }].slice(-20)
    Object.assign(chapter, { content: draft.content, wordCount: countNovelWords(draft.content), status: 'writing', updatedAt: now,
      contentReview: '', contentReviewSignature: '', contentReviewCoverage: undefined, reviewRewriteBlockedSignature: '' })
  }
  if (draft.review && draft.stage === 'analyzed') {
    workspace.candidates = workspace.candidates.map(row => row.chapterId === chapter.id && ['proposed', 'edited', 'deferred'].includes(row.status) ? markCandidateStaleIfSourceChanged(row, bodyVersion) : row)
    for (const candidate of draft.review.candidateChanges) if (!workspace.candidates.some(row => row.id === candidate.id)) workspace.candidates.push(candidate)
    const findings = draft.review.findings.map(row => workspace.reviewFindings.find(old => old.id === row.id) || row)
    workspace.reviewFindings = [...workspace.reviewFindings.filter(row => row.chapterId !== chapter.id), ...findings]
    const review = { ...draft.review, findings, candidateChanges: draft.review.candidateChanges.map(row => workspace.candidates.find(old => old.id === row.id)!) }
    workspace.chapterReviews = [...(workspace.chapterReviews || []).filter(row => row.id !== review.id), review]
    chapter.contentReview = draft.report || ''
    chapter.contentReviewSignature = buildChapterReviewSignature(draft.content, contextVersion)
    chapter.contentReviewCoverage = draft.reviewCoverage
    chapter.status = review.status === 'ready_to_finalize' ? 'reviewed' : 'writing'
    chapter.updatedAt = now
  }
  draft.status = 'accepted'; draft.acceptedAt = now; draft.updatedAt = now; run.updatedAt = now
  novel.currentWordCount = novel.chapters.reduce((sum, row) => sum + row.wordCount, 0); novel.updatedAt = now
  if (contentChanged) {
    const unchanged = novel.chapters.filter(row => inputs.get(row.id) === signature(row)).map(row => row.id)
    // The accepted draft can carry a current review for the new source chapter.
    if (draft.stage === 'analyzed' && chapter.contentReviewSignature === signature(chapter)) unchanged.push(chapter.id)
    appendStoryImpactReport(aggregate, before, [{ target: { kind: 'chapter', id: chapter.id, label: chapter.title || '未命名章节' },
      action: 'update', fields: ['content'] }], invalidateWrittenChapterReviews(aggregate, unchanged), now,
    () => 'auto-draft:' + run.id + ':' + draft.id + ':' + now, undefined, 'changed-inputs')
  }
  return draft
}
