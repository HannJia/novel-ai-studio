import { computed, ref } from 'vue'
import type { Ref } from 'vue'
import { useConfigStore, type ModelConfig } from '@/stores/config'
import { useKnowledgeStore } from '@/stores/knowledge'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { useNovelStore } from '@/stores/novel'
import { useChapterAnalysis } from '@/composables/useChapterAnalysis'
import { requestSelectionReplacement } from '@/services/selectionAssistant'
import { buildSelectionRevision, captureSelectionSnapshot, type SelectionRevisionMode } from '@/services/selectionRevision'
import { buildWritingContext, buildChapterFactCard, augmentWritingContextWithVectorMemory } from '@/services/context'
import { buildChapterReviewInput, buildChapterReviewSubmission } from '@/services/chapterReviewInput'
import { requestCoveredContentReview } from '@/services/chapterReview'
import type { StoredReviewCoverage } from '@/services/chapterReviewCoverage'
import { requestChapterMetadata } from '@/services/chapterMetadata'
import { captureChapterAnalysisBaseline } from '@/services/chapterAnalysisTransactions'
import { inspectChapterLength, resolveChapterLengthPolicy } from '@/services/chapterLength'
import { getChapterSummaryStatus } from '@/services/derivedSources'
import { projectStoryTime } from '@/services/storyTime'
import { syncSemanticIndexForNovel } from '@/services/semanticIndex'
import { useChapterEndingCheck } from '@/composables/useChapterEndingCheck'
import { chapterEndingPasses } from '@/services/chapterEnding'
import { callAI } from '@/services/ai'
import { buildBannedWordsCheckPrompt } from '@/services/prompts'
import { chapterBackgroundQueue } from '@/services/aiTaskQueue'
import { getAiWorkflowPolicy } from '@/services/aiWorkflow'
import { useStoryStateScansStore } from '@/stores/storyStateScans'
import type { CandidateChange, ReviewFinding } from '@/types/reconstruction'
import type { CharacterMemoryAuthorDecision } from '@/types/characterMemory'
import type { EditorMark } from '../editor/PlainTextEditor.vue'
import type { useChapterSession } from './useChapterSession'
import { anchorFindings, candidateAnchor, findingMarks, revisionPreview } from './marks'

type Session = ReturnType<typeof useChapterSession>
type BackgroundTaskStatus = 'pending' | 'running' | 'completed' | 'failed'

interface ChapterBackgroundTask {
  id: string
  chapterId: string
  name: string
  status: BackgroundTaskStatus
  error: string
}

export interface ChapterAiOptions {
  session: Session
  editor: Ref<{ getSelectionOffsets: () => { start: number; end: number } } | undefined>
}

