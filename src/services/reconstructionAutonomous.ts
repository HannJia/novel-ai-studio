import type { AiChapterDraft, AiRun, AiRunRequest } from '@/types/reconstruction'
import type { AiRequestLifecycle } from './ai'
import { activeAutonomousRunCount, appUpdateInstalling, cloudApplyBusy, projectTransferBusy } from './appLifecycle'
import { assertAiRunCanProcessChapter, checkpointAiRun, finishAiRun, pauseAiRun, startAiRun } from '@/services/reconstructionAiRun'
import { assertRequestBudgetReady, createAiRunRequestLifecycle, interruptAiRunRequests } from './reconstructionAiBudget'

export interface AutonomousChapterResult {
  status: 'completed' | 'needs_author'
  checkpoint?: string
  message?: string
}

export interface AutonomousChapterContext {
  chapterIndex: number
  run: AiRun
  getRun: () => AiRun
  saveDraft: (draft: AiChapterDraft) => Promise<void>
  signal?: AbortSignal
  requestLifecycle: (phase: AiRunRequest['phase']) => AiRequestLifecycle
}

export interface AutonomousRunExecutorInput {
  run: AiRun
  persist: (run: AiRun) => Promise<void>
  processChapter: (context: AutonomousChapterContext) => Promise<AutonomousChapterResult>
  now?: () => string
  signal?: AbortSignal
}

function timestamp(input: AutonomousRunExecutorInput): string {
  return input.now ? input.now() : new Date().toISOString()
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
    || error instanceof Error && error.name === 'AbortError'
}

function firstChapterToProcess(run: AiRun, wasPaused: boolean): number {
  const start = run.chapterStart as number
  if (!wasPaused) return start
  const completed = run.checkpoint?.match(/^chapter-(\d+):(completed|reviewed|checkpoint)$/)
  if (completed) return Math.max(start, Number(completed[1]) + 1)
  const pending = run.checkpoint?.match(/^chapter-(\d+):(?:started|review-needs-author|needs-author)$/)
  return pending ? Math.max(start, Number(pending[1])) : start
}

function isCompletedChapterCheckpoint(checkpoint: string, chapterIndex: number): boolean {
  return checkpoint === `chapter-${chapterIndex}:completed` || checkpoint === `chapter-${chapterIndex}:reviewed`
}

const activeRuns = new Set<string>()
const runKey = (run: AiRun) => JSON.stringify([run.targetId, run.id])
export function isAutonomousRunActive(run: AiRun): boolean { return activeRuns.has(runKey(run)) }

export function recoverInterruptedAiRun(run: AiRun, now: string): AiRun {
  if (isAutonomousRunActive(run)) throw new Error('任务仍在执行，不能恢复为中断状态。')
  if (run.status !== 'running') throw new Error('只有中断的执行中任务需要恢复。')
  return { ...interruptAiRunRequests(run, now), status: 'paused', error: '上次任务意外中断；未收到回执的请求已按预留额度计入估算用量。' }
}

export async function executeAutonomousRun(input: AutonomousRunExecutorInput): Promise<AiRun> {
  if (projectTransferBusy.value || cloudApplyBusy.value || appUpdateInstalling.value) throw new Error('项目正在保存或恢复，暂时不能启动自动写作。')
  if (isAutonomousRunActive(input.run)) throw new Error('此自动任务已经在执行。')
  assertRequestBudgetReady(input.run)
  activeRuns.add(runKey(input.run))
  activeAutonomousRunCount.value += 1
  try { return await executeRun(input) }
  finally { activeAutonomousRunCount.value -= 1; activeRuns.delete(runKey(input.run)) }
}

