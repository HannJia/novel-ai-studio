import { eventCausalitySemanticRecords } from './eventCausalitySemantic'
import { formatArcDesign } from './storyArcEditing'
import { getCurrentChapterSummary } from '@/services/derivedSources'
import type { StoryMemoryRecord } from '@/types/storyMemory'
import { getStoryMemoryStatus, resolveStoryMemorySource } from './storyMemory'
import { withCurrentStoryEntities } from './effectiveStory'
import { getRelationshipProjection, type RelationshipProjectionEdge } from './relationshipProjection'
import { characterStateEvidenceIssue, getCharacterStateSnapshot, getPropositionCatalog, knowledgeStateLabels } from './reconstructionCharacterState'
import { describeProposition, propositionOf, relationshipDimensionLabel } from './characterMemoryIdentity'
import { buildSemanticMemoryGraph, expandSemanticMemoryGraph, formatSemanticGraphHop, type SemanticGraphPathHop } from './semanticMemoryGraph'
import { getEntityHistory } from './entityProvenance'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import type { EntityKind, EntityProvenance } from '@/types/entityProvenance'
import type { EvidenceRef } from '@/types/reconstruction'
import type { CanonMutationRecord } from '@/types/reconstruction'
import type { MemoryKnowledgeEdge } from '@/types/characterMemory'
import { entrySourceVersion, getCurrentEntrySummary } from './knowledgeSources'
import type { Novel, Chapter, Character, EventLogEntry, DataPanelItem, ChapterPlanHorizon, ChapterPlanStatus, StoryArcType, StoryArcStatus, StoryArcNode } from '@/types/novel'
import type { KnowledgeBase } from '@/stores/knowledge'
import type { EmbeddingConfig } from '@/stores/config'
import { execute, initDb, queryAll, runTransaction } from '@/services/database'
import { embedTextsWithProvider, embeddingSourceId, isRemoteEmbeddingEnabled } from '@/services/embeddings'
import { equipmentSnapshot, formatEquipmentTotals } from '@/services/dataPanelEquipment'

export type SemanticSourceType = 'knowledge' | 'chapter' | 'character' | 'event' | 'story_arc' | 'chapter_plan' | 'data_panel' | 'story_memory'

// These descriptions are displayed in search results as well as embedded.
// Machine-readable states remain in metadata for filtering and source checks.
const planHorizonLabels: Record<ChapterPlanHorizon, string> = { next: '下一章', near: '近期', far: '远期' }
const planStatusLabels: Record<ChapterPlanStatus, string> = { planned: '待执行', active: '进行中', awaiting_review: '待核对', completed: '已完成', archived: '已归档' }
const arcTypeLabels: Record<StoryArcType, string> = { main: '主线', sub: '支线', character: '角色成长', relationship: '关系线', mystery: '悬念线', world: '世界线' }
const arcStatusLabels: Record<StoryArcStatus, string> = { active: '推进中', paused: '暂停', completed: '已完成', abandoned: '已放弃', unverified: '待核对' }
const nodeStatusLabels: Record<StoryArcNode['status'], string> = { pending: '计划节点', completed: '已完成', abandoned: '已放弃', unverified: '待核对' }
const eventStatusLabels: Record<NonNullable<EventLogEntry['status']>, string> = { planted: '已埋下', developing: '推进中', resolved: '已兑现', abandoned: '已放弃', unverified: '待核对' }

export interface SemanticRecord {
  id: string
  novelId: string
  sourceType: SemanticSourceType
  sourceId: string
  title: string
  content: string
  metadata?: Record<string, unknown>
}

export interface SemanticEvidence extends SemanticRecord {
  score: number
  citation: string
  retrieval?: { method: 'remote' | 'local'; indexed: boolean }
  graphDistance?: number
  path?: SemanticGraphPathHop[]
}

// Read on demand so a request cannot retain a replaced book or knowledge array.
export type SemanticMemorySource = () => { novel: Novel; knowledgeBases: KnowledgeBase[]; storyMemories?: StoryMemoryRecord[]; canonMutations?: CanonMutationRecord[] }

export class SemanticSourceChangedError extends Error {
  constructor() {
    super('记忆来源在请求期间发生变化，请使用当前内容重新执行。')
    this.name = 'SemanticSourceChangedError'
  }
}

export interface SemanticSyncResult {
  recordCount: number
  provider: 'remote' | 'local'
  model: string
  dimensions: number
  embeddedCount: number
  updatedCount: number
  removedCount: number
  unchangedCount: number
}

export interface SemanticIndexInfo {
  recordCount: number
  provider: 'remote' | 'local'
  model: string
  dimensions: number
  updatedAt: string
}

const VECTOR_SIZE = 192

function tokenize(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
  const words = normalized.split(/\s+/).filter(Boolean)
  const cjk = Array.from(normalized.replace(/[^\p{Script=Han}]/gu, ''))
  const grams: string[] = []
  for (let i = 0; i < cjk.length - 1; i++) grams.push(cjk.slice(i, i + 2).join(''))
  return [...words, ...grams].filter(token => token.length >= 2)
}

function hashToken(token: string): number {
  let hash = 2166136261
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash)
}

function embedText(text: string): number[] {
  const vector = Array.from({ length: VECTOR_SIZE }, () => 0)
  for (const token of tokenize(text)) {
    const idx = hashToken(token) % VECTOR_SIZE
    vector[idx] += 1
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1
  return vector.map(value => Number((value / norm).toFixed(6)))
}

function cosine(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length)
  let dot = 0
  for (let i = 0; i < len; i++) dot += a[i] * b[i]
  return dot
}

function lexicalRelevance(terms: string[], text: string): number {
  if (terms.length === 0) return 0
  const normalized = text.toLowerCase()
  const matched = terms.filter(term => normalized.includes(term)).length
  return matched / terms.length
}

function relevanceScore(queryTerms: string[], queryVector: number[], record: SemanticRecord, vector?: number[]): number {
  const text = `${record.title}\n${record.content}`
  const candidateVector = vector || embedText(text)
  const semantic = queryVector.length > 0 && queryVector.length === candidateVector.length
    ? cosine(queryVector, candidateVector)
    : 0
  const lexical = lexicalRelevance(queryTerms, text)
  const titleBoost = lexicalRelevance(queryTerms, record.title) * 0.12
  return Math.min(1, semantic * 0.68 + lexical * 0.32 + titleBoost)
}

function compact(text: string, limit = 900): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, limit)
}

export function splitMemoryText(text: string, maxLength = 800, overlap = 120): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').trim()
  if (!normalized) return []
  const safeMax = Math.max(200, maxLength)
  const safeOverlap = Math.min(Math.max(0, overlap), Math.floor(safeMax / 3))
  const chunks: string[] = []
  let cursor = 0
  while (cursor < normalized.length) {
    let end = Math.min(normalized.length, cursor + safeMax)
    if (end < normalized.length) {
      const segment = normalized.slice(cursor, end)
      const boundary = Math.max(segment.lastIndexOf('\n\n'), segment.lastIndexOf('。'), segment.lastIndexOf('！'), segment.lastIndexOf('？'))
      if (boundary >= Math.floor(safeMax * 0.55)) end = cursor + boundary + 1
    }
    const chunk = normalized.slice(cursor, end).trim()
    if (chunk) chunks.push(chunk)
    if (end >= normalized.length) break
    cursor = Math.max(cursor + 1, end - safeOverlap)
  }
  return chunks
}

