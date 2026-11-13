import type { ModelConfig } from '@/stores/config'
import type { KnowledgeBase, KnowledgeSummaryCoverage } from '@/types/knowledge'
import { callAI, type ChatCompletionResult } from './ai'
import { baseSourceVersion, entrySourceVersion } from './knowledgeSources'
import { buildKnowledgeSummaryChunks, createKnowledgeSummaryCoverage, type KnowledgeSummaryChunk } from './knowledgeSummaryCoverage'
import { buildStoryMemorySummaryGraph, summaryMessages as messagesFor, summaryLeafText as leafText, summaryMergeText as mergeText, summaryInputReservation as inputReservation, summaryRequestReservation } from './summaryGraph'
import { startAiActivity, finishAiActivity } from './aiActivity'

const FAN_IN = 4
const OUTPUT_CHARS = { brief: 800, standard: 2500, detailed: 6000 } as const
export const DEFAULT_SUMMARY_REQUESTS = 64
export const DEFAULT_SUMMARY_TOKENS = 500_000

export interface KnowledgeSummaryPlan {
  knowledgeBaseId: string
  entryId?: string
  sourceVersionId: string
  title: string
  description: string
  level: keyof typeof OUTPUT_CHARS
  chunks: KnowledgeSummaryChunk[]
  plannedRequests: number
}
export interface KnowledgeSummaryBudget {
  maxRequests: number
  maxTokens: number
  requests: number
  inputTokens: number
  outputTokens: number
  usageEstimated: boolean
}
export interface KnowledgeSummaryProgress {
  phase: 'extract' | 'merge' | 'complete' | 'failed' | 'cancelled'
  completedChunks: number
  totalChunks: number
  completedRequests: number
  plannedRequests: number
  inputTokens: number
  outputTokens: number
  usageEstimated: boolean
}

export function createKnowledgeSummaryBudget(maxRequests = DEFAULT_SUMMARY_REQUESTS, maxTokens = DEFAULT_SUMMARY_TOKENS): KnowledgeSummaryBudget {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 4096
    || !Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > 50_000_000) {
    throw new Error('摘要预算无效：请求次数须为 1–4096，token 预算须为 1–50000000')
  }
  return { maxRequests, maxTokens, requests: 0, inputTokens: 0, outputTokens: 0, usageEstimated: false }
}

export function planKnowledgeSummary(kb: KnowledgeBase, entryId?: string, level: KnowledgeSummaryPlan['level'] = 'standard'): KnowledgeSummaryPlan {
  if (!(level in OUTPUT_CHARS)) throw new Error('摘要详细程度无效')
  const entries = entryId ? kb.entries.filter(entry => entry.id === entryId) : kb.entries
  if (!entries.length || !entries.some(entry => entry.content.trim())) throw new Error('请先添加非空资料')
  const chunks = buildKnowledgeSummaryChunks(entries.map(entry => ({
    entryId: entry.id, sourceVersionId: entrySourceVersion(kb.id, entry),
    title: entry.title, category: entry.category, tags: [...entry.tags], content: entry.content,
  })))
  let count = chunks.length, plannedRequests = count
  while (count > 1) {
    plannedRequests += Math.floor(count / FAN_IN) + (count % FAN_IN > 1 ? 1 : 0)
    count = Math.ceil(count / FAN_IN)
  }
  return { knowledgeBaseId: kb.id, entryId, sourceVersionId: entryId ? entrySourceVersion(kb.id, entries[0]) : baseSourceVersion(kb),
    title: entryId ? entries[0].title : kb.name, description: entryId ? '' : kb.description, level, chunks, plannedRequests }
}

function outputReservation(model: ModelConfig, maxChars: number) {
  if (!Number.isSafeInteger(model.maxTokens) || model.maxTokens < 1) throw new Error('模型输出 token 上限无效')
  return Math.min(model.maxTokens, maxChars * 2)
}
function assertContextAllowance(model: ModelConfig, input: number, output: number) {
  if (model.contextWindow !== undefined && (!Number.isSafeInteger(model.contextWindow) || model.contextWindow < 1)) throw new Error('模型上下文窗口无效')
  if (model.contextWindow && input + output > model.contextWindow) throw new Error('单次完整分段或合并超过模型上下文窗口，请选择更大窗口的模型或减少输出上限；未截取原文')
}

/** Exact leaf inputs and bounded intermediate outputs; requests disable hidden retries. */
export function estimateKnowledgeSummaryTokens(plan: KnowledgeSummaryPlan, model: ModelConfig, instructions = '') {
  const graph = buildStoryMemorySummaryGraph(plan, model, instructions)
  plan.plannedRequests = graph.plannedRequests
  return graph.estimatedTokens
}

function completeText(result: ChatCompletionResult, streamed: string, limit: number, label: string) {
  if (result.finishReason !== 'stop') throw new Error(label + '未完整完成（' + result.finishReason + '），未保存')
  const text = (result.content || streamed).trim()
  if (!text) throw new Error(label + '为空，未保存')
  if (text.length > limit) throw new Error(label + '超过 ' + limit + ' 字的合并容量，未截取保存，请调整模型后重试')
  return text
}
function reportedUsage(result: ChatCompletionResult) {
  const usage = result.usage
  if (!usage || typeof usage.prompt_tokens !== 'number' || typeof usage.completion_tokens !== 'number' || typeof usage.total_tokens !== 'number'
    || ![usage.prompt_tokens, usage.completion_tokens, usage.total_tokens].every(value => Number.isSafeInteger(value) && value >= 0)) return null
  return { input: usage.prompt_tokens, output: Math.max(usage.completion_tokens, usage.total_tokens - usage.prompt_tokens) }
}

