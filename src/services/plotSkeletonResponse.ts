import type { ChatCompletionResult } from './ai'
import type { Novel } from '@/types/novel'
import { normalizePlotSkeletonCandidates } from './reconstructionCreation'
import { assertStructuredOutputComplete, structuredOutputDiagnostic } from './aiDiagnostics'
import { skeletonCompletionIssues } from './creationDraft'

export function parsePlotSkeletonResponse(novel: Novel, response: ChatCompletionResult, now: string) {
  assertStructuredOutputComplete(response, '故事骨架')
  // A balanced nested array inside a truncated root is not a complete response.
  const text = response.content.trim().replace(/^\x60{3}(?:json)?\s*/i, '').replace(/\s*\x60{3}$/, '').trim()
  let payload: unknown
  try { payload = JSON.parse(text) }
  catch { throw new Error('骨架 JSON 未完整闭合或格式无效，原始输出已保留，请恢复补齐后保存（' + structuredOutputDiagnostic(response) + '）') }
  const candidates = normalizePlotSkeletonCandidates(novel, payload, now)
  if (!candidates.length) throw new Error(`模型没有返回有效的故事骨架，需包含 skeletons 数组或骨架数组及 title、premise 字段（${structuredOutputDiagnostic(response)}）`)
  return candidates.map(candidate => ({ ...candidate, complete: skeletonCompletionIssues(candidate).length === 0 }))
}

/** Extract only balanced candidate objects. The original partial text stays in the attempt. */
export function recoverPartialSkeletons(novel: Novel, content: string, now: string) {
  const objects: unknown[] = []
  const starts: number[] = []
  let quoted = false, escaped = false
  for (let index = 0; index < content.length; index++) {
    const char = content[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (char.charCodeAt(0) === 92) escaped = true
      else if (char === '"') quoted = false
    } else if (char === '"') quoted = true
    else if (char === '{') starts.push(index)
    else if (char === '}' && starts.length) {
      const start = starts.pop()!
      try {
        const item = JSON.parse(content.slice(start, index + 1))
        if (item && typeof item.title === 'string' && typeof item.premise === 'string') objects.push(item)
      } catch { /* Incomplete JSON stays available as raw author recovery text. */ }
    }
  }
  return normalizePlotSkeletonCandidates(novel, objects, now).map(candidate => ({ ...candidate, complete: false }))
}
