import { activeMemoryRunCount, projectTransferBusy, cloudApplyBusy, appUpdateInstalling } from './appLifecycle'
import type { ModelConfig } from '@/stores/config'
import type { AiRun, AiRunRequest } from '@/types/reconstruction'
import type { StoryMemoryScope, StoryMemorySummaryNode, StoryMemoryRequestLedgerEntry } from '@/types/storyMemory'
import { callAI, type ChatCompletionResult } from './ai'
import { createKnowledgeSummaryCoverage } from './knowledgeSummaryCoverage'
import { buildStoryMemorySummaryGraph, modelSignature, summaryPromptSignature, summaryMessages, summaryLeafText, summaryMergeText, summaryInputReservation, summaryRequestReservation, type SummaryGraphPlan } from './summaryGraph'
import { assertAiRunRequests, refreshMemoryRequestMetrics, memoryPaidRequestCount, sameMemorySourceLocations } from './aiRunRequestValidation'
import type { KnowledgeSummaryPlan, KnowledgeSummaryProgress } from './knowledgeSummary'

export interface StoryMemoryTaskDraft {
  scope: StoryMemoryScope
  sourceVersionId: string
  openBaseline: string
  title: string
  body: string
  level: KnowledgeSummaryPlan['level']
  tokenBudget?: number
  requestLimit?: number
}
export interface StoryMemoryTaskOptions {
  model: ModelConfig
  plan: KnowledgeSummaryPlan
  instructions: string
  maxRequests: number
  maxTokens: number
  signal?: AbortSignal
  isCurrent?: () => boolean
  persist: (run: AiRun) => Promise<void>
  onProgress?: (progress: KnowledgeSummaryProgress) => void
}
const active = new Set<string>()
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
const now = () => new Date().toISOString()
function complete(node: StoryMemorySummaryNode): boolean { return ['completed', 'reused'].includes(node.status) && !!node.output?.trim() }
function usageOf(result: ChatCompletionResult) {
  const usage = result.usage
  if (!usage) return undefined
  const { prompt_tokens: input, completion_tokens: completion, total_tokens: total } = usage
  if (![input, completion, total].every(value => Number.isSafeInteger(value) && (value as number) >= 0)) return undefined
  const output = Math.max(completion as number, (total as number) - (input as number))
  return Number.isSafeInteger((input as number) + output) ? { input: input as number, output } : undefined
}
export function createMemoryUpdateRun(novelId: string, draft: StoryMemoryTaskDraft, graph: SummaryGraphPlan, maxTokens: number, requestLimit: number): AiRun {
  const createdAt = now()
  return { id: crypto.randomUUID(), mode: 'assist', taskType: 'memory_update', targetId: novelId, tokenBudget: maxTokens, requestLimit, usedTokens: 0, requests: [], status: 'queued', checkpoint: graph.finalNodeId, createdAt, updatedAt: createdAt,
    memoryTask: { version: 1, scope: clone(draft.scope), sourceVersionId: draft.sourceVersionId, openBaseline: draft.openBaseline, titleDraft: draft.title, bodyDraft: draft.body, level: draft.level, modelSignature: graph.modelSig, promptSignature: graph.promptSig, stage: 'planned', graph: clone(graph.nodes), finalNodeId: graph.finalNodeId, requests: [], reservedTokens: 0, currentInputTokens: 0, currentOutputTokens: 0, historicalInputTokens: 0, historicalOutputTokens: 0, usageEstimated: false, updatedAt: createdAt } }
}

/** Called only by an explicit author action. A continuation is one accounting execution;
 * the run's budget and paid ledger remain cumulative across all source revisions. */
export async function continueStoryMemoryTask(options: StoryMemoryTaskOptions, original: AiRun, draft?: Partial<StoryMemoryTaskDraft>): Promise<AiRun> {
  if (projectTransferBusy.value || cloudApplyBusy.value || appUpdateInstalling.value) throw new Error('项目正在恢复、同步或准备更新，暂时不能启动回顾任务')
  if (active.has(original.id)) throw new Error('此回顾任务仍在停止或保存，请稍后继续')
  activeMemoryRunCount.value += 1
  try { return await executeStoryMemoryTask(options, original, draft) }
  finally { activeMemoryRunCount.value -= 1 }
}

