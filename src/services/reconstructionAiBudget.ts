import type { AiRequestLifecycle, ChatCompletionOptions, ChatCompletionResult } from './ai'
import type { AiRun, AiRunRequest } from '@/types/reconstruction'
import { assertAiRunRequests, refreshMemoryRequestMetrics, memoryPaidRequestCount } from './aiRunRequestValidation'
import { validateAiRunScope } from './reconstructionAiRun'

export function reviseAiRunLimits(run: AiRun, limits: { tokenBudget: number; requestLimit: number }, now: string): AiRun {
  assertRequestBudgetReady(run)
  if (!['paused', 'needs_author', ...(run.taskType === 'memory_update' ? ['cancelled', 'failed', 'queued', 'completed'] : [])].includes(run.status)) throw new Error('请先暂停任务，再调整额度。')
  const next = { ...run, ...limits, updatedAt: now }
  const issues = run.taskType === 'memory_update' ? [] : validateAiRunScope(next)
  if (issues.length) throw new Error(issues.join('；'))
  if (limits.tokenBudget < run.usedTokens! || limits.requestLimit < (run.taskType === 'memory_update' ? memoryPaidRequestCount(run) : run.requests!.length)) throw new Error('任务总额度不能低于已记录的用量和请求次数。')
  assertAiRunRequests(next)
  return next
}

export class AiRunBudgetError extends Error {
  constructor(message: string) { super(message); this.name = 'AiRunBudgetError' }
}

export function assertRequestBudgetReady(run: AiRun): void {
  assertAiRunRequests(run)
  if (!run.requests || !run.requestLimit) throw new AiRunBudgetError('任务没有逐请求账本，请创建新的自动任务。')
}

/** Includes Skill-enriched input, UTF-8 byte allowance and output ceiling. No prompt is stored. */
export function reserveRequestTokens(options: ChatCompletionOptions): { input: number; output: number } {
  const output = options.maxTokens ?? options.model.maxTokens
  if (!Number.isSafeInteger(output) || output < 1) throw new AiRunBudgetError('模型输出 Token 上限无效，未发送请求。')
  if (options.messages.some(message => message.imageDataUrls?.length)) throw new AiRunBudgetError('自动写作预算暂不支持图片请求。')
  const encoder = new TextEncoder()
  const input = options.messages.reduce((sum, message) => sum + encoder.encode(message.content).length + 16, 64)
  if (!Number.isSafeInteger(input + output)) throw new AiRunBudgetError('请求额度超过可统计范围。')
  return { input, output }
}

function reportedUsage(result: ChatCompletionResult | undefined) {
  const usage = result?.usage
  if (!usage || typeof usage.prompt_tokens !== 'number' || typeof usage.completion_tokens !== 'number' || typeof usage.total_tokens !== 'number'
    || ![usage.prompt_tokens, usage.completion_tokens, usage.total_tokens].every(value => Number.isSafeInteger(value) && value >= 0)) return undefined
  const output = Math.max(usage.completion_tokens, usage.total_tokens - usage.prompt_tokens)
  return Number.isSafeInteger(usage.prompt_tokens + output) ? { input: usage.prompt_tokens, output } : undefined
}

export function interruptAiRunRequests(run: AiRun, now: string): AiRun {
  const next: AiRun = { ...run, requests: run.requests?.map(request => request.status === 'pending'
    ? { ...request, status: 'interrupted', usageSource: 'estimated', completedAt: now } : request), updatedAt: now }
  if (next.memoryTask) { next.memoryTask = JSON.parse(JSON.stringify(next.memoryTask)); refreshMemoryRequestMetrics(next) }
  return next
}

export function createAiRunRequestLifecycle(input: {
  getRun: () => AiRun
  save: (next: AiRun, retainOnFailure?: boolean) => Promise<void>
  chapterIndex: number
  phase: AiRunRequest['phase']
  now: () => string
  onBudgetStop: (message: string) => void
}): AiRequestLifecycle {
  let requestId: string | undefined
  const stop = (message: string): never => { input.onBudgetStop(message); throw new AiRunBudgetError(message) }
  return {
    async beforeRequest(options) {
      const run = input.getRun()
      assertRequestBudgetReady(run)
      if (run.status !== 'running') throw new Error('自动任务已停止，未发送请求。')
      if (run.requests!.some(request => request.status === 'pending')) throw new Error('上一次请求尚未记账，未发送新请求。')
      if (run.requests!.length >= run.requestLimit!) stop('已达到请求次数上限，未发送下一次请求。')
      let allowance: ReturnType<typeof reserveRequestTokens>
      try { allowance = reserveRequestTokens(options) } catch (error) { return stop(error instanceof Error ? error.message : String(error)) }
      const reservedTokens = allowance.input + allowance.output
      if (run.usedTokens! + reservedTokens > run.tokenBudget!) stop('下一次请求需要保守预留 ' + reservedTokens + ' Token，超过剩余预算，已停止。')
      const now = input.now()
      const request: AiRunRequest = { id: run.id + ':request:' + (run.requests!.length + 1), chapterIndex: input.chapterIndex,
        phase: input.phase, modelId: options.model.modelName, status: 'pending', reservedTokens,
        inputTokens: allowance.input, outputTokens: allowance.output, usageSource: 'reservation', startedAt: now }
      const next: AiRun = { ...run, requests: [...run.requests!, request], usedTokens: run.usedTokens! + reservedTokens, updatedAt: now }
      assertAiRunRequests(next)
      await input.save(next)
      requestId = request.id
    },
    async afterRequest(outcome) {
      const run = input.getRun(), index = run.requests!.findIndex(request => request.id === requestId && request.status === 'pending')
      if (index < 0) throw new Error('找不到待结算请求，任务已停止。')
      const pending = run.requests![index], usage = reportedUsage(outcome.result), now = input.now()
      const settled: AiRunRequest = { ...pending, status: outcome.result ? 'completed' : 'failed',
        inputTokens: usage?.input ?? pending.inputTokens, outputTokens: usage?.output ?? pending.outputTokens,
        usageSource: usage ? 'reported' : 'estimated', completedAt: now }
      const requests = run.requests!.map((request, i) => i === index ? settled : request)
      const next: AiRun = { ...run, requests, usedTokens: requests.reduce((sum, request) => sum + request.inputTokens + request.outputTokens, 0), updatedAt: now }
      assertAiRunRequests(next)
      await input.save(next, true)
      requestId = undefined
      // Keep the received text available to the caller for durable candidate storage.
      // The next admission is denied; the executor also stops at this chapter boundary.
      if (next.usedTokens! > next.tokenBudget!) input.onBudgetStop('接口报告的实际用量超过预算；已保留完整用量并停止后续请求。')
    },
  }
}
