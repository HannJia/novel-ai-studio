import { preserveAiRunRequestHistory, refreshMemoryRequestMetrics } from './aiRunRequestValidation'
import type { AiRun } from '@/types/reconstruction'
import type { ProjectBackup } from './projectBackup'
import type { ProjectHistoryScope } from '@/types/projectHistory'

export const historyClone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
export function historyScope(backup: ProjectBackup, novelId: string): ProjectHistoryScope {
  const novel = backup.novels.find(row => row.id === novelId) || null
  return historyClone({ novel, workspace: backup.reconstructionWorkspaces.find(row => row.novelId === novelId) || null,
    chapterRevisions: backup.chapterRevisions.filter(row => row.novelId === novelId),
    // Global exploration sessions have no ownership. Book conversations live in novel.inspirationHistory.
    inspirationSessions: [], knowledgeBaseIds: novel?.knowledgeBaseIds || [] })
}

/** Stream one validated source at a time; retain only target-book run records. */
export function mergeHistoryRuns(previous: AiRun[], incoming: AiRun[], now: string): AiRun[] {
  const source = historyClone(incoming)
  for (const run of source) {
    const old = previous.find(row => row.id === run.id)
    if (old && old.taskType !== run.taskType) throw new Error('历史任务编号对应不同类型，已停止恢复。')
    run.requests = run.requests?.map(request => {
      const settled = old?.requests?.find(row => row.id === request.id)
      if (settled && (settled.startedAt !== request.startedAt || settled.modelId !== request.modelId || settled.phase !== request.phase || settled.chapterIndex !== request.chapterIndex || settled.reservedTokens !== request.reservedTokens)) throw new Error('历史请求身份冲突：' + request.id)
      return request.status === 'pending' && settled && settled.status !== 'pending' ? historyClone(settled) : request
    })
    if (run.requests) run.usedTokens = run.requests.reduce((sum, row) => sum + row.inputTokens + row.outputTokens, 0)
    if (run.memoryTask) refreshMemoryRequestMetrics(run)
  }
  const result = preserveAiRunRequestHistory(previous, source, now)
  // The common ledger helper omits unbilled runs absent from its target. Preserve them as history too.
  for (const run of source) if (!result.some(row => row.id === run.id)) result.push(run)
  for (const run of result) {
    const latest = source.find(row => row.id === run.id)
    const old = previous.find(row => row.id === run.id)
    const legacyUsage = Math.max(!old?.requests ? old?.usedTokens || 0 : 0, !latest?.requests ? latest?.usedTokens || 0 : 0)
    if (!old?.requests && !latest?.requests && run.taskType !== 'memory_update') {
      delete run.requests; delete run.requestLimit
      run.usedTokens = Math.max(run.usedTokens || 0, legacyUsage)
    } else if (legacyUsage > (run.usedTokens || 0)) {
      throw new Error('旧任务累计用量缺少可核对的请求记录，不能降低已消费预算；请先补全该任务账本。')
    }
    run.status = 'paused'; run.checkpoint = 'history-restored-needs-author'; run.updatedAt = now
    for (const draft of run.chapterDrafts || []) {
      // Keep author decisions and pending text; invalidate approval evidence, never invent rejection.
      draft.contextVersion = 'history-restored:' + run.id
      delete draft.review; delete draft.reviewCoverage; delete draft.report
      draft.stage = 'generated'
    }
    if (run.memoryTask) {
      run.memoryTask.stage = 'paused'; run.memoryTask.updatedAt = now; delete run.memoryTask.candidate
      refreshMemoryRequestMetrics(run)
    }
  }
  return result
}
export function prepareHistoryRestore(current: ProjectBackup, historical: ProjectHistoryScope, accumulatedRuns: AiRun[], occurredRequests = new Set<string>()): ProjectHistoryScope {
  if (!historical.novel || !historical.workspace) throw new Error('该版本不包含完整作品，不能恢复。')
  const id = historical.novel.id, now = new Date().toISOString()
  const live = historyScope(current, id)
  for (const run of live.workspace?.aiRuns || []) for (const request of run.requests || []) {
    if (request.status === 'not_sent' && occurredRequests.has(JSON.stringify([run.id, request.id]))) throw new Error('历史已发生或未知请求不能改为未发送：' + request.id)
  }
  if ([...(live.novel?.chapters || []), ...(live.novel?.archivedChapters || [])].some(row => row.status === 'locked')) {
    throw new Error('作品含锁定章节，请先由作者解锁后再恢复。')
  }
  const result = historyClone(historical)
  const novel = result.novel!, workspace = result.workspace!
  const invalidatedVersion = 'history-restored:' + crypto.randomUUID()
  const available = new Set(current.knowledgeBases.map(row => row.id))
  novel.knowledgeBaseIds = novel.knowledgeBaseIds.filter(id => available.has(id))
  novel.updatedAt = now
  for (const chapter of [...novel.chapters, ...(novel.archivedChapters || [])]) {
    chapter.contentReviewSignature = ''; chapter.contentReviewCoverage = undefined; chapter.reviewRewriteBlockedSignature = ''
    chapter.status = chapter.content ? 'writing' : 'draft'
  }
  for (const review of workspace.chapterReviews) {
    review.status = 'needs_revision'; review.deterministicChecksPassed = false; review.semanticChecksPassed = false
    review.sourceVersionId = invalidatedVersion
  }
  const appliedCandidateIds = new Set(workspace.canonMutations.map(record => record.candidateId).filter(Boolean))
  for (const candidate of workspace.candidates) if (!appliedCandidateIds.has(candidate.id) && ['proposed', 'deferred', 'edited'].includes(candidate.status)) {
    candidate.sourceVersionId = invalidatedVersion
  }
  // Restore author drafts from the selected version while billing accumulates
  // across every protected branch. Ledger-only reads do not carry chapter prose.
  workspace.aiRuns = mergeHistoryRuns(mergeHistoryRuns(historical.workspace.aiRuns || [], accumulatedRuns, now), live.workspace?.aiRuns || [], now)
  result.knowledgeBaseIds = novel.knowledgeBaseIds
  return result
}

export function replaceHistoryScope(current: ProjectBackup, scope: ProjectHistoryScope): ProjectBackup {
  if (!scope.novel || !scope.workspace || scope.novel.id !== scope.workspace.novelId) throw new Error('历史作品归属无效。')
  const next = historyClone(current), id = scope.novel.id
  const index = next.novels.findIndex(row => row.id === id)
  if (index < 0) next.novels.push(scope.novel); else next.novels[index] = scope.novel
  const wi = next.reconstructionWorkspaces.findIndex(row => row.novelId === id)
  if (wi < 0) next.reconstructionWorkspaces.push(scope.workspace); else next.reconstructionWorkspaces[wi] = scope.workspace
  next.chapterRevisions = [...next.chapterRevisions.filter(row => row.novelId !== id), ...scope.chapterRevisions]
  next.exportedAt = new Date().toISOString()
  return next
}

