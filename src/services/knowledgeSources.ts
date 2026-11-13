import type {
  KBEntry,
  KnowledgeBase,
  KnowledgeSummarySource,
  KnowledgeSummaryCoverage,
} from '@/types/knowledge'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import { coverageMatchesSources, isKnowledgeSummaryCoverage } from './knowledgeSummaryCoverage'

export type KnowledgeSummaryStatus = 'empty' | 'current' | 'unverified' | 'stale'

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isValidDate(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false
  const date = value
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(date)
    || !Number.isFinite(Date.parse(date))) return false
  return new Date(date.slice(0, 10) + 'T00:00:00Z').toISOString().slice(0, 10) === date.slice(0, 10)
}

function isValidOrigin(value: unknown): value is KnowledgeSummarySource['origin'] {
  return value === 'ai' || value === 'author'
}

function isValidKind(value: unknown): value is KnowledgeSummarySource['kind'] {
  return value === 'entry' || value === 'base'
}

function isValidSummarySource(value: unknown): value is KnowledgeSummarySource {
  if (!isRecord(value)) return false
  if (!isValidKind(value.kind)) return false
  if (value.coverage !== undefined && !isKnowledgeSummaryCoverage(value.coverage)) return false
  if (value.origin === 'ai' && !value.coverage) return false
  if (!isNonEmptyString(value.knowledgeBaseId)
    || !isNonEmptyString(value.sourceVersionId)
    || !isNonEmptyString(value.derivedValue)
    || !isValidOrigin(value.origin)
    || !isValidDate(value.createdAt)) return false

  if (value.kind === 'entry') return isNonEmptyString(value.entryId)
  return value.entryId === undefined
}

function isValidSummaryLevel(value: unknown): value is NonNullable<KnowledgeBase['summaryLevel']> {
  return value === 'brief' || value === 'standard' || value === 'detailed'
}

function isValidEntryRecord(entry: unknown): entry is KBEntry {
  if (!isRecord(entry)) return false
  return isNonEmptyString(entry.id)
    && typeof entry.category === 'string'
    && typeof entry.title === 'string'
    && typeof entry.content === 'string'
    && typeof entry.summary === 'string'
    && Array.isArray(entry.tags)
    && entry.tags.every(tag => typeof tag === 'string')
    && typeof entry.createdAt === 'string'
    && typeof entry.updatedAt === 'string'
}

function isUsableEntry(entry: unknown): entry is Pick<KBEntry, 'id' | 'content'> {
  return isValidEntryRecord(entry) && isNonEmptyString(entry.content)
}

function isValidBaseRecord(base: unknown): base is KnowledgeBase {
  if (!isRecord(base)) return false
  if (!isNonEmptyString(base.id)
    || typeof base.name !== 'string'
    || typeof base.description !== 'string'
    || typeof base.createdAt !== 'string'
    || !Array.isArray(base.entries)
    || !base.entries.every(isValidEntryRecord)) return false

  const ids = new Set(base.entries.map(entry => entry.id))
  if (ids.size !== base.entries.length) return false
  if (base.summary !== undefined && typeof base.summary !== 'string') return false
  if (base.summaryLevel !== undefined && !isValidSummaryLevel(base.summaryLevel)) return false
  if (base.summaryUpdatedAt !== undefined && typeof base.summaryUpdatedAt !== 'string') return false
  return true
}

function assertNonEmpty(value: unknown, label: string): asserts value is string {
  if (!isNonEmptyString(value)) throw new Error(label + '不能为空')
}

function assertDate(value: unknown): asserts value is string {
  if (!isValidDate(value)) throw new Error('createdAt 必须是有效日期')
}

function assertOrigin(value: unknown): asserts value is KnowledgeSummarySource['origin'] {
  if (!isValidOrigin(value)) throw new Error('origin 无效')
}

function entryVersionPayload(kbId: string, entry: KBEntry) {
  return {
    knowledgeBaseId: kbId,
    id: entry.id,
    title: entry.title,
    category: entry.category,
    content: entry.content,
    tags: entry.tags,
  }
}

export function entrySourceVersion(kbId: string, entry: KBEntry): string {
  return buildAnalysisSourceVersionId(JSON.stringify(entryVersionPayload(kbId, entry)))
}

function baseVersionPayload(base: KnowledgeBase) {
  return {
    id: base.id,
    name: base.name,
    description: base.description,
    // A knowledge base is a collection, not an ordered manuscript. SQL reloads
    // may sort imported rows differently without changing the source facts.
    entries: [...base.entries].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(entry => ({
      id: entry.id,
      title: entry.title,
      category: entry.category,
      content: entry.content,
      tags: entry.tags,
      summary: getCurrentEntrySummary(base.id, entry),
    })),
  }
}

