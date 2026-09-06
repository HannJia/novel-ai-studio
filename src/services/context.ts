// 上下文窗口管理 — 组装 AI 生成时的上下文信息

import type { Novel, Chapter, Character, EventLogEntry } from '@/types/novel'
import type { EmbeddingConfig } from '@/stores/config'
import { useKnowledgeStore } from '@/stores/knowledge'
import { buildSemanticRecords, formatEvidence, queryPersistedSemanticEvidence, retrieveSemanticEvidence } from '@/services/semanticIndex'
import { isRemoteEmbeddingEnabled } from '@/services/embeddings'
import { formatChapterPlanContext } from '@/services/storyPlanning'

export interface WritingContext {
  outlineContext: string
  previousSummary: string
  lastParagraph: string
  chapterGuidance: string
  semanticEvidence: string
}

export interface ReviewContext {
  settings: string
  style: string
  characters: string
  outline: string
  chapterGuidance: string
  recentEvents: string
  previousSummary: string
  chapterContent: string
  semanticEvidence: string
}

interface ContextBudget {
  outline: number
  volume: number
  characters: number
  globalPlans: number
  storyArcs: number
  timeline: number
  knowledgeEntry: number
  summaryChapterCount: number
  summaryText: number
  lastParagraph: number
  reviewContent: number
  reviewEvents: number
  semanticEvidence: number
}

const contextCache = new Map<string, WritingContext>()

function getContextBudget(contextWindow = 8000): ContextBudget {
  return {
    outline: Math.min(Math.floor(contextWindow * 0.15), 1200),
    volume: Math.min(Math.floor(contextWindow * 0.12), 900),
    characters: Math.min(Math.floor(contextWindow * 0.18), 1400),
    globalPlans: Math.min(Math.floor(contextWindow * 0.12), 900),
    storyArcs: Math.min(Math.floor(contextWindow * 0.13), 1100),
    timeline: Math.min(Math.floor(contextWindow * 0.11), 900),
    knowledgeEntry: Math.min(Math.floor(contextWindow * 0.05), 300),
    summaryChapterCount: Math.min(Math.floor(contextWindow / 800), 15),
    summaryText: Math.min(Math.floor(contextWindow * 0.22), 1800),
    lastParagraph: Math.min(Math.floor(contextWindow * 0.08), 800),
    reviewContent: Math.min(Math.floor(contextWindow * 0.5), 4000),
    reviewEvents: Math.min(Math.floor(contextWindow * 0.12), 900),
    semanticEvidence: Math.min(Math.floor(contextWindow * 0.16), 1500),
  }
}

function limitText(text: string, limit: number): string {
  return text.length > limit ? text.slice(0, limit) : text
}

function splitKeywords(text: string): string[] {
  return Array.from(new Set(
    text
      .split(/[\s\n，。！？、；：,.!?;:《》“”‘’（）()【】\[\]-]+/)
      .map(s => s.trim())
      .filter(s => s.length >= 2)
  ))
}

function includesAny(source: string, values: string[]): boolean {
  return values.some(value => value && source.includes(value))
}

export function selectRelevantCharacters(novel: Novel, sourceText: string, limit = 12): Character[] {
  const activeChars = (novel.characters || []).filter(c => !c.status || c.status === '活跃' || c.status === '失踪')
  if (activeChars.length <= limit) return activeChars

  const protagonistName = novel.settings?.protagonist?.name || ''
  const scored = activeChars.map((char, index) => {
    const names = [char.name, ...(char.aliases || [])].filter(Boolean)
    let score = 0
    if (char.name === protagonistName || names.includes(protagonistName)) score += 100
    if (includesAny(sourceText, names)) score += 50
    if (char.relationships?.some(r => sourceText.includes(r.targetName))) score += 12
    if (char.firstAppearChapter <= 1) score += 5
    if (char.status === '失踪' && !includesAny(sourceText, names)) score -= 10
    return { char, score, index }
  })

  const selected = scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(item => item.char)

  return selected.length > 0 ? selected : activeChars.slice(0, limit)
}

