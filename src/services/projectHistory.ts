import { useNovelStore } from '@/stores/novel'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { assertProjectIdle, projectTransferBusy } from './projectTransfer'
import { captureProjectSnapshot, flushProjectState } from './projectSnapshot'
import { usesProjectKernel, readProjectLibrary, listProjectSnapshots, readHistoricalProject, createKernelHistoryPoint, restoreKernelNovel, rebuildProjectIndex, readKernelHistoryRuns, previewKernelHistoryCapacity, cleanupKernelHistory } from './projectKernelClient'
import { listSqlHistory, readSqlHistory, saveSqlHistory, restoreSqlHistory, readSqlHistoryRuns, sqlHistoryRunsBaseline, previewSqlHistoryCapacity } from './db/projectHistory'
import { getRowCacheEpoch } from './database'
import { historyClone, historyScope, mergeHistoryRuns, prepareHistoryRestore, replaceHistoryScope } from './projectHistoryMerge'
import { buildProjectHistoryDiff, stableHistoryValue } from './projectHistoryDiff'
import { parseProjectBackup, type ProjectBackup } from './projectBackup'
import { mergeCommittedSnapshot } from './committedSnapshotMerge'
import type { ProjectHistoryPreview, ProjectHistoryCapacity, ProjectHistoryCleanupResult } from '@/types/projectHistory'
import type { AiRun } from '@/types/reconstruction'