// Offsets refer to the original body, including CRLF and leading whitespace.
function chapterSpans(text: string): Array<{ content: string; startOffset: number; endOffset: number }> {
  const spans: Array<{ content: string; startOffset: number; endOffset: number }> = []
  let cursor = 0
  while (cursor < text.length) {
    let end = Math.min(text.length, cursor + 800)
    if (end < text.length) {
      const part = text.slice(cursor, end)
      const boundary = Math.max(part.lastIndexOf('\n\n'), part.lastIndexOf('。'), part.lastIndexOf('！'), part.lastIndexOf('？'))
      if (boundary >= 440) end = cursor + boundary + 1
    }
    const raw = text.slice(cursor, end), left = raw.length - raw.trimStart().length
    const content = raw.trim()
    if (content) spans.push({ content, startOffset: cursor + left, endOffset: cursor + left + content.length })
    if (end === text.length) break
    cursor = Math.max(cursor + 1, end - 120)
  }
  return spans
}

function chapterRecords(novelId: string, chapter: Chapter): SemanticRecord[] {
  const records: SemanticRecord[] = []
  const sourceVersionId = buildAnalysisSourceVersionId(chapter.content)
  const baseTitle = `第${chapter.chapterIndex + 1}章 ${chapter.title}`
  const summary = getCurrentChapterSummary(chapter)
  if (summary.trim()) {
    records.push({
      id: `${novelId}:chapter:${chapter.id}:summary`,
      novelId,
      sourceType: 'chapter',
      sourceId: chapter.id,
      title: `${baseTitle} 摘要`,
      content: compact(summary),
      metadata: { chapterIndex: chapter.chapterIndex, status: chapter.status, chunkType: 'summary', sourceVersionId: chapter.summarySource?.sourceVersionId },
    })
  }
  for (const [index, span] of chapterSpans(chapter.content).entries()) {
    records.push({
      id: `${novelId}:chapter:${chapter.id}:chunk:${index}`,
      novelId,
      sourceType: 'chapter',
      sourceId: chapter.id,
      title: `${baseTitle} 片段${index + 1}`,
      content: span.content,
      metadata: { chapterIndex: chapter.chapterIndex, status: chapter.status, chunkType: 'content', chunkIndex: index, startOffset: span.startOffset, endOffset: span.endOffset, sourceVersionId },
    })
  }
  return records
}

function characterRecord(novel: Novel, character: Character, relationships: RelationshipProjectionEdge[]): SemanticRecord {
  const novelId = novel.id
  relationships = [...relationships].sort((a, b) => a.target.id.localeCompare(b.target.id) || a.relation.localeCompare(b.relation))
  const relations = relationships.map(edge => `${edge.target.name}｜${edge.dimensionLabel}:${edge.relation}（${edge.origin === 'author' ? '作者基础设定' : '正文已确认'}）`).join('；')
  const content = [
    character.name,
    character.aliases?.join('、'),
    character.identity,
    character.personality,
    character.powerLevel,
    character.faction,
    character.description,
    relations,
    character.events?.join('；'),
  ].filter(Boolean).join('\n')
  return {
    id: `${novelId}:character:${character.id}`,
    novelId,
    sourceType: 'character',
    sourceId: character.id,
    title: `角色 ${character.name}`,
    content: compact(content),
    metadata: { characterId: character.id, status: character.status, firstAppearChapter: character.firstAppearChapter, relationshipSources: relationships.map(edge => ({ targetId: edge.target.id, dimension: edge.dimension, origin: edge.origin, chapterId: edge.chapterId, chapterIndex: edge.chapterId ? novel.chapters.find(chapter => chapter.id === edge.chapterId)?.chapterIndex : undefined, relation: edge.relation, evidence: edge.evidence })) },
  }
}

function characterStateRecords(novel: Novel, canonMutations: CanonMutationRecord[], beforeChapterIndex?: number): SemanticRecord[] {
  const boundary = beforeChapterIndex === undefined ? 'through' : 'before'
  const boundaryIndex = beforeChapterIndex ?? novel.chapters.reduce((maximum, chapter) => Math.max(maximum, chapter.chapterIndex), -1)
  const snapshot = getCharacterStateSnapshot(novel, canonMutations, boundaryIndex, boundary)
  const characterName = (id: string) => novel.characters.find(character => character.id === id)?.name || '已删除角色'
  const evidenceText = (evidence: { quote?: string; label?: string }[]) => evidence.map(item => item.quote || item.label || '').filter(Boolean).join('；')
  const records: SemanticRecord[] = []
  for (const entry of getPropositionCatalog(novel, canonMutations, boundaryIndex, boundary)) {
    const proposition = entry.proposition, ref = entry.evidence[0]
    records.push({ id: novel.id + ':proposition:' + encodeURIComponent(proposition.id), novelId: novel.id, sourceType: 'character', sourceId: 'proposition:' + proposition.id,
      title: '命题身份：' + proposition.text,
      content: ['命题身份登记（不表示命题客观成立；须结合人物态度和证据）', describeProposition(proposition), '命题文字：' + proposition.text, '当前等价身份：' + entry.canonicalId, evidenceText(entry.evidence)].join('\n'),
      metadata: { stateKind: 'proposition', factId: proposition.id, projectedFactId: entry.canonicalId, proposition, subjectId: proposition.subjectId, objectId: proposition.objectId,
        cognitiveNote: '命题身份不等于客观事实；人物态度和冲突独立保留', sourceChapterId: ref?.sourceId, chapterIndex: novel.chapters.find(chapter => chapter.id === ref?.sourceId)?.chapterIndex, evidence: entry.evidence } })
  }
  for (const item of snapshot.propositionDecisions) {
    // A stale source is never a retrievable graph edge. A current-source decision
    // whose selected identity expired remains readable as an inactive decision.
    if (characterStateEvidenceIssue(novel, item.record) || item.record.characterState?.kind !== 'knowledge') continue
    const state = item.record.characterState.after as MemoryKnowledgeEdge, decision = state.propositionDecision!
    records.push({ id: novel.id + ':proposition-decision:' + encodeURIComponent(decision.id), novelId: novel.id, sourceType: 'character', sourceId: decision.id,
      title: '作者命题身份决定：' + (item.active ? '有效' : '已停用'),
      content: [decision.fromIds.join('、') + ' → ' + decision.targetId, item.active ? '作者明确确认等价；不同认知仍保留。' : '已停用：' + item.issue + '；恢复原身份。',
        '作者说明：' + (decision.reason || '明确引用已有命题'), decision.resolvedStateIds?.length ? '作者明确处理旧认知：' + decision.resolvedStateIds.join('、') + '；历史保留。' : '', evidenceText(decision.evidence)].filter(Boolean).join('\n'),
      metadata: { stateKind: 'proposition_decision', decisionActive: item.active, propositionDecision: decision, characterId: state.characterId,
        cognitiveNote: '作者身份决定（非事实因果；不自动消除相反认知）', sourceChapterId: item.record.chapterId, chapterIndex: decision.chapterIndex, evidence: decision.evidence } })
  }
  for (const state of snapshot.knowledge) {
    const chapterId = state.evidence[0]?.sourceId
    records.push({
      id: `${novel.id}:character-state:${state.id}`,
      novelId: novel.id,
      sourceType: 'character',
      sourceId: state.id,
      title: `角色 ${characterName(state.characterId)} 的知情状态`,
      content: [characterName(state.characterId), knowledgeStateLabels[state.state] + '（角色认知，不代表客观事实）', '命题：' + state.fact, describeProposition(propositionOf(state)),
        state.projectedFactId !== state.factId ? '当前等价身份：' + state.projectedFactId : '', state.conflictGroupId ? '存在并列冲突认知，不能选取一条作为统一事实。' : '',
        state.belief ? `角色误信：${state.belief}（不代表客观事实）` : '', state.learnedFrom ? `获知途径：${state.learnedFrom}` : '', evidenceText(state.evidence)].filter(Boolean).join('\n'),
      metadata: { stateKind: 'knowledge', characterId: state.characterId, factId: state.factId, proposition: propositionOf(state), projectedFactId: state.projectedFactId, conflictGroupId: state.conflictGroupId, propositionDecision: state.propositionDecision, knowledgeState: state.state, belief: state.belief, chapterIndex: state.knownSinceChapter, sourceChapterId: chapterId, evidence: state.evidence, firstAppearChapter: novel.characters.find(character => character.id === state.characterId)?.firstAppearChapter },
    })
  }
  for (const state of snapshot.relationships) {
    const chapterId = state.evidence[0]?.sourceId
    records.push({
      id: `${novel.id}:character-state:${state.id}`,
      novelId: novel.id,
      sourceType: 'character',
      sourceId: state.id,
      title: `角色 ${characterName(state.characterId)} → ${characterName(state.targetCharacterId)} 的关系状态`,
      content: [characterName(state.characterId), relationshipDimensionLabel(state.dimension), state.relation, characterName(state.targetCharacterId), state.description, evidenceText(state.evidence)].filter(Boolean).join('\n'),
      metadata: { stateKind: 'relationship', dimension: state.dimension, dimensionLabel: relationshipDimensionLabel(state.dimension), characterId: state.characterId, targetCharacterId: state.targetCharacterId, relation: state.relation, chapterIndex: state.sinceChapter, sourceChapterId: chapterId, evidence: state.evidence, firstAppearChapter: novel.characters.find(character => character.id === state.characterId)?.firstAppearChapter },
    })
  }
  return records
}