function formatCharacter(c: Character): string {
  let entry = `• ${c.name}（${c.identity || '未知身份'}）`
  if (c.personality) entry += `，性格：${c.personality}`
  if (c.faction) entry += `，阵营：${c.faction}`
  if (c.powerLevel) entry += `，实力：${c.powerLevel}`
  if (c.status === '失踪') entry += `，当前状态：失踪`
  if (c.relationships && c.relationships.length > 0) {
    const rels = c.relationships.map(r => `${r.targetName}(${r.relation})`).join('、')
    entry += `，关系：${rels}`
  }
  return entry
}

function formatDataPanelItem(item: Novel['dataPanels'][number]): string {
  const fields = item.fields
    .map(field => {
      const type = field.type && field.type !== 'text' ? `（${field.type}${field.formula ? `:${field.formula}` : ''}）` : ''
      return `${field.name}${type}=${field.value}${field.unit ? field.unit : ''}`
    })
    .join('；')
  const keywords = item.relatedKeywords.length > 0 ? `，关键词：${item.relatedKeywords.join('、')}` : ''
  return `• [${item.category}] ${item.name}：${fields || '暂无字段'}${keywords}`
}

function buildStageSummary(novel: Novel, chapterIdx: number, limit: number): string {
  const olderSummaries = novel.chapters
    .filter(c => c.chapterIndex < chapterIdx - 15 && c.summary)
    .sort((a, b) => a.chapterIndex - b.chapterIndex)

  if (olderSummaries.length === 0) return ''

  const groups: string[] = []
  for (let i = 0; i < olderSummaries.length; i += 10) {
    const group = olderSummaries.slice(i, i + 10)
    const first = group[0]
    const last = group[group.length - 1]
    const text = group.map(c => c.summary).join('；')
    groups.push(`【第${first.chapterIndex + 1}-${last.chapterIndex + 1}章阶段摘要】${limitText(text, 220)}`)
  }
  return limitText(groups.join('\n'), limit)
}

function buildPreviousSummary(novel: Novel, chapterIdx: number, budget: ContextBudget): string {
  const summaryChapters = novel.chapters
    .filter(c => c.chapterIndex < chapterIdx && c.summary)
    .sort((a, b) => b.chapterIndex - a.chapterIndex)
    .slice(0, budget.summaryChapterCount)
    .reverse()

  const recentSummary = summaryChapters.length > 0
    ? summaryChapters.map(c => `【第${c.chapterIndex + 1}章 ${c.title}】${c.summary}`).join('\n\n')
    : ''
  const stageSummary = buildStageSummary(novel, chapterIdx, Math.floor(budget.summaryText * 0.35))
  return limitText([stageSummary, recentSummary].filter(Boolean).join('\n\n'), budget.summaryText)
}

function buildContextSignature(novel: Novel, currentChapter: Chapter, contextWindow?: number): string {
  const previousChapter = novel.chapters.find(c => c.chapterIndex === currentChapter.chapterIndex - 1)
  const currentVolume = novel.volumes?.find(v => v.volumeIndex === currentChapter.volumeIndex)
  const characterSig = (novel.characters || [])
    .map(c => [c.id, c.name, c.status, c.identity, c.powerLevel, c.relationships?.length || 0].join(':'))
    .join('|')
  const eventSig = (novel.eventLog || [])
    .map(e => [e.id, e.title, e.status || '', e.hintCount || 0, e.targetChapter ?? '', e.updatedAt || ''].join(':'))
    .join('|')
  const arcSig = (novel.storyArcs || [])
    .map(arc => [
      arc.id,
      arc.status,
      arc.updatedAt,
      arc.nodes.map(node => `${node.id}:${node.status}:${node.targetChapter}:${node.actualChapter ?? ''}`).join(','),
    ].join(':'))
    .join('|')
  const dataSig = (novel.dataPanels || [])
    .map(item => [
      item.id,
      item.name,
      item.updatedAt,
      item.fields.map(f => `${f.name}:${f.value}`).join(','),
    ].join(':'))
    .join('|')
  const planSig = (novel.chapterPlans || [])
    .map(plan => [
      plan.id,
      plan.status,
      plan.targetChapterStart,
      plan.targetChapterEnd,
      plan.updatedAt,
    ].join(':'))
    .join('|')

  return [
    novel.id,
    currentChapter.id,
    currentChapter.title,
    currentChapter.updatedAt,
    previousChapter?.updatedAt || '',
    previousChapter?.content.length || 0,
    contextWindow || 8000,
    novel.outline.length,
    currentVolume ? [currentVolume.title, currentVolume.theme, currentVolume.summary, currentVolume.keyTurningPoints, currentVolume.characterChanges].join(':') : '',
    characterSig,
    eventSig,
    arcSig,
    planSig,
    dataSig,
    novel.knowledgeBaseIds?.join(',') || '',
  ].join('|')
}