async function executeRun(input: AutonomousRunExecutorInput): Promise<AiRun> {
  if (!Number.isInteger(input.run.chapterStart) || !Number.isInteger(input.run.chapterEnd)) {
    throw new Error('自动运行必须指定章节范围')
  }
  const wasPaused = ['paused', 'needs_author', 'failed'].includes(input.run.status)
  let run = startAiRun(input.run, timestamp(input))
  await input.persist(run)
  let budgetStop: string | undefined
  let ledgerTail: Promise<unknown> = Promise.resolve()
  const withLedgerLock = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = ledgerTail.then(operation)
    ledgerTail = next.catch(() => undefined)
    return next
  }
  const save = async (next: AiRun, retainOnFailure = false) => {
    // A received usage receipt remains available for the final failure save.
    // Admission, however, is not published until its reservation is durable.
    if (retainOnFailure) run = next
    await input.persist(next)
    run = next
  }

  try {
    const chapterStart = firstChapterToProcess(run, wasPaused)
    const chapterEnd = run.chapterEnd as number
    for (let chapterIndex = chapterStart; chapterIndex <= chapterEnd; chapterIndex += 1) {
      input.signal?.throwIfAborted()
      assertAiRunCanProcessChapter(run, chapterIndex)
      // 保留本章的重新审核检查点，让处理器能够识别作者已经修订的正文。
      if (run.checkpoint !== 'chapter-' + chapterIndex + ':review-needs-author') {
        run = checkpointAiRun(run, 'chapter-' + chapterIndex + ':started', timestamp(input))
      }
      await input.persist(run)

      const result = await input.processChapter({ chapterIndex, run, getRun: () => run, signal: input.signal,
        saveDraft: draft => withLedgerLock(async () => {
          if (draft.chapterIndex !== chapterIndex || run.status !== 'running') throw new Error('候选稿不属于当前执行章节。')
          const drafts = run.chapterDrafts || []
          await save({ ...run, chapterDrafts: [...drafts.filter(row => row.chapterId !== draft.chapterId), draft], updatedAt: timestamp(input) }, true)
        }),
        requestLifecycle: phase => {
          const lifecycle = createAiRunRequestLifecycle({ getRun: () => run, save, chapterIndex, phase,
            now: () => timestamp(input), onBudgetStop: message => { budgetStop = message } })
          return {
            beforeRequest: options => withLedgerLock(() => lifecycle.beforeRequest(options)),
            afterRequest: outcome => withLedgerLock(() => lifecycle.afterRequest(outcome)),
          }
        },
      })
      await ledgerTail
      if (run.requests!.some(request => request.status === 'pending')) throw new Error('本章仍有未结算请求，不能推进任务。')

      if (result.status === 'needs_author') {
        run = finishAiRun(
          { ...run, checkpoint: result.checkpoint || 'chapter-' + chapterIndex + ':needs-author' },
          'needs_author',
          timestamp(input),
          budgetStop || result.message,
        )
        await input.persist(run)
        return run
      }

      if (budgetStop) {
        run = finishAiRun(run, 'needs_author', timestamp(input), budgetStop)
        await input.persist(run)
        return run
      }

      const completionCheckpoint = result.checkpoint || 'chapter-' + chapterIndex + ':completed'
      run = checkpointAiRun(run, completionCheckpoint, timestamp(input))
      await input.persist(run)
      const processed = chapterIndex - chapterStart + 1
      const isLast = chapterIndex >= chapterEnd
      if (result.status === 'completed' && isCompletedChapterCheckpoint(completionCheckpoint, chapterIndex)
        && run.checkpointEvery && !isLast && processed % run.checkpointEvery === 0) {
        run = finishAiRun({ ...run, checkpoint: 'chapter-' + chapterIndex + ':checkpoint' }, 'needs_author', timestamp(input),
          `已完成 ${processed} 章，达到每 ${run.checkpointEvery} 章检查点，请作者确认后继续。`)
        await input.persist(run)
        return run
      }
    }

    run = finishAiRun(run, 'completed', timestamp(input))
    await input.persist(run)
    return run
  } catch (error) {
    run = interruptAiRunRequests(run, timestamp(input))
    if (isAbortError(error) || input.signal?.aborted) {
      run = pauseAiRun(run, timestamp(input), run.checkpoint || 'author-paused')
      await input.persist(run)
      return run
    }
    const message = error instanceof Error ? error.message : String(error)
    run = finishAiRun(run, budgetStop ? 'needs_author' : 'failed', timestamp(input), budgetStop || message)
    await input.persist(run)
    return run
  }
}