function eventRecord(novelId: string, event: EventLogEntry): SemanticRecord {
  return {
    id: `${novelId}:event:${event.id}`,
    novelId,
    sourceType: 'event',
    sourceId: event.id,
    title: `事件 ${event.title}`,
    content: compact([
      event.title,
      event.description,
      event.characters?.join('、'),
      event.type,
      event.status ? eventStatusLabels[event.status] : undefined,
      event.storyTime,
      event.location,
    ].filter(Boolean).join('\n')),
    metadata: {
      chapterIndex: event.chapterIndex,
      targetChapter: event.targetChapter,
      type: event.type,
      status: event.status,
      importance: event.importance,
      relatedArcIds: event.relatedArcIds || [],
      characters: event.characters || [],
    },
  }
}

function storyArcRecord(novelId: string, arc: NonNullable<Novel['storyArcs']>[number]): SemanticRecord {
  const nodeLines = (arc.nodes || []).map(node => {
    const chapter = node.actualChapter ?? node.targetChapter
    return `${node.status === 'completed' && node.actualChapter !== undefined ? '确认发生' : '计划'}第${chapter + 1}章 ${node.title} ${node.description} [${nodeStatusLabels[node.status]}] 前置节点：${(node.prerequisiteNodeIds || []).join('、')} 后续事件：${(node.consequenceEventIds || []).join('、')}`
  })
  return {
    id: `${novelId}:story_arc:${arc.id}`,
    novelId,
    sourceType: 'story_arc',
    sourceId: arc.id,
    title: `弧线 ${arc.title}`,
    content: compact([
      arcTypeLabels[arc.type],
      arcStatusLabels[arc.status],
      arc.description,
      arc.reactivateAt,
      formatArcDesign(arc),
      ...nodeLines,
    ].filter(Boolean).join('\n')),
    metadata: {
      type: arc.type, status: arc.status, importance: arc.importance,
      characterIds: arc.characterIds || [], dependencyArcIds: arc.dependencyArcIds || [], turningPointEventIds: arc.turningPointEventIds || [],
      nodes: (arc.nodes || []).map(node => ({ id: node.id, title: node.title, targetChapter: node.targetChapter, actualChapter: node.actualChapter, status: node.status, prerequisiteNodeIds: [...(node.prerequisiteNodeIds || [])].sort(), consequenceEventIds: [...(node.consequenceEventIds || [])].sort() })),
    },
  }
}

function chapterPlanRecord(novelId: string, plan: NonNullable<Novel['chapterPlans']>[number]): SemanticRecord {
  return {
    id: `${novelId}:chapter_plan:${plan.id}`,
    novelId,
    sourceType: 'chapter_plan',
    sourceId: plan.id,
    title: `章节计划 ${plan.title}`,
    content: compact([
      planHorizonLabels[plan.horizon],
      planStatusLabels[plan.status],
      `第${plan.targetChapterStart + 1}-${plan.targetChapterEnd + 1}章`,
      plan.objective,
      plan.summary,
      ...plan.beats,
    ].filter(Boolean).join('\n')),
    metadata: {
      horizon: plan.horizon,
      status: plan.status,
      targetChapterStart: plan.targetChapterStart,
      targetChapterEnd: plan.targetChapterEnd,
      relatedArcIds: plan.relatedArcIds || [],
      relatedEventIds: plan.relatedEventIds || [],
    },
  }
}

function dataPanelRecord(novelId: string, item: DataPanelItem, items: DataPanelItem[]): SemanticRecord {
  const fields = item.fields.map(field => `${field.name}:${field.value}${field.unit || ''}`).join('；')
  return {
    id: `${novelId}:data_panel:${item.id}`,
    novelId,
    sourceType: 'data_panel',
    sourceId: item.id,
    title: `数据 ${item.name}`,
    content: compact([item.category, item.name, fields, item.relatedKeywords.join('、'),
      item.ownerItemId ? equipmentSnapshot(item, items) : '',
      formatEquipmentTotals(items, item.id),
    ].join('\n')),
    metadata: { category: item.category, lastMentionChapterIndex: item.lastMentionChapterIndex },
  }
}