export async function generateKnowledgeSummary(plan: KnowledgeSummaryPlan, options: {
  model: ModelConfig
  budget: KnowledgeSummaryBudget
  instructions?: string
  signal?: AbortSignal
  isCurrent?: () => boolean
  onProgress?: (progress: KnowledgeSummaryProgress) => void
}): Promise<{ summary: string; coverage: KnowledgeSummaryCoverage }> {
  const model = { ...options.model }, budget = options.budget, instructions = options.instructions || ''
  let ownInput = 0, ownOutput = 0, ownRequests = 0, estimated = false
  const progress: KnowledgeSummaryProgress = { phase: 'extract', completedChunks: 0, totalChunks: plan.chunks.length,
    completedRequests: 0, plannedRequests: plan.plannedRequests, inputTokens: 0, outputTokens: 0, usageEstimated: false }
  const publish = () => {
    Object.assign(progress, { inputTokens: ownInput, outputTokens: ownOutput, usageEstimated: estimated })
    options.onProgress?.({ ...progress })
  }
  const assertCurrent = () => {
    options.signal?.throwIfAborted()
    if (options.isCurrent && !options.isCurrent()) throw new Error('资料或摘要已发生变化，停止整理，请重新核对')
  }
  let activity: ReturnType<typeof startAiActivity> | undefined
  try {
    assertCurrent()
    const graph = buildStoryMemorySummaryGraph(plan, model, instructions)
    plan.plannedRequests = graph.plannedRequests
    progress.totalChunks = graph.nodes.filter(node => node.kind === 'leaf').length
    progress.plannedRequests = graph.plannedRequests
    if (budget.requests + graph.plannedRequests > budget.maxRequests) throw new Error('完整整理需要 ' + graph.plannedRequests + ' 次请求，超过剩余请求预算；未开始新请求')
    const allowance = graph.estimatedTokens
    if (budget.inputTokens + budget.outputTokens + allowance > budget.maxTokens) throw new Error('完整整理的保守额度为 ' + allowance + ' token，超过剩余预算；未开始新请求')
    activity = startAiActivity('知识资料分批摘要：' + plan.title)
    publish()
    const request = async (text: string, limit: number, merge: boolean, label: string) => {
      assertCurrent()
      const messages = messagesFor(plan, text, limit, merge, instructions)
      const input = inputReservation(messages), output = outputReservation(model, limit)
      assertContextAllowance(model, input, output)
      summaryRequestReservation(model, messages, limit)
      if (budget.requests >= budget.maxRequests || budget.inputTokens + budget.outputTokens + input + output > budget.maxTokens) throw new Error('摘要预算不足，未发送下一次请求')
      budget.requests++; ownRequests++
      budget.inputTokens += input; budget.outputTokens += output
      ownInput += input; ownOutput += output
      const wasEstimated = estimated
      estimated = true; publish()
      let streamed = '', result: ChatCompletionResult
      try {
        result = await callAI({ model, messages, stream: true, onChunk: chunk => { streamed += chunk },
          maxTokens: output, signal: options.signal, noAutomaticRetry: true, activityParentId: activity!.id, taskName: label })
      } catch (error) { budget.usageEstimated = true; throw error }
      const usage = reportedUsage(result)
      if (usage) {
        budget.inputTokens += usage.input - input; budget.outputTokens += usage.output - output
        ownInput += usage.input - input; ownOutput += usage.output - output
        estimated = wasEstimated
      } else budget.usageEstimated = true
      progress.completedRequests++; publish()
      assertCurrent()
      if (budget.inputTokens + budget.outputTokens > budget.maxTokens) throw new Error('接口报告的实际用量超过预算，停止整理，结果未保存')
      return completeText(result, streamed, limit, label)
    }
    const outputs = new Map<string, string>()
    for (const node of graph.nodes) {
      const dependencies = node.dependencyIds.map(id => { const output = outputs.get(id); if (!output) throw new Error('摘要依赖缺失'); return output })
      const chunks = graph.chunksByNode.get(node.id)
      if (!chunks?.length) throw new Error('摘要来源缺失')
      progress.phase = node.kind === 'leaf' ? 'extract' : 'merge'
      const text = node.kind === 'leaf' ? leafText(chunks[0]) : mergeText(dependencies)
      outputs.set(node.id, await request(text, node.outputLimit, node.kind === 'merge', '资料摘要节点'))
      if (node.kind === 'leaf') progress.completedChunks++
      publish()
    }
    assertCurrent()
    const coverage = createKnowledgeSummaryCoverage(graph.nodes.filter(node => node.kind === 'leaf').flatMap(node => graph.chunksByNode.get(node.id)!), { requestCount: ownRequests, inputTokens: ownInput, outputTokens: ownOutput, usageEstimated: estimated })
    progress.phase = 'complete'; publish()
    finishAiActivity(activity)
    return { summary: outputs.get(graph.finalNodeId)!, coverage }
  } catch (error) {
    progress.phase = options.signal?.aborted ? 'cancelled' : 'failed'; publish()
    if (activity) finishAiActivity(activity, error)
    throw error
  }
}