function buildVolumeContext(novel: Novel, currentChapter: Chapter, budget: ContextBudget): string {
  const currentVolume = novel.volumes?.find(v => v.volumeIndex === currentChapter.volumeIndex)
  if (!currentVolume) return ''
  return limitText(`\n\n【当前卷级摘要：${currentVolume.title}】\n主题：${currentVolume.theme}\n剧情概要：${currentVolume.summary}`, budget.volume)
}

function buildStoryArcContext(novel: Novel, currentChapter: Chapter, budget: ContextBudget): string {
  const arcs = (novel.storyArcs || [])
    .filter(arc => arc.status === 'active' || arc.status === 'paused')
    .sort((a, b) => b.importance - a.importance || a.createdAt.localeCompare(b.createdAt))
  if (arcs.length === 0) return ''

  const lines = arcs.map(arc => {
    const pendingNodes = arc.nodes
      .filter(node => node.status === 'pending')
      .sort((a, b) => a.targetChapter - b.targetChapter)
    const nextNode = pendingNodes.find(node => node.targetChapter >= currentChapter.chapterIndex) || pendingNodes[0]
    const next = nextNode
      ? `；下一节点：第${nextNode.targetChapter + 1}章「${nextNode.title}」${nextNode.description ? `（${nextNode.description}）` : ''}`
      : ''
    const paused = arc.status === 'paused' && arc.reactivateAt ? `；恢复条件：${arc.reactivateAt}` : ''
    return `• [${arc.type}/${arc.status}/重要度${arc.importance}] ${arc.title}：${arc.description || '暂无描述'}${next}${paused}`
  })
  return limitText(`\n\n【当前故事弧线（按节奏推进，不要提前完成远期节点）】\n${lines.join('\n')}`, budget.storyArcs)
}

function buildTimelineContext(novel: Novel, currentChapter: Chapter, budget: ContextBudget): string {
  const chapterIndex = currentChapter.chapterIndex
  const recent = (novel.eventLog || [])
    .filter(event => event.chapterIndex < chapterIndex && !isActiveGlobalPlan(event))
    .sort((a, b) => b.chapterIndex - a.chapterIndex)
    .slice(0, 5)
  const upcoming = (novel.eventLog || [])
    .filter(event => !isActiveGlobalPlan(event) && event.status !== 'resolved' && event.status !== 'abandoned' && event.targetChapter !== undefined)
    .sort((a, b) => (a.targetChapter || 0) - (b.targetChapter || 0) || (b.importance || 3) - (a.importance || 3))
    .slice(0, 6)
  const entries = [...recent, ...upcoming.filter(item => !recent.some(event => event.id === item.id))]
  if (entries.length === 0) return ''

  const lines = entries.map(event => {
    const actual = event.chapterIndex < 0 ? '全书规划' : `第${event.chapterIndex + 1}章`
    const target = event.targetChapter !== undefined ? `，预计第${event.targetChapter + 1}章推进` : ''
    const timePlace = [event.storyTime, event.location].filter(Boolean).join(' / ')
    return `• ${actual}${target} [${event.type}/${event.status || 'resolved'}] ${event.title}${timePlace ? `（${timePlace}）` : ''}：${event.description}`
  })
  return limitText(`\n\n【故事时间线（已发生事实优先；预计章节只用于节奏参考）】\n${lines.join('\n')}`, budget.timeline)
}