function knowledgeRecords(novelId: string, kb: KnowledgeBase, entry: KnowledgeBase['entries'][number]): SemanticRecord[] {
  const id = novelId + ':knowledge:' + kb.id + ':' + entry.id
  const title = '知识库/' + kb.name + '/' + entry.title
  const metadata = { kbId: kb.id, category: entry.category, tags: entry.tags, sourceVersionId: entrySourceVersion(kb.id, entry) }
  const records: SemanticRecord[] = splitMemoryText(entry.content).map((content, index) => ({
    id: index === 0 ? id : id + ':chunk:' + index, novelId, sourceType: 'knowledge', sourceId: entry.id,
    title: title + ' 原文片段' + (index + 1), content, metadata: { ...metadata, chunkType: 'content', chunkIndex: index },
  }))
  // A compressed summary cannot replace the source evidence it may omit.
  splitMemoryText(getCurrentEntrySummary(kb.id, entry)).forEach((content, index) => records.push({
    id: id + ':summary:' + index, novelId, sourceType: 'knowledge', sourceId: entry.id,
    title: title + ' 摘要' + (index + 1), content, metadata: { ...metadata, chunkType: 'summary', chunkIndex: index },
  }))
  return records
}

export function isSemanticRecordBeforeChapter(record: Pick<SemanticRecord, 'sourceType' | 'metadata'>, chapterIndex: number): boolean {
  if (record.metadata?.stateKind === 'evidence') {
    const index = record.metadata.chapterIndex
    return typeof index === 'number' && index >= 0 && index < chapterIndex
  }
  if (record.sourceType === 'story_memory') {
    const last = record.metadata?.throughChapterIndex
    return typeof last === 'number' && last >= 0 && last < chapterIndex
  }
  if (record.sourceType === 'chapter' || record.sourceType === 'event') {
    const sourceIndex = record.metadata?.chapterIndex
    return typeof sourceIndex === 'number' && sourceIndex >= 0 && sourceIndex < chapterIndex
  }
  if (record.sourceType === 'character') {
    const stateChapter = record.metadata?.stateKind ? record.metadata?.chapterIndex : undefined
    if (typeof stateChapter === 'number') return stateChapter >= 0 && stateChapter < chapterIndex
    const first = record.metadata?.firstAppearChapter
    return typeof first === 'number' && first < chapterIndex
  }
  if (record.sourceType === 'story_arc') {
    const nodes = Array.isArray(record.metadata?.nodes) ? record.metadata?.nodes as Array<Record<string, unknown>> : []
    return nodes.length === 0 || nodes.some(node => typeof (node.actualChapter ?? node.targetChapter) === 'number' && Number(node.actualChapter ?? node.targetChapter) < chapterIndex)
  }
  if (record.sourceType === 'chapter_plan') {
    const target = record.metadata?.targetChapterStart
    return typeof target !== 'number' || target < chapterIndex
  }
  return true
}

// Source validity is established here, before records enter either retrieval route.
// No fuzzy quote match or default chunk is allowed for formal evidence.
function resolvedEvidence(novel: Novel, ref: Partial<EvidenceRef>, beforeChapterIndex?: number): EvidenceRef | undefined {
  const chapter = novel.chapters.find(c => c.id === ref.sourceId)
  if (!chapter || ref.sourceType !== 'chapter' || !ref.quote?.trim()
    || (beforeChapterIndex !== undefined && chapter.chapterIndex >= beforeChapterIndex)
    || ref.sourceVersionId !== buildAnalysisSourceVersionId(chapter.content)) return undefined
  const start = ref.startOffset ?? chapter.content.indexOf(ref.quote)
  const end = ref.endOffset ?? start + ref.quote.length
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start
    || chapter.content.slice(start, end) !== ref.quote
    || (ref.startOffset === undefined && start !== chapter.content.lastIndexOf(ref.quote))) return undefined
  return { ...ref, id: ref.id || chapter.id + ':' + start + ':' + end, sourceType: 'chapter', sourceId: chapter.id, startOffset: start, endOffset: end }
}

function appendEvidenceRecords(novel: Novel, records: SemanticRecord[], beforeChapterIndex?: number) {
  const recordIds = new Set(records.map(record => record.id))
  const append = (owner: SemanticRecord, refs: Partial<EvidenceRef>[], suffix: string, note = '', nodeId?: string): string[] => {
    const result: string[] = []
    for (const raw of refs) {
      const ref = resolvedEvidence(novel, raw, beforeChapterIndex)
      if (!ref) continue
      const chapter = novel.chapters.find(c => c.id === ref.sourceId)!
      const id = owner.id + ':evidence:' + suffix + ':' + ref.sourceId + ':' + ref.startOffset + ':' + ref.endOffset
      if (!recordIds.has(id)) records.push({ id, novelId: novel.id, sourceType: owner.sourceType, sourceId: id,
        title: owner.title + ' · 来源证据', content: (note ? note + '\n' : '') + ref.quote,
        metadata: { stateKind: 'evidence', ownerRecordId: nodeId ? undefined : owner.id, ownerSourceId: owner.sourceId, ownerSourceType: owner.sourceType,
          nodeId, chapterIndex: chapter.chapterIndex, sourceChapterId: chapter.id, sourceVersionId: ref.sourceVersionId,
          startOffset: ref.startOffset, endOffset: ref.endOffset, evidence: [ref], cognitiveNote: note || undefined } })
      recordIds.add(id)
      result.push(id)
    }
    return result.sort()
  }
  const entityEvidence = (owner: SemanticRecord, kind: EntityKind, entity: { id: string; provenance?: EntityProvenance }, nodeId?: string): string[] => {
    const history = getEntityHistory(novel, kind, entity).map((item, index) => ({ ...item, index }))
    // Match formal projection: latest author baseline, then chapter/quote order.
    const latest = new Map<string, typeof history[number]>()
    const fields = new Set(history.flatMap(item => item.revision.changes.map(change => change.field)))
    for (const field of fields) {
      const writes = history.filter(item => item.revision.changes.some(change => change.field === field))
      const authors = writes.filter(item => item.revision.source.kind === 'author')
      const author = authors[authors.length - 1]
      if (author) latest.set(field, author)
      const chapterWrites = writes.filter(item => item.revision.source.kind === 'chapter' && (!author || item.index > author.index))
        .filter(item => item.revision.source.kind === 'chapter' && (beforeChapterIndex === undefined || item.revision.source.chapterIndex < beforeChapterIndex))
        .sort((a, b) => {
          const sa = a.revision.source, sb = b.revision.source
          if (sa.kind !== 'chapter' || sb.kind !== 'chapter') return a.index - b.index
          const offset = (refs: typeof sa.evidence) => Math.min(...refs.map(ref => ref.startOffset ?? Infinity))
          return sa.chapterIndex - sb.chapterIndex || offset(sa.evidence) - offset(sb.evidence)
            || a.revision.appliedAt.localeCompare(b.revision.appliedAt) || a.index - b.index
        })
      for (const item of chapterWrites) {
        const source = item.revision.source
        const replacedStaleVersion = item.issue?.includes('source_version_mismatch') && source.kind === 'chapter'
          && writes.some(other => !other.issue && other.index > item.index && other.revision.source.kind === 'chapter' && other.revision.source.chapterId === source.chapterId)
        if (!replacedStaleVersion) latest.set(field, item)
      }
    }
    const selected = new Map<string, typeof history[number]>()
    for (const [field, item] of latest) {
      const change = item.revision.changes.find(c => c.field === field)
      if (!item.issue && change && stableSerialize((entity as unknown as Record<string, unknown>)[field]) === stableSerialize(change.after)) selected.set(item.revision.id, item)
    }
    return [...selected.values()].flatMap(item => {
      const source = item.revision.source
      if (source.kind !== 'chapter') return []
      return append(owner, source.evidence.map(ref => ({ ...ref, sourceType: 'chapter', sourceId: source.chapterId, sourceVersionId: source.sourceVersionId })), item.revision.id, '', nodeId)
    })
  }
  for (const record of [...records]) {
    const m = record.metadata || {}
    if (m.stateKind === 'knowledge' || m.stateKind === 'relationship' || m.stateKind === 'proposition' || m.stateKind === 'proposition_decision') {
      append(record, (m.evidence || []) as EvidenceRef[], 'state', m.stateKind === 'knowledge'
        ? cognitionLabel(record) : m.stateKind === 'relationship' ? '单向人物关系证据，不可自动反推' : String(m.cognitiveNote))
      continue
    }
    if (record.sourceType === 'character') {
      const entity = novel.characters.find(c => c.id === record.sourceId)
      if (entity) entityEvidence(record, 'character', entity)
    } else if (record.sourceType === 'event') {
      const entity = novel.eventLog.find(e => e.id === record.sourceId)
      if (entity) entityEvidence(record, 'event', entity)
    } else if (record.sourceType === 'story_arc') {
      const entity = novel.storyArcs?.find(a => a.id === record.sourceId)
      if (!entity) continue
      entityEvidence(record, 'arc', entity)
      for (const node of entity.nodes) {
        const nodeMeta = (m.nodes as Array<Record<string, unknown>>).find(n => n.id === node.id)
        if (nodeMeta) nodeMeta.evidenceRecordIds = entityEvidence(record, 'arc_node', node, node.id)
      }
    }
  }
}

