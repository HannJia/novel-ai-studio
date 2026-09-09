import { callAI } from '@/services/ai'
import { buildChapterCompletionPrompt } from '@/services/prompts'
import type { ModelConfig } from '@/stores/config'
import { parseAiJsonObject } from '@/utils/aiJson'

export interface ChapterMetadata {
  title: string
  summary: string
}

const PLACEHOLDER_TITLE = /^第\s*[一二三四五六七八九十百千万零〇两\d]+\s*章(?:\s*[：:、.-]?\s*)?$/

export function isPlaceholderChapterTitle(title: string): boolean {
  return PLACEHOLDER_TITLE.test(title.trim())
}

export function normalizeChapterTitle(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .trim()
    .replace(/^#{1,6}\s*/, '')
    .replace(/^第\s*[一二三四五六七八九十百千万零〇两\d]+\s*章\s*[：:、.-]?\s*/, '')
    .replace(/^[《〈「『【\[“”"'\s]+|[》〉」』】\]“”"'\s]+$/g, '')
    .replace(/[\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20)
}

function normalizeChapterSummary(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, 500)
}

export function parseChapterMetadata(text: string, requireTitle: boolean): ChapterMetadata | null {
  const parsed = parseAiJsonObject<{ title?: unknown; summary?: unknown }>(text)
  const title = normalizeChapterTitle(parsed?.title)
  const summary = normalizeChapterSummary(parsed?.summary)
  if (summary.length < 20 || (requireTitle && (title.length < 2 || isPlaceholderChapterTitle(title)))) return null
  return { title, summary }
}

export async function requestChapterMetadata(options: {
  model: ModelConfig
  chapterContent: string
  chapterTitle: string
  chapterIndex: number
  signal?: AbortSignal
  activityParentId?: string
  maxAttempts?: number
}): Promise<ChapterMetadata> {
  const requireTitle = isPlaceholderChapterTitle(options.chapterTitle)
  const maxAttempts = Math.max(1, options.maxAttempts ?? 2)
  let lastOutput = ''

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const messages = buildChapterCompletionPrompt(
      options.chapterContent,
      options.chapterTitle,
      options.chapterIndex,
    )
    if (attempt > 0) {
      messages[messages.length - 1].content += `\n\n上一轮输出无法解析或字段不合格。请重新输出一个完整 JSON 对象；summary 至少 20 字${requireTitle ? '，title 必须是 4-8 个字且不能只是“第X章”' : ''}。`
    }
    const result = await callAI({
      model: options.model,
      skillTask: 'analysis',
      messages,
      signal: options.signal,
      activityParentId: options.activityParentId,
      maxTokens: 900,
    })
    lastOutput = result.content
    const metadata = parseChapterMetadata(lastOutput, requireTitle)
    if (metadata) return metadata
  }

  throw new Error(`章节整理结果格式无效${lastOutput ? '，已自动重试' : ''}`)
}