function isActiveGlobalPlan(event: EventLogEntry): boolean {
  return event.chapterIndex < 0 && event.type === '伏笔' && (event.status === 'planted' || event.status === 'developing')
}

/**
 * 构建 AI 写作上下文（滑动窗口）
 * 按优先级组装：总大纲 → 分卷规划 → 章节计划 → 故事弧线 → 时间线 → 相关角色 → 全书规划 → 知识库 → 前文摘要
 */
export function buildWritingContext(
  novel: Novel,
  currentChapter: Chapter,
  contextWindow?: number,
): WritingContext {
  const cacheKey = buildContextSignature(novel, currentChapter, contextWindow)
  const cached = contextCache.get(cacheKey)
  if (cached) return cached

  const budget = getContextBudget(contextWindow)
  const chapterIdx = currentChapter.chapterIndex

  const outlineContext = novel.outline ? limitText(novel.outline, budget.outline) : ''
  const volumeContext = buildVolumeContext(novel, currentChapter, budget)
  const storyArcContext = buildStoryArcContext(novel, currentChapter, budget)
  const timelineContext = buildTimelineContext(novel, currentChapter, budget)
  const chapterGuidance = formatChapterPlanContext(novel, chapterIdx)

  let lastParagraph = ''
  if (chapterIdx > 0) {
    const prevChapter = novel.chapters.find(c => c.chapterIndex === chapterIdx - 1)
    if (prevChapter && prevChapter.content) {
      lastParagraph = prevChapter.content.slice(-budget.lastParagraph)
    }
  }

  const previousSummary = buildPreviousSummary(novel, chapterIdx, budget)
  const relevanceSource = [currentChapter.title, chapterGuidance, volumeContext, storyArcContext, timelineContext, lastParagraph, previousSummary].join('\n')
  let semanticEvidence = ''

  let characterContext = ''
  const relevantChars = selectRelevantCharacters(novel, relevanceSource, 12)
  if (relevantChars.length > 0) {
    characterContext = limitText(`\n\n【相关角色库（请严格遵循以下设定，根据剧情安排出场）】\n${relevantChars.map(formatCharacter).join('\n')}`, budget.characters)
  }

  let globalPlanContext = ''
  const activeGlobalPlans = (novel.eventLog || []).filter(isActiveGlobalPlan)
  if (activeGlobalPlans.length > 0) {
    const lines = activeGlobalPlans.map(event => {
      const statusLabel = event.status === 'planted' ? '待推进' : '推进中'
      return `• [${statusLabel}] ${event.title}：${event.description}${event.hintCount ? `（已铺垫${event.hintCount}次）` : ''}`
    })
    globalPlanContext = limitText(`\n\n【全书规划（请在合适时机自然推进，不要强行收束）】\n${lines.join('\n')}`, budget.globalPlans)
  }

  let knowledgeContext = ''
  if (novel.knowledgeBaseIds && novel.knowledgeBaseIds.length > 0) {
    try {
      const kbStore = useKnowledgeStore()
      const keywords = splitKeywords([relevanceSource, ...relevantChars.map(c => c.name)].join('\n')).slice(0, 30)
      const relevantEntries = kbStore.getRelevantEntries(novel.knowledgeBaseIds, keywords, 8)
      const entries = relevantEntries.map(entry => {
        const text = entry.summary || entry.content.substring(0, budget.knowledgeEntry)
        return `• [${entry.category}] ${entry.title}：${text}`
      })
      if (entries.length > 0) {
        knowledgeContext = `\n\n【知识库（已按本章相关性筛选，请确保内容一致）】\n${entries.join('\n')}`
      }
      semanticEvidence = formatEvidence(
        retrieveSemanticEvidence(relevanceSource, buildSemanticRecords(novel, kbStore.knowledgeBases), 8),
        budget.semanticEvidence,
      )
    } catch {
      // 知识库 store 未初始化时静默跳过
    }
  }

  if (!semanticEvidence) {
    semanticEvidence = formatEvidence(
      retrieveSemanticEvidence(relevanceSource, buildSemanticRecords(novel, []), 8),
      budget.semanticEvidence,
    )
  }

  const result = {
    outlineContext: outlineContext + volumeContext + storyArcContext + timelineContext + characterContext + globalPlanContext + knowledgeContext + (semanticEvidence ? `\n\n【语义记忆召回】\n${semanticEvidence}` : ''),
    previousSummary,
    lastParagraph,
    chapterGuidance,
    semanticEvidence,
  }

  if (contextCache.size > 30) contextCache.clear()
  contextCache.set(cacheKey, result)
  return result
}