export function buildSemanticRecords(novel: Novel, knowledgeBases: KnowledgeBase[] = [], beforeChapterIndex?: number, storyMemories: StoryMemoryRecord[] = [], canonMutations: CanonMutationRecord[] = []): SemanticRecord[] {
  novel = withCurrentStoryEntities(novel, beforeChapterIndex)
  const relationships = getRelationshipProjection(novel, canonMutations, beforeChapterIndex, beforeChapterIndex === undefined ? 'through' : 'before')
  const records: SemanticRecord[] = []
  for (const memory of storyMemories) {
    if (getStoryMemoryStatus(novel, memory) !== 'current') continue
    const source = resolveStoryMemorySource(novel, memory.scope)
    if (beforeChapterIndex !== undefined && source.throughChapterIndex >= beforeChapterIndex) continue
    records.push({ id: novel.id + ':story-memory:' + memory.id, novelId: novel.id, sourceType: 'story_memory', sourceId: memory.id,
      title: source.label + ' · ' + memory.title, content: memory.summary, metadata: {
        throughChapterIndex: source.throughChapterIndex, scope: memory.scope, sourceVersionId: source.versionId,
        chapterIds: source.chapters.map(chapter => chapter.chapterId),
      } })
  }
  for (const chapter of novel.chapters || []) {
    if (beforeChapterIndex !== undefined && chapter.chapterIndex >= beforeChapterIndex) continue
    records.push(...chapterRecords(novel.id, chapter))
  }
  records.push(...(novel.characters || []).map(character => characterRecord(novel, character, relationships.edges.filter(edge => edge.source.id === character.id))))
  records.push(...characterStateRecords(novel, canonMutations, beforeChapterIndex))
  for (const edge of relationships.edges.filter(edge => edge.origin === 'author')) {
    const id = novel.id + ':author-relationship:' + encodeURIComponent(JSON.stringify([edge.source.id, edge.target.id, edge.dimension, edge.relation]))
    records.push({ id, novelId: novel.id, sourceType: 'character', sourceId: id,
      title: '角色 ' + edge.source.name + ' → ' + edge.target.name + ' 的作者关系设定',
      content: [edge.source.name + ' → ' + edge.target.name, edge.dimensionLabel, edge.relation, edge.description, '作者基础设定；单向关系，不能自动反推。'].filter(Boolean).join('\n'),
      metadata: { stateKind: 'relationship', dimension: edge.dimension, dimensionLabel: edge.dimensionLabel, origin: 'author', characterId: edge.source.id, targetCharacterId: edge.target.id, relation: edge.relation, firstAppearChapter: Math.max(edge.source.firstAppearChapter, edge.target.firstAppearChapter) } })
  }
  records.push(...(novel.eventLog || []).map(event => eventRecord(novel.id, event)))
  records.push(...(novel.storyArcs || []).map(arc => storyArcRecord(novel.id, { ...arc, nodes: arc.nodes.filter(node =>
    !['abandoned', 'unverified'].includes(node.status) && (beforeChapterIndex === undefined
      || (node.actualChapter ?? node.targetChapter) < beforeChapterIndex)).sort((a, b) => a.id.localeCompare(b.id)) })))
  records.push(...(novel.chapterPlans || []).map(plan => chapterPlanRecord(novel.id, plan)))
  records.push(...(novel.dataPanels || []).map(item => dataPanelRecord(novel.id, item, novel.dataPanels)))

  const boundIds = new Set(novel.knowledgeBaseIds || [])
  for (const kb of knowledgeBases) {
    if (!boundIds.has(kb.id)) continue
    for (const entry of kb.entries || []) records.push(...knowledgeRecords(novel.id, kb, entry))
  }
  appendEvidenceRecords(novel, records, beforeChapterIndex)
  records.push(...eventCausalitySemanticRecords(novel, canonMutations, beforeChapterIndex))
  const visible = records.filter(record => record.content.trim().length > 0
    && (beforeChapterIndex === undefined || isSemanticRecordBeforeChapter(record, beforeChapterIndex)))
  return uniqueSemanticRecords(visible)
}

function uniqueSemanticRecords(records: SemanticRecord[]): SemanticRecord[] {
  const ordered = [...records].sort((a, b) => a.id.localeCompare(b.id) || stableSerialize(a).localeCompare(stableSerialize(b)))
  return [...new Map(ordered.reverse().map(record => [record.id, record])).values()].sort((a, b) => a.id.localeCompare(b.id))
}