// The author confirms a preview token. Never accept a mutable UI snapshot as restore authority.
const previews = new Map<string, { novelId: string; revision: string; baseline: string }>()
async function exclusive<T>(work: () => Promise<T>): Promise<T> {
  assertProjectIdle(); projectTransferBusy.value = true
  try { await flushProjectState(); return await work() } finally { projectTransferBusy.value = false }
}
async function baseline(backup: ProjectBackup): Promise<string> {
  const bytes = new TextEncoder().encode(stableHistoryValue({ ...backup, exportedAt: undefined }))
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
}
export async function listProjectHistory() { return usesProjectKernel() ? listProjectSnapshots() : listSqlHistory() }
export async function readHistorySnapshot(revision: string) { return usesProjectKernel() ? readHistoricalProject(revision) : readSqlHistory(revision) }
export async function rebuildCurrentProjectIndex(novelId: string) {
  if (!usesProjectKernel()) throw new Error('当前环境没有桌面项目索引。')
  return exclusive(() => rebuildProjectIndex(novelId))
}
export async function previewProjectHistoryCapacity(): Promise<ProjectHistoryCapacity> {
  return exclusive(() => usesProjectKernel() ? previewKernelHistoryCapacity() : previewSqlHistoryCapacity())
}
export async function cleanupProjectHistoryCapacity(preview: ProjectHistoryCapacity): Promise<ProjectHistoryCleanupResult> {
  if (!usesProjectKernel()) throw new Error('当前浏览器没有可清理的桌面孤立文件。')
  return exclusive(() => cleanupKernelHistory(preview.token, preview.baseRevision))
}
/** One authoritative ledger source at a time. Never read a historical library. */
async function accumulateHistoryRuns(novelId: string, baseRevision: string | null, now: string): Promise<{ runs: AiRun[]; baseline: string | null; occurredRequests: Set<string> }> {
  const desktop = usesProjectKernel(), ledgerBaseline = desktop ? baseRevision : await sqlHistoryRunsBaseline()
  const occurredRequests = new Set<string>()
  let runs: AiRun[] = [], cursor = 0
  do {
    const page = desktop ? await readKernelHistoryRuns(novelId, ledgerBaseline, cursor)
      : await readSqlHistoryRuns(novelId, ledgerBaseline!, cursor)
    if (page.projectId !== novelId || page.baseRevision !== ledgerBaseline) throw new Error('历史账本读取基线无效。')
    if (page.source) {
      for (const run of page.source.runs) for (const request of run.requests || []) {
        const key = JSON.stringify([run.id, request.id])
        if (request.status === 'not_sent' && occurredRequests.has(key)) throw new Error('历史已发生或未知请求不能改为未发送：' + request.id)
        if (!['pending', 'not_sent'].includes(request.status)) occurredRequests.add(key)
      }
      runs = mergeHistoryRuns(runs, page.source.runs, now)
    }
    if (page.nextCursor === null) break
    if (page.nextCursor <= cursor) throw new Error('历史账本页码无效。')
    cursor = page.nextCursor
  } while (true)
  return { runs, baseline: ledgerBaseline, occurredRequests }
}
export async function createProjectHistoryPoint(novelId: string): Promise<void> {
  await exclusive(async () => {
    const current = await captureProjectSnapshot()
    if (!current.novels.some(row => row.id === novelId)) throw new Error('请先选择当前作品。')
    if (usesProjectKernel()) await createKernelHistoryPoint(novelId)
    else await saveSqlHistory(current, novelId, '作者手动恢复点')
  })
}
export async function previewProjectHistory(revision: string, novelId: string): Promise<ProjectHistoryPreview> {
  return exclusive(async () => {
    const current = await captureProjectSnapshot(), historical = await readHistorySnapshot(revision)
    const left = historyScope(current, novelId), right = historyScope(historical, novelId)
    if (!right.novel) throw new Error('该版本没有所选作品。')
    const token = crypto.randomUUID()
    previews.clear()
    previews.set(token, { novelId, revision, baseline: await baseline(current) })
    return { token, currentRevision: usesProjectKernel() ? (await readProjectLibrary()).revision! : String(getRowCacheEpoch()),
      targetRevision: revision, novelId, current: left, historical: right, diff: buildProjectHistoryDiff(left, right, novelId) }
  })
}
export async function restoreProjectHistory(token: string): Promise<void> {
  const preview = previews.get(token)
  if (!preview) throw new Error('请重新预览并确认恢复。')
  await exclusive(async () => {
    const kernelState = usesProjectKernel() ? await readProjectLibrary(true) : null
    const current = kernelState?.backup || await captureProjectSnapshot()
    const epoch = getRowCacheEpoch()
    if (await baseline(current) !== preview.baseline) throw new Error('预览后内容已变化（包括待保存编辑），请重新预览。')
    const baseRevision = kernelState?.revision || ''
    const history = await readHistorySnapshot(preview.revision)
    const now = new Date().toISOString()
    const ledger = await accumulateHistoryRuns(preview.novelId, kernelState?.revision || null, now)
    const scope = prepareHistoryRestore(current, historyScope(history, preview.novelId), ledger.runs, ledger.occurredRequests)
    const result = parseProjectBackup(JSON.stringify(replaceHistoryScope(current, scope)))
    const novels = useNovelStore(), workspaces = useReconstructionWorkspaceStore(), id = preview.novelId
    const stored = current.reconstructionWorkspaces.find(row => row.novelId === id)
    const before = stored ? { ...stored, storyMemories: stored.storyMemories || [], impactReports: stored.impactReports || [] } : undefined
    const liveWorkspace = () => before ? { ...before,
      ...(Object.prototype.hasOwnProperty.call(workspaces.aiRunsByNovel, id) ? { aiRuns: workspaces.getAiRuns(id) } : {}),
      ...(Object.prototype.hasOwnProperty.call(workspaces.candidatesByNovel, id) ? { candidates: workspaces.getCandidates(id) } : {}),
      ...(Object.prototype.hasOwnProperty.call(workspaces.reviewsByNovel, id) ? { chapterReviews: workspaces.getChapterReviews(id) } : {}),
      ...(Object.prototype.hasOwnProperty.call(workspaces.reviewFindingsByNovel, id) ? { reviewFindings: workspaces.getReviewFindings(id) } : {}),
      ...(Object.prototype.hasOwnProperty.call(workspaces.canonMutationsByNovel, id) ? { canonMutations: workspaces.getCanonMutations(id) } : {}),
      ...(Object.prototype.hasOwnProperty.call(workspaces.creationDraftsByNovel, id) ? { creationDraft: workspaces.getCreationDraft(id) } : {}),
      ...(Object.prototype.hasOwnProperty.call(workspaces.storyMemoriesByNovel, id) ? { storyMemories: workspaces.getStoryMemories(id) } : {}),
      ...(Object.prototype.hasOwnProperty.call(workspaces.impactReportsByNovel, id) ? { impactReports: workspaces.getImpactReports(id) } : {}),
    } : undefined
    const assertLive = () => {
      if (stableHistoryValue(novels.getNovel(id) || null) !== stableHistoryValue(current.novels.find(row => row.id === id) || null)
        || stableHistoryValue(liveWorkspace()) !== stableHistoryValue(before)) throw new Error('恢复准备期间作品有新的编辑，请重新预览。')
    }
    assertLive()
    if (!usesProjectKernel() && getRowCacheEpoch() !== epoch) throw new Error('恢复准备期间本地数据有更新，请重新预览。')
    let sqlLedgerBaseline = ''
    if (!usesProjectKernel()) {
      const point = await saveSqlHistory(current, id, '单作品恢复前保护点', preview.revision, ledger.baseline!)
      sqlLedgerBaseline = String(epoch) + ':' + point
    }
    const persist = async () => {
      assertLive()
      if (usesProjectKernel()) await restoreKernelNovel(baseRevision, preview.revision, id, scope)
      else await restoreSqlHistory(scope, result, epoch, preview.revision, assertLive, sqlLedgerBaseline)
    }
    if (novels.getNovel(id)) {
      await novels.transactNovel(id, async draft => {
        for (const key of Object.keys(draft)) delete (draft as unknown as Record<string, unknown>)[key]
        Object.assign(draft, historyClone(scope.novel!))
        return { value: undefined, persist }
      })
    } else { await persist(); novels.publishCreatedNovel(scope.novel!) }
    // Publish only this workspace; concurrent author edits win and stay available to the next flush.
    workspaces.publishCreatedWorkspace(id, before
      ? mergeCommittedSnapshot(before, scope.workspace!, liveWorkspace()!) : scope.workspace!)
    previews.delete(token)
  })
}
