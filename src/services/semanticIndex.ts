import type { Novel, Chapter, Character, EventLogEntry, DataPanelItem } from '@/types/novel'
import type { KnowledgeBase } from '@/stores/knowledge'
import type { EmbeddingConfig } from '@/stores/config'
import { execute, initDb, queryAll, runTransaction } from '@/services/database'
import { embedTextsWithProvider, isRemoteEmbeddingEnabled } from '@/services/embeddings'

export type SemanticSourceType = 'knowledge' | 'chapter' | 'character' | 'event' | 'story_arc' | 'chapter_plan' | 'data_panel'

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

function lexicalRelevance(query: string, text: string): number {
  const terms = Array.from(new Set(tokenize(query)))
  if (terms.length === 0) return 0
  const normalized = text.toLowerCase()
  const matched = terms.filter(term => normalized.includes(term)).length
  return matched / terms.length
}

function relevanceScore(query: string, queryVector: number[], record: SemanticRecord, vector?: number[]): number {
  const text = `${record.title}\n${record.content}`
  const candidateVector = vector || embedText(text)
  const semantic = queryVector.length > 0 && queryVector.length === candidateVector.length
    ? cosine(queryVector, candidateVector)
    : 0
  const lexical = lexicalRelevance(query, text)
  const titleBoost = lexicalRelevance(query, record.title) * 0.12
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

function chapterRecords(novelId: string, chapter: Chapter): SemanticRecord[] {
  const records: SemanticRecord[] = []
  const baseTitle = `第${chapter.chapterIndex + 1}章 ${chapter.title}`
  const summary = chapter.summary
  if (summary.trim()) {
    records.push({
      id: `${novelId}:chapter:${chapter.id}:summary`,
      novelId,
      sourceType: 'chapter',
      sourceId: chapter.id,
      title: `${baseTitle} 摘要`,
      content: compact(summary),
      metadata: { chapterIndex: chapter.chapterIndex, status: chapter.status, chunkType: 'summary' },
    })
  }
  for (const [index, chunk] of splitMemoryText(chapter.content).entries()) {
    records.push({
      id: `${novelId}:chapter:${chapter.id}:chunk:${index}`,
      novelId,
      sourceType: 'chapter',
      sourceId: chapter.id,
      title: `${baseTitle} 片段${index + 1}`,
      content: chunk,
      metadata: { chapterIndex: chapter.chapterIndex, status: chapter.status, chunkType: 'content', chunkIndex: index },
    })
  }
  return records
}

function characterRecord(novelId: string, character: Character): SemanticRecord {
  const relations = character.relationships?.map(rel => `${rel.targetName}:${rel.relation}`).join('；') || ''
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
    metadata: { status: character.status, firstAppearChapter: character.firstAppearChapter },
  }
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
      event.status,
      event.storyTime,
      event.location,
    ].filter(Boolean).join('\n')),
    metadata: {
      chapterIndex: event.chapterIndex,
      targetChapter: event.targetChapter,
      type: event.type,
      status: event.status,
      importance: event.importance,
    },
  }
}

function storyArcRecord(novelId: string, arc: NonNullable<Novel['storyArcs']>[number]): SemanticRecord {
  const nodeLines = (arc.nodes || []).map(node => {
    const chapter = node.actualChapter ?? node.targetChapter
    return `第${chapter + 1}章 ${node.title} ${node.description} [${node.status}]`
  })
  return {
    id: `${novelId}:story_arc:${arc.id}`,
    novelId,
    sourceType: 'story_arc',
    sourceId: arc.id,
    title: `弧线 ${arc.title}`,
    content: compact([
      arc.type,
      arc.status,
      arc.description,
      arc.reactivateAt,
      ...nodeLines,
    ].filter(Boolean).join('\n')),
    metadata: { type: arc.type, status: arc.status, importance: arc.importance },
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
      plan.horizon,
      plan.status,
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
    },
  }
}

function dataPanelRecord(novelId: string, item: DataPanelItem): SemanticRecord {
  const fields = item.fields.map(field => `${field.name}:${field.value}${field.unit || ''}`).join('；')
  return {
    id: `${novelId}:data_panel:${item.id}`,
    novelId,
    sourceType: 'data_panel',
    sourceId: item.id,
    title: `数据 ${item.name}`,
    content: compact([item.category, item.name, fields, item.relatedKeywords.join('、')].join('\n')),
    metadata: { category: item.category, lastMentionChapterIndex: item.lastMentionChapterIndex },
  }
}

function knowledgeRecord(novelId: string, kb: KnowledgeBase, entry: KnowledgeBase['entries'][number]): SemanticRecord {
  return {
    id: `${novelId}:knowledge:${kb.id}:${entry.id}`,
    novelId,
    sourceType: 'knowledge',
    sourceId: entry.id,
    title: `知识库/${kb.name}/${entry.title}`,
    content: compact([entry.category, entry.title, entry.summary || entry.content, entry.tags.join('、')].join('\n')),
    metadata: { kbId: kb.id, category: entry.category },
  }
}

