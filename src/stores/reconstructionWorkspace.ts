import { captureEventCausalityBaseline } from '@/services/eventCausality'
import { commitEventCausality } from '@/services/eventCausalityTransactions'
import type { EventCausalityEdit } from '@/types/eventCausality'
import { createAuthorStoryMemoryRun } from '@/services/storyMemoryGeneration'
import type { StoryMemoryTaskDraft } from '@/services/storyMemoryTask'
import { refreshMemoryRequestMetrics } from '@/services/aiRunRequestValidation'
import { computed, ref } from 'vue'
import { confirmCompletionClock, commitChapterCompletion, type ChapterCompletionInput } from '@/services/chapterCompletionTransactions'
import { saveChapterReviewSnapshot, type ChapterReviewSubmission } from '@/services/chapterReviewTransactions'
import { commitStoryStateScan, type StoryStateScanSubmission } from '@/services/storyStateScanTransactions'
import { defineStore } from 'pinia'
import { loadReconstructionWorkspace, saveReconstructionWorkspace, commitEditorDraftCommand, type ReconstructionWorkspaceSnapshot } from '@/services/db/reconstruction'
import type { CharacterEditorPayload, EditorDraft, EditorDraftCommand } from '@/types/editorRecovery'
import { applyEditorDraftCommand, editorDraftVersion } from '@/services/editorRecovery'
import { editDefinitionsWithImpact } from '@/services/storyImpactTransactions'
import { assertEditorDraft, assertEditorPayload } from '@/services/editorRecoveryValidation'
import { saveReconstructionRun } from '@/services/db/reconstructionRuns'
import { reviseAiRunLimits } from '@/services/reconstructionAiBudget'
import { decideAutonomousDraft } from '@/services/autonomousDraftDecisions'
import { isAutonomousRunActive } from '@/services/reconstructionAutonomous'
import type { AiChapterDraft } from '@/types/reconstruction'
import type { ProjectWorkspaceSnapshot } from '@/services/projectBackup'
import { markCandidateStaleIfSourceChanged } from '@/services/reconstructionReview'
import { readStoryAggregate, saveStoryAggregate, type RevisionAcceptance, type StoryAggregate } from '@/services/storyAggregate'
import { acceptStoryChange, rejectStoryChange, deferStoryChange, resolveStoryFinding, finalizeStoryChapter, storyDecisionSourceVersion,
  type StoryDecisionOptions, type FindingDecisionStatus } from '@/services/storyDecisions'
import { mergeCommittedSnapshot } from '@/services/committedSnapshotMerge'
import { verifyEvidence } from '@/services/reconstructionCanon'
import { createCharacterStateChange } from '@/services/reconstructionCharacterState'
import { buildAnalysisSourceVersionId } from '@/services/reconstructionCandidates'
import { reconcileLegacyChapterFindings, type FindingsReconciliationResult } from '@/services/reconstructionFindings'
import { applyCreationEdit, captureCreationBaseline, type CreationEdit } from '@/services/creationTransactions'
import { applyCreationRecovery, type CreationRecoveryEdit } from '@/services/creationDraft'
import { canFlushSceneRecovery, isSceneRecoveryEdit } from '@/services/planningRecovery'
import { validateReconstructionCreationDraft } from '@/services/reconstructionBackupValidation'
import { applyScenePlanningEdit, type ScenePlanningEdit } from '@/services/scenePlanningTransactions'
import { saveCharacterScan } from '@/services/characterScanTransactions'
import { commitChapterAnalysis, type ChapterAnalysisSubmission } from '@/services/chapterAnalysisTransactions'
import { saveWritingSuggestion, type SaveWritingSuggestionInput } from '@/services/writingSuggestionTransactions'
import { useNovelStore } from './novel'
import { useKnowledgeStore } from './knowledge'
import { withStoryReviewInvalidation } from '@/services/chapterReviewInvalidation'
import { projectTransferBusy, cloudApplyBusy, appUpdateInstalling, isDraftFlushTokenActive, type DraftFlushToken } from '@/services/appLifecycle'
import type { Novel } from '@/types/novel'
import type { StoryMemoryRecord } from '@/types/storyMemory'
import { confirmStoryMemory, type SaveStoryMemoryInput } from '@/services/storyMemoryTransactions'
import type { AiRun, CandidateChange, CanonMutationRecord, ChapterReview, CreationDraft, ReviewFinding } from '@/types/reconstruction'
import type { StoryImpactReport } from '@/types/storyImpact'

export interface StoryTransactionOptions<P = undefined> {
  /** Runs after both the workspace and novel queues have reached this transaction. */
  prepare?: () => Promise<P>
  /** Supplies aggregate metadata at durable-save time, without a second transaction. */
  revisionAcceptance?: (prepared: P) => RevisionAcceptance | undefined
}

