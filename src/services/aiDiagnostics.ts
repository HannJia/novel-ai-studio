import type { ChatCompletionResult } from './ai'

const FINISH_REASONS = new Set(['stop', 'length', 'content_filter', 'tool_calls', 'function_call', 'client_stop'])

function isTokenCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Copy only known numeric counters; never retain provider text or unknown fields. */
export function safeAiUsage(value: unknown): ChatCompletionResult['usage'] {
  if (!isRecord(value)) return undefined
  const usage: NonNullable<ChatCompletionResult['usage']> = {}
  for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens'] as const) {
    const count = value[key]
    if (isTokenCount(count)) usage[key] = count
  }
  const details = value.completion_tokens_details
  if (isRecord(details)) {
    const count = details.reasoning_tokens
    if (isTokenCount(count)) usage.completion_tokens_details = { reasoning_tokens: count }
  }
  return Object.keys(usage).length ? usage : undefined
}

/** Deliberately excludes response text, prompts, URLs and credentials. */
export function structuredOutputDiagnostic(result: ChatCompletionResult): string {
  const finish = !result.finishReason ? '未提供' : FINISH_REASONS.has(result.finishReason) ? result.finishReason : '未知'
  const tokens = result.usage?.completion_tokens
  const reasoningTokens = result.usage?.completion_tokens_details?.reasoning_tokens
  return `结束原因：${finish}；正文长度：${result.content.length} 字符`
    + (isTokenCount(tokens) ? `；输出用量：${tokens} token` : '')
    + (isTokenCount(reasoningTokens) ? `；推理用量：${reasoningTokens} token` : '')
}

export function assertStructuredOutputComplete(result: ChatCompletionResult, task: string): void {
  if (result.finishReason && result.finishReason !== 'stop') {
    throw new Error(`${task}输出未正常完成，未采用部分结果（${structuredOutputDiagnostic(result)}）`)
  }
  if (!result.content.trim()) {
    throw new Error(`${task}未返回正文，未采用空结果（${structuredOutputDiagnostic(result)}）`)
  }
}

export function safeAiErrorMessage(error: unknown, secrets: string[] = []): string {
  let text = error instanceof Error ? error.message : String(error ?? '')
  for (const secret of secrets) if (secret) text = text.split(secret).join('[已隐藏]')
  return text
    .replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [已隐藏]')
    .replace(/\bsk-[A-Za-z0-9_-]+/g, '[已隐藏]')
    .replace(/((?:api[_-]?key|access[_-]?token|authorization)\s*["']?\s*[:=]\s*["']?)[^\s"'&,}]+/gi, '$1[已隐藏]')
    .replace(/https?:\/\/[^\s<>"']+/gi, '[接口地址已隐藏]')
    .slice(0, 1600)
}
