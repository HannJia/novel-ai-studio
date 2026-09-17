import { callAI, type ChatMessage } from '@/services/ai'
import {
  augmentWritingContextWithVectorMemory,
  buildWritingContext,
  type WritingContext,
} from '@/services/context'
import type { ModelConfig, EmbeddingConfig } from '@/stores/config'
import type { Chapter, Novel } from '@/types/novel'
import { parseAiJsonObject } from '@/utils/aiJson'
import { buildSoftwareAssistantContext } from './softwareAssistantContext'

export type WritingAdviceMode = 'paragraph' | 'scene' | 'chapter'
export type WritingAdviceKind = 'conflict' | 'investigation' | 'relationship' | 'revelation' | 'scene' | 'pacing'

interface WritingAdviceEvidence {
  sourceType: 'chapter' | 'knowledge' | 'timeline' | 'data_panel' | 'plan' | 'character' | 'context'
  sourceLabel: string
  excerpt: string
}

export interface WritingAdviceSuggestion {
  id: string
  kind: WritingAdviceKind
  title: string
  approach: string
  storyEffect: string
  nextBeat: string
  risk: string
  evidence: WritingAdviceEvidence[]
}

interface WritingAdviceNextPlan {
  title: string
  objective: string
  beats: string[]
}

export interface WritingAdviceResult {
  mode: WritingAdviceMode
  focusLabel: string
  focusExcerpt: string
  contextSummary: string
  suggestions: WritingAdviceSuggestion[]
  nextChapterPlan: WritingAdviceNextPlan | null
  generatedAt: string
}

export interface WritingAdviceRequest {
  model: ModelConfig
  novel: Novel
  chapter: Chapter
  content: string
  focus: string
  mode: WritingAdviceMode
  embeddingConfig?: EmbeddingConfig
  signal?: AbortSignal
}

const MODE_LABELS: Record<WritingAdviceMode, string> = {
  paragraph: '当前段落',
  scene: '当前场景',
  chapter: '本章走向',
}

function limitText(value: unknown, limit: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit)
}

function normalizeKind(value: unknown): WritingAdviceKind {
  const kind = String(value || '').trim() as WritingAdviceKind
  return ['conflict', 'investigation', 'relationship', 'revelation', 'scene', 'pacing'].includes(kind)
    ? kind
    : 'scene'
}

function normalizeEvidence(value: unknown): WritingAdviceEvidence[] {
  if (!Array.isArray(value)) return []
  const allowed = ['chapter', 'knowledge', 'timeline', 'data_panel', 'plan', 'character', 'context'] as const
  return value
    .map(item => {
      if (!item || typeof item !== 'object') return null
      const candidate = item as Record<string, unknown>
      const sourceType = allowed.includes(String(candidate.sourceType) as typeof allowed[number])
        ? String(candidate.sourceType) as WritingAdviceEvidence['sourceType']
        : 'context'
      const sourceLabel = limitText(candidate.sourceLabel || candidate.source || '当前资料', 100)
      const excerpt = limitText(candidate.excerpt || candidate.evidence || '', 220)
      return sourceLabel && excerpt ? { sourceType, sourceLabel, excerpt } : null
    })
    .filter((item): item is WritingAdviceEvidence => Boolean(item))
    .slice(0, 3)
}

function normalizeNextPlan(value: unknown): WritingAdviceNextPlan | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  const beats = Array.isArray(candidate.beats)
    ? candidate.beats.map(beat => limitText(beat, 180)).filter(Boolean).slice(0, 6)
    : []
  const title = limitText(candidate.title, 120)
  const objective = limitText(candidate.objective || candidate.summary, 280)
  if (!title && !objective && beats.length === 0) return null
  return { title: title || '下一步章节方向', objective, beats }
}

export function extractWritingFocus(content: string, selectionStart = content.length, selectionEnd = selectionStart): string {
  const source = String(content || '')
  if (!source.trim()) return ''
  const start = Math.max(0, Math.min(selectionStart, source.length))
  const end = Math.max(start, Math.min(selectionEnd, source.length))
  if (end > start && source.slice(start, end).trim()) return limitText(source.slice(start, end), 1800)

  const paragraphStart = Math.max(source.lastIndexOf('\n\n', Math.max(0, start - 1)), source.lastIndexOf('\n', Math.max(0, start - 1)))
  const nextBreak = source.indexOf('\n', start)
  const paragraphEnd = nextBreak >= 0 ? nextBreak : source.length
  const paragraph = source.slice(paragraphStart + 1, paragraphEnd).trim()
  if (paragraph) return limitText(paragraph, 1800)
  return limitText(source.slice(Math.max(0, start - 1200), Math.min(source.length, start + 600)), 1800)
}

function contextSummary(context: WritingContext): string {
  const parts = [
    context.chapterGuidance ? '当前章节计划' : '',
    context.previousSummary ? '前文章节摘要' : '',
    context.lastParagraph ? '上一章结尾' : '',
    context.semanticEvidence ? '语义检索资料' : '',
    context.outlineContext ? '总纲、分卷与故事状态' : '',
  ].filter(Boolean)
  return parts.join('、') || '当前章节正文'
}

