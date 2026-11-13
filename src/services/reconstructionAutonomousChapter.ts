import type { StoryMemoryRecord } from '@/types/storyMemory'
import { callAI, type AiRequestLifecycle } from './ai'
import { buildChapterFactCard, buildWritingContext, augmentWritingContextWithVectorMemory } from './context'
import { requestCoveredContentReview } from './chapterReview'
import { chapterOutputTokenBudget } from './chapterGeneration'
import { resolveChapterLengthPolicy } from './chapterLength'
import { buildChapterPrompt } from './prompts'
import type { ModelConfig } from '@/stores/config'
import type { Novel } from '@/types/novel'
import type { AiChapterDraft, CandidateChange, CanonMutationRecord, CreationDraft } from '@/types/reconstruction'
import type { AutonomousChapterContext, AutonomousChapterResult } from './reconstructionAutonomous'
import { buildAutonomousChapterReview } from './reconstructionAutonomousReview'
import { buildChapterReviewSignature, buildChapterReviewSourceVersion, buildReviewContextVersion, type ReviewKnowledgeRevisions } from './reconstructionReviewVersion'
import { buildChapterReviewInput, mergeLocalChapterReview } from './chapterReviewInput'
import { ChapterReviewCoverageError } from './chapterReviewCoverage'
import { buildAutonomousDraftNovel } from './autonomousDrafts'
import { structuredOutputDiagnostic } from './aiDiagnostics'

export interface AutonomousChapterRuntime {
  novelId: string
  getNovel: () => Novel | undefined
  getKnowledgeRevisions?: () => ReviewKnowledgeRevisions
  getCreationDraft?: () => CreationDraft | undefined
  getCanonMutations?: () => CanonMutationRecord[]
  getStoryMemories?: () => StoryMemoryRecord[]
  writingModel: ModelConfig
  reviewModel: ModelConfig
  analysisModel?: ModelConfig
  onReviewProgress?: (novelId: string, chapterId: string, coverage: unknown) => void
  extractCandidates?: (input: { novel: Novel; chapterId: string; model: ModelConfig; signal?: AbortSignal; requestLifecycle: AiRequestLifecycle }) => Promise<{ candidates: CandidateChange[]; usedTokens?: number; error?: string }>
}

