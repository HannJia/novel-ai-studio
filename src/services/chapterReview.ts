import { callAI, type AiRequestLifecycle } from './ai'
import { buildContentReviewPrompt } from './prompts'
import { contentReviewVerdict } from './contentReview'
import { requestChapterReviewWithCoverage, type ReviewCoverage, type ReviewCheckpoint } from './chapterReviewCoverage'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import { getActivePinia } from 'pinia'
import type { ReviewContext } from './context'
import { useConfigStore, type ModelConfig } from '@/stores/config'
import { materializeReviewContexts } from './reviewContextPlan'

export async function requestCoveredContentReview(options: {
  source: string
  chapterIndex: number
  model: ModelConfig
  buildContext: (text: string) => ReviewContext
  ensureCurrent: () => void
  signal?: AbortSignal
  activityParentId?: string
  onProgress?: (coverage: ReviewCoverage) => void
  onChunk?: (report: string) => void
  onRetry?: () => void
  requestLifecycle?: AiRequestLifecycle
  checkpoint?: ReviewCheckpoint
  checkpointKey?: string
  onCheckpoint?: (coverage: ReviewCoverage) => Promise<void>
}): Promise<string> {
  const getBinding = (contexts = materializeReviewContexts(options.source, options.buildContext)) => buildAnalysisSourceVersionId(JSON.stringify({
    protocol: 'covered-review-v2', chapterIndex: options.chapterIndex, key: options.checkpointKey || '',
    contexts, skill: getActivePinia() ? useConfigStore().getSkillPrompt('review') : '',
    model: { id: options.model.id, baseUrl: options.model.baseUrl, modelName: options.model.modelName,
      maxTokens: options.model.maxTokens, contextWindow: options.model.contextWindow, temperature: options.model.temperature, topP: options.model.topP },
  }))
  options.signal?.throwIfAborted(); options.ensureCurrent()
  const contexts = materializeReviewContexts(options.source, options.buildContext)
  const binding = getBinding(contexts)
  const ensureCurrent = () => {
    options.ensureCurrent()
    if (getBinding() !== binding) throw new Error('审核设定、模型或规则已变化，未采用旧版本的分段审核')
  }
  const result = await requestChapterReviewWithCoverage(options.source, async (part, kind, facts) => {
    options.signal?.throwIfAborted()
    ensureCurrent()
    const context = contexts.find(row => row.kind === kind && row.part.index === part.index)!.context
    const messages = buildContentReviewPrompt(context, options.chapterIndex)
    if (kind === 'global') {
      messages[1].content += '\n【本次范围：全章各段事实摘要关系复核】\n以下是每一段原文检查产生的事实摘要，不是逐字正文。只核对各段之间的时间、数值、人物状态与事件因果冲突；原文细节已分别检查，不声称在这里重读全文。意见引用摘要及段号，不得编造原句。按上述报告格式给出唯一结论。\n' + facts
    } else if (part.total > 1) {
      messages[1].content += `\n【分段范围】仅检查第 ${part.index + 1}/${part.total} 段，原文字符 ${part.start + 1}–${part.end}。不要把本段未覆盖全章计划、段尾尚未收束误判为整章缺失。报告最后必须追加标题“## 本段事实摘要”，用 1–600 字符记录本段明确出现的事件顺序、角色状态、数值和因果，禁止猜测，以供全章关系复核。`
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      let report = ''
      const result = await callAI({
        model: options.model, skillTask: 'review', messages, stream: true,
        taskName: kind === 'global' ? '内容审查（全章关系复核）' : part.total > 1 ? `内容审查（分段 ${part.index + 1}/${part.total}）` : attempt ? '内容审查（重试）' : '内容审查',
        signal: options.signal, noAutomaticRetry: true, activityParentId: options.activityParentId,
        requestLifecycle: options.requestLifecycle,
        onChunk: chunk => {
          report += chunk
          if (part.total === 1) options.onChunk?.(report)
        },
      })
      options.signal?.throwIfAborted()
      ensureCurrent()
      if (result.finishReason && result.finishReason !== 'stop') {
        const reason = result.finishReason === 'length' ? '达到输出上限（length）'
          : result.finishReason === 'content_filter' ? '供应商内容过滤（content_filter）'
            : result.finishReason === 'client_stop' ? '本次请求被停止（client_stop）'
              : '供应商返回了非正常结束标记'
        const output = result.usage?.completion_tokens
        const usage = typeof output === 'number' && Number.isFinite(output) ? `；已输出 ${output} tokens` : ''
        const limit = Number.isFinite(options.model.maxTokens) ? `；设置上限 ${options.model.maxTokens} tokens` : ''
        throw new Error(`内容审查输出未正常完成：${reason}${usage}${limit}。部分报告保留供参考，不能用于通过审校。`)
      }
      if (contentReviewVerdict(report) !== 'unknown') return report.trim()
      if (attempt === 0) options.onRetry?.()
    }
    throw new Error('AI 审查返回为空或格式不完整')
  }, options.onProgress, options.onCheckpoint ? { binding, checkpoint: options.checkpoint, onCheckpoint: async coverage => {
    ensureCurrent()
    await options.onCheckpoint!(coverage)
    ensureCurrent()
    options.signal?.throwIfAborted()
  } } : undefined)
  ensureCurrent(); options.signal?.throwIfAborted()
  return result
}