export function baseSourceVersion(base: KnowledgeBase): string {
  return buildAnalysisSourceVersionId(JSON.stringify(baseVersionPayload(base)))
}

export function createEntrySummarySource(
  kbId: string,
  entry: KBEntry,
  summary: string,
  origin: KnowledgeSummarySource['origin'],
  now: string,
  coverage?: KnowledgeSummaryCoverage,
): KnowledgeSummarySource {
  assertNonEmpty(kbId, 'knowledgeBaseId')
  if (!isUsableEntry(entry)) throw new Error('条目来源绑定要求有效条目 ID、字段类型和非空正文')
  assertNonEmpty(summary, '摘要')
  assertOrigin(origin)
  assertDate(now)
  if (origin === 'ai' && !coverageMatchesSources(coverage, [{ entryId: entry.id, sourceVersionId: entrySourceVersion(kbId, entry), contentLength: entry.content.length }])) {
    throw new Error('AI 摘要缺少当前原文的完整覆盖记录')
  }

  return {
    kind: 'entry',
    knowledgeBaseId: kbId,
    entryId: entry.id,
    sourceVersionId: entrySourceVersion(kbId, entry),
    derivedValue: summary,
    origin,
    createdAt: now,
    ...(origin === 'ai' ? { coverage: JSON.parse(JSON.stringify(coverage)) as KnowledgeSummaryCoverage } : {}),
  }
}

export function createBaseSummarySource(
  base: KnowledgeBase,
  summary: string,
  origin: KnowledgeSummarySource['origin'],
  now: string,
  coverage?: KnowledgeSummaryCoverage,
): KnowledgeSummarySource {
  if (!isValidBaseRecord(base) || !base.entries.some(isUsableEntry)) {
    throw new Error('整库来源绑定要求有效知识库、唯一条目 ID 和至少一条正文非空的条目')
  }
  assertNonEmpty(summary, '摘要')
  assertOrigin(origin)
  assertDate(now)
  if (origin === 'ai' && !coverageMatchesSources(coverage, base.entries.map(entry => ({ entryId: entry.id, sourceVersionId: entrySourceVersion(base.id, entry), contentLength: entry.content.length })))) {
    throw new Error('AI 摘要缺少当前原文的完整覆盖记录')
  }

  return {
    kind: 'base',
    knowledgeBaseId: base.id,
    sourceVersionId: baseSourceVersion(base),
    derivedValue: summary,
    origin,
    createdAt: now,
    ...(origin === 'ai' ? { coverage: JSON.parse(JSON.stringify(coverage)) as KnowledgeSummaryCoverage } : {}),
  }
}

export function getEntrySummaryStatus(kbId: string, entry: KBEntry): KnowledgeSummaryStatus {
  if (isValidEntryRecord(entry) && !entry.summary.trim()) return 'empty'
  if (!isUsableEntry(entry)) return 'unverified'
  const source = entry.summarySource
  if (!isValidSummarySource(source)) return 'unverified'
  if (source.kind !== 'entry' || source.knowledgeBaseId !== kbId || source.entryId !== entry.id) return 'stale'
  if (source.origin === 'ai' && !coverageMatchesSources(source.coverage, [{ entryId: entry.id, sourceVersionId: entrySourceVersion(kbId, entry), contentLength: entry.content.length }])) return 'stale'

  try {
    return source.sourceVersionId === entrySourceVersion(kbId, entry)
      && source.derivedValue === entry.summary
      ? 'current'
      : 'stale'
  } catch {
    return 'unverified'
  }
}

export function getBaseSummaryStatus(base: KnowledgeBase): KnowledgeSummaryStatus {
  if (isValidBaseRecord(base) && !base.summary?.trim()) return 'empty'
  if (!isValidBaseRecord(base) || !base.entries.some(isUsableEntry)) return 'unverified'
  const source = base.summarySource
  if (!isValidSummarySource(source)) return 'unverified'
  if (source.kind !== 'base' || source.knowledgeBaseId !== base.id) return 'stale'
  if (source.origin === 'ai' && !coverageMatchesSources(source.coverage, base.entries.map(entry => ({ entryId: entry.id, sourceVersionId: entrySourceVersion(base.id, entry), contentLength: entry.content.length })))) return 'stale'

  try {
    return source.sourceVersionId === baseSourceVersion(base)
      && source.derivedValue === base.summary
      ? 'current'
      : 'stale'
  } catch {
    return 'unverified'
  }
}

export function getCurrentEntrySummary(kbId: string, entry: KBEntry): string {
  return getEntrySummaryStatus(kbId, entry) === 'current' ? entry.summary : ''
}

export function getCurrentBaseSummary(base: KnowledgeBase): string {
  return getBaseSummaryStatus(base) === 'current' ? base.summary || '' : ''
}