export async function augmentWritingContextWithVectorMemory(
  novel: Novel,
  currentChapter: Chapter,
  context: WritingContext,
  embeddingConfig?: EmbeddingConfig,
): Promise<WritingContext> {
  if (!isRemoteEmbeddingEnabled(embeddingConfig)) return context
  const query = [
    currentChapter.title,
    context.chapterGuidance,
    context.previousSummary,
    context.lastParagraph,
  ].filter(Boolean).join('\n')
  if (!query.trim()) return context
  try {
    const evidence = await queryPersistedSemanticEvidence(novel.id, query, 8, embeddingConfig)
    const formatted = formatEvidence(evidence, 1500)
    if (!formatted) return context
    const usesRemoteVectors = evidence.some(item => (item.metadata as any)?._embedding?.provider === 'remote')
    return {
      ...context,
      outlineContext: `${context.outlineContext}\n\n【${usesRemoteVectors ? 'BGE 向量' : '持久化'}记忆召回】\n${formatted}`,
      semanticEvidence: formatted,
    }
  } catch (error) {
    console.warn('Vector memory query failed, using local context', error)
    return context
  }
}

export function buildChapterFactCard(
  novel: Novel,
  currentChapter: Chapter,
  writingContext = buildWritingContext(novel, currentChapter),
): string {
  const chapterIdx = currentChapter.chapterIndex
  const previousChapter = novel.chapters.find(c => c.chapterIndex === chapterIdx - 1)
  const relevanceSource = [
    currentChapter.title,
    writingContext.chapterGuidance,
    writingContext.previousSummary,
    writingContext.lastParagraph,
  ].join('\n')
  const relevantCharacters = selectRelevantCharacters(novel, relevanceSource, 8)
  const recentEvents = (novel.eventLog || [])
    .filter(e => e.chapterIndex < chapterIdx && !isActiveGlobalPlan(e))
    .slice(-8)
    .map(e => `• ${e.chapterIndex < 0 ? '全书规划' : `第${e.chapterIndex + 1}章`} [${e.type}] ${e.title}：${e.description}`)
  const activeGlobalPlans = (novel.eventLog || [])
    .filter(isActiveGlobalPlan)
    .slice(0, 10)
    .map(event => `• [${event.status === 'planted' ? '待推进' : '推进中'}] ${event.title}：${event.description}${event.hintCount ? `（已铺垫${event.hintCount}次）` : ''}`)
  const allDataPanels = novel.dataPanels || []
  const relatedData = allDataPanels
    .filter(item => {
      const text = `${item.name}\n${item.relatedKeywords.join('\n')}\n${item.fields.map(f => `${f.name} ${f.value}`).join('\n')}`
      return item.relatedKeywords.some(keyword => relevanceSource.includes(keyword))
        || relevanceSource.includes(item.name)
        || relevantCharacters.some(char => text.includes(char.name) || char.name.includes(item.name))
    })
    .slice(0, 10)
    .map(formatDataPanelItem)
  const globalNumericData = allDataPanels
    .filter(item => !relatedData.some(line => line.includes(`] ${item.name}：`)))
    .filter(item => {
      const source = `${item.name}\n${item.fields.map(f => `${f.name} ${f.value} ${f.unit || ''}`).join('\n')}`
      return /(时间|日期|天|日|月|剩余|倒计时|成熟|进度|资源|灵石|数量|库存|等级|境界|阶段|月例|采收)/.test(source)
    })
    .slice(0, 8)
    .map(formatDataPanelItem)
  return [
    `【本章写作事实卡】`,
    `章节：第${chapterIdx + 1}章 ${currentChapter.title}`,
    writingContext.chapterGuidance
      ? `章节计划：\n${writingContext.chapterGuidance}`
      : '章节计划：暂无，请严格承接分卷目标和前文推进，不要临时发明重大设定。',
    previousChapter ? `上一章标题：第${previousChapter.chapterIndex + 1}章 ${previousChapter.title}` : '',
    writingContext.lastParagraph ? `上一章结尾：${limitText(writingContext.lastParagraph, 500)}` : '',
    writingContext.previousSummary ? `前文摘要：${limitText(writingContext.previousSummary, 1200)}` : '',
    relevantCharacters.length ? `必须遵守的角色状态：\n${relevantCharacters.map(formatCharacter).join('\n')}` : '',
    recentEvents.length ? `近期已发生事件：\n${recentEvents.join('\n')}` : '',
    activeGlobalPlans.length ? `待推进的全书规划：\n${activeGlobalPlans.join('\n')}` : '',
    relatedData.length || globalNumericData.length ? `相关/关键数据面板：\n${[...relatedData, ...globalNumericData].join('\n')}` : '',
    writingContext.semanticEvidence ? `可引用证据：\n${limitText(writingContext.semanticEvidence, 1000)}` : '',
    `硬性要求：不得改写已定角色状态、等级、资源、位置、时间线；涉及时间、倒计时、剩余天数、灵石收支、作物成熟进度等数字时必须逐项演算，不能凭感觉估算；不得突然新增未铺垫的重大设定、道具、势力或人物。`,
  ].filter(Boolean).join('\n\n')
}