/** Model output stays in the run until an explicit author transaction publishes it. */
export function createAutonomousEmptyChapterProcessor(runtime: AutonomousChapterRuntime) {
  return async ({ chapterIndex, signal, getRun, saveDraft, requestLifecycle }: AutonomousChapterContext): Promise<AutonomousChapterResult> => {
    const formal = runtime.getNovel(), chapter = formal?.chapters.find(row => row.chapterIndex === chapterIndex)
    if (!formal || !chapter) return { status: 'needs_author', message: '自动任务范围内找不到目标章节' }
    if (chapter.status === 'locked') return { status: 'needs_author', message: '目标章节已锁定' }
    let draft = getRun().chapterDrafts?.find(row => row.chapterId === chapter.id)
    if (draft?.status === 'rejected') return { status: 'needs_author', message: '本章候选稿已拒绝，请处理该候选或建立新任务。' }
    if (draft?.status === 'accepted') {
      if (chapter.content !== draft.content) return { status: 'needs_author', message: '已接受稿件的正文已经变化，请核对后续章节。' }
      return { status: 'completed', checkpoint: `chapter-${chapterIndex}:completed` }
    }
    if (draft?.generationFinishReason) {
      return { status: 'needs_author', checkpoint: `chapter-${chapterIndex}:needs-author`,
        message: `候选稿生成以 ${draft.generationFinishReason} 结束，尚未进入审校。请编辑或明确接受候选稿；如需重新生成，请拒绝后创建新任务。` }
    }
    if (!draft && chapter.content.trim()) return { status: 'needs_author', message: '当前章节已有正文，自动任务不会覆盖作者内容。' }
    const base = draft?.baseContent ?? chapter.content
    const view = () => {
      const current = runtime.getNovel(), target = current?.chapters.find(row => row.id === chapter.id)
      if (!current || !target || target.content !== base || target.chapterIndex !== chapterIndex || target.status === 'locked') throw new Error('章节正文或状态已变化，候选稿保留但未写入正文。')
      return buildAutonomousDraftNovel(current, getRun(), chapterIndex)
    }
    const version = (novel: Novel) => buildReviewContextVersion(novel, novel.chapters.find(row => row.id === chapter.id)!,
      runtime.getKnowledgeRevisions?.(), runtime.getCreationDraft?.(), runtime.getCanonMutations?.(), runtime.getStoryMemories?.())
    let planningVersion = draft?.contextVersion ?? version(view())
    const ensureCurrent = () => {
      const current = view()
      if (version(current) !== planningVersion) throw new Error('设定、人物状态或前文已变化，请核对并重新保存候选稿。')
      return current
    }
    const persist = async (next: AiChapterDraft) => { await saveDraft(next); draft = next }
    ensureCurrent(); signal?.throwIfAborted()
    if (draft && draft.stage !== 'generated') {
      const signature = buildChapterReviewSignature(draft.content, planningVersion)
      const knownInput = draft.review
        ? draft.review.sourceVersionId === buildChapterReviewSourceVersion(draft.content, planningVersion)
        : draft.reviewCoverage?.signature === signature
      if (!knownInput || draft.reviewCoverage && draft.reviewCoverage.signature !== signature) {
        return { status: 'needs_author', message: '候选稿的审核规则已变化或来源未验证，请先保存候选修改，再重新审核；旧报告已保留。' }
      }
    }
    if (!draft) {
      const novel = view(), target = novel.chapters.find(row => row.id === chapter.id)!
      let context = buildWritingContext(novel, target, runtime.writingModel.contextWindow, runtime.getCreationDraft?.(), runtime.getCanonMutations?.(), runtime.getStoryMemories?.())
      context = await augmentWritingContextWithVectorMemory(novel, target, context, undefined, runtime.getStoryMemories)
      ensureCurrent(); signal?.throwIfAborted()
      const result = await callAI({ model: runtime.writingModel, skillTask: 'writing', taskName: '自动写作第' + (chapterIndex + 1) + '章',
        messages: buildChapterPrompt(novel, context.outlineContext, context.chapterGuidance || '第' + (chapterIndex + 1) + '章', context.previousSummary, context.lastParagraph, '', buildChapterFactCard(novel, target, context)),
        maxTokens: chapterOutputTokenBudget(runtime.writingModel.maxTokens, resolveChapterLengthPolicy(novel.chapterLengthPolicy).targetWords),
        signal, noAutomaticRetry: true, requestLifecycle: requestLifecycle('writing') })
      if (!result.content.trim()) return { status: 'needs_author', message: '模型没有返回可保存的正文（' + structuredOutputDiagnostic(result) + '）' }
      ensureCurrent()
      const now = new Date().toISOString()
      // Once generated, bind the candidate's actual slices rather than the formerly empty chapter.
      const candidateView = { ...novel, chapters: novel.chapters.map(row => row.id === chapter.id
        ? { ...row, content: result.content, summary: '', summarySource: undefined } : row) }
      const candidateVersion = version(candidateView)
      const generationFinishReason = result.finishReason && result.finishReason !== 'stop' ? result.finishReason : undefined
      await persist({ id: getRun().id + ':draft:' + chapter.id, chapterId: chapter.id, chapterIndex, baseContent: base, content: result.content,
        contextVersion: candidateVersion, status: 'pending', stage: 'generated', generationFinishReason, createdAt: now, updatedAt: now, history: [] })
      planningVersion = candidateVersion
      signal?.throwIfAborted()
      if (result.finishReason && result.finishReason !== 'stop') return { status: 'needs_author', message: '生成输出未正常完成（' + result.finishReason + '），已保存候选稿，请先检查后重试。' }
    }
    if (draft!.stage === 'generated') {
      const novel = ensureCurrent(), target = novel.chapters.find(row => row.id === chapter.id)!
      const input = buildChapterReviewInput(novel, target, { knowledge: runtime.getKnowledgeRevisions?.(),
        creationDraft: runtime.getCreationDraft?.(), canonMutations: runtime.getCanonMutations?.(), storyMemories: runtime.getStoryMemories?.() })
      const signature = input.signature
      let report: string
      try { report = await requestCoveredContentReview({ source: draft!.content, chapterIndex, model: runtime.reviewModel,
        buildContext: input.buildContext,
        ensureCurrent: () => { ensureCurrent(); signal?.throwIfAborted() }, signal, requestLifecycle: requestLifecycle('review'),
        checkpoint: draft!.reviewCoverage?.checkpoint, checkpointKey: signature,
        onCheckpoint: async coverage => { await persist({ ...draft!, reviewCoverage: { ...coverage, signature }, updatedAt: new Date().toISOString() }) },
        onProgress: value => runtime.onReviewProgress?.(runtime.novelId, chapter.id, value) }) }
      catch (error) {
        if (error instanceof ChapterReviewCoverageError && error.coverage.checkpoint) {
          await persist({ ...draft!, reviewCoverage: { ...error.coverage, signature }, updatedAt: new Date().toISOString() })
        }
        throw error
      }
      ensureCurrent()
      await persist({ ...draft!, report: mergeLocalChapterReview(input, report), stage: 'reviewed', updatedAt: new Date().toISOString() })
    }
    signal?.throwIfAborted()
    if (draft!.stage === 'reviewed') {
      const novel = ensureCurrent()
      let candidates: CandidateChange[] = [], errorMessage = runtime.extractCandidates ? '' : '未配置故事变化提取，无法核对本章长期记忆。'
      if (runtime.extractCandidates) {
        try {
          const result = await runtime.extractCandidates({ novel, chapterId: chapter.id, model: runtime.analysisModel || runtime.reviewModel, signal, requestLifecycle: requestLifecycle('analysis') })
          candidates = result.candidates; errorMessage = result.error || ''
        } catch (error) {
          if (signal?.aborted) throw error
          errorMessage = error instanceof Error ? error.message : String(error)
        }
      }
      ensureCurrent()
      const target = novel.chapters.find(row => row.id === chapter.id)!
      const structured = buildAutonomousChapterReview({ chapter: target,
        report: draft!.report!, candidates, contextVersion: planningVersion, candidateExtractionError: errorMessage || undefined,
        reviewInput: buildChapterReviewInput(novel, target, { knowledge: runtime.getKnowledgeRevisions?.(),
          creationDraft: runtime.getCreationDraft?.(), canonMutations: runtime.getCanonMutations?.(), storyMemories: runtime.getStoryMemories?.() }) })
      await persist({ ...draft!, stage: errorMessage ? 'reviewed' : 'analyzed', review: structured.review, analysisError: errorMessage || undefined, updatedAt: new Date().toISOString() })
    }
    const passed = draft!.stage === 'analyzed' && draft!.review?.status === 'ready_to_finalize'
    return { status: passed ? 'completed' : 'needs_author', checkpoint: `chapter-${chapterIndex}:${passed ? 'reviewed' : 'review-needs-author'}`,
      message: passed ? undefined : '候选稿已保存，审核或故事变化提取需要作者处理' + (draft!.analysisError ? '；' + draft!.analysisError : '') }
  }
}