export const useReconstructionWorkspaceStore = defineStore('reconstructionWorkspace', () => {
  const editorDraftsByNovel = ref<Record<string, EditorDraft[]>>({})
  const editorDraftWork = new Set<Promise<unknown>>()
  const candidatesByNovel = ref<Record<string, CandidateChange[]>>({})
  const canonMutationsByNovel = ref<Record<string, CanonMutationRecord[]>>({})
  const creationDraftsByNovel = ref<Record<string, CreationDraft>>({})
  const reviewFindingsByNovel = ref<Record<string, ReviewFinding[]>>({})
  const reviewsByNovel = ref<Record<string, ChapterReview[]>>({})
  const aiRunsByNovel = ref<Record<string, AiRun[]>>({})
  const storyMemoriesByNovel = ref<Record<string, StoryMemoryRecord[]>>({})
  const impactReportsByNovel = ref<Record<string, StoryImpactReport[]>>({})
  const persistenceByNovel = new Map<string, Promise<unknown>>()
  const hydrated = new Set<string>()

  function serializePersistence<T>(novelId: string, operation: () => Promise<T>): Promise<T> {
    const previous = persistenceByNovel.get(novelId) || Promise.resolve()
    const next = previous.catch(() => undefined).then(operation)
    persistenceByNovel.set(novelId, next)
    void next.finally(() => { if (persistenceByNovel.get(novelId) === next) persistenceByNovel.delete(novelId) }).catch(() => undefined)
    return next
  }

  function addCandidateChanges(novelId: string, candidates: CandidateChange[]): number {
    if (!candidates.length) return 0
    let current = candidatesByNovel.value[novelId] || []

    // 每次章节重新分析时，旧正文版本的候选都必须失效。否则旧候选会继续
    // 出现在待确认列表，甚至阻塞本章定稿。
    const sourceVersionsByChapter = new Map<string, Set<string>>()
    for (const candidate of candidates) {
      if (!candidate.chapterId || !candidate.sourceVersionId) continue
      const versions = sourceVersionsByChapter.get(candidate.chapterId) || new Set<string>()
      versions.add(candidate.sourceVersionId)
      sourceVersionsByChapter.set(candidate.chapterId, versions)
    }
    if (sourceVersionsByChapter.size) {
      current = current.map(candidate => {
        const versions = candidate.chapterId ? sourceVersionsByChapter.get(candidate.chapterId) : undefined
        if (!versions || !candidate.sourceVersionId || versions.has(candidate.sourceVersionId)) return candidate
        if (candidate.status !== 'proposed' && candidate.status !== 'deferred') return candidate
        return markCandidateStaleIfSourceChanged(candidate, [...versions][0])
      })
      candidatesByNovel.value[novelId] = current
    }

    const existingIds = new Set(current.map(candidate => candidate.id))
    const additions: CandidateChange[] = []
    for (const candidate of candidates) {
      if (existingIds.has(candidate.id)) continue
      existingIds.add(candidate.id)
      additions.push(candidate)
    }
    if (additions.length) candidatesByNovel.value[novelId] = [...current, ...additions]
    return additions.length
  }

  function markChapterCandidatesStale(novelId: string, chapterId: string, currentSourceVersionId: string): number {
    const current = getCandidates(novelId)
    let changed = 0
    const next = current.map(candidate => {
      if (candidate.chapterId !== chapterId
        || !candidate.sourceVersionId
        || candidate.sourceVersionId === currentSourceVersionId
        || (candidate.status !== 'proposed' && candidate.status !== 'deferred')) return candidate
      changed += 1
      return markCandidateStaleIfSourceChanged(candidate, currentSourceVersionId)
    })
    if (changed) candidatesByNovel.value[novelId] = next
    return changed
  }

  function getCandidates(novelId: string): CandidateChange[] {
    return candidatesByNovel.value[novelId] || []
  }

  function getPendingCandidates(novelId: string, chapterId?: string, sourceVersionId?: string): CandidateChange[] {
    return getCandidates(novelId).filter(candidate =>
      (candidate.status === 'proposed' || candidate.status === 'deferred')
      && (!chapterId || candidate.chapterId === chapterId)
      && (!sourceVersionId || !candidate.sourceVersionId || candidate.sourceVersionId === sourceVersionId),
    )
  }

  function replaceCandidates(novelId: string, candidates: CandidateChange[]) {
    candidatesByNovel.value[novelId] = candidates.slice()
  }

  function updateCandidate(novelId: string, candidate: CandidateChange): boolean {
    const current = getCandidates(novelId)
    const index = current.findIndex(item => item.id === candidate.id)
    if (index < 0) return false
    const next = current.slice()
    next[index] = candidate
    candidatesByNovel.value[novelId] = next
    return true
  }

  function removeCandidates(novelId: string, candidateIds: string[]) {
    const ids = new Set(candidateIds)
    candidatesByNovel.value[novelId] = getCandidates(novelId).filter(candidate => !ids.has(candidate.id))
  }

  function clearNovel(novelId: string) {
    delete editorDraftsByNovel.value[novelId]
    hydrated.delete(novelId)
    delete candidatesByNovel.value[novelId]
    delete canonMutationsByNovel.value[novelId]
    delete creationDraftsByNovel.value[novelId]
    delete reviewFindingsByNovel.value[novelId]
    delete reviewsByNovel.value[novelId]
    delete aiRunsByNovel.value[novelId]
    delete storyMemoriesByNovel.value[novelId]
    delete impactReportsByNovel.value[novelId]
  }

  function getCreationDraft(novelId: string): CreationDraft | undefined {
    return creationDraftsByNovel.value[novelId]
  }

  function setCreationDraft(novelId: string, draft: CreationDraft): CreationDraft {
    creationDraftsByNovel.value[novelId] = draft
    return draft
  }

  /** Publish a newly created workspace only after its story aggregate is durable. */
  function publishCreatedWorkspace(novelId: string, snapshot: ReconstructionWorkspaceSnapshot): void {
    adoptWorkspace(novelId, JSON.parse(JSON.stringify(snapshot)))
  }

  function updateCreationDraft(novelId: string, updates: Partial<CreationDraft>): CreationDraft | undefined {
    const current = getCreationDraft(novelId)
    if (!current) return undefined
    const next = { ...current, ...updates }
    creationDraftsByNovel.value[novelId] = next
    return next
  }

  function getReviewFindings(novelId: string, chapterId?: string): ReviewFinding[] {
    return (reviewFindingsByNovel.value[novelId] || []).filter(finding => !chapterId || finding.chapterId === chapterId)
  }

  function replaceChapterFindings(novelId: string, chapterId: string, findings: ReviewFinding[]) {
    const existing = (reviewFindingsByNovel.value[novelId] || []).filter(finding => finding.chapterId !== chapterId)
    reviewFindingsByNovel.value[novelId] = [...existing, ...findings]
  }

  function updateReviewFinding(novelId: string, finding: ReviewFinding): boolean {
    const current = reviewFindingsByNovel.value[novelId] || []
    const index = current.findIndex(item => item.id === finding.id)
    if (index < 0) return false
    const next = current.slice()
    next[index] = finding
    reviewFindingsByNovel.value[novelId] = next
    return true
  }

  function getChapterReviews(novelId: string, chapterId?: string): ChapterReview[] {
    return (reviewsByNovel.value[novelId] || []).filter(review => !chapterId || review.chapterId === chapterId)
  }

  function getLatestChapterReview(novelId: string, chapterId: string): ChapterReview | undefined {
    return getChapterReviews(novelId, chapterId)
      .slice()
      .sort((left, right) => {
        const leftTime = left.completedAt || left.startedAt
        const rightTime = right.completedAt || right.startedAt
        return rightTime.localeCompare(leftTime)
      })[0]
  }

  function replaceChapterReview(novelId: string, review: ChapterReview) {
    const current = getChapterReviews(novelId)
    const replaced = current.filter(item => item.id === review.id
      || (item.chapterId === review.chapterId && item.sourceVersionId === review.sourceVersionId))
    const archives = [...new Map([...replaced.flatMap(item => item.findingReconciliations || []),
      ...(review.findingReconciliations || [])].map(item => [item.id, item])).values()]
    const next = current.filter(item => item.id !== review.id
      && !(item.chapterId === review.chapterId && item.sourceVersionId === review.sourceVersionId))
    reviewsByNovel.value[novelId] = [...next, archives.length ? { ...review, findingReconciliations: archives } : review]
  }

  async function reconcileChapterFindings(novelId: string, chapterId: string): Promise<FindingsReconciliationResult> {
    const chapter = useNovelStore().getNovel(novelId)?.chapters.find(row => row.id === chapterId)
    if (!chapter?.contentReview) return 'unchanged'
    const baseline = JSON.stringify([chapter.content, chapter.contentReview, chapter.contentReviewSignature])
    return transactStory(novelId, aggregate => {
      const current = aggregate.novel.chapters.find(row => row.id === chapterId)
      if (!current || JSON.stringify([current.content, current.contentReview, current.contentReviewSignature]) !== baseline) {
        throw new Error('正文或审核报告已变化，未迁移旧问题，请重新打开章节。')
      }
      return reconcileLegacyChapterFindings(aggregate, chapterId, new Date().toISOString())
    }, result => result !== 'reconciled')
  }

  function getAiRuns(novelId: string): AiRun[] {
    return aiRunsByNovel.value[novelId] || []
  }

  function getAiRun(novelId: string, runId: string): AiRun | undefined {
    return getAiRuns(novelId).find(run => run.id === runId)
  }

  function replaceAiRun(novelId: string, run: AiRun) {
    const current = getAiRuns(novelId)
    const next = current.filter(item => item.id !== run.id)
    aiRunsByNovel.value[novelId] = [...next, run]
  }

  async function saveAiRun(novelId: string, run: AiRun): Promise<void> {
    const captured: AiRun = JSON.parse(JSON.stringify(run))
    await serializePersistence(novelId, async () => {
      if (projectTransferBusy.value || cloudApplyBusy.value || appUpdateInstalling.value) throw new Error('项目正在恢复、同步或准备更新，任务账本暂时无法保存。')
      const current = getAiRun(novelId, captured.id)
      if (current?.memoryTask) {
        for (const oldDetail of current.memoryTask.requests) {
          const detail = captured.memoryTask?.requests.find(row => row.id === oldDetail.id)
          if (!detail || ['nodeId', 'runId', 'executionId', 'nodeSignature', 'requestSignature', 'modelSignature', 'promptSignature', 'sourceRanges', 'sourceFingerprints'].some(field => JSON.stringify(detail[field as keyof typeof detail]) !== JSON.stringify(oldDetail[field as keyof typeof oldDetail]))) throw new Error('不能改写历史请求的来源证据')
        }
        for (const old of current.requests || []) {
          const next = captured.requests?.find(row => row.id === old.id)
          if (!next || old.status !== 'pending' && JSON.stringify(old) !== JSON.stringify(next)) throw new Error('任务账本已变化，拒绝覆盖已记录请求')
        }
      }
      await saveReconstructionRun(novelId, captured)
      replaceAiRun(novelId, captured)
    })
  }

  async function saveAuthorMemoryDraft(novelId: string, draft: StoryMemoryTaskDraft, flushToken?: DraftFlushToken): Promise<AiRun> {
    const captured = JSON.parse(JSON.stringify(draft)) as StoryMemoryTaskDraft
    return serializePersistence(novelId, async () => {
      if ((projectTransferBusy.value || cloudApplyBusy.value || appUpdateInstalling.value) && !isDraftFlushTokenActive(flushToken)) throw new Error('项目正在恢复或同步，草稿暂时无法保存')
      const current = getAiRuns(novelId).slice().reverse().find(row => row.memoryTask && JSON.stringify(row.memoryTask.scope) === JSON.stringify(captured.scope))
      if (current?.status === 'running') throw new Error('请等待生成任务停止后保存草稿')
      const next: AiRun = current ? JSON.parse(JSON.stringify(current)) : createAuthorStoryMemoryRun(novelId, captured)
      const task = next.memoryTask!
      task.titleDraft = captured.title; task.bodyDraft = captured.body; task.level = captured.level
      if (task.stage === 'draft') { task.sourceVersionId = captured.sourceVersionId; task.openBaseline = captured.openBaseline; next.tokenBudget = captured.tokenBudget ?? next.tokenBudget; next.requestLimit = captured.requestLimit ?? next.requestLimit }
      if (task.stage === 'committed') { task.stage = 'paused'; task.candidate = undefined; next.status = 'paused' }
      next.updatedAt = new Date().toISOString(); task.updatedAt = next.updatedAt
      await saveReconstructionRun(novelId, next); replaceAiRun(novelId, next); return next
    })
  }
  async function saveMemoryTaskDraft(novelId: string, runId: string, draft: { title: string; body: string; sourceVersionId: string }, flushToken?: DraftFlushToken): Promise<AiRun> {
    return serializePersistence(novelId, async () => {
      if ((projectTransferBusy.value || cloudApplyBusy.value || appUpdateInstalling.value) && !isDraftFlushTokenActive(flushToken)) throw new Error('项目正在恢复或同步，草稿暂时无法保存')
      const current = getAiRun(novelId, runId)
      if (!current?.memoryTask || current.status === 'running' || current.memoryTask.stage === 'committed' || current.memoryTask.sourceVersionId !== draft.sourceVersionId) throw new Error('回顾任务已变化，未覆盖草稿')
      const next: AiRun = JSON.parse(JSON.stringify(current))
      next.memoryTask!.titleDraft = draft.title; next.memoryTask!.bodyDraft = draft.body
      next.updatedAt = new Date().toISOString(); next.memoryTask!.updatedAt = next.updatedAt
      await saveReconstructionRun(novelId, next); replaceAiRun(novelId, next); return next
    })
  }
  async function saveAiRunLimits(novelId: string, expected: AiRun, limits: { tokenBudget: number; requestLimit: number }): Promise<void> {
    const captured: AiRun = JSON.parse(JSON.stringify(expected)), capturedLimits = { ...limits }
    await serializePersistence(novelId, async () => {
      if (projectTransferBusy.value || cloudApplyBusy.value || appUpdateInstalling.value) throw new Error('项目正在保存或恢复，暂时不能调整额度。')
      const current = getAiRun(novelId, captured.id)
      if (!current || JSON.stringify(current) !== JSON.stringify(captured)) throw new Error('任务记录已经变化，请刷新后调整额度。')
      const next = reviseAiRunLimits(current, capturedLimits, new Date().toISOString())
      await saveReconstructionRun(novelId, next)
      replaceAiRun(novelId, next)
    })
  }

  async function decideAiDraft(novelId: string, runId: string, expected: AiChapterDraft, action: 'edit' | 'accept' | 'reject', content?: string): Promise<AiChapterDraft> {
    const captured: AiChapterDraft = JSON.parse(JSON.stringify(expected))
    return transactStory(novelId, aggregate => {
      const run = aggregate.workspace.aiRuns?.find(row => row.id === runId)
      if (run && isAutonomousRunActive(run)) throw new Error('请先暂停任务，再处理候选稿。')
      return decideAutonomousDraft(aggregate, runId, captured, action, content, useKnowledgeStore().knowledgeBases, new Date().toISOString())
    })
  }

  function removeAiRun(novelId: string, runId: string): boolean {
    const current = getAiRuns(novelId)
    const next = current.filter(run => run.id !== runId)
    if (next.length === current.length) return false
    aiRunsByNovel.value[novelId] = next
    return true
  }

  function getCanonMutations(novelId: string): CanonMutationRecord[] {
    return canonMutationsByNovel.value[novelId] || []
  }

  function getStoryMemories(novelId: string): StoryMemoryRecord[] {
    return storyMemoriesByNovel.value[novelId] || []
  }

  function getImpactReports(novelId: string): StoryImpactReport[] {
    return impactReportsByNovel.value[novelId] || []
  }

  async function saveStoryMemory(novelId: string, input: SaveStoryMemoryInput): Promise<StoryMemoryRecord> {
    const captured: SaveStoryMemoryInput = JSON.parse(JSON.stringify(input))
    return transactStory(novelId, aggregate => confirmStoryMemory(aggregate, captured, new Date().toISOString()),
      record => captured.expectedRecord !== null && JSON.stringify(record) === captured.expectedRecord)
  }

  function hasCanonMutation(novelId: string, candidateId: string): boolean {
    return getCanonMutations(novelId).some(mutation => mutation.candidateId === candidateId)
  }

  function recordCanonMutation(novelId: string, mutation: CanonMutationRecord): boolean {
    if (mutation.novelId !== novelId || hasCanonMutation(novelId, mutation.candidateId)) return false
    canonMutationsByNovel.value[novelId] = [...getCanonMutations(novelId), mutation]
    return true
  }

  async function hydrateFromPersistence(novelId: string) {
    return serializePersistence(novelId, async () => {
      const snapshot = await loadReconstructionWorkspace(novelId)
      const recovered = (snapshot.aiRuns || []).map(run => {
        if (run.taskType !== 'memory_update' || !run.memoryTask) return run
        const pending = run.requests?.some(request => request.status === 'pending')
        if (!pending && run.status !== 'running') return run
        const next = JSON.parse(JSON.stringify(run)) as AiRun
        next.status = 'paused'
        next.error = '应用重启或页面离开时发现未完成请求；已标记为中断，需作者明确继续。'
        next.updatedAt = new Date().toISOString()
        next.memoryTask!.stage = 'interrupted'
        next.memoryTask!.usageEstimated = true
        next.memoryTask!.updatedAt = next.updatedAt
        next.requests = next.requests?.map(request => request.status === 'pending'
          ? { ...request, status: 'interrupted' as const, usageSource: 'estimated' as const, completedAt: next.updatedAt } : request)
        next.memoryTask!.graph.forEach(node => { if (node.status === 'running') node.status = 'unknown' })
        refreshMemoryRequestMetrics(next)
        return next
      })
      const changed = JSON.stringify(recovered) !== JSON.stringify(snapshot.aiRuns || [])
      if (changed) {
        snapshot.aiRuns = recovered
        for (const run of recovered) {
          if (run.taskType === 'memory_update' && run.memoryTask?.stage === 'interrupted') await saveReconstructionRun(novelId, run)
        }
      }
      adoptWorkspace(novelId, snapshot)
      return snapshot
    })
  }

  function adoptWorkspace(novelId: string, snapshot: ReconstructionWorkspaceSnapshot) {
    editorDraftsByNovel.value[novelId] = snapshot.editorDrafts || []
    if (snapshot.creationDraft) creationDraftsByNovel.value[novelId] = snapshot.creationDraft
    else delete creationDraftsByNovel.value[novelId]
    candidatesByNovel.value[novelId] = snapshot.candidates
    reviewFindingsByNovel.value[novelId] = snapshot.reviewFindings
    reviewsByNovel.value[novelId] = snapshot.chapterReviews || []
    aiRunsByNovel.value[novelId] = snapshot.aiRuns || []
    storyMemoriesByNovel.value[novelId] = snapshot.storyMemories || []
    impactReportsByNovel.value[novelId] = snapshot.impactReports || []
    canonMutationsByNovel.value[novelId] = snapshot.canonMutations
    hydrated.add(novelId)
  }

  /** Called only after the full project transaction has committed. */
  function adoptProjectWorkspaces(workspaces: ProjectWorkspaceSnapshot[]) {
    editorDraftsByNovel.value = {}
    candidatesByNovel.value = {}
    canonMutationsByNovel.value = {}
    creationDraftsByNovel.value = {}
    reviewFindingsByNovel.value = {}
    reviewsByNovel.value = {}
    aiRunsByNovel.value = {}
    storyMemoriesByNovel.value = {}
    impactReportsByNovel.value = {}
    hydrated.clear()
    for (const workspace of workspaces) adoptWorkspace(workspace.novelId, JSON.parse(JSON.stringify(workspace)))
  }

  function snapshotForPersistence(novelId: string) {
    return {
      editorDrafts: editorDraftsByNovel.value[novelId] || [],
      creationDraft: getCreationDraft(novelId),
      candidates: getCandidates(novelId),
      reviewFindings: getReviewFindings(novelId),
      chapterReviews: getChapterReviews(novelId),
      aiRuns: getAiRuns(novelId),
      storyMemories: getStoryMemories(novelId),
      impactReports: getImpactReports(novelId),
      canonMutations: getCanonMutations(novelId),
    }
  }

  async function persistToDatabase(novelId: string): Promise<void> {
    await serializePersistence(novelId, () => saveCurrentWorkspace(novelId))
  }

  function assertCreationAvailable(): void {
    if (projectTransferBusy.value || cloudApplyBusy.value || appUpdateInstalling.value) {
      throw new Error('项目正在恢复、同步或准备更新，暂时不能创建作品。')
    }
  }

  /** Persist a first novel and its initial workspace as one SQL/kernel aggregate. */
  async function persistInitialCreation(novel: Novel, workspace: ReconstructionWorkspaceSnapshot): Promise<void> {
    const capturedNovel = JSON.parse(JSON.stringify(novel)) as Novel
    const capturedWorkspace = JSON.parse(JSON.stringify(workspace)) as ReconstructionWorkspaceSnapshot
    assertCreationAvailable()
    await serializePersistence(capturedNovel.id, async () => {
      assertCreationAvailable()
      await useKnowledgeStore().flushPendingSaves()
      assertCreationAvailable()
      const expected = await readStoryAggregate(capturedNovel.id)
      assertCreationAvailable()
      if (expected.novel) throw new Error('作品已经存在，请刷新书架后重试。')
      await saveStoryAggregate({ novel: capturedNovel, workspace: capturedWorkspace }, expected)
    })
  }

  function captureCreationEditBaseline(novelId: string): string {
    const novel = useNovelStore().getNovel(novelId)
    if (!novel) throw new Error('作品不存在，请重新打开')
    return captureCreationBaseline(novel, getCreationDraft(novelId))
  }

  async function commitCreationEdit(novelId: string, edit: CreationEdit, baseline: string) {
    const captured = JSON.parse(JSON.stringify(edit)) as CreationEdit
    return transactStory(novelId, aggregate => {
      const changed = applyCreationEdit(aggregate, captured, baseline, new Date().toISOString(),
        () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10))
      return { changed, baseline: captureCreationBaseline(aggregate.novel, aggregate.workspace.creationDraft) }
    }, result => !result.changed)
  }

  async function saveCreationRecovery(novelId: string, edit: CreationRecoveryEdit, flushToken?: DraftFlushToken): Promise<void> {
    const captured: CreationRecoveryEdit = JSON.parse(JSON.stringify(edit))
    return serializePersistence(novelId, async () => {
      const controlledEditorFlush = isDraftFlushTokenActive(flushToken) && (captured.kind === 'editor'
        || captured.kind === 'attempt' && !['queued', 'running'].includes(captured.value.status)
        || isSceneRecoveryEdit(captured) && canFlushSceneRecovery(captured))
      if ((projectTransferBusy.value || cloudApplyBusy.value || appUpdateInstalling.value) && !controlledEditorFlush) throw new Error('项目正在保存或恢复，创作草稿暂时无法保存')
      const persisted = await loadReconstructionWorkspace(novelId)
      const snapshot = currentWorkspace(novelId, persisted)
      if (!snapshot.creationDraft) throw new Error('请先打开作品创作草稿')
      snapshot.creationDraft = applyCreationRecovery(snapshot.creationDraft, captured)
      validateReconstructionCreationDraft(snapshot.creationDraft)
      await saveReconstructionWorkspace(novelId, snapshot)
      creationDraftsByNovel.value[novelId] = snapshot.creationDraft
    })
  }

  function getEditorDrafts(novelId: string): EditorDraft[] {
    return JSON.parse(JSON.stringify((editorDraftsByNovel.value[novelId] || []).filter(draft => draft.status === 'active')))
  }

  /** Complete owned snapshot for history/live-state comparison, including deletion markers. */
  function getEditorDraftSnapshot(novelId: string): EditorDraft[] | undefined {
    const rows = editorDraftsByNovel.value[novelId]
    return rows ? JSON.parse(JSON.stringify(rows)) : undefined
  }

  /** CAS is evaluated against durable state. Only registered form flushing may cross the transfer guard. */
  function saveEditorDraft(command: EditorDraftCommand, flushToken?: DraftFlushToken): Promise<EditorDraft> {
    if (command.action === 'save') assertEditorPayload(command.draft.payload)
    const captured: EditorDraftCommand = JSON.parse(JSON.stringify(command))
    const assertAvailable = () => {
      if ((projectTransferBusy.value || cloudApplyBusy.value || appUpdateInstalling.value) && !isDraftFlushTokenActive(flushToken)) {
        throw new Error('项目正在恢复、同步或准备更新。编辑输入已保留，稍后可重试保存草稿。')
      }
    }
    return serializePersistence(captured.novelId, async () => {
      assertAvailable()
      const result = await commitEditorDraftCommand(captured, assertAvailable)
      editorDraftsByNovel.value[captured.novelId] = JSON.parse(JSON.stringify(result.drafts))
      return JSON.parse(JSON.stringify(result.draft)) as EditorDraft
    })
  }

  /** Tracks a coalescing editor's entire drain, including intervals between queued writes after unmount. */
  function trackEditorDraftWork<T>(work: Promise<T>): Promise<T> {
    editorDraftWork.add(work)
    void work.finally(() => editorDraftWork.delete(work)).catch(() => undefined)
    return work
  }

  /** Formal character save + exact draft retirement share the existing story transaction. */
  async function commitCharacterEditorDraft(checkpoint: EditorDraft): Promise<boolean> {
    const captured: EditorDraft = JSON.parse(JSON.stringify(checkpoint))
    assertEditorDraft(captured, captured.novelId)
    if (captured.kind !== 'character-form' || captured.status !== 'active' || !captured.payload) throw new Error('请选择完整的人物表单草稿。')
    return transactStory(captured.novelId, aggregate => {
      const now = new Date().toISOString(), operationId = 'submit:' + captured.lastOperationId
      const rows = aggregate.workspace.editorDrafts || []
      const current = rows.find(row => row.id === captured.id)
      if (current?.status === 'discarded' && current.lastOperationId === operationId && current.revision === captured.revision + 1) return false
      if (!current || JSON.stringify(current) !== JSON.stringify(captured)) throw new Error('人物草稿已有更新，请先保存并重新确认当前版本。')
      const p = captured.payload as CharacterEditorPayload
      const updates = {
        name: p.name.trim(), aliases: p.aliasesText.split(/[,，、]/).map(name => name.trim()).filter(Boolean),
        identity: p.identity, personality: p.personality, powerLevel: p.powerLevel, faction: p.faction,
        status: p.status as import('@/types/novel').Character['status'], description: p.description,
        avatarId: p.avatarId || undefined,
        relationships: p.relationships.map(relation => {
          const target = aggregate.novel.characters.find(character => character.id === relation.targetId)
          if (!target || target.id === captured.targetId) throw new Error('关系目标已删除或无效，请核对表单。')
          return { targetId: target.id, targetName: target.name, relation: relation.relation.trim(),
            dimension: relation.dimension === 'custom' ? 'custom:' + relation.dimensionName.trim() : relation.dimension }
        }),
      }
      if (!captured.targetId && JSON.stringify(aggregate.novel.characters) !== captured.openedBaseline) throw new Error('人物资料在新建表单打开后已变化，请先核对最新资料。原输入仍在草稿中。')
      editDefinitionsWithImpact(aggregate, [captured.targetId
        ? { action: 'update', kind: 'character', entityId: captured.targetId, expectedEntity: captured.openedBaseline, updates }
        : { action: 'create', kind: 'character', data: updates }], now, () => crypto.randomUUID())
      aggregate.workspace.editorDrafts = applyEditorDraftCommand(rows, { action: 'discard', novelId: captured.novelId, id: captured.id,
        expected: editorDraftVersion(captured), operationId }, now).drafts
      return true
    }, changed => !changed)
  }

  async function saveCurrentWorkspace(novelId: string): Promise<void> {
    const persisted = await loadReconstructionWorkspace(novelId)
    const snapshot = currentWorkspace(novelId, persisted)
    const serialized = JSON.stringify(snapshot)
    if (serialized !== JSON.stringify(persisted)) await saveReconstructionWorkspace(novelId, JSON.parse(serialized))
  }

  async function commitScenePlanningEdit(novelId: string, edit: ScenePlanningEdit, baseline: string) {
    const captured = JSON.parse(JSON.stringify(edit)) as ScenePlanningEdit
    return transactStory(novelId, aggregate => applyScenePlanningEdit(aggregate, captured, baseline,
      new Date().toISOString(), () => crypto.randomUUID()), result => !result.changed)
  }

  function currentWorkspace(novelId: string, persisted: ReconstructionWorkspaceSnapshot): ReconstructionWorkspaceSnapshot {
    const current = snapshotForPersistence(novelId)
    // A contract can be edited before the rest of this workspace is opened.
    // Only collections owned by this store may replace their persisted values.
    return {
      // Draft input is never published before its narrow CAS commits. Always keep
      // durable rows when composing a later full-workspace transaction.
      editorDrafts: persisted.editorDrafts || [],
      creationDraft: hydrated.has(novelId) || Object.prototype.hasOwnProperty.call(creationDraftsByNovel.value, novelId) ? current.creationDraft : persisted.creationDraft,
      candidates: Object.prototype.hasOwnProperty.call(candidatesByNovel.value, novelId) ? current.candidates : persisted.candidates,
      reviewFindings: Object.prototype.hasOwnProperty.call(reviewFindingsByNovel.value, novelId) ? current.reviewFindings : persisted.reviewFindings,
      chapterReviews: Object.prototype.hasOwnProperty.call(reviewsByNovel.value, novelId) ? current.chapterReviews : persisted.chapterReviews || [],
      aiRuns: Object.prototype.hasOwnProperty.call(aiRunsByNovel.value, novelId) ? current.aiRuns : persisted.aiRuns || [],
      storyMemories: Object.prototype.hasOwnProperty.call(storyMemoriesByNovel.value, novelId) ? current.storyMemories : persisted.storyMemories || [],
      impactReports: Object.prototype.hasOwnProperty.call(impactReportsByNovel.value, novelId) ? current.impactReports : persisted.impactReports || [],
      canonMutations: Object.prototype.hasOwnProperty.call(canonMutationsByNovel.value, novelId) ? current.canonMutations : persisted.canonMutations,
    }
  }

  async function flushPendingSaves(novelIds: string[]): Promise<void> {
    // Include saves queued while an earlier save or hydration was running.
    while (persistenceByNovel.size || editorDraftWork.size) {
      const results = await Promise.allSettled([...persistenceByNovel.values(), ...editorDraftWork])
      const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failure) throw failure.reason
    }
    const maps = [editorDraftsByNovel, creationDraftsByNovel, candidatesByNovel, reviewFindingsByNovel, reviewsByNovel, aiRunsByNovel, canonMutationsByNovel, storyMemoriesByNovel, impactReportsByNovel]
    for (const novelId of novelIds) {
      if (!maps.some(map => Object.prototype.hasOwnProperty.call(map.value, novelId)) && !hydrated.has(novelId)) continue
      await serializePersistence(novelId, () => saveCurrentWorkspace(novelId))
    }
  }

  function transactStory<R, P>(novelId: string, operation: (aggregate: StoryAggregate, prepared: P) => R,
    skipPersistence: ((value: R) => boolean) | undefined, assertLive: (() => void) | undefined,
    options: StoryTransactionOptions<P> & { prepare: () => Promise<P> }): Promise<R>
  function transactStory<R>(novelId: string, operation: (aggregate: StoryAggregate) => R,
    skipPersistence?: (value: R) => boolean, assertLive?: () => void): Promise<R>
  async function transactStory<R, P = undefined>(novelId: string, operation: (aggregate: StoryAggregate, prepared: P) => R,
    skipPersistence?: (value: R) => boolean, assertLive?: () => void, options?: StoryTransactionOptions<P>): Promise<R> {
    const assertAvailable = () => {
      if (projectTransferBusy.value || cloudApplyBusy.value || appUpdateInstalling.value) throw new Error('项目正在恢复、同步或准备更新，请稍后再处理审核。')
    }
    assertAvailable()
    return serializePersistence(novelId, async () => {
      let before!: ReconstructionWorkspaceSnapshot, committed!: ReconstructionWorkspaceSnapshot, didCommit = false
      const value = await useNovelStore().transactNovel(novelId, async novel => {
        assertAvailable()
        const expected = await readStoryAggregate(novelId)
        const prepared = await options?.prepare?.() as P
        before = JSON.parse(JSON.stringify(currentWorkspace(novelId, expected.workspace)))
        committed = JSON.parse(JSON.stringify(before))
        const aggregate = { novel, workspace: committed }
        const reviewed = withStoryReviewInvalidation(aggregate, useKnowledgeStore().knowledgeBases, () => operation(aggregate, prepared))
        const value = reviewed.value
        if (skipPersistence?.(value)) return { value, persist: null }
        didCommit = true
        return { value, persist: () => saveStoryAggregate(aggregate, expected, options?.revisionAcceptance?.(prepared), () => {
          assertLive?.()
          reviewed.assertKnowledgeCurrent(useKnowledgeStore().knowledgeBases)
        }) }
      })
      if (!didCommit) return value
      adoptWorkspace(novelId, mergeCommittedSnapshot(before, committed, currentWorkspace(novelId, before)))
      return value
    })
  }

  async function prepareChapterAnalysis(novelId: string) {
    return serializePersistence(novelId, async () => {
      const stored = await readStoryAggregate(novelId)
      const novel = useNovelStore().getNovel(novelId)
      if (!novel) throw new Error('分析作品已不存在。')
      return JSON.parse(JSON.stringify({ novel, canonMutations: currentWorkspace(novelId, stored.workspace).canonMutations })) as {
        novel: Novel; canonMutations: CanonMutationRecord[]
      }
    })
  }

  async function saveStoryStateScan(novelId: string, input: StoryStateScanSubmission, signal?: AbortSignal) {
    const captured = JSON.parse(JSON.stringify(input)) as StoryStateScanSubmission
    return transactStory(novelId, aggregate => {
      signal?.throwIfAborted()
      return commitStoryStateScan(aggregate, captured, new Date().toISOString())
    }, count => count === 0)
  }

  async function saveChapterAnalysis(novelId: string, input: ChapterAnalysisSubmission, signal?: AbortSignal) {
    const captured = JSON.parse(JSON.stringify(input)) as ChapterAnalysisSubmission
    return transactStory(novelId, aggregate => {
      signal?.throwIfAborted()
      return commitChapterAnalysis(aggregate, captured, new Date().toISOString(), () => crypto.randomUUID())
    }, result => !result.changed)
  }

  async function commitWritingSuggestion(novelId: string, input: SaveWritingSuggestionInput) {
    const captured = JSON.parse(JSON.stringify(input)) as SaveWritingSuggestionInput
    return transactStory(novelId, aggregate => saveWritingSuggestion(aggregate, captured, new Date().toISOString(),
      useKnowledgeStore().knowledgeBases), result => !result.changed)
  }

  function retireScanEditorDraft(snapshot: ReconstructionWorkspaceSnapshot, novelId: string, checkpoint: EditorDraft): boolean {
    assertEditorDraft(checkpoint, novelId)
    if (checkpoint.novelId !== novelId || !['character-scan', 'relationship-scan'].includes(checkpoint.kind)
      || checkpoint.status !== 'active' || checkpoint.payload?.state !== 'ready') throw new Error('扫描恢复版本不属于本次结果。')
    const rows = snapshot.editorDrafts || []
    const current = rows.find(row => row.id === checkpoint.id)
    const operationId = 'submit:' + checkpoint.lastOperationId
    const already = current?.status === 'discarded' && current.lastOperationId === operationId && current.revision === checkpoint.revision + 1
    if (!already && (!current || JSON.stringify(current) !== JSON.stringify(checkpoint))) throw new Error('扫描草稿已有更新，请重新选择版本。')
    snapshot.editorDrafts = applyEditorDraftCommand(rows, { action: 'discard', novelId, id: checkpoint.id,
      expected: editorDraftVersion(checkpoint), operationId }, new Date().toISOString()).drafts
    return !already
  }

  async function saveCharacterScanCandidates(novelId: string, baseline: string, candidates: CandidateChange[], editorCheckpoint?: EditorDraft): Promise<number> {
    const captured = JSON.parse(JSON.stringify(candidates)) as CandidateChange[]
    const checkpoint = editorCheckpoint ? JSON.parse(JSON.stringify(editorCheckpoint)) as EditorDraft : undefined
    const result = await transactStory(novelId, aggregate => {
      const result = saveCharacterScan(aggregate, baseline, captured)
      if (checkpoint) {
        if (checkpoint.kind !== 'character-scan' || checkpoint.openedBaseline !== baseline
          || JSON.stringify(checkpoint.payload?.candidates) !== JSON.stringify(captured)) throw new Error('角色扫描结果与草稿版本不一致。')
        result.changed = retireScanEditorDraft(aggregate.workspace, novelId, checkpoint) || result.changed
      }
      return result
    }, result => !result.changed)
    return result.added
  }

  async function saveRelationshipCandidates(novelId: string, chapterId: string, sourceVersion: string, characterBaseline: string, candidates: CandidateChange[], editorCheckpoint?: EditorDraft): Promise<number> {
    const captured = JSON.parse(JSON.stringify(candidates)) as CandidateChange[]
    const checkpoint = editorCheckpoint ? JSON.parse(JSON.stringify(editorCheckpoint)) as EditorDraft : undefined
    return transactStory(novelId, aggregate => {
      const chapter = aggregate.novel.chapters.find(row => row.id === chapterId)
      if (!chapter || buildAnalysisSourceVersionId(chapter.content) !== sourceVersion
        || JSON.stringify(aggregate.novel.characters) !== characterBaseline) throw new Error('正文或角色资料已变化，请重新扫描关系。')
      const ids = new Set(aggregate.workspace.candidates.map(row => row.id))
      let added = 0
      for (const candidate of captured) {
        if (candidate.type !== 'relationship' || candidate.status !== 'proposed' || candidate.novelId !== novelId
          || candidate.chapterId !== chapterId || candidate.sourceVersionId !== sourceVersion) throw new Error('关系候选不属于当前章节版本。')
        verifyEvidence(aggregate.novel, candidate)
        createCharacterStateChange(aggregate.novel, candidate, JSON.parse(candidate.proposedValue), aggregate.workspace.canonMutations, { mode: 'proposal' })
        if (ids.has(candidate.id)) continue
        ids.add(candidate.id); aggregate.workspace.candidates.push(candidate); added++
      }
      if (checkpoint) {
        if (checkpoint.kind !== 'relationship-scan' || checkpoint.targetId !== chapterId || checkpoint.payload?.sourceVersion !== sourceVersion
          || checkpoint.payload?.characterBaseline !== characterBaseline || JSON.stringify(checkpoint.payload?.candidates) !== JSON.stringify(captured)) throw new Error('关系扫描结果与草稿版本不一致。')
        retireScanEditorDraft(aggregate.workspace, novelId, checkpoint)
      }
      return added
    })
  }

  async function captureDecision<T extends CandidateChange | ReviewFinding>(novelId: string, record: T | undefined, options?: StoryDecisionOptions<T>): Promise<StoryDecisionOptions<T>> {
    if (options) return JSON.parse(JSON.stringify(options))
    const novel = useNovelStore().getNovel(novelId)
    if (!novel || !record?.chapterId) throw new Error('找不到来源章节或审核记录。')
    const expectedRecord = JSON.parse(JSON.stringify(record)), capturedNovel = JSON.parse(JSON.stringify(novel))
    const knowledge = JSON.parse(JSON.stringify(useKnowledgeStore().knowledgeBases))
    const local = JSON.parse(JSON.stringify(snapshotForPersistence(novelId)))
    const owned = Object.fromEntries(Object.entries({ editorDrafts: editorDraftsByNovel, creationDraft: creationDraftsByNovel, candidates: candidatesByNovel,
      reviewFindings: reviewFindingsByNovel, chapterReviews: reviewsByNovel, aiRuns: aiRunsByNovel,
      storyMemories: storyMemoriesByNovel, impactReports: impactReportsByNovel, canonMutations: canonMutationsByNovel })
      .filter(([, map]) => hydrated.has(novelId) || Object.prototype.hasOwnProperty.call(map.value, novelId))
      .map(([key]) => [key, local[key]]))
    // Never treat unopened collections as empty review context, or hydrate over unsaved author edits.
    const workspace = hydrated.has(novelId) ? local : { ...await loadReconstructionWorkspace(novelId), ...owned }
    return { expectedRecord, expectedSourceVersionId: storyDecisionSourceVersion({ novel: capturedNovel, workspace }, expectedRecord.chapterId, knowledge) }
  }

  async function acceptStoryCandidate(novelId: string, candidateId: string, now: string, editedValue?: string, options?: StoryDecisionOptions<CandidateChange>): Promise<CanonMutationRecord> {
    const captured = await captureDecision(novelId, getCandidates(novelId).find(item => item.id === candidateId), options)
    return transactStory(novelId, aggregate => acceptStoryChange(aggregate, candidateId, now, useKnowledgeStore().knowledgeBases, editedValue, captured))
  }

  async function acceptCharacterStateCandidate(novel: Novel, candidateId: string, now: string): Promise<CanonMutationRecord> {
    return acceptStoryCandidate(novel.id, candidateId, now)
  }

  async function rejectStoryCandidate(novelId: string, candidateId: string, now: string, options?: StoryDecisionOptions<CandidateChange>): Promise<void> {
    const captured = await captureDecision(novelId, getCandidates(novelId).find(item => item.id === candidateId), options)
    return transactStory(novelId, aggregate => rejectStoryChange(aggregate, candidateId, now, useKnowledgeStore().knowledgeBases, captured))
  }

  async function deferStoryCandidate(novelId: string, candidateId: string, now: string, options?: StoryDecisionOptions<CandidateChange>): Promise<void> {
    const captured = await captureDecision(novelId, getCandidates(novelId).find(item => item.id === candidateId), options)
    return transactStory(novelId, aggregate => deferStoryChange(aggregate, candidateId, now, useKnowledgeStore().knowledgeBases, captured))
  }

  async function resolveStoryReviewFinding(novelId: string, findingId: string, status: FindingDecisionStatus, now: string, options?: StoryDecisionOptions<ReviewFinding>): Promise<void> {
    const captured = await captureDecision(novelId, getReviewFindings(novelId).find(item => item.id === findingId), options)
    return transactStory(novelId, aggregate => resolveStoryFinding(aggregate, findingId, status, now, useKnowledgeStore().knowledgeBases, captured))
  }

  async function finalizeChapter(novelId: string, chapterId: string, expectedVersion: string, now: string): Promise<ChapterReview> {
    return transactStory(novelId, aggregate => finalizeStoryChapter(aggregate, chapterId, expectedVersion, now, useKnowledgeStore().knowledgeBases))
  }

  async function commitChapterReview(novelId: string, input: ChapterReviewSubmission, signal?: AbortSignal) {
    const captured: ChapterReviewSubmission = JSON.parse(JSON.stringify(input))
    return transactStory(novelId, aggregate => {
      signal?.throwIfAborted()
      return saveChapterReviewSnapshot(aggregate, captured, new Date().toISOString(), useKnowledgeStore().knowledgeBases)
    }, result => !result.changed)
  }

  async function confirmChapterCompletionClock(novelId: string, chapterId: string, days: number, baseline: string) {
    return transactStory(novelId, aggregate => confirmCompletionClock(aggregate, chapterId, days, baseline,
      new Date().toISOString(), () => crypto.randomUUID()), changed => !changed)
  }

  async function completeChapter(novelId: string, input: ChapterCompletionInput, signal?: AbortSignal) {
    const captured = { ...input }
    return transactStory(novelId, aggregate => {
      signal?.throwIfAborted()
      return commitChapterCompletion(aggregate, captured, new Date().toISOString(), () => crypto.randomUUID(), useKnowledgeStore().knowledgeBases)
    }, result => !result.changed)
  }

  function captureEventCausalityOpenBaseline(novelId: string): string {
    const novel = useNovelStore().getNovel(novelId)
    if (!novel || !hydrated.has(novelId)) throw new Error('请等待工作区读取完成。')
    return captureEventCausalityBaseline(novel, getCanonMutations(novelId))
  }
  function saveEventCausality(novelId: string, input: EventCausalityEdit) {
    const captured: EventCausalityEdit = JSON.parse(JSON.stringify(input))
    return transactStory(novelId, aggregate => commitEventCausality(aggregate, captured, new Date().toISOString(), () => crypto.randomUUID()))
  }
  return {
    getEditorDrafts,
    getEditorDraftSnapshot,
    saveEditorDraft,
    trackEditorDraftWork,
    commitCharacterEditorDraft,
    captureEventCausalityOpenBaseline,
    saveEventCausality,
    commitChapterReview,
    confirmChapterCompletionClock,
    completeChapter,
    captureCreationEditBaseline,
    commitCreationEdit,
    commitScenePlanningEdit,
    saveRelationshipCandidates,
    saveCharacterScanCandidates,
    commitWritingSuggestion,
    saveChapterAnalysis,
    prepareChapterAnalysis,
    saveStoryStateScan,
    candidatesByNovel,
    canonMutationsByNovel,
    creationDraftsByNovel,
    reviewFindingsByNovel,
    reviewsByNovel,
    aiRunsByNovel,
    storyMemoriesByNovel,
    impactReportsByNovel,
    getStoryMemories,
    getImpactReports,
    saveStoryMemory,
    addCandidateChanges,
    markChapterCandidatesStale,
    getCandidates,
    getPendingCandidates,
    replaceCandidates,
    updateCandidate,
    removeCandidates,
    clearNovel,
    getCanonMutations,
    hasCanonMutation,
    recordCanonMutation,
    acceptCharacterStateCandidate,
    acceptStoryCandidate,
    rejectStoryCandidate,
    deferStoryCandidate,
    resolveStoryReviewFinding,
    finalizeChapter,
    getCreationDraft,
    setCreationDraft,
    publishCreatedWorkspace,
    updateCreationDraft,
    getReviewFindings,
    replaceChapterFindings,
    reconcileChapterFindings,
    updateReviewFinding,
    getChapterReviews,
    getLatestChapterReview,
    replaceChapterReview,
    getAiRuns,
    getAiRun,
    replaceAiRun,
    saveAiRun,
    saveAiRunLimits,
    saveMemoryTaskDraft,
    saveAuthorMemoryDraft,
    saveCreationRecovery,
    decideAiDraft,
    removeAiRun,
    hydrateFromPersistence,
    persistToDatabase,
    persistInitialCreation,
    transactStory,
    flushPendingSaves,
    adoptProjectWorkspaces,
    pendingCount: computed(() => Object.values(candidatesByNovel.value)
      .flat()
      .filter(candidate => candidate.status === 'proposed').length),
  }
})
