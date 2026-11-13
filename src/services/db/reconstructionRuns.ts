import { execute, initDb, queryAll, runTransaction } from '@/services/database'
import type { AiRun, AiRunMode, AiRunStatus } from '@/types/reconstruction'
import { usesProjectKernel } from '../projectKernelClient'
import { loadKernelWorkspace, saveKernelRun, changeKernelWorkspace } from '../projectKernelRepository'
import { assertAiRunRequests } from '../aiRunRequestValidation'
import { validateReconstructionAiRun } from '../reconstructionBackupValidation'

interface RunRow { value: string }

const aiRunModes: readonly AiRunMode[] = ['assist', 'collaborative', 'autonomous']
const aiRunStatuses: readonly AiRunStatus[] = ['queued', 'running', 'paused', 'completed', 'failed', 'cancelled', 'needs_author']
const aiRunTaskTypes: readonly AiRun['taskType'][] = ['brainstorm', 'contract', 'skeleton', 'outline', 'draft', 'review', 'memory_update', 'export']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function isOptionalInteger(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isInteger(value))
}

function isAiRun(value: unknown): value is AiRun {
  if (!isRecord(value)) return false
  try { assertAiRunRequests(value as unknown as AiRun); validateReconstructionAiRun(value) } catch { return false }
  return typeof value.id === 'string'
    && aiRunModes.includes(value.mode as AiRunMode)
    && aiRunTaskTypes.includes(value.taskType as AiRun['taskType'])
    && aiRunStatuses.includes(value.status as AiRunStatus)
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string'
    && isOptionalString(value.targetId)
    && isOptionalInteger(value.chapterStart)
    && isOptionalInteger(value.chapterEnd)
    && isOptionalInteger(value.tokenBudget)
    && isOptionalInteger(value.usedTokens)
    && isOptionalString(value.checkpoint)
    && isOptionalString(value.error)
}

function parseAiRun(value: string): AiRun | undefined {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!isAiRun(parsed)) throw new Error('任务记录损坏，不能忽略付费历史')
    return parsed
  } catch {
    throw new Error('AI 运行记录损坏，已停止加载以保护请求账本')
  }
}

function assertNovelId(novelId: string): void {
  if (!novelId.trim()) throw new Error('小说 ID 不能为空')
}

function assertRunId(runId: string): void {
  if (!runId.trim()) throw new Error('AI 运行 ID 不能为空')
}

function loadRunRows(novelId: string): AiRun[] {
  return queryAll<RunRow>(
    'SELECT value FROM reconstruction_ai_runs WHERE novel_id = ? ORDER BY created_at ASC, id ASC',
    [novelId],
  ).map(row => parseAiRun(row.value)).filter((run): run is AiRun => !!run)
}

export async function loadReconstructionRuns(novelId: string): Promise<AiRun[]> {
  assertNovelId(novelId)
  if (usesProjectKernel()) return (await loadKernelWorkspace(novelId)).aiRuns || []
  await initDb()
  return loadRunRows(novelId)
}

export async function loadReconstructionRun(novelId: string, runId: string): Promise<AiRun | undefined> {
  assertNovelId(novelId)
  assertRunId(runId)
  if (usesProjectKernel()) return (await loadKernelWorkspace(novelId)).aiRuns?.find(run => run.id === runId)
  await initDb()
  const row = queryAll<RunRow>(
    'SELECT value FROM reconstruction_ai_runs WHERE novel_id = ? AND id = ?',
    [novelId, runId],
  )[0]
  return row ? parseAiRun(row.value) : undefined
}

export async function saveReconstructionRun(novelId: string, run: AiRun): Promise<void> {
  assertNovelId(novelId)
  assertRunId(run.id)
  if (!isAiRun(run)) throw new Error('AI 运行记录格式无效')
  if (usesProjectKernel()) return saveKernelRun(novelId, run)
  await initDb()
  await runTransaction(() => {
    execute(`
      INSERT OR REPLACE INTO reconstruction_ai_runs
        (id, novel_id, mode, task_type, target_id, chapter_start, chapter_end,
         token_budget, used_tokens, status, checkpoint, error, created_at, updated_at, value)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      run.id,
      novelId,
      run.mode,
      run.taskType,
      run.targetId ?? null,
      run.chapterStart ?? null,
      run.chapterEnd ?? null,
      run.tokenBudget ?? null,
      run.usedTokens ?? null,
      run.status,
      run.checkpoint ?? null,
      run.error ?? null,
      run.createdAt,
      run.updatedAt,
      JSON.stringify(run),
    ])
  }, { restoreOnWriteFailure: true })
}

export async function replaceReconstructionRun(novelId: string, run: AiRun): Promise<void> {
  await saveReconstructionRun(novelId, run)
}

export async function deleteReconstructionRun(novelId: string, runId: string): Promise<void> {
  assertNovelId(novelId)
  assertRunId(runId)
  if (usesProjectKernel()) return changeKernelWorkspace(novelId, workspace => { workspace.aiRuns = workspace.aiRuns.filter(run => run.id !== runId) })
  await initDb()
  await runTransaction(() => {
    execute('DELETE FROM reconstruction_ai_runs WHERE novel_id = ? AND id = ?', [novelId, runId])
  }, { restoreOnWriteFailure: true })
}

export async function deleteReconstructionRuns(novelId: string): Promise<void> {
  assertNovelId(novelId)
  if (usesProjectKernel()) return changeKernelWorkspace(novelId, workspace => { workspace.aiRuns = [] })
  await initDb()
  await runTransaction(() => {
    execute('DELETE FROM reconstruction_ai_runs WHERE novel_id = ?', [novelId])
  }, { restoreOnWriteFailure: true })
}