async function executeStoryMemoryTask(options: StoryMemoryTaskOptions, original: AiRun, draft?: Partial<StoryMemoryTaskDraft>): Promise<AiRun> {
  options = { ...options, model: { ...options.model }, plan: clone(options.plan) }
  if (active.has(original.id)) throw new Error('此回顾任务仍在停止或保存，请稍后继续')
  assertAiRunRequests(original)
  if (!original.memoryTask) throw new Error('故事记忆任务缺少状态')
  if (!Number.isSafeInteger(options.maxRequests) || options.maxRequests < 1 || options.maxRequests > 4096 || !Number.isSafeInteger(options.maxTokens) || options.maxTokens < 1 || options.maxTokens > 50_000_000) throw new Error('回顾预算无效')
  if (options.maxRequests < memoryPaidRequestCount(original) || options.maxTokens < (original.usedTokens || 0)) throw new Error('总预算不能低于已记录用量')
  const graph = buildStoryMemorySummaryGraph(options.plan, options.model, options.instructions)
  const run = clone(original), task = run.memoryTask!
  const previous = new Map(task.graph.map(node => [node.signature, node]))
  task.graph = graph.nodes.map(node => {
    let old = previous.get(node.signature)
    if (!old || !complete(old)) {
      const receipt = task.requests.slice().reverse().find(row => row.nodeSignature === node.signature && row.status === 'completed' && row.partialOutput?.trim() && sameMemorySourceLocations(row.sourceRanges, node.sourceRanges) && JSON.stringify(row.sourceFingerprints) === JSON.stringify(node.sourceFingerprints))
      const paid = receipt && run.requests!.find(row => row.id === receipt.id && row.status === 'completed')
      if (receipt && paid) old = { ...node, status: 'completed', output: receipt.partialOutput!.trim(), requestId: receipt.id, requestSignature: receipt.requestSignature, inputTokens: paid.inputTokens, outputTokens: paid.outputTokens, usageSource: paid.usageSource === 'reported' ? 'reported' : 'estimated' }
    }
    const receipt = old && task.requests.find(row => row.id === old.requestId)
    const reusedFrom = receipt && JSON.stringify(receipt.sourceRanges) !== JSON.stringify(node.sourceRanges) ? { requestId: receipt.id, sourceRanges: clone(receipt.sourceRanges) } : undefined
    return old && complete(old) && receipt && sameMemorySourceLocations(receipt.sourceRanges, node.sourceRanges) && JSON.stringify(receipt.sourceFingerprints) === JSON.stringify(node.sourceFingerprints) ? { ...clone(old), ...node, status: 'reused' as const, reusedFrom, output: old.output, requestId: old.requestId, requestSignature: old.requestSignature, inputTokens: old.inputTokens, outputTokens: old.outputTokens, usageSource: old.usageSource } : clone(node)
  })
  if (draft?.scope) task.scope = clone(draft.scope)
  task.sourceVersionId = options.plan.sourceVersionId
  task.openBaseline = draft?.openBaseline ?? task.openBaseline
  task.titleDraft = draft?.title ?? task.titleDraft; task.bodyDraft = draft?.body ?? task.bodyDraft
  task.level = options.plan.level; task.candidate = undefined; task.executionId = crypto.randomUUID()
  task.finalNodeId = graph.finalNodeId; task.modelSignature = graph.modelSig; task.promptSignature = graph.promptSig
  run.tokenBudget = options.maxTokens; run.requestLimit = options.maxRequests
  // A persisted pending request may already have reached the provider. Retain its full allowance.
  run.requests = run.requests!.map(row => row.status === 'pending' ? { ...row, status: 'interrupted', usageSource: 'estimated', completedAt: now() } : row)
  run.status = 'running'; task.stage = 'running'; run.error = undefined
  const assertCurrent = () => { options.signal?.throwIfAborted(); if (options.isCurrent && !options.isCurrent()) throw new Error('正文、范围或打开记录已变化，停止旧任务') }
  const save = async () => {
    run.updatedAt = now(); task.updatedAt = run.updatedAt; refreshMemoryRequestMetrics(run); assertAiRunRequests(run)
    await options.persist(clone(run))
  }
  const publish = (phase: KnowledgeSummaryProgress['phase']) => options.onProgress?.({ phase, completedChunks: task.graph.filter(complete).length, totalChunks: task.graph.length, completedRequests: task.requests.filter(detail => detail.executionId === task.executionId && detail.status !== 'not_sent').length, plannedRequests: graph.plannedRequests, inputTokens: task.currentInputTokens, outputTokens: task.currentOutputTokens, usageEstimated: task.usageEstimated })
  active.add(run.id)
  try {
    assertCurrent(); await save()
    const nodes = new Map(task.graph.map(node => [node.id, node]))
    for (const node of task.graph) {
      assertCurrent()
      const dependencies = node.dependencyIds.map(id => {
        const dependency = nodes.get(id)
        if (!dependency || !complete(dependency)) throw new Error('摘要依赖缺失或未完成')
        return dependency
      })
      const chunks = graph.chunksByNode.get(node.id)
      if (!chunks?.length) throw new Error('摘要缺少来源区间')
      const text = node.kind === 'leaf' ? summaryLeafText(chunks[0]) : summaryMergeText(dependencies.map(dep => dep.output!))
      const messages = summaryMessages(options.plan, text, node.outputLimit, node.kind === 'merge', options.instructions)
      const requestSignature = summaryPromptSignature(JSON.stringify([modelSignature(options.model), messages, Math.min(options.model.maxTokens, node.outputLimit * 2)]))
      if (complete(node) && node.requestSignature === requestSignature) { publish(node.kind === 'leaf' ? 'extract' : 'merge'); continue }
      node.status = 'pending'; node.output = undefined
      const invalidated = new Set([node.id])
      for (const parent of task.graph) if (parent.dependencyIds.some(id => invalidated.has(id))) {
        invalidated.add(parent.id); parent.status = 'pending'; parent.output = undefined
      }
      const reservedTokens = summaryRequestReservation(options.model, messages, node.outputLimit)
      if (memoryPaidRequestCount(run) >= run.requestLimit! || run.usedTokens! + reservedTokens > run.tokenBudget!) throw new Error('摘要任务预算不足，未发送下一次请求')
      const startedAt = now(), id = crypto.randomUUID()
      const request: AiRunRequest = { id, chapterIndex: 0, phase: 'analysis', modelId: options.model.modelName, status: 'pending', reservedTokens, inputTokens: summaryInputReservation(messages), outputTokens: reservedTokens - summaryInputReservation(messages), usageSource: 'reservation', startedAt }
      const detail: StoryMemoryRequestLedgerEntry = { ...request, nodeId: node.id, runId: run.id, executionId: task.executionId!, nodeSignature: node.signature, requestSignature, modelSignature: graph.modelSig, promptSignature: graph.promptSig, sourceRanges: clone(node.sourceRanges), sourceFingerprints: clone(node.sourceFingerprints) }
      run.requests!.push(request); task.requests.push(detail)
      node.status = 'running'; node.reusedFrom = undefined; node.requestId = id; node.requestSignature = requestSignature
      let sent = false, streamed = '', streamWrites = Promise.resolve(), lastWrite = 0
      try {
        await save()
        // Persistence is an await boundary: cancellation/source changes must be rechecked here.
        assertCurrent()
        sent = true
        const result = await callAI({ model: { ...options.model }, messages, stream: true, maxTokens: Math.min(options.model.maxTokens, node.outputLimit * 2), signal: options.signal, noAutomaticRetry: true, taskName: '故事记忆摘要节点', onChunk: chunk => {
          streamed += chunk
          detail.partialOutput = streamed
          // Await this ordered queue before settlement; a late pending save cannot replace completion.
          if (Date.now() - lastWrite >= 1000) {
            lastWrite = Date.now()
            streamWrites = streamWrites.then(save)
            void streamWrites.catch(() => undefined)
          }
        } })
        await streamWrites
        const usage = usageOf(result)
        request.inputTokens = usage?.input ?? request.inputTokens; request.outputTokens = usage?.output ?? request.outputTokens
        request.usageSource = usage ? 'reported' : 'estimated'; request.completedAt = now()
        const output = (result.content || streamed).trim()
        const invalid = (result.finishReason !== 'stop') || !output || output.length > node.outputLimit
        request.status = invalid ? 'failed' : 'completed'
        detail.partialOutput = result.content || streamed
        if (invalid) throw new Error('模型输出为空、截断或超过长度上限，未生成完整候选')
        node.status = 'completed'; node.output = output; node.inputTokens = request.inputTokens; node.outputTokens = request.outputTokens; node.usageSource = request.usageSource; node.error = undefined
        await save(); assertCurrent()
        if (run.usedTokens! > run.tokenBudget!) throw new Error('实际用量超过总预算，已保留用量和节点，停止后续请求')
        publish(node.kind === 'leaf' ? 'extract' : 'merge')
      } catch (cause) {
        await streamWrites.catch(() => undefined)
        if (request.status === 'pending') {
          request.status = !sent ? 'not_sent' : options.signal?.aborted ? 'interrupted' : 'unknown'
          request.usageSource = !sent ? 'reported' : 'estimated'; request.completedAt = now()
          if (!sent) { request.inputTokens = 0; request.outputTokens = 0 }
        }
        if (request.status !== 'completed') detail.partialOutput = streamed || detail.partialOutput
        detail.error = cause instanceof Error ? cause.message : String(cause)
        if (!complete(node)) { node.status = request.status === 'unknown' ? 'unknown' : 'failed'; node.error = detail.error }
        throw cause
      }
    }
    assertCurrent()
    const final = task.graph.find(node => node.id === task.finalNodeId)
    if (!final || !complete(final) || task.graph.some(node => !complete(node))) throw new Error('摘要图未完整完成')
    const leaves = task.graph.filter(node => node.kind === 'leaf')
    const coverage = createKnowledgeSummaryCoverage(leaves.flatMap(node => graph.chunksByNode.get(node.id)!), {
      leafEvidence: leaves.map(node => ({ nodeId: node.id, signature: node.signature, runId: run.id, requestId: node.requestId!, binding: clone(node.sourceRanges[0]), originalBinding: clone(task.requests.find(row => row.id === node.requestId)!.sourceRanges[0]) })),
      requestCount: task.requests.filter(row => row.executionId === task.executionId && row.status !== 'not_sent').length,
      inputTokens: task.currentInputTokens, outputTokens: task.currentOutputTokens, usageEstimated: task.usageEstimated,
    })
    task.candidate = { title: task.titleDraft, summary: final.output!, sourceVersionId: task.sourceVersionId, coverage }
    // Existing author text remains available; never silently overwrite an edited draft.
    if (!task.bodyDraft.trim()) task.bodyDraft = final.output!
    task.stage = 'awaiting_author'; run.status = 'needs_author'; await save(); publish('complete')
    return clone(run)
  } catch (cause) {
    run.error = cause instanceof Error ? cause.message : String(cause)
    task.stage = options.signal?.aborted ? 'cancelled' : 'paused'; run.status = options.signal?.aborted ? 'cancelled' : 'paused'
    task.candidate = undefined
    try { await save() } catch (saveError) { throw new Error('任务已停止，但检查点保存失败；上次持久化预留仍有效：' + String(saveError)) }
    publish(options.signal?.aborted ? 'cancelled' : 'failed'); throw cause
  } finally { active.delete(run.id) }
}
export function memoryTaskSignature(run: AiRun): string | undefined { return run.memoryTask ? [run.memoryTask.sourceVersionId, run.memoryTask.modelSignature, run.memoryTask.promptSignature].join('|') : undefined }
export function isResumableStoryMemoryRun(run: AiRun | undefined): boolean { return !!run?.memoryTask && run.taskType === 'memory_update' && !active.has(run.id) && ['queued', 'paused', 'needs_author', 'failed', 'cancelled', 'completed'].includes(run.status) }
export function isPendingStoryMemoryRun(run: AiRun | undefined): boolean { return !!run?.memoryTask && !!run.requests?.some(row => row.status === 'pending') }
export function modelSignatureForTask(model: ModelConfig, instructions: string): string { return modelSignature(model) + '|' + summaryPromptSignature(instructions) }
