import { formatEventCausalityContext } from './eventCausality'
import { formatArcDesign } from './storyArcEditing'
import { getCurrentChapterSummary } from '@/services/derivedSources'
import type { StoryMemoryRecord } from '@/types/storyMemory'
import { formatStoryMemoryContext, storyMemorySignature } from './storyMemory'
import { withCurrentStoryEntities, formatEntitySourceWarnings } from './effectiveStory'
// 上下文窗口管理 — 组装 AI 生成时的上下文信息

import type { Novel, Chapter, Character, EventLogEntry } from '@/types/novel'
import type { EmbeddingConfig } from '@/stores/config'
import { useKnowledgeStore } from '@/stores/knowledge'
import type { KnowledgeBase } from '@/types/knowledge'
import { orderKnowledgeSources, selectKnowledgeEntries } from './knowledgeSelection'
import { buildSemanticRecords, formatEvidence, queryPersistedSemanticEvidence, retrieveSemanticEvidence, SemanticSourceChangedError } from '@/services/semanticIndex'
import { isRemoteEmbeddingEnabled } from '@/services/embeddings'
import { formatChapterPlanContext } from '@/services/storyPlanning'
import { buildBoundKnowledgeSignature } from '@/services/knowledgeContext'
import { projectStoryTime, projectStoryTimeTimeline } from './storyTime'
import { equipmentSnapshot, formatEquipmentTotals } from '@/services/dataPanelEquipment'
import { buildReconstructionContextPack, formatReconstructionContextPack } from '@/services/reconstructionContext'
import type { CanonMutationRecord, ContextPack, CreationDraft } from '@/types/reconstruction'
import { formatApprovedPlanning, getApprovedPlanning } from './reconstructionPlanning'
import { formatCharacterStateContext } from './reconstructionCharacterState'
import { getRelationshipProjection } from './relationshipProjection'
import { resolveChapterLengthPolicy, type ChapterLengthPolicy } from './chapterLength'
import { countNovelWords } from '@/utils/format'


export interface WritingContext {
  outlineContext: string
  previousSummary: string
  lastParagraph: string
  chapterGuidance: string
  semanticEvidence: string
  structuredState?: string
}

export interface ReviewContext {
  lengthPolicy?: ChapterLengthPolicy
  chapterWordCount?: number
  settings: string
  style: string
  characters: string
  outline: string
  chapterGuidance: string
  recentEvents: string
  previousSummary: string
  chapterContent: string
  semanticEvidence: string
  structuredState?: string
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
  reviewEvents: number
  semanticEvidence: number
  structuredState: number
}

const contextCache = new Map<string, { signature: string; context: WritingContext }>()
const contextSources = new WeakMap<WritingContext, string>()
const contextCanon = new WeakMap<WritingContext, CanonMutationRecord[]>()

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
    reviewEvents: Math.min(Math.floor(contextWindow * 0.12), 900),
    semanticEvidence: Math.min(Math.floor(contextWindow * 0.16), 1500),
    structuredState: Math.min(Math.floor(contextWindow * 0.18), 1400),
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
  const activeChars = (novel.characters || []).filter(c => !c.status || c.status === '活跃' || c.status === '失踪' || c.status === '待核对')
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

function formatCharacter(c: Character, relationships: ReturnType<typeof getRelationshipProjection>): string {
  let entry = `• ${c.name}（${c.identity || '未知身份'}）`
  if (c.personality) entry += `，性格：${c.personality}`
  if (c.faction) entry += `，阵营：${c.faction}`
  if (c.powerLevel) entry += `，实力：${c.powerLevel}`
  if (c.status === '失踪') entry += `，当前状态：失踪`
  const current = relationships.edges.filter(edge => edge.source.id === c.id)
  if (current.length > 0) {
    const rels = current.map(edge => `${edge.target.name}(${edge.relation})`).join('、')
    entry += `，关系：${rels}`
  }
  return entry
}