export function buildReviewContext(
  novel: Novel,
  currentChapter: Chapter,
  chapterContent: string,
  contextWindow?: number,
): ReviewContext {
  const budget = getContextBudget(contextWindow)
  const writingContext = buildWritingContext(novel, currentChapter, contextWindow)
  const reviewSource = [currentChapter.title, writingContext.chapterGuidance, writingContext.previousSummary, chapterContent.slice(0, 1200)].join('\n')
  const characters = selectRelevantCharacters(novel, reviewSource, 12)
    .map(formatCharacter)
    .join('\n') || '暂无角色信息'
  const recentEvents = limitText((novel.eventLog || [])
    .filter(e => e.chapterIndex < currentChapter.chapterIndex && !isActiveGlobalPlan(e))
    .slice(-10)
    .map(e => `${e.chapterIndex < 0 ? '全书规划' : `第${e.chapterIndex + 1}章`} [${e.type}] ${e.title}：${e.description}`)
    .join('\n') || '暂无事件记录', budget.reviewEvents)

  return {
    settings: limitText(JSON.stringify(novel.settings), 1200),
    style: limitText(JSON.stringify(novel.writingStyle), 500),
    characters: limitText(characters, budget.characters),
    outline: limitText(writingContext.outlineContext, budget.outline + budget.volume),
    chapterGuidance: writingContext.chapterGuidance || '暂无章节计划',
    recentEvents,
    previousSummary: writingContext.previousSummary || '暂无前章总结',
    chapterContent: limitText(chapterContent, budget.reviewContent),
    semanticEvidence: writingContext.semanticEvidence || '暂无可引用证据',
  }
}
