import { callAI } from './ai'
import { buildContentReviewPrompt } from './prompts'
import { contentReviewVerdict } from './contentReview'
import { requestChapterReviewWithCoverage, type ReviewCoverage } from './chapterReviewCoverage'
import type { ReviewContext } from './context'
import type { ModelConfig } from '@/stores/config'

export function requestCoveredContentReview(options: {
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
}): Promise<string> {
  return requestChapterReviewWithCoverage(options.source, async (part, kind, facts) => {
    options.signal?.throwIfAborted()
    options.ensureCurrent()
    const context = options.buildContext(part.text)
    // Slices have already been bounded by the coverage service. No hidden prefix truncation.
    context.chapterContent = part.text
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
        onChunk: chunk => {
          report += chunk
          if (part.total === 1) options.onChunk?.(report)
        },
      })
      options.signal?.throwIfAborted()
      options.ensureCurrent()
      if (result.finishReason && result.finishReason !== 'stop') throw new Error('内容审查输出未正常完成，未将部分报告当作通过结果')
      if (contentReviewVerdict(report) !== 'unknown') return report.trim()
      if (attempt === 0) options.onRetry?.()
    }
    throw new Error('AI 审查返回为空或格式不完整')
  }, options.onProgress)
}