function formatDataPanelItem(item: Novel['dataPanels'][number], panels: Novel['dataPanels']): string {
  const fields = item.fields
    .map(field => {
      const type = field.type && field.type !== 'text' ? `（${field.type}${field.formula ? `:${field.formula}` : ''}）` : ''
      return `${field.name}${type}=${field.value}${field.unit ? field.unit : ''}`
    })
    .join('；')
  const owner = ['装备', '道具'].includes(item.category) ? `，${equipmentSnapshot(item, panels)}` : ''
  const effective = formatEquipmentTotals(panels, item.id)
  const keywords = item.relatedKeywords.length > 0 ? `，关键词：${item.relatedKeywords.join('、')}` : ''
  return `• [${item.category}] ${item.name}：${fields || '暂无字段'}${owner}${keywords}${effective ? `\n${effective}` : ''}`
}

function buildPreviousSummary(novel: Novel, chapterIdx: number, budget: ContextBudget, storyMemories: StoryMemoryRecord[]): string {
  const summaryChapters = novel.chapters
    .filter(c => c.chapterIndex < chapterIdx && getCurrentChapterSummary(c))
    .sort((a, b) => b.chapterIndex - a.chapterIndex)
    .slice(0, budget.summaryChapterCount)
    .reverse()

  const stageSummary = formatStoryMemoryContext(novel, storyMemories, chapterIdx, Math.floor(budget.summaryText * 0.65))
  const recentBudget = budget.summaryText - stageSummary.length - (stageSummary ? 2 : 0)
  const recent: string[] = []
  let remaining = recentBudget
  for (const chapter of summaryChapters.reverse()) {
    const label = `【第${chapter.chapterIndex + 1}章 ${chapter.title}】`
    const available = remaining - label.length - (recent.length ? 2 : 0)
    if (available <= 0) break
    const line = label + limitText(getCurrentChapterSummary(chapter), available)
    recent.unshift(line)
    remaining -= line.length + (recent.length > 1 ? 2 : 0)
  }
  return [stageSummary, recent.join('\n\n')].filter(Boolean).join('\n\n')
}

function readContextKnowledge(snapshot?: KnowledgeBase[]): KnowledgeBase[] {
  if (snapshot !== undefined) return snapshot
  try { return useKnowledgeStore().knowledgeBases } catch { return [] }
}

function buildContextSignature(novel: Novel, currentChapter: Chapter, storyMemories: StoryMemoryRecord[] = [], canonMutations: CanonMutationRecord[] = [], knowledge?: KnowledgeBase[]): string {
  novel = withCurrentStoryEntities(novel, currentChapter.chapterIndex)
  // Keep exact content, including same-length edits and fields whose timestamps
  // have not yet been saved. Only a few current chapter contexts are retained.
  return JSON.stringify({
    canonMutations, novelId: novel.id, currentChapter: { id: currentChapter.id, chapterIndex: currentChapter.chapterIndex,
      volumeIndex: currentChapter.volumeIndex, title: currentChapter.title, content: currentChapter.content, summary: getCurrentChapterSummary(currentChapter) },
    outline: novel.outline, settings: novel.settings,
    storyMemory: storyMemorySignature(novel, storyMemories, currentChapter.chapterIndex),
    storyTime: { current: projectStoryTime(novel, currentChapter), prior: projectStoryTimeTimeline(novel, currentChapter.chapterIndex) },
    volumes: novel.volumes, characters: novel.characters,
    events: novel.eventLog, arcs: novel.storyArcs, plans: novel.chapterPlans, data: novel.dataPanels,
    chapters: novel.chapters.filter(chapter => chapter.chapterIndex < currentChapter.chapterIndex)
      .map(chapter => [chapter.id, chapter.chapterIndex, chapter.volumeIndex, chapter.title, chapter.status, getCurrentChapterSummary(chapter), chapter.content]),
    knowledgeIds: novel.knowledgeBaseIds, knowledge: buildBoundKnowledgeSignature(novel, readContextKnowledge(knowledge)),
  })
}

