import { callAI } from '@/services/ai'
import { kbCategories } from '@/stores/knowledge'
import type { ModelConfig } from '@/stores/config'
import { parseAiJsonObject } from '@/utils/aiJson'

export const CHAT_KNOWLEDGE_EXTRACT_LIMIT = 16_000

export interface ChatKnowledgeExtraction {
  title: string
  category: string
  summary: string
  tags: string[]
}

function fallbackTitle(content: string): string {
  return content.split('\n').map(line => line.replace(/^[#*\s]+|[*\s]+$/g, '')).find(Boolean)?.slice(0, 180) || '灵感资料'
}

function extractedFields(parsed: Record<string, unknown> | null, content: string): ChatKnowledgeExtraction | null {
  const summary = parsed?.summary ?? parsed?.摘要 ?? parsed?.要点
  if (typeof summary !== 'string' || !summary.trim()) return null
  const name = parsed?.title ?? parsed?.标题
  const category = parsed?.category ?? parsed?.分类
  const tags = parsed?.tags ?? parsed?.标签
  return {
    title: typeof name === 'string' && name.trim() ? name.trim().slice(0, 180) : fallbackTitle(content),
    category: typeof category === 'string' && kbCategories.some(item => item.value === category)
      ? category : '其他',
    summary: summary.trim().slice(0, 12000),
    tags: Array.isArray(tags)
      ? tags.filter((tag): tag is string => typeof tag === 'string')
        .map(tag => tag.trim().slice(0, 40)).filter(Boolean).slice(0, 8)
      : [],
  }
}

function plainSummary(text: string): string {
  const cleaned = text.replace(/<(thinking|think|analysis|reasoning)>[\s\S]*?<\/\1>/gi, '')
    .replace(/^```(?:text|markdown)?\s*|\s*```$/gi, '')
    .replace(/^#{1,4}\s*(?:摘要|要点)\s*[:：]?\s*/i, '')
    .trim()
  if (cleaned.length < 8 || /^[{[]/.test(cleaned) || /^(抱歉|无法完成|不能提供)/.test(cleaned)) return ''
  return cleaned.slice(0, 1800)
}

export async function extractChatKnowledge(
  model: ModelConfig,
  content: string,
  signal?: AbortSignal,
  onRetry?: () => void,
): Promise<ChatKnowledgeExtraction> {
  const source = content.slice(0, CHAT_KNOWLEDGE_EXTRACT_LIMIT)
  const result = await callAI({
    model,
    taskName: '提取知识条目',
    maxTokens: 4000,
    timeoutMs: 90_000,
    noAutomaticRetry: true,
    stream: true,
    onChunk: () => {},
    signal,
    messages: [
      { role: 'system', content: `从单条对话回复中提取可复用的知识条目。只返回 JSON 对象，字段为 title、category、summary、tags（字符串数组）。
category 只能是：${kbCategories.map(item => item.value).join('、')}。
summary 用简洁中文记录原文明确提出的设定、人物、时间、地点、因果、规则和关键数字。不要编造或补全事实；区分小说构想与有来源的史实，不把建议或猜测写成已证实事实。不要把“参考来源”列表当成事实。tags 最多 8 个。不要重复整段原文。` },
      { role: 'user', content: source },
    ],
  })
  const parsed = extractedFields(parseAiJsonObject<Record<string, unknown>>(result.content), content)
  if (parsed) return parsed

  if (signal?.aborted) throw signal.reason || new DOMException('请求已取消', 'AbortError')
  onRetry?.()
  const retry = await callAI({
    model,
    taskName: '重试提取知识摘要',
    maxTokens: 4000,
    timeoutMs: 90_000,
    noAutomaticRetry: true,
    stream: true,
    onChunk: () => {},
    signal,
    messages: [
      { role: 'system', content: '只根据收到的对话回复，提取其中明确提出的设定和关键数字。不要编造，不把建议或猜测当作事实，不要把来源列表当作事实。只输出简洁中文摘要，不要 JSON 或分析过程。' },
      { role: 'user', content: source },
    ],
  })
  const structuredRetry = extractedFields(parseAiJsonObject<Record<string, unknown>>(retry.content), content)
  if (structuredRetry) return structuredRetry
  const summary = plainSummary(retry.content)
  if (summary) return { title: fallbackTitle(content), category: '其他', summary, tags: [] }
  throw new Error('模型未返回可用摘要。可更换对话模型后重试')
}