export function buildWritingAdvicePrompt(
  novel: Novel,
  chapter: Chapter,
  focus: string,
  mode: WritingAdviceMode,
  context: WritingContext,
  currentContent = chapter.content,
): ChatMessage[] {
  const contextText = context.outlineContext.slice(0, 7000)
  const planText = context.chapterGuidance.slice(0, 2200)
  const summaryText = context.previousSummary.slice(-2200)
  const previousEnding = context.lastParagraph.slice(-1000)
  const chapterContent = limitText(currentContent, 6000)
  const modeLabel = MODE_LABELS[mode]
  return [
    {
      role: 'system',
      content: `${buildSoftwareAssistantContext('advisor')}
你是小说连续性编辑和创作顾问，服务于人工主笔。你可以帮助作者规划故事、提供多个后续方向和下一章计划，但绝不能代写正文、改写正文或输出可直接替代正文的大段文字。只根据给出的资料提出建议，资料不足时明确说资料不足。每条建议都必须引用提供的资料证据；不要编造不存在的人物、事件、规则或数值。当前是结构化写作建议任务，必须输出严格 JSON，不把软件帮助说明写进小说正文。`,
    },
    {
      role: 'user',
      content: `请为《${novel.title}》第 ${chapter.chapterIndex + 1} 章提供 ${modeLabel} 的写作辅助。

【作者正在编辑的内容】
${focus || '正文尚未开始，请根据章节计划提供开场推进方向'}

【本章已写正文（仅用于理解，不得改写）】
${chapterContent || '暂无正文'}

【本章计划】
${planText || '暂无，请根据总纲和前文给出保守建议'}

【前文摘要】
${summaryText || '暂无'}

【上一章结尾】
${previousEnding || '暂无'}

【故事资料与已确认事实】
${contextText || '暂无'}

【输出要求】
输出 JSON 对象，不要代码块，不要解释：
{
  "contextSummary": "本次实际参考了哪些资料，50字以内",
  "suggestions": [
    {
      "id": "方向1",
      "kind": "conflict|investigation|relationship|revelation|scene|pacing",
      "title": "方向名称，12字以内",
      "approach": "具体写作思路，80-180字；只描述剧情方向，不写正文",
      "storyEffect": "对本章和后续的作用，40-100字",
      "nextBeat": "作者接下来可以落笔的动作或剧情节拍，40-100字",
      "risk": "可能的节奏或设定风险，没有则写无",
      "evidence": [{"sourceType":"chapter|knowledge|timeline|data_panel|plan|character|context","sourceLabel":"来源名称","excerpt":"来源中的短证据"}]
    }
  ],
  "nextChapterPlan": {"title":"下一章标题方向","objective":"下一章目标","beats":["节拍1","节拍2","节拍3"]}
}

规则：suggestions 返回 3-4 个彼此不同的方向；不得输出正文段落、完整对话或超过 2 句的文学描写。nextChapterPlan 只能是规划草案，不得假设作者一定采用。`,
    },
  ]
}

export function parseWritingAdviceResult(
  raw: string,
  mode: WritingAdviceMode,
  focus: string,
  context: WritingContext,
): WritingAdviceResult {
  const parsed = parseAiJsonObject<Record<string, unknown>>(raw)
  if (!parsed) throw new Error('AI 返回的写作建议不是有效 JSON')
  const rawSuggestions = Array.isArray(parsed.suggestions)
    ? parsed.suggestions
    : Array.isArray(parsed.directions)
      ? parsed.directions
      : []
  const suggestions = rawSuggestions
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null
      const candidate = item as Record<string, unknown>
      const title = limitText(candidate.title || candidate.name, 120)
      const approach = limitText(candidate.approach || candidate.description || candidate.idea, 600)
      if (!title || !approach) return null
      return {
        id: limitText(candidate.id, 80) || `direction-${index + 1}`,
        kind: normalizeKind(candidate.kind || candidate.type),
        title,
        approach,
        storyEffect: limitText(candidate.storyEffect || candidate.effect, 320),
        nextBeat: limitText(candidate.nextBeat || candidate.nextStep, 320),
        risk: limitText(candidate.risk, 220) || '无明显风险',
        evidence: normalizeEvidence(candidate.evidence),
      } satisfies WritingAdviceSuggestion
    })
    .filter((item): item is WritingAdviceSuggestion => Boolean(item))
    .slice(0, 4)
  if (suggestions.length === 0) throw new Error('AI 没有返回可用的写作方向')
  return {
    mode,
    focusLabel: MODE_LABELS[mode],
    focusExcerpt: limitText(focus, 1800),
    contextSummary: limitText(parsed.contextSummary, 180) || contextSummary(context),
    suggestions,
    nextChapterPlan: normalizeNextPlan(parsed.nextChapterPlan || parsed.chapterPlan),
    generatedAt: new Date().toISOString(),
  }
}

export async function requestWritingAdvice(request: WritingAdviceRequest): Promise<WritingAdviceResult> {
  // The editor keeps unsaved text in a local ref, so make the context use that
  // exact snapshot instead of the last persisted chapter content.
  const contextChapter = request.chapter.content === request.content
    ? request.chapter
    : { ...request.chapter, content: request.content }
  let context = buildWritingContext(request.novel, contextChapter, request.model.contextWindow)
  context = await augmentWritingContextWithVectorMemory(
    request.novel,
    contextChapter,
    context,
    request.embeddingConfig,
  )
  const result = await callAI({
    model: request.model,
    skillTask: 'planning',
    messages: buildWritingAdvicePrompt(request.novel, request.chapter, request.focus, request.mode, context, request.content),
    maxTokens: Math.min(request.model.maxTokens || 2400, 2600),
    signal: request.signal,
  })
  return parseWritingAdviceResult(result.content, request.mode, request.focus, context)
}