function citationFor(record: SemanticRecord): string {
  if (record.sourceType === 'story_memory') return `已写故事回顾：${record.title}`
  if (record.sourceType === 'chapter') return `章节：${record.title}`
  if (record.sourceType === 'knowledge') return `知识：${record.title}`
  if (record.sourceType === 'character') return `角色：${record.title.replace(/^角色\s*/, '')}`
  if (record.sourceType === 'event') return `事件：${record.title.replace(/^事件\s*/, '')}`
  if (record.sourceType === 'story_arc') return `弧线：${record.title.replace(/^弧线\s*/, '')}`
  if (record.sourceType === 'chapter_plan') return `计划：${record.title.replace(/^章节计划\s*/, '')}`
  return `数据：${record.title.replace(/^数据\s*/, '')}`
}

export function retrieveSemanticEvidence(
  query: string,
  records: SemanticRecord[],
  maxResults = 8,
  minScore = 0.08,
  options: { beforeChapterIndex?: number; sourceType?: SemanticSourceType } = {},
): SemanticEvidence[] {
  const queryVector = embedText(query)
  const queryTerms = Array.from(new Set(tokenize(query)))
  const candidates = uniqueSemanticRecords(records)
  const direct = candidates
    .filter(record => (!options.sourceType || record.sourceType === options.sourceType)
      && (options.beforeChapterIndex === undefined || isSemanticRecordBeforeChapter(record, options.beforeChapterIndex)))
    .map(record => ({
      ...record,
      score: relevanceScore(queryTerms, queryVector, record),
      citation: citationFor(record),
    }))
    .filter(record => record.score >= minScore)
    .sort(compareEvidence)
  return expandAndRankSemanticEvidence(query, candidates, direct, maxResults, options)
}

/** Author-confirmed causal hops are the highest-precision multi-hop relation; they get the expansion slots first. */
function causalPath(path: SemanticEvidence['path']): boolean {
  return !!path?.length && path.every(hop => hop.type.startsWith('event_'))
}

function compareEvidence(a: SemanticEvidence, b: SemanticEvidence): number {
  return b.score - a.score || (a.graphDistance || 0) - (b.graphDistance || 0) || a.id.localeCompare(b.id)
}

function expandAndRankSemanticEvidence(query: string, records: SemanticRecord[], direct: SemanticEvidence[], maxResults: number, options: { beforeChapterIndex?: number; sourceType?: SemanticSourceType } = {}): SemanticEvidence[] {
  const limit = Math.min(64, Math.max(0, Math.floor(maxResults) || 0))
  if (!limit || !direct.length) return []
  const visible = uniqueSemanticRecords(records).filter(record => options.beforeChapterIndex === undefined || isSemanticRecordBeforeChapter(record, options.beforeChapterIndex))
  const graph = buildSemanticMemoryGraph(visible, options.beforeChapterIndex)
  // Reserve one third for expansion; the best direct hit always remains.
  const directQuota = limit === 1 ? 1 : Math.max(1, limit - Math.max(1, Math.floor(limit / 3)))
  const selectedDirect = diversifyEvidence([...direct].sort(compareEvidence), directQuota)
  const directIds = new Set(selectedDirect.map(item => item.id))
  const seeds = selectedDirect.slice(0, 6).map(item => item.id)
  const expansions = expandSemanticMemoryGraph(graph, seeds)
  const recordById = new Map(visible.map(record => [record.id, record]))
  const queryVector = embedText(query)
  const queryTerms = Array.from(new Set(tokenize(query)))
  const related = expansions.flatMap(expansion => {
    const record = recordById.get(expansion.recordId)
    if (!record || directIds.has(record.id) || (options.sourceType && record.sourceType !== options.sourceType)) return []
    const score = relevanceScore(queryTerms, queryVector, record)
    return [{ ...record, score, citation: citationFor(record), graphDistance: expansion.graphDistance, path: expansion.path }]
  }).sort(compareEvidence)
  // The deepest author-confirmed causal chain takes one expansion slot first; its path carries every hop.
  const slots = limit - selectedDirect.length
  const chain = related.filter(item => causalPath(item.path))
    .sort((a, b) => (b.graphDistance || 0) - (a.graphDistance || 0) || compareEvidence(a, b)).slice(0, Math.min(1, slots))
  const rest = related.filter(item => !chain.includes(item))
  const selectedIds = new Set(selectedDirect.map(item => item.id))
  for (const item of [...chain, ...diversifyEvidence(rest, slots - chain.length), ...direct]) {
    if (selectedDirect.length >= limit) break
    if (selectedIds.has(item.id)) continue
    selectedDirect.push(item)
    selectedIds.add(item.id)
  }
  return selectedDirect
}

function diversifyEvidence(evidence: SemanticEvidence[], maxResults: number): SemanticEvidence[] {
  const remaining = [...evidence]
  const selected: SemanticEvidence[] = []
  while (remaining.length > 0 && selected.length < maxResults) {
    let bestIndex = -1
    let bestAdjustedScore = -Infinity
    for (let index = 0; index < remaining.length; index++) {
      const candidate = remaining[index]
      const sameSourceCount = selected.filter(item => item.sourceType === candidate.sourceType && item.sourceId === candidate.sourceId).length
      if (sameSourceCount >= 2) continue
      const sameTypeCount = selected.filter(item => item.sourceType === candidate.sourceType).length
      const adjusted = candidate.score - sameSourceCount * 0.16 - sameTypeCount * 0.015
      if (adjusted > bestAdjustedScore) {
        bestAdjustedScore = adjusted
        bestIndex = index
      }
    }
    if (bestIndex < 0) break
    const [best] = remaining.splice(bestIndex, 1)
    if (selected.filter(item => item.sourceType === best.sourceType && item.sourceId === best.sourceId).length >= 2) break
    selected.push(best)
  }
  return selected
}

function relevantExcerpt(text: string, query: string, limit: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= limit) return normalized
  const terms = Array.from(new Set(tokenize(query)))
  const lower = normalized.toLowerCase()
  const starts = new Set([0])
  const windowSize = limit - 2
  for (const term of terms) {
    let at = lower.indexOf(term)
    while (at >= 0) {
      starts.add(Math.max(0, Math.min(normalized.length - windowSize, at - Math.floor(windowSize / 3))))
      at = lower.indexOf(term, at + term.length)
    }
  }
  let start = 0
  let best = -1
  let bestMargin = -1
  for (const candidate of starts) {
    const window = lower.slice(candidate, candidate + windowSize)
    const score = terms.reduce((sum, term) => sum + (window.includes(term) ? Math.min(term.length, 12) : 0), 0)
    const matches = terms.flatMap(term => {
      const offset = window.indexOf(term)
      return offset < 0 ? [] : [{ start: offset, end: offset + term.length }]
    })
    // Equal keyword coverage should leave room around the matched fact, so a
    // hit at the right edge does not cut off the rest of its sentence.
    const margin = matches.length ? Math.min(Math.min(...matches.map(match => match.start)),
      windowSize - Math.max(...matches.map(match => match.end))) : 0
    if (score > best || (score === best && margin > bestMargin)) { best = score; bestMargin = margin; start = candidate }
  }
  return (start > 0 ? '…' : '') + normalized.slice(start, start + windowSize)
    + (start + windowSize < normalized.length ? '…' : '')
}