function buildVolumeContext(novel: Novel, currentChapter: Chapter, budget: ContextBudget): string {
  const currentVolume = novel.volumes?.find(v => v.volumeIndex === currentChapter.volumeIndex)
  if (!currentVolume) return ''
  return limitText(`\n\n【当前卷规划（预期走向，不能作为已发生事实）：${currentVolume.title}】\n主题：${currentVolume.theme}\n剧情概要：${currentVolume.summary}`, budget.volume)
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
    const prerequisites = nextNode?.prerequisiteNodeIds?.length ? '；前置节点 ID：' + nextNode.prerequisiteNodeIds.join('、') : ''
    return `• [${arc.type}/${arc.status}/重要度${arc.importance}] ${arc.title}：${arc.description || '暂无描述'}；${formatArcDesign(arc)}${next}${paused}${prerequisites}`
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
    .filter(event => !isActiveGlobalPlan(event) && event.status !== 'resolved' && event.status !== 'abandoned' && event.status !== 'unverified' && event.targetChapter !== undefined)
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
  creationDraft?: CreationDraft,
  canonMutations: CanonMutationRecord[] = [],
  storyMemories: StoryMemoryRecord[] = [],
  knowledgeSnapshot?: KnowledgeBase[],
): WritingContext {
  const knowledge = orderKnowledgeSources(readContextKnowledge(knowledgeSnapshot))
  const sourceWarnings = formatEntitySourceWarnings(novel, currentChapter.chapterIndex)
  novel = withCurrentStoryEntities(novel, currentChapter.chapterIndex)
  const maxContext = contextWindow || 8000
  const characterState = formatCharacterStateContext(novel, canonMutations, currentChapter.chapterIndex,
    { limit: Math.min(6000, Math.floor(maxContext * 0.45)) })
  const cacheKey = JSON.stringify([novel.id, currentChapter.id, contextWindow || 8000])
  const sourceSignature = buildContextSignature(novel, currentChapter, storyMemories, canonMutations, knowledge)
  const signature = sourceSignature + JSON.stringify(getApprovedPlanning(creationDraft, currentChapter.chapterIndex, novel)) + characterState + sourceWarnings
  const cached = contextCache.get(cacheKey)
  if (cached?.signature === signature) return cached.context

  const budget = getContextBudget(contextWindow)
  const chapterIdx = currentChapter.chapterIndex

  const outlineContext = novel.outline ? limitText(novel.outline, budget.outline) : ''
  const volumeContext = buildVolumeContext(novel, currentChapter, budget)
  const storyArcContext = buildStoryArcContext(novel, currentChapter, budget)
  const timelineContext = buildTimelineContext(novel, currentChapter, budget)
  const chapterGuidance = creationDraft ? formatApprovedPlanning(creationDraft, chapterIdx, novel) : formatChapterPlanContext(novel, chapterIdx)
  const chapterTime = projectStoryTime(novel, currentChapter)
  const timeline = projectStoryTimeTimeline(novel, currentChapter.chapterIndex).sort((a, b) => a.chapterIndex - b.chapterIndex)
  const recentTimes = timeline.slice(-3)
  const knownTimes = timeline.filter(item => item.time.known)
  const nearestKnown = knownTimes[knownTimes.length - 1]
  if (nearestKnown && !recentTimes.includes(nearestKnown)) recentTimes.unshift(nearestKnown)
  const unknownTimes = timeline.filter(item => !item.time.known).length
  const priorTimes = recentTimes.map(item => item.time.known
    ? `第${item.chapterIndex + 1}章「${limitText(item.title, 40)}」：故事日 ${item.time.startDay}–${item.time.endDay}${item.time.label ? `（${limitText(item.time.label, 40)}）` : ''}`
    : `第${item.chapterIndex + 1}章「${limitText(item.title, 40)}」：时间来源未知（${limitText(item.time.reason || '待核对', 70)}）`).join('\n')
  const storyClockContext = limitText(`\n\n【按章故事时间】${chapterTime.known
    ? `本章边界为故事日 ${chapterTime.startDay}–${chapterTime.endDay}，本章经过 ${chapterTime.elapsedDays} 天。`
    : `${chapterTime.startDay !== undefined ? `本章已知开始为故事日 ${chapterTime.startDay}；` : '本章开始时间未知；'}本章结束时间未知（${chapterTime.reason || '待作者确认'}），不得从全局最新时钟补值。`}${chapterTime.label ? ` 时间标签：${chapterTime.label}。` : ''}${priorTimes ? `\n前序 ${timeline.length} 章中 ${unknownTimes} 章时间待核对；仅列最近章节及最近有效锚点，未知间隔不能推算：\n${priorTimes}` : ''}`, Math.min(900, Math.floor(maxContext * 0.1)))
  const reconstructionPack = buildReconstructionContextPack(novel, currentChapter, {
    creationDraft,
    canonMutations,
    targetType: 'chapter',
    targetId: currentChapter.id,
    authorInstruction: '写作时优先遵守已确认的结构化故事状态；无法确认的内容只能作为候选，不要自行写入 Canon。',
  })
  // 人物状态已按完整条目限制长度，不能在总预算处把证据或误信说明截成半句。
  const structuredState = [limitText(sourceWarnings, Math.floor(maxContext * 0.05)), characterState,
    formatEventCausalityContext(novel, canonMutations, currentChapter.chapterIndex, Math.min(5000, Math.floor(maxContext * 0.2))),
    limitText(formatReconstructionContextPack({ ...reconstructionPack, characterState: '' }), Math.min(budget.structuredState, Math.floor(maxContext * 0.18)))].filter(Boolean).join('\n\n')

  let lastParagraph = ''
  if (chapterIdx > 0) {
    const prevChapter = novel.chapters.find(c => c.chapterIndex === chapterIdx - 1)
    if (prevChapter && prevChapter.content) {
      lastParagraph = prevChapter.content.slice(-budget.lastParagraph)
    }
  }

  const previousSummary = buildPreviousSummary(novel, chapterIdx, budget, storyMemories)
  const relevanceSource = [currentChapter.title, chapterGuidance, volumeContext, storyArcContext, timelineContext, lastParagraph, previousSummary].join('\n')
  let semanticEvidence = ''

  let characterContext = ''
  const relationships = getRelationshipProjection(novel, canonMutations, chapterIdx, 'before')
  const relevantChars = selectRelevantCharacters(novel, relevanceSource, 12)
  if (relevantChars.length > 0) {
    characterContext = limitText(`\n\n【相关角色库（请严格遵循以下设定，根据剧情安排出场）】\n${relevantChars.map(character => formatCharacter(character, relationships)).join('\n')}`, budget.characters)
  }

  let globalPlanContext = ''
  const activeGlobalPlans = (novel.eventLog || []).filter(isActiveGlobalPlan)
  const activePromises = (novel.eventLog || [])
    .filter(event => event.type === '伏笔' && event.chapterIndex >= 0 && event.chapterIndex < chapterIdx
      && event.status !== 'resolved' && event.status !== 'abandoned' && event.status !== 'unverified')
    .sort((a, b) => (b.lastProgressChapterIndex ?? b.chapterIndex) - (a.lastProgressChapterIndex ?? a.chapterIndex))
  if (activeGlobalPlans.length > 0) {
    const lines = activeGlobalPlans.map(event => {
      const statusLabel = event.status === 'planted' ? '待推进' : '推进中'
      return `• [${statusLabel}] ${event.title}：${event.description}${event.hintCount ? `（已铺垫${event.hintCount}次）` : ''}`
    })
    globalPlanContext = limitText(`\n\n【全书规划（请在合适时机自然推进，不要强行收束）】\n${lines.join('\n')}`, budget.globalPlans)
  }
  if (activePromises.length > 0) {
    const promiseBudget = Math.max(180, Math.floor(budget.timeline * 0.45))
    const lines = activePromises.slice(0, 5).map(event =>
      `• ${event.title}（第${event.chapterIndex + 1}章提出${event.targetChapter !== undefined ? `，预计第${event.targetChapter + 1}章推进` : ''}）：${limitText(event.description, 100)}`)
    globalPlanContext += limitText(`\n\n【尚未兑现的读者期待（保持连续性，不提前兑现）】\n${lines.join('\n')}`, promiseBudget)
  }

  let knowledgeContext = ''
  if (novel.knowledgeBaseIds && novel.knowledgeBaseIds.length > 0) {
    const keywords = splitKeywords([relevanceSource, ...relevantChars.map(c => c.name)].join('\n')).slice(0, 30)
    const relevantEntries = selectKnowledgeEntries(knowledge, novel.knowledgeBaseIds, keywords, 8)
    const entries = relevantEntries.map(entry => {
      const text = entry.summary || entry.content.substring(0, budget.knowledgeEntry)
      return `• [${entry.category}] ${entry.title}：${text}`
    })
    if (entries.length > 0) {
      knowledgeContext = `\n\n【知识库（已按本章相关性筛选，请确保内容一致）】\n${entries.join('\n')}`
    }
    semanticEvidence = formatEvidence(
      retrieveSemanticEvidence(relevanceSource, buildSemanticRecords(novel, knowledge, chapterIdx, storyMemories, canonMutations), 8),
      budget.semanticEvidence, relevanceSource,
    )
  }

  if (!semanticEvidence) {
    semanticEvidence = formatEvidence(
      retrieveSemanticEvidence(relevanceSource, buildSemanticRecords(novel, [], chapterIdx, storyMemories, canonMutations), 8),
      budget.semanticEvidence, relevanceSource,
    )
  }

  const result = {
    outlineContext: limitText('\n\n【V3 结构化故事状态】\n' + structuredState + storyClockContext + outlineContext + volumeContext + storyArcContext + timelineContext + characterContext + globalPlanContext + knowledgeContext + (semanticEvidence ? '\n\n【语义记忆召回】\n' + semanticEvidence : ''), maxContext),
    previousSummary,
    lastParagraph,
    chapterGuidance,
    semanticEvidence,
    structuredState,
  }

  if (contextCache.size >= 4 && !contextCache.has(cacheKey)) contextCache.delete(contextCache.keys().next().value!)
  contextCache.set(cacheKey, { signature, context: result })
  contextSources.set(result, sourceSignature)
  contextCanon.set(result, JSON.parse(JSON.stringify(canonMutations)))
  return result
}