/** AI actions for the V3 desk. Every write is a candidate or a typed transaction. */
export function useChapterAi(options: ChapterAiOptions) {
  const session = options.session
  const config = useConfigStore()
  const knowledge = useKnowledgeStore()
  const workspace = useReconstructionWorkspaceStore()
  const novels = useNovelStore()
  const storyStateScans = useStoryStateScansStore()
  const ending = useChapterEndingCheck()
  const analysis = useChapterAnalysis({
    currentNovelId: computed(() => session.novel.value?.id || ''),
    currentChapterId: computed(() => session.chapter.value?.id || ''),
    currentContent: session.content,
    currentPanels: computed(() => session.novel.value?.dataPanels || []),
    onInfo: value => { statusText.value = value },
    onWarning: value => { error.value = value },
    onCandidatesDetected: () => session.markChanged(),
  })
  const reviewBusy = ref(false)
  const selectionBusy = ref(false)
  const completeBusy = ref(false)
  const statusText = ref('')
  const error = ref('')
  const reviewReport = ref('')
  const reviewCoverage = ref<StoredReviewCoverage>()
  const lastSelection = ref<{ start: number; end: number; text: string } | null>(null)
  const backgroundTasks = ref<ChapterBackgroundTask[]>([])

  const currentMarks = computed<EditorMark[]>(() => {
    const content = session.content.value
    const marks = session.workflow.value?.reviewCurrent ? findingMarks(anchorFindings(content, session.findings.value)) : []
    for (const candidate of session.candidates.value) {
      const anchor = candidateAnchor(content, candidate)
      if (anchor) marks.push({ id: 'c:' + candidate.id, ...anchor, cls: 'mk-cand', title: '故事变化候选 · 未入典' })
    }
    const revision = session.pendingRevision.value
    if (revision) {
      const preview = revisionPreview(revision, content, session.contextVersion.value)
      if (preview.current) marks.push({ id: 'r:' + revision.id, start: preview.start, end: preview.end, cls: 'mk-cand', title: '正文修订候选 · 未入正文' })
    }
    return marks
  })

  function requireChapter() {
    const novel = session.novel.value, chapter = session.chapter.value
    if (!novel || !chapter) throw new Error('作品或章节不存在。')
    return { novel, chapter }
  }

  function ensureCurrent(baseContent: string, baseContext: string) {
    const { chapter } = requireChapter()
    if (session.content.value !== baseContent || session.contextVersion.value !== baseContext || chapter.status === 'locked') {
      throw new Error('正文或写作依据已经变化，请重新开始本次 AI 操作。')
    }
  }

  async function generateSelection(mode: SelectionRevisionMode, authorInstruction = '', selectionOverride?: { start: number; end: number }) {
    const { novel, chapter } = requireChapter()
    const selection = selectionOverride || options.editor.value?.getSelectionOffsets() || { start: 0, end: 0 }
    if (mode !== 'continue' && selection.end <= selection.start) throw new Error('请先选择要处理的正文。')
    const model = config.getModelForTask('writing')
    if (!model) throw new Error('请先在设置页配置写作模型。')
    if (!session.saved.value) await session.saveNow()
    const baseContent = session.content.value
    const baseContext = session.contextVersion.value
    const snapshot = captureSelectionSnapshot({ novelId: novel.id, chapterId: chapter.id, baseContent,
      contextVersion: baseContext, startOffset: selection.start, endOffset: selection.end, mode })
    selectionBusy.value = true; error.value = ''; statusText.value = '正在生成选区候选…'
    try {
      let writingContext = buildWritingContext(novel, { ...chapter, content: baseContent }, model.contextWindow,
        workspace.getCreationDraft(novel.id), workspace.getCanonMutations(novel.id), workspace.getStoryMemories(novel.id), knowledge.knowledgeBases)
      writingContext = await augmentWritingContextWithVectorMemory(novel, { ...chapter, content: baseContent }, writingContext,
        config.embedding, () => workspace.getStoryMemories(novel.id), () => workspace.getCanonMutations(novel.id))
      const replacement = await requestSelectionReplacement({ model, snapshot, authorInstruction,
        factCard: buildChapterFactCard(novel, { ...chapter, content: baseContent }, writingContext),
        guidance: writingContext.chapterGuidance, signal: undefined })
      ensureCurrent(baseContent, baseContext)
      if (!session.saved.value) await session.saveNow()
      const proposed = buildSelectionRevision(snapshot, replacement, { novelId: novel.id, chapterId: chapter.id, content: session.content.value, contextVersion: session.contextVersion.value })
      await novels.proposeChapterRevision(novel.id, chapter.id, proposed, 'ai', '选区候选：' + mode,
        { selection: { mode, startOffset: snapshot.startOffset, endOffset: snapshot.endOffset, contextVersion: baseContext }, expectedBaseContent: baseContent })
      await session.refreshRevision()
      lastSelection.value = { start: snapshot.startOffset, end: snapshot.endOffset, text: snapshot.selectedText }
      statusText.value = '候选已保存，正文尚未改变。'
      session.markChanged()
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
      throw cause
    } finally {
      selectionBusy.value = false
    }
  }

  async function runReviewChapter(skipSave = false) {
    const { novel, chapter } = requireChapter()
    const model = config.getModelForTask('review') || config.getModelForTask('writing')
    if (!model) throw new Error('请先在设置页配置审校模型。')
    if (!skipSave) await session.saveNow()
    const sourceChapter = { ...chapter, content: session.content.value, title: session.title.value }
    const source = buildChapterReviewInput(novel, sourceChapter, {
      knowledge: knowledge.knowledgeBases,
      creationDraft: workspace.getCreationDraft(novel.id),
      canonMutations: workspace.getCanonMutations(novel.id),
      storyMemories: workspace.getStoryMemories(novel.id),
    })
    const baseContent = source.content, baseContext = source.contextVersion
    reviewBusy.value = true; error.value = ''; statusText.value = '正在按分段审校本章…'; reviewReport.value = ''
    try {
      const report = await requestCoveredContentReview({
        source: baseContent,
        chapterIndex: chapter.chapterIndex,
        model,
        buildContext: source.buildContext,
        ensureCurrent: () => ensureCurrent(baseContent, baseContext),
        checkpoint: chapter.contentReviewCoverage?.checkpoint,
        checkpointKey: source.signature,
        onCheckpoint: async progress => {
          ensureCurrent(baseContent, baseContext)
          const coverage = { ...progress, signature: source.signature }
          const current = session.chapter.value
          if (!current) throw new Error('章节已不存在。')
          const changed = JSON.stringify(current.contentReviewCoverage) !== JSON.stringify(coverage)
          if (changed) {
            const updated = novels.updateChapter(novel.id, chapter.id, { contentReviewCoverage: coverage })
            if (!updated) throw new Error('审核覆盖进度保存失败。')
            await novels.saveNovelNow(novel.id)
          }
          ensureCurrent(baseContent, baseContext)
        },
        onChunk: value => { reviewReport.value = value },
        onProgress: value => {
          reviewCoverage.value = { ...value, signature: source.signature }
          statusText.value = `审校进度 ${value.completedChunks}/${value.totalChunks}`
        },
      })
      ensureCurrent(baseContent, baseContext)
      const coverage = reviewCoverage.value || { totalChunks: 1, completedChunks: 1, coveredCharacters: baseContent.length,
        totalCharacters: baseContent.length, globalStatus: 'not-needed' as const, status: 'complete' as const, signature: source.signature }
      const submission = buildChapterReviewSubmission(source, report, coverage, workspace.getChapterReviews(novel.id, chapter.id),
        workspace.getCandidates(novel.id), new Date().toISOString())
      await workspace.commitChapterReview(novel.id, submission)
      reviewReport.value = report
      statusText.value = '本章审校已保存。'
      session.markChanged()
      return report
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
      throw cause
    } finally {
      reviewBusy.value = false
    }
  }

  async function completeChapter() {
    const { novel, chapter } = requireChapter()
    const model = config.getModelForTask('review') || config.getModelForTask('writing')
    if (!model) throw new Error('请先在设置页配置 AI 模型。')
    await session.saveNow()
    const policy = resolveChapterLengthPolicy(novel.chapterLengthPolicy)
    const length = inspectChapterLength(session.content.value, policy)
    if (length.status !== 'within') throw new Error(length.status === 'short' ? `正文还差 ${length.deficit} 字。` : `正文超出篇幅上限 ${length.excess} 字。`)
    const time = projectStoryTime(novel, { ...chapter, content: session.content.value })
    if (!time.known) throw new Error('请先确认本章经过的故事天数。')
    completeBusy.value = true; error.value = ''; statusText.value = '正在完成本章…'
    try {
      const latestNovel = session.novel.value, latestChapter = session.chapter.value
      if (!latestNovel || !latestChapter) throw new Error('作品或章节已不存在。')
      if (getChapterSummaryStatus(latestChapter) !== 'current') {
        const metadata = await requestChapterMetadata({ model, chapterContent: session.content.value,
          chapterTitle: session.title.value, chapterIndex: latestChapter.chapterIndex })
        await novels.saveChapterSummary(latestNovel.id, latestChapter.id, session.content.value, latestChapter.summary, metadata.summary, 'ai')
        if (metadata.title && session.title.value !== metadata.title) {
          session.title.value = metadata.title
          await session.saveNow()
        }
      }
      const current = session.workflow.value
      let writingContext = buildWritingContext(latestNovel, { ...latestChapter, content: session.content.value, title: session.title.value }, model.contextWindow,
        workspace.getCreationDraft(latestNovel.id), workspace.getCanonMutations(latestNovel.id), workspace.getStoryMemories(latestNovel.id), knowledge.knowledgeBases)
      const endingCheck = await ending.requestChapterEndingCheck(model, session.content.value, writingContext.chapterGuidance)
      if (!chapterEndingPasses(endingCheck)) {
        if (latestNovel.writingMode === 'ai') {
          const continuation = await ending.generateEndingContinuation(model, session.content.value, endingCheck,
            writingContext.chapterGuidance, '', buildChapterFactCard(latestNovel, { ...latestChapter, content: session.content.value }, writingContext))
          if (continuation.trim()) {
            await novels.proposeChapterRevision(latestNovel.id, latestChapter.id, session.content.value + '\n' + continuation.trim(), 'ai', '整章候选：章节结尾补全',
              { expectedBaseContent: session.content.value })
            await session.refreshRevision()
          }
        }
        throw new Error(latestNovel.writingMode === 'ai' ? '章节结尾尚未收束，已生成修订候选，请先核对。' : '章节结尾尚未收束，请调整正文后再完成本章。')
      }
      if (!current?.reviewCurrent) await runReviewChapter(true)
      const prepared = await workspace.prepareChapterAnalysis(latestNovel.id)
      const analysisChapter = prepared.novel.chapters.find(item => item.id === latestChapter.id)
      if (!analysisChapter) throw new Error('章节已变化，请重新打开写作台。')
      const analysisBaseline = captureChapterAnalysisBaseline(prepared.novel, analysisChapter, prepared.canonMutations)
      const analyzed = await analysis.analyzeChapterStructure(model, { target: { novelId: latestNovel.id, chapterId: latestChapter.id } })
      if (!analyzed) throw new Error('章节分析未返回完整结果，请重试。')
      await syncSemanticIndexForNovel(() => {
        const current = novels.getNovel(latestNovel.id)
        if (!current) throw new Error('当前作品已关闭。')
        return { novel: current, knowledgeBases: knowledge.knowledgeBases, storyMemories: workspace.getStoryMemories(current.id) }
      }, config.embedding)
      const completion = await workspace.completeChapter(latestNovel.id, { chapterId: latestChapter.id, content: session.content.value,
        reviewVersion: session.reviewSourceVersion.value, analysisComplete: true, analysisBaseline })
      if (completion.pending > 0) {
        statusText.value = `本章已完成，还有 ${completion.pending} 条故事变化候选待处理。`
        session.markChanged()
        return
      }
      const queued = enqueueBackgroundChecks(latestNovel.id, latestChapter.id, session.content.value, model)
      statusText.value = queued.failed
        ? '本章已完成，但部分后台检查未能启动。'
        : queued.count ? '本章已完成，后台检查已排队。' : '本章已完成。'
      session.markChanged()
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
      throw cause
    } finally {
      completeBusy.value = false
    }
  }

  function enqueueBackgroundTask(chapterId: string, name: string, run: () => Promise<void>): boolean {
    const task: ChapterBackgroundTask = { id: crypto.randomUUID(), chapterId, name, status: 'pending', error: '' }
    backgroundTasks.value = [...backgroundTasks.value, task].slice(-30)
    const update = (status: BackgroundTaskStatus, error = '') => {
      backgroundTasks.value = backgroundTasks.value.map(item => item.id === task.id ? { ...item, status, error } : item)
    }
    try {
      chapterBackgroundQueue.enqueue(name, async () => {
        update('running')
        try {
          await run()
          update('completed')
        } catch (cause) {
          update('failed', cause instanceof Error ? cause.message : String(cause))
          throw cause
        }
      })
      return true
    } catch (cause) {
      update('failed', cause instanceof Error ? cause.message : String(cause))
      return false
    }
  }

  function enqueueBackgroundChecks(novelId: string, chapterId: string, content: string, model: ModelConfig) {
    const policy = getAiWorkflowPolicy(config.aiWorkflowMode)
    if (!policy.runExtendedBackgroundChecks) return { count: 0, failed: false }
    let count = 0, failed = false
    if (content.length > 200) {
      const queued = enqueueBackgroundTask(chapterId, '违禁词审查', async () => {
        let report = ''
        const result = await callAI({ model, skillTask: 'review', messages: buildBannedWordsCheckPrompt(content), stream: true,
          taskName: '章节后台违禁词审查', onChunk: chunk => { report += chunk } })
        if (result.content && !report) report = result.content
        const current = novels.getNovel(novelId)?.chapters.find(item => item.id === chapterId)
        if (!current || current.content !== content) throw new Error('章节正文已变化，放弃保存后台违禁审查结果。')
        novels.updateChapter(novelId, chapterId, { bannedReview: report })
        await novels.saveNovelNow(novelId)
      })
      if (queued) count++
      else failed = true
    }
    const novel = novels.getNovel(novelId)
    if (novel && (novel.storyArcs?.length || 0) + (novel.eventLog?.length || 0) + (novel.chapterPlans?.length || 0) > 0) {
      const queued = enqueueBackgroundTask(chapterId, '故事状态提案', async () => {
        await storyStateScans.scan(novelId, chapterId, model, { expectedContent: content })
      })
      if (queued) count++
      else failed = true
    }
    return { count, failed }
  }

  async function reviewChapter() {
    return runReviewChapter(false)
  }

  async function finalizeChapter() {
    const { novel, chapter } = requireChapter()
    if (!session.saved.value) await session.saveNow()
    if (session.workflow.value?.primary !== 'finalize') throw new Error('当前章节尚未满足定稿门槛。')
    await workspace.finalizeChapter(novel.id, chapter.id, session.reviewSourceVersion.value, new Date().toISOString())
    statusText.value = '本章已定稿。'
    session.markChanged()
  }

  async function prepareDecision<T extends CandidateChange | ReviewFinding>(record: T, version = session.reviewSourceVersion.value) {
    const expectedRecord = JSON.parse(JSON.stringify(record)) as T
    if (!await session.saveNow()) throw new Error('正文尚未保存，本次决定未提交。')
    if (session.reviewSourceVersion.value !== version) throw new Error('正文或审核依据已经变化，请重新核对后确认。')
    return { expectedRecord, expectedSourceVersionId: version }
  }
  async function acceptCandidate(candidate: CandidateChange, editedValue?: string, authorNote?: string,
    characterMemoryDecision?: CharacterMemoryAuthorDecision, version?: string) {
    const { novel } = requireChapter()
    const expected = await prepareDecision(candidate, version)
    await workspace.acceptStoryCandidate(novel.id, candidate.id, new Date().toISOString(), editedValue,
      { ...expected, authorNote, characterMemoryDecision })
    statusText.value = '故事变化候选已采纳入典。'
    session.markChanged()
  }
  async function rejectCandidate(candidate: CandidateChange, note?: string) {
    const { novel } = requireChapter()
    const expected = await prepareDecision(candidate)
    await workspace.rejectStoryCandidate(novel.id, candidate.id, new Date().toISOString(), { ...expected, authorNote: note })
    statusText.value = '故事变化候选已驳回。'
    session.markChanged()
  }
  async function deferCandidate(candidate: CandidateChange, note?: string) {
    const { novel } = requireChapter()
    const expected = await prepareDecision(candidate)
    await workspace.deferStoryCandidate(novel.id, candidate.id, new Date().toISOString(), { ...expected, authorNote: note })
    statusText.value = '故事变化候选已收起，仍可稍后处理。'
    session.markChanged()
  }
  async function resolveFinding(finding: ReviewFinding, status: 'accepted' | 'intentional' | 'deferred', note?: string) {
    const { novel } = requireChapter()
    const expected = await prepareDecision(finding)
    await workspace.resolveStoryReviewFinding(novel.id, finding.id, status, new Date().toISOString(), { ...expected, authorNote: note })
    session.markChanged()
  }

  return { reviewBusy, selectionBusy, completeBusy, statusText, error, reviewReport, reviewCoverage, lastSelection, backgroundTasks,
    currentMarks, generateSelection, reviewChapter, completeChapter, finalizeChapter, acceptCandidate, rejectCandidate,
    deferCandidate, resolveFinding }
}