export function cognitionLabel(item: Pick<SemanticRecord, 'metadata'>): string {
  if (typeof item.metadata?.cognitiveNote === 'string') return item.metadata.cognitiveNote
  if (item.metadata?.stateKind !== 'knowledge') return ''
  const state = String(item.metadata.knowledgeState || '')
  const label = knowledgeStateLabels[state as keyof typeof knowledgeStateLabels] || '未知认知状态'
  return '角色认知：' + label + '（角色态度，不代表客观事实；明确不知情仅针对该命题）' + (item.metadata?.conflictGroupId ? '；存在并列冲突认知，待作者处理。' : '')
}

export function formatEvidence(evidence: SemanticEvidence[], limit = 1800, query = ''): string {
  const lines: string[] = []
  let remaining = Math.max(0, limit)
  // Give one expanded path a budget before lower ranked direct hits consume it.
  const firstRelated = evidence.find(item => item.path?.length)
  const firstDirect = evidence.find(item => !item.path?.length)
  const prioritized = [...new Map([firstDirect, firstRelated, ...evidence].filter((item): item is SemanticEvidence => !!item).map(item => [item.id, item])).values()]
  for (const item of prioritized) {
    const path = item.path?.length ? '｜路径：' + item.path.map(hop => formatSemanticGraphHop(hop, true)).join('；') : ''
    const cognitive = cognitionLabel(item)
    const state = cognitive ? '｜' + cognitive : item.metadata?.stateKind === 'relationship' ? '｜单向关系状态' : ''
    const prefix = '- [' + item.citation + state + path + '｜检索相关度' + Math.round(item.score * 100) + '（非因果置信度）] '
    const available = Math.min(260, remaining - prefix.length - (lines.length ? 1 : 0))
    if (available < 32) continue
    const line = prefix + relevantExcerpt(item.content, query, available)
    remaining -= line.length + (lines.length ? 1 : 0)
    lines.push(line)
  }
  const omitted = evidence.length - lines.length
  const notice = omitted ? '\n（预算未装入 ' + omitted + ' 条证据；路径或认知限定未被截断，不可视为资料完整。）' : ''
  return lines.join('\n') + (notice.length <= remaining ? notice : '')
}

interface PersistedSemanticRow {
  id: string
  novel_id: string
  source_type: SemanticSourceType
  source_id: string
  title: string
  content: string
  embedding: string
  metadata: string
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function fingerprint(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `${value.length}:${(hash >>> 0).toString(16)}`
}

function semanticRecordFingerprint(record: SemanticRecord): string {
  return fingerprint(`${record.title}\u0000${record.content}`)
}

function semanticMetadataFingerprint(record: SemanticRecord): string {
  return fingerprint(`${semanticRecordFingerprint(record)}\u0000${stableSerialize(record.metadata || {})}`)
}

function parseVector(value: string): number[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) && parsed.length > 0 && parsed.every(item => typeof item === 'number' && Number.isFinite(item))
      && parsed.some(item => item !== 0) ? parsed : []
  } catch {
    return []
  }
}

const syncQueue = new Map<string, Promise<unknown>>()

function currentRecords(source: SemanticMemorySource, novelId: string, beforeChapterIndex?: number): SemanticRecord[] {
  const snapshot = source()
  if (!snapshot.novel || snapshot.novel.id !== novelId) throw new SemanticSourceChangedError()
  return buildSemanticRecords(snapshot.novel, snapshot.knowledgeBases, beforeChapterIndex, snapshot.storyMemories, snapshot.canonMutations)
}

function recordMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const { _embedding, _recordFingerprint, _visibleBeforeChapterIndex, ...sourceMetadata } = metadata
  return sourceMetadata
}

function matchesCurrentRecord(row: PersistedSemanticRow | undefined, record: SemanticRecord): row is PersistedSemanticRow {
  return !!row && row.novel_id === record.novelId && row.source_type === record.sourceType
    && row.source_id === record.sourceId && row.title === record.title && row.content === record.content
    && stableSerialize(recordMetadata(parseMetadata(row.metadata))) === stableSerialize(record.metadata || {})
}

export async function syncSemanticIndexForNovel(
  source: SemanticMemorySource,
  embeddingConfig?: EmbeddingConfig,
  fallbackToLocal = true,
): Promise<SemanticSyncResult> {
  const novelId = source().novel.id
  const config = embeddingConfig ? { ...embeddingConfig } : undefined
  const previous = syncQueue.get(novelId) || Promise.resolve()
  const request = previous.catch(() => {}).then(() => synchronizeSnapshot(source, novelId, config, fallbackToLocal))
  syncQueue.set(novelId, request)
  try { return await request } finally { if (syncQueue.get(novelId) === request) syncQueue.delete(novelId) }
}