export async function augmentWritingContextWithVectorMemory(
  novel: Novel,
  currentChapter: Chapter,
  context: WritingContext,
  embeddingConfig?: EmbeddingConfig,
  readStoryMemories: () => StoryMemoryRecord[] = () => [],
  readCanon: () => CanonMutationRecord[] = () => contextCanon.get(context) || [],
): Promise<WritingContext> {
  if (!isRemoteEmbeddingEnabled(embeddingConfig)) return context
  const sourceSignature = buildContextSignature(novel, currentChapter, readStoryMemories(), readCanon())
  const originalSource = contextSources.get(context)
  if (originalSource && originalSource !== sourceSignature) throw new SemanticSourceChangedError()
  const query = [
    currentChapter.title,
    context.chapterGuidance,
    context.previousSummary,
    context.lastParagraph,
  ].filter(Boolean).join('\n')
  if (!query.trim()) return context
  try {
    const source = () => {
      let knowledgeBases: ReturnType<typeof useKnowledgeStore>['knowledgeBases'] = []
      try { knowledgeBases = useKnowledgeStore().knowledgeBases } catch { /* no active knowledge store */ }
      return { novel, knowledgeBases, storyMemories: readStoryMemories(), canonMutations: readCanon() }
    }
    const evidence = await queryPersistedSemanticEvidence(source, query, 8, embeddingConfig, undefined, currentChapter.chapterIndex)
    if (buildContextSignature(novel, currentChapter, readStoryMemories(), readCanon()) !== sourceSignature) throw new SemanticSourceChangedError()
    const formatted = formatEvidence(evidence, 1500, query)
    if (!formatted) return context
    const usesRemoteVectors = evidence.some(item => item.retrieval?.method === 'remote')
    const augmented = {
      ...context,
      outlineContext: `${context.outlineContext}\n\n【${usesRemoteVectors ? '向量' : '当前内容'}记忆召回】\n${formatted}`,
      semanticEvidence: formatted,
    }
    contextSources.set(augmented, sourceSignature)
    contextCanon.set(augmented, contextCanon.get(context) || [])
    return augmented
  } catch (error) {
    if (error instanceof SemanticSourceChangedError) throw error
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
  novel = withCurrentStoryEntities(novel, chapterIdx)
  const previousChapter = novel.chapters.find(c => c.chapterIndex === chapterIdx - 1)
  const relevanceSource = [
    currentChapter.title,
    writingContext.chapterGuidance,
    writingContext.previousSummary,
    writingContext.lastParagraph,
  ].join('\n')
  const relevantCharacters = selectRelevantCharacters(novel, relevanceSource, 8)
  const relationships = getRelationshipProjection(novel, contextCanon.get(writingContext) || [], chapterIdx, 'before')
  const recentEvents = (novel.eventLog || [])
    .filter(e => e.chapterIndex < chapterIdx && !isActiveGlobalPlan(e))
    .slice(-8)
    .map(e => `• ${e.chapterIndex < 0 ? '全书规划' : `第${e.chapterIndex + 1}章`} [${e.type}] ${e.title}：${e.description}`)
  const activeGlobalPlans = (novel.eventLog || [])
    .filter(isActiveGlobalPlan)
    .slice(0, 10)
    .map(event => `• [${event.status === 'planted' ? '待推进' : '推进中'}] ${event.title}：${event.description}${event.hintCount ? `（已铺垫${event.hintCount}次）` : ''}`)
  const openPromises = (novel.eventLog || [])
    .filter(event => event.type === '伏笔' && event.chapterIndex >= 0 && event.chapterIndex < chapterIdx
      && event.status !== 'resolved' && event.status !== 'abandoned' && event.status !== 'unverified')
    .sort((a, b) => (b.lastProgressChapterIndex ?? b.chapterIndex) - (a.lastProgressChapterIndex ?? a.chapterIndex))
    .slice(0, 5)
    .map(event => `• ${event.title}：${limitText(event.description, 100)}`)
  const allDataPanels = novel.dataPanels || []
  const relatedData = allDataPanels
    .filter(item => {
      const text = `${item.name}\n${item.relatedKeywords.join('\n')}\n${item.fields.map(f => `${f.name} ${f.value}`).join('\n')}`
      return item.relatedKeywords.some(keyword => relevanceSource.includes(keyword))
        || relevanceSource.includes(item.name)
        || relevantCharacters.some(char => text.includes(char.name) || char.name.includes(item.name))
    })
    .slice(0, 10)
    .map(item => formatDataPanelItem(item, allDataPanels))
  const globalNumericData = allDataPanels
    .filter(item => !relatedData.some(line => line.includes(`] ${item.name}：`)))
    .filter(item => {
      const source = `${item.name}\n${item.fields.map(f => `${f.name} ${f.value} ${f.unit || ''}`).join('\n')}`
      return /(时间|日期|天|日|月|剩余|倒计时|成熟|进度|资源|灵石|数量|库存|等级|境界|阶段|月例|采收)/.test(source)
    })
    .slice(0, 8)
    .map(item => formatDataPanelItem(item, allDataPanels))
  return [
    `【本章写作事实卡】`,
    `章节：第${chapterIdx + 1}章 ${currentChapter.title}`,
    writingContext.chapterGuidance
      ? `章节计划：\n${writingContext.chapterGuidance}`
      : '章节计划：暂无，请严格承接分卷目标和前文推进，不要临时发明重大设定。',
    previousChapter ? `上一章标题：第${previousChapter.chapterIndex + 1}章 ${previousChapter.title}` : '',
    writingContext.lastParagraph ? `上一章结尾：${limitText(writingContext.lastParagraph, 500)}` : '',
    writingContext.previousSummary ? `前文摘要：${limitText(writingContext.previousSummary, 1200)}` : '',
    writingContext.structuredState ? `结构化故事状态：\n${writingContext.structuredState}` : '',
    relevantCharacters.length ? `必须遵守的角色状态：\n${relevantCharacters.map(character => formatCharacter(character, relationships)).join('\n')}` : '',
    recentEvents.length ? `近期已发生事件：\n${recentEvents.join('\n')}` : '',
    activeGlobalPlans.length ? `待推进的全书规划：\n${activeGlobalPlans.join('\n')}` : '',
    openPromises.length ? `尚未兑现的读者期待：\n${openPromises.join('\n')}` : '',
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
  reconstructionPack?: ContextPack,
  creationDraft?: CreationDraft,
  canonMutations: CanonMutationRecord[] = [],
  storyMemories: StoryMemoryRecord[] = [],
  knowledgeSnapshot?: KnowledgeBase[],
): ReviewContext {
  // Review the author's plan for this chapter. Workflow progress and later plans
  // are not evidence that the current manuscript changed. Keep original records intact.
  novel = { ...novel, chapterPlans: (novel.chapterPlans || []).filter(plan => plan.status !== 'archived'
    && plan.targetChapterStart <= currentChapter.chapterIndex && plan.targetChapterEnd >= currentChapter.chapterIndex)
    .map(plan => ({ ...plan, status: 'planned' })) }
  const budget = getContextBudget(contextWindow)
  const writingContext = buildWritingContext(novel, currentChapter, contextWindow, creationDraft, canonMutations, storyMemories, knowledgeSnapshot)
  novel = withCurrentStoryEntities(novel, currentChapter.chapterIndex)
  const reviewSource = [currentChapter.title, writingContext.chapterGuidance, writingContext.previousSummary, chapterContent.slice(0, 1200)].join('\n')
  const relationships = getRelationshipProjection(novel, canonMutations, currentChapter.chapterIndex, 'before')
  const characters = selectRelevantCharacters(novel, reviewSource, 12)
    .map(character => formatCharacter(character, relationships))
    .join('\n') || '暂无角色信息'
  const recentEvents = limitText((novel.eventLog || [])
    .filter(e => e.chapterIndex < currentChapter.chapterIndex && !isActiveGlobalPlan(e))
    .slice(-10)
    .map(e => `${e.chapterIndex < 0 ? '全书规划' : `第${e.chapterIndex + 1}章`} [${e.type}] ${e.title}：${e.description}`)
    .join('\n') || '暂无事件记录', budget.reviewEvents)
  const structuredState = formatReconstructionContextPack(reconstructionPack || buildReconstructionContextPack(novel, currentChapter, {
    creationDraft,
    canonMutations,
    targetType: 'review',
    targetId: currentChapter.id,
    authorInstruction: '审核时只依据正文证据判断；没有证据或作者确认的推断只能标记为未知或候选。',
  }))

  return {
    settings: limitText(JSON.stringify(novel.settings), 1200),
    lengthPolicy: resolveChapterLengthPolicy(novel.chapterLengthPolicy),
    chapterWordCount: countNovelWords(chapterContent),
    style: limitText(JSON.stringify(novel.writingStyle), 500),
    characters: limitText(characters, budget.characters),
    outline: limitText(writingContext.outlineContext, budget.outline + budget.volume),
    chapterGuidance: ['章节：第' + (currentChapter.chapterIndex + 1) + '章 ' + currentChapter.title, writingContext.chapterGuidance, currentChapter.sceneNotes?.length
      ? '本章场景笔记（计划与约束，不能作为已发生事实）：\n' + limitText(currentChapter.sceneNotes
        .map(note => note.title + '：' + note.content).join('\n'), budget.globalPlans) : ''].filter(Boolean).join('\n\n') || '暂无章节计划',
    recentEvents,
    previousSummary: writingContext.previousSummary || '暂无前章总结',
    // Review callers split and track coverage; never silently substitute a prefix for the supplied body.
    chapterContent,
    semanticEvidence: writingContext.semanticEvidence || '暂无可引用证据',
    structuredState: [structuredState, formatEventCausalityContext(novel, canonMutations, currentChapter.chapterIndex)].filter(Boolean).join('\n\n'),
  }
}