export function buildSemanticRecords(novel: Novel, knowledgeBases: KnowledgeBase[] = []): SemanticRecord[] {
  const records: SemanticRecord[] = []
  for (const chapter of novel.chapters || []) {
    records.push(...chapterRecords(novel.id, chapter))
  }
  records.push(...(novel.characters || []).map(character => characterRecord(novel.id, character)))
  records.push(...(novel.eventLog || []).map(event => eventRecord(novel.id, event)))
  records.push(...(novel.storyArcs || []).map(arc => storyArcRecord(novel.id, arc)))
  records.push(...(novel.chapterPlans || []).map(plan => chapterPlanRecord(novel.id, plan)))
  records.push(...(novel.dataPanels || []).map(item => dataPanelRecord(novel.id, item)))

  const boundIds = new Set(novel.knowledgeBaseIds || [])
  for (const kb of knowledgeBases) {
    if (!boundIds.has(kb.id)) continue
    for (const entry of kb.entries || []) records.push(knowledgeRecord(novel.id, kb, entry))
  }
  return records.filter(record => record.content.trim().length > 0)
}

function citationFor(record: SemanticRecord): string {
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
): SemanticEvidence[] {
  const queryVector = embedText(query)
  const scored = records
    .map(record => ({
      ...record,
      score: relevanceScore(query, queryVector, record),
      citation: citationFor(record),
    }))
    .filter(record => record.score >= minScore)
    .sort((a, b) => b.score - a.score)
  return diversifyEvidence(scored, maxResults)
}

function diversifyEvidence(evidence: SemanticEvidence[], maxResults: number): SemanticEvidence[] {
  const remaining = [...evidence]
  const selected: SemanticEvidence[] = []
  while (remaining.length > 0 && selected.length < maxResults) {
    let bestIndex = 0
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
    const [best] = remaining.splice(bestIndex, 1)
    if (selected.filter(item => item.sourceType === best.sourceType && item.sourceId === best.sourceId).length >= 2) break
    selected.push(best)
  }
  return selected
}

export function formatEvidence(evidence: SemanticEvidence[], limit = 1800): string {
  if (evidence.length === 0) return ''
  const lines = evidence.map(item => {
    const percent = Math.round(item.score * 100)
    return `- [${item.citation}｜相关度${percent}] ${compact(item.content, 260)}`
  })
  return compact(lines.join('\n'), limit)
}

interface PersistedSemanticRow {
  id: string
  title: string
  content: string
  embedding: string
  metadata: string
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
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
    return Array.isArray(parsed) && parsed.every(item => Number.isFinite(Number(item))) ? parsed.map(Number) : []
  } catch {
    return []
  }
}

export async function syncSemanticIndexForNovel(
  novel: Novel,
  knowledgeBases: KnowledgeBase[] = [],
  embeddingConfig?: EmbeddingConfig,
  fallbackToLocal = true,
): Promise<SemanticSyncResult> {
  await initDb()
  const records = buildSemanticRecords(novel, knowledgeBases)
  const existingRows = queryAll<PersistedSemanticRow>(
    'SELECT id, title, content, embedding, metadata FROM semantic_index WHERE novel_id = ?',
    [novel.id],
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
        && embedding?.contentFingerprint === contentFingerprint
      if (compatible) reusableVectors.set(record.id, vector)
      else needsEmbedding.push(record)

      const recordChanged = metadata._recordFingerprint !== semanticMetadataFingerprint(record)
        || existing?.title !== record.title
        || existing?.content !== record.content
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
    for (const id of removedIds) execute('DELETE FROM semantic_index WHERE id = ? AND novel_id = ?', [id, novel.id])
    for (const record of prepared.needsWrite) {
      const vector = vectorsById.get(record.id) || prepared.reusableVectors.get(record.id) || []
      const metadata = {
        ...(record.metadata || {}),
        _recordFingerprint: semanticMetadataFingerprint(record),
        _embedding: {
          provider,
          model,
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
  })
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
    return JSON.parse(String(value || '{}'))
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
  novelId: string,
  query: string,
  maxResults = 8,
  embeddingConfig?: EmbeddingConfig,
  sourceType?: SemanticSourceType,
): Promise<SemanticEvidence[]> {
  await initDb()
  const rows = queryAll<Record<string, any>>('SELECT * FROM semantic_index WHERE novel_id = ?', [novelId])
    .filter(row => !sourceType || row.source_type === sourceType)
  const remoteModels = new Set(rows
    .map(row => parseMetadata(row.metadata)._embedding)
    .filter(embedding => embedding?.provider === 'remote')
    .map(embedding => String(embedding.model || '')))
  const hasCompatibleRemoteVectors = remoteModels.size === 1 && remoteModels.has(embeddingConfig?.modelName || '')
  let remoteQueryVector: number[] = []
  if (hasCompatibleRemoteVectors && isRemoteEmbeddingEnabled(embeddingConfig)) {
    remoteQueryVector = (await embedTextsWithProvider(embeddingConfig, [query]))[0] || []
  }
  const localQueryVector = embedText(query)
  const scored = rows
    .map(row => {
      const metadata = parseMetadata(row.metadata)
      const record: SemanticRecord = {
        id: row.id,
        novelId: row.novel_id,
        sourceType: row.source_type,
        sourceId: row.source_id,
        title: row.title,
        content: row.content,
        metadata,
      }
      const provider = metadata._embedding?.provider === 'remote' ? 'remote' : 'local'
      const queryVector = provider === 'remote' ? remoteQueryVector : localQueryVector
      return {
        ...record,
        score: relevanceScore(query, queryVector, record, JSON.parse(row.embedding || '[]')),
        citation: citationFor(record),
      }
    })
    .filter(record => record.score >= 0.04)
    .sort((a, b) => b.score - a.score)
  return diversifyEvidence(scored, maxResults)
}