async function synchronizeSnapshot(
  source: SemanticMemorySource,
  novelId: string,
  embeddingConfig: EmbeddingConfig | undefined,
  fallbackToLocal: boolean,
): Promise<SemanticSyncResult> {
  await initDb()
  const records = currentRecords(source, novelId)
  const captured = stableSerialize(records)
  const assertCurrent = () => {
    if (stableSerialize(currentRecords(source, novelId)) !== captured) throw new SemanticSourceChangedError()
  }
  const existingRows = queryAll<PersistedSemanticRow>(
    'SELECT * FROM semantic_index WHERE novel_id = ?',
    [novelId],
  )
  const existingById = new Map(existingRows.map(row => [row.id, row]))
  const desiredIds = new Set(records.map(record => record.id))
  const removedIds = existingRows.filter(row => !desiredIds.has(row.id)).map(row => row.id)
  let provider: SemanticSyncResult['provider'] = 'local'
  let model = 'local-hash-v1'
  if (isRemoteEmbeddingEnabled(embeddingConfig)) {
    provider = 'remote'
    model = embeddingConfig.modelName
  }

  function prepare(targetProvider: SemanticSyncResult['provider'], targetModel: string) {
    const needsEmbedding: SemanticRecord[] = []
    const needsWrite: SemanticRecord[] = []
    const reusableVectors = new Map<string, number[]>()
    for (const record of records) {
      const existing = existingById.get(record.id)
      const metadata = parseMetadata(existing?.metadata)
      const vector = existing ? parseVector(existing.embedding) : []
      const embedding = metadata._embedding
      const contentFingerprint = semanticRecordFingerprint(record)
      const compatible = vector.length > 0
        && embedding?.provider === targetProvider
        && embedding?.model === targetModel
        && (targetProvider === 'local' || (embedding?.endpointId && embedding.endpointId === embeddingSourceId(embeddingConfig!.baseUrl)))
        && embedding?.contentFingerprint === contentFingerprint
        && existing?.title === record.title && existing?.content === record.content
        && embedding?.dimensions === vector.length
        && (targetProvider !== 'local' || vector.length === VECTOR_SIZE)
      if (compatible) reusableVectors.set(record.id, vector)
      else needsEmbedding.push(record)

      const recordChanged = metadata._recordFingerprint !== semanticMetadataFingerprint(record)
        || !matchesCurrentRecord(existing, record)
      if (!compatible || recordChanged) needsWrite.push(record)
    }
    return { needsEmbedding, needsWrite, reusableVectors }
  }

  let prepared = prepare(provider, model)
  let embeddedVectors: number[][] = []
  if (provider === 'remote' && prepared.needsEmbedding.length > 0) {
    try {
      embeddedVectors = await embedTextsWithProvider(
        embeddingConfig!,
        prepared.needsEmbedding.map(record => `${record.title}\n${record.content}`),
      )
    } catch (error) {
      if (!fallbackToLocal) throw error
      console.warn('Remote embedding failed, using local fallback', error)
      provider = 'local'
      model = 'local-hash-v1'
      prepared = prepare(provider, model)
      embeddedVectors = prepared.needsEmbedding.map(record => embedText(`${record.title}\n${record.content}`))
    }
  } else if (provider === 'local') {
    embeddedVectors = prepared.needsEmbedding.map(record => embedText(`${record.title}\n${record.content}`))
  }

  const vectorsById = new Map(prepared.needsEmbedding.map((record, index) => [record.id, embeddedVectors[index]]))
  const existingDimensions = existingRows
    .map(row => Number(parseMetadata(row.metadata)._embedding?.dimensions) || 0)
    .find(value => value > 0) || 0
  const dimensions = embeddedVectors[0]?.length || existingDimensions || (records.length > 0 && provider === 'local' ? VECTOR_SIZE : 0)

  if (prepared.needsWrite.length > 0 || removedIds.length > 0) await runTransaction(() => {
    assertCurrent()
    for (const id of removedIds) execute('DELETE FROM semantic_index WHERE id = ? AND novel_id = ?', [id, novelId])
    for (const record of prepared.needsWrite) {
      const vector = vectorsById.get(record.id) || prepared.reusableVectors.get(record.id) || []
      const metadata = {
        ...(record.metadata || {}),
        _recordFingerprint: semanticMetadataFingerprint(record),
        _embedding: {
          provider,
          model,
          ...(provider === 'remote' ? { endpointId: embeddingSourceId(embeddingConfig!.baseUrl) } : {}),
          dimensions: vector.length || dimensions,
          contentFingerprint: semanticRecordFingerprint(record),
        },
      }
      execute(`
        INSERT OR REPLACE INTO semantic_index
        (id, novel_id, source_type, source_id, title, content, embedding, metadata, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        record.id,
        record.novelId,
        record.sourceType,
        record.sourceId,
        record.title,
        record.content,
        JSON.stringify(vector),
        JSON.stringify(metadata),
        new Date().toISOString(),
      ])
    }
  }, { restoreOnWriteFailure: true })
  assertCurrent()
  return {
    recordCount: records.length,
    provider,
    model,
    dimensions,
    embeddedCount: prepared.needsEmbedding.length,
    updatedCount: prepared.needsWrite.length,
    removedCount: removedIds.length,
    unchangedCount: records.length - prepared.needsWrite.length,
  }
}

function parseMetadata(value: unknown): Record<string, any> {
  try {
    const parsed = JSON.parse(String(value || '{}'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export async function getSemanticIndexInfo(novelId: string): Promise<SemanticIndexInfo> {
  await initDb()
  const rows = queryAll<Record<string, any>>(
    'SELECT metadata, updated_at FROM semantic_index WHERE novel_id = ? ORDER BY updated_at DESC',
    [novelId],
  )
  const metadata = parseMetadata(rows[0]?.metadata)
  return {
    recordCount: rows.length,
    provider: metadata._embedding?.provider === 'remote' ? 'remote' : 'local',
    model: metadata._embedding?.model || 'local-hash-v1',
    dimensions: Number(metadata._embedding?.dimensions) || 0,
    updatedAt: rows[0]?.updated_at || '',
  }
}

export async function queryPersistedSemanticEvidence(
  source: SemanticMemorySource,
  query: string,
  maxResults = 8,
  embeddingConfig?: EmbeddingConfig,
  sourceType?: SemanticSourceType,
  beforeChapterIndex?: number,
): Promise<SemanticEvidence[]> {
  const novelId = source().novel.id
  const config = embeddingConfig ? { ...embeddingConfig } : undefined
  await initDb()
  const rows = queryAll<PersistedSemanticRow>('SELECT * FROM semantic_index WHERE novel_id = ?', [novelId])
  const byId = new Map(rows.map(row => [row.id, row]))
  const readAllCurrent = () => currentRecords(source, novelId, beforeChapterIndex)
  const readCurrent = () => readAllCurrent().filter(record => !sourceType || record.sourceType === sourceType)
  const compatibleRemote = (record: SemanticRecord) => {
    const row = byId.get(record.id)
    if (!matchesCurrentRecord(row, record) || !isRemoteEmbeddingEnabled(config)) return false
    const embedding = parseMetadata(row.metadata)._embedding
    const vector = parseVector(row.embedding)
    return vector.length > 0 && embedding?.provider === 'remote'
      && embedding.model === config.modelName && embedding.endpointId === embeddingSourceId(config.baseUrl)
      && embedding.dimensions === vector.length && embedding.contentFingerprint === semanticRecordFingerprint(record)
  }
  const initial = readCurrent()
  let remoteQueryVector: number[] = []
  if (isRemoteEmbeddingEnabled(config) && initial.some(compatibleRemote)) {
    try { remoteQueryVector = (await embedTextsWithProvider(config, [query]))[0] || [] }
    catch (error) { console.warn('Vector memory query failed, using current local records', error) }
  }
  const localQueryVector = embedText(query)
  const queryTerms = Array.from(new Set(tokenize(query)))
  // Re-read after network I/O. Deleted sources disappear and edited/new sources
  // are ranked locally until synchronization builds their vectors.
  const current = readAllCurrent()
  const scored = current.filter(record => !sourceType || record.sourceType === sourceType)
    .map(record => {
      const row = byId.get(record.id)
      const fresh = matchesCurrentRecord(row, record)
      const metadata = fresh ? parseMetadata(row.metadata) : {}
      const storedVector = fresh ? parseVector(row.embedding) : []
      const remote = compatibleRemote(record) && remoteQueryVector.length > 0 && remoteQueryVector.length === storedVector.length
      const local = fresh && metadata._embedding?.provider === 'local'
        && metadata._embedding.model === 'local-hash-v1' && storedVector.length === VECTOR_SIZE
        && metadata._embedding.dimensions === storedVector.length
        && metadata._embedding.contentFingerprint === semanticRecordFingerprint(record)
      const queryVector = remote ? remoteQueryVector : localQueryVector
      const vector = remote || local ? storedVector : embedText([record.title, record.content].join('\n'))
      return {
        ...record,
        score: relevanceScore(queryTerms, queryVector, record, vector),
        citation: citationFor(record),
        retrieval: { method: remote ? 'remote' as const : 'local' as const, indexed: fresh },
      }
    })
    .filter(record => record.score >= 0.04)
    .sort(compareEvidence)
  return expandAndRankSemanticEvidence(query, current, scored, maxResults, { beforeChapterIndex, sourceType })
}
