import type {
  KnowledgeSummaryCoverage,
  KnowledgeSummaryCoverageSource,
} from '@/types/knowledge'

export interface KnowledgeSummaryChunk {
  id: string
  entryId: string
  sourceVersionId: string
  contentLength: number
  start: number
  end: number
  title: string
  category: string
  tags: string[]
  text: string
}

type KnowledgeSummaryEntry = {
  entryId: string
  sourceVersionId: string
  title: string
  category: string
  tags: string[]
  content: string
}

type KnowledgeSummaryMetrics = {
  leafEvidence?: KnowledgeSummaryCoverage['leafEvidence']
  requestCount: number
  inputTokens: number
  outputTokens: number
  usageEstimated: boolean
}

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value)
  return actualKeys.length === keys.length && keys.every(key => actualKeys.includes(key))
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
}

function assertSafeNonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (!isSafeNonNegativeInteger(value)) throw new Error(`${label} 必须是安全的非负整数`)
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} 必须是对象`)
}

function assertExactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (!hasExactKeys(value, keys)) throw new Error(`${label} 字段形状无效`)
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (!isNonEmptyString(value)) throw new Error(`${label} 必须是非空字符串`)
}

function assertTags(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || !value.every(tag => typeof tag === 'string')) {
    throw new Error(`${label} 必须是字符串数组`)
  }
}

function isValidRange(value: unknown, contentLength: number): value is { start: number; end: number } {
  if (!isRecord(value)
    || !hasExactKeys(value, ['start', 'end'])
    || !isSafeNonNegativeInteger(value.start)
    || !isSafeNonNegativeInteger(value.end)
    || value.start > value.end
    || value.end > contentLength) return false
  return true
}

function rangesCoverContent(ranges: unknown, contentLength: number): ranges is Array<{ start: number; end: number }> {
  if (!Array.isArray(ranges) || ranges.length === 0) return false

  if (contentLength === 0) {
    return ranges.length === 1
      && isValidRange(ranges[0], contentLength)
      && ranges[0].start === 0
      && ranges[0].end === 0
  }

  let cursor = 0
  for (const range of ranges) {
    if (!isValidRange(range, contentLength) || range.start !== cursor || range.start === range.end) return false
    cursor = range.end
  }
  return cursor === contentLength
}

function sourceKey(entryId: string, sourceVersionId: string): string {
  return JSON.stringify([entryId, sourceVersionId])
}

function chunkId(entryId: string, sourceVersionId: string, index: number): string {
  return JSON.stringify([entryId, sourceVersionId, index])
}

function validateMetrics(metrics: unknown): asserts metrics is KnowledgeSummaryMetrics {
  assertRecord(metrics, 'metrics')
  assertExactKeys(metrics, ['requestCount', 'inputTokens', 'outputTokens', 'usageEstimated', ...(metrics.leafEvidence === undefined ? [] : ['leafEvidence'])], 'metrics')
  assertSafeNonNegativeInteger(metrics.requestCount, 'requestCount')
  assertSafeNonNegativeInteger(metrics.inputTokens, 'inputTokens')
  assertSafeNonNegativeInteger(metrics.outputTokens, 'outputTokens')
  if (typeof metrics.usageEstimated !== 'boolean') throw new Error('usageEstimated 必须是 boolean')
}

function validateEntry(entry: unknown, index: number): asserts entry is KnowledgeSummaryEntry {
  assertRecord(entry, `entries[${index}]`)
  assertExactKeys(entry, ['entryId', 'sourceVersionId', 'title', 'category', 'tags', 'content'], `entries[${index}]`)
  assertNonEmptyString(entry.entryId, `entries[${index}].entryId`)
  assertNonEmptyString(entry.sourceVersionId, `entries[${index}].sourceVersionId`)
  if (typeof entry.title !== 'string') throw new Error(`entries[${index}].title 必须是字符串`)
  if (typeof entry.category !== 'string') throw new Error(`entries[${index}].category 必须是字符串`)
  assertTags(entry.tags, `entries[${index}].tags`)
  if (typeof entry.content !== 'string') throw new Error(`entries[${index}].content 必须是字符串`)
}

function validateChunk(chunk: unknown, index: number): asserts chunk is KnowledgeSummaryChunk {
  assertRecord(chunk, `chunks[${index}]`)
  assertExactKeys(chunk, [
    'id', 'entryId', 'sourceVersionId', 'contentLength', 'start', 'end',
    'title', 'category', 'tags', 'text',
  ], `chunks[${index}]`)
  assertNonEmptyString(chunk.id, `chunks[${index}].id`)
  assertNonEmptyString(chunk.entryId, `chunks[${index}].entryId`)
  assertNonEmptyString(chunk.sourceVersionId, `chunks[${index}].sourceVersionId`)
  assertSafeNonNegativeInteger(chunk.contentLength, `chunks[${index}].contentLength`)
  assertSafeNonNegativeInteger(chunk.start, `chunks[${index}].start`)
  assertSafeNonNegativeInteger(chunk.end, `chunks[${index}].end`)
  if (chunk.start > chunk.end || chunk.end > chunk.contentLength) {
    throw new Error(`chunks[${index}] 区间无效`)
  }
  if (typeof chunk.title !== 'string') throw new Error(`chunks[${index}].title 必须是字符串`)
  if (typeof chunk.category !== 'string') throw new Error(`chunks[${index}].category 必须是字符串`)
  assertTags(chunk.tags, `chunks[${index}].tags`)
  if (typeof chunk.text !== 'string' || chunk.text.length !== chunk.end - chunk.start) {
    throw new Error(`chunks[${index}].text 必须匹配区间长度`)
  }
}

function assertCoverageChunks(chunks: unknown): asserts chunks is KnowledgeSummaryChunk[] {
  if (!Array.isArray(chunks)) throw new Error('chunks 必须是数组')
  if (chunks.length === 0) throw new Error('chunks 不能为空：完全无条目不是有效摘要覆盖')

  const chunkIds = new Set<string>()
  const entryIds = new Set<string>()
  const sourceVersionIds = new Set<string>()
  const sourceGroups = new Map<string, { contentLength: number; ranges: Array<{ start: number; end: number }> }>()
  for (let index = 0; index < chunks.length; index += 1) {
    validateChunk(chunks[index], index)
    const chunk = chunks[index]
    if (chunkIds.has(chunk.id)) throw new Error(`chunks 存在重复 id: ${chunk.id}`)
    chunkIds.add(chunk.id)

    const key = sourceKey(chunk.entryId, chunk.sourceVersionId)
    const group = sourceGroups.get(key)
    if (!group) {
      if (entryIds.has(chunk.entryId)) throw new Error(`chunks 存在重复 entryId: ${chunk.entryId}`)
      if (sourceVersionIds.has(chunk.sourceVersionId)) {
        throw new Error(`chunks 存在重复 sourceVersionId: ${chunk.sourceVersionId}`)
      }
      entryIds.add(chunk.entryId)
      sourceVersionIds.add(chunk.sourceVersionId)
    }
    if (group && group.contentLength !== chunk.contentLength) {
      throw new Error(`同一来源的 contentLength 不一致: ${key}`)
    }
    if (group) group.ranges.push({ start: chunk.start, end: chunk.end })
    else sourceGroups.set(key, { contentLength: chunk.contentLength, ranges: [{ start: chunk.start, end: chunk.end }] })
  }

  for (const [key, group] of sourceGroups) {
    const ranges = [...group.ranges].sort((a, b) => a.start - b.start || a.end - b.end)
    if (!rangesCoverContent(ranges, group.contentLength)) {
      throw new Error(`来源 ${key} 的 chunks 没有连续完整覆盖原文`)
    }
  }
}

export function buildKnowledgeSummaryChunks(
  entries: KnowledgeSummaryEntry[],
  chunkChars = 6000,
): KnowledgeSummaryChunk[] {
  if (!Array.isArray(entries)) throw new Error('entries 必须是数组')
  if (!Number.isSafeInteger(chunkChars) || chunkChars < 2) throw new Error('chunkChars 必须是大于等于 2 的安全整数')

  const entryIds = new Set<string>()
  const sourceVersionIds = new Set<string>()
  const chunks: KnowledgeSummaryChunk[] = []
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
    validateEntry(entries[entryIndex], entryIndex)
    const entry = entries[entryIndex]
    if (entryIds.has(entry.entryId)) throw new Error(`entries 存在重复 entryId: ${entry.entryId}`)
    if (sourceVersionIds.has(entry.sourceVersionId)) {
      throw new Error(`entries 存在重复 sourceVersionId: ${entry.sourceVersionId}`)
    }
    entryIds.add(entry.entryId)
    sourceVersionIds.add(entry.sourceVersionId)

    const contentLength = entry.content.length
    if (contentLength === 0) {
      chunks.push({
        id: chunkId(entry.entryId, entry.sourceVersionId, 0),
        entryId: entry.entryId,
        sourceVersionId: entry.sourceVersionId,
        contentLength,
        start: 0,
        end: 0,
        title: entry.title,
        category: entry.category,
        tags: [...entry.tags],
        text: '',
      })
      continue
    }

    let start = 0
    let chunkIndex = 0
    while (start < contentLength) {
      let end = Math.min(start + chunkChars, contentLength)
      if (end < contentLength && end > start
        && entry.content.charCodeAt(end - 1) >= 0xD800
        && entry.content.charCodeAt(end - 1) <= 0xDBFF
        && entry.content.charCodeAt(end) >= 0xDC00
        && entry.content.charCodeAt(end) <= 0xDFFF) {
        end -= 1
      }

      const text = entry.content.slice(start, end)
      chunks.push({
        id: chunkId(entry.entryId, entry.sourceVersionId, chunkIndex),
        entryId: entry.entryId,
        sourceVersionId: entry.sourceVersionId,
        contentLength,
        start,
        end,
        title: entry.title,
        category: entry.category,
        tags: [...entry.tags],
        text,
      })
      start = end
      chunkIndex += 1
    }
  }

  return chunks
}

export function createKnowledgeSummaryCoverage(
  chunks: KnowledgeSummaryChunk[],
  metrics: KnowledgeSummaryMetrics,
): KnowledgeSummaryCoverage {
  assertCoverageChunks(chunks)
  validateMetrics(metrics)
  if (metrics.leafEvidence !== undefined && !validLeafEvidence(metrics.leafEvidence, chunks.length)) throw new Error('叶子请求证据不完整')
  if (!metrics.leafEvidence && metrics.requestCount < chunks.length) throw new Error('requestCount 不能小于 leafCount')

  const sources: KnowledgeSummaryCoverageSource[] = []
  const sourceIndexes = new Map<string, number>()
  for (const chunk of chunks) {
    const key = sourceKey(chunk.entryId, chunk.sourceVersionId)
    const sourceIndex = sourceIndexes.get(key)
    if (sourceIndex === undefined) {
      sourceIndexes.set(key, sources.length)
      sources.push({
        entryId: chunk.entryId,
        sourceVersionId: chunk.sourceVersionId,
        contentLength: chunk.contentLength,
        ranges: [{ start: chunk.start, end: chunk.end }],
      })
    } else {
      sources[sourceIndex].ranges.push({ start: chunk.start, end: chunk.end })
    }
  }

  for (const source of sources) {
    source.ranges.sort((a, b) => a.start - b.start || a.end - b.end)
  }

  return {
    ...(metrics.leafEvidence ? { leafEvidence: metrics.leafEvidence } : {}),
    version: 1,
    strategy: 'full-source-hierarchical',
    sources,
    leafCount: chunks.length,
    requestCount: metrics.requestCount,
    inputTokens: metrics.inputTokens,
    outputTokens: metrics.outputTokens,
    usageEstimated: metrics.usageEstimated,
  }
}

function isValidCoverageSource(value: unknown): value is KnowledgeSummaryCoverageSource {
  if (!isRecord(value)
    || !hasExactKeys(value, ['entryId', 'sourceVersionId', 'contentLength', 'ranges'])
    || !isNonEmptyString(value.entryId)
    || !isNonEmptyString(value.sourceVersionId)
    || !isSafeNonNegativeInteger(value.contentLength)) return false
  return rangesCoverContent(value.ranges, value.contentLength)
}

function validLeafEvidence(value: unknown, count: number): boolean {
  if (!Array.isArray(value) || value.length !== count || count < 1) return false
  const ids = new Set<string>()
  return value.every(item => {
    if (!isRecord(item) || !hasExactKeys(item, ['nodeId', 'signature', 'runId', 'requestId', 'binding', 'originalBinding']) || !['nodeId', 'signature', 'runId', 'requestId'].every(key => isNonEmptyString(item[key])) || ids.has(item.nodeId as string)) return false
    for (const binding of [item.binding, item.originalBinding]) {
      if (!isRecord(binding) || !hasExactKeys(binding, ['entryId', 'sourceVersionId', 'start', 'end', 'contentLength']) || !isNonEmptyString(binding.entryId) || !isNonEmptyString(binding.sourceVersionId) || !isSafeNonNegativeInteger(binding.start) || !isSafeNonNegativeInteger(binding.end) || !isSafeNonNegativeInteger(binding.contentLength) || binding.start > binding.end || binding.end > binding.contentLength) return false
    }
    const binding = item.binding as Record<string, unknown>, original = item.originalBinding as Record<string, unknown>
    if (['entryId', 'start', 'end', 'contentLength'].some(key => binding[key] !== original[key])) return false
    ids.add(item.nodeId as string); return true
  })
}

export function isKnowledgeSummaryCoverage(value: unknown): value is KnowledgeSummaryCoverage {
  if (!isRecord(value)
    || !hasExactKeys(value, [
      'version', 'strategy', 'sources', 'leafCount', 'requestCount',
      'inputTokens', 'outputTokens', 'usageEstimated', ...(value.leafEvidence === undefined ? [] : ['leafEvidence']),
    ])
    || value.version !== 1
    || value.strategy !== 'full-source-hierarchical'
    || !Array.isArray(value.sources)
    || value.sources.length === 0
    || !isSafeNonNegativeInteger(value.leafCount)
    || !isSafeNonNegativeInteger(value.requestCount)
    || !isSafeNonNegativeInteger(value.inputTokens)
    || !isSafeNonNegativeInteger(value.outputTokens)
    || typeof value.usageEstimated !== 'boolean'
    || (value.leafEvidence === undefined ? value.requestCount < value.leafCount : !validLeafEvidence(value.leafEvidence, value.leafCount))) return false

  const entryIds = new Set<string>()
  const sourceVersionIds = new Set<string>()
  let rangeCount = 0
  for (const source of value.sources) {
    if (!isValidCoverageSource(source)) return false
    if (entryIds.has(source.entryId) || sourceVersionIds.has(source.sourceVersionId)) return false
    entryIds.add(source.entryId)
    sourceVersionIds.add(source.sourceVersionId)
    if (rangeCount > MAX_SAFE_INTEGER - source.ranges.length) return false
    rangeCount += source.ranges.length
  }
  if (value.leafEvidence !== undefined) {
    const evidence = value.leafEvidence as NonNullable<KnowledgeSummaryCoverage['leafEvidence']>
    const bindings = (value.sources as KnowledgeSummaryCoverageSource[]).flatMap(source => source.ranges.map(range => JSON.stringify([source.entryId, source.sourceVersionId, range.start, range.end, source.contentLength])))
    const proof = evidence.map(item => JSON.stringify([item.binding.entryId, item.binding.sourceVersionId, item.binding.start, item.binding.end, item.binding.contentLength]))
    if (new Set(proof).size !== proof.length || bindings.some(key => !proof.includes(key))) return false
  }
  return value.leafCount === rangeCount
}

type ExpectedCoverageSource = {
  entryId: string
  sourceVersionId: string
  contentLength: number
}

export function coverageMatchesSources(
  coverage: unknown,
  expected: ExpectedCoverageSource[],
): boolean {
  if (!isKnowledgeSummaryCoverage(coverage) || !Array.isArray(expected)) return false

  const expectedKeys = new Set<string>()
  for (const source of expected) {
    if (!isRecord(source)
      || !hasExactKeys(source, ['entryId', 'sourceVersionId', 'contentLength'])
      || !isNonEmptyString(source.entryId)
      || !isNonEmptyString(source.sourceVersionId)
      || !isSafeNonNegativeInteger(source.contentLength)) return false
    const key = sourceKey(source.entryId, source.sourceVersionId)
    if (expectedKeys.has(key)) return false
    expectedKeys.add(key)
  }

  if (coverage.sources.length !== expected.length) return false
  return coverage.sources.every(source => {
    const key = sourceKey(source.entryId, source.sourceVersionId)
    if (!expectedKeys.has(key)) return false
    const expectedSource = expected.find(candidate => sourceKey(candidate.entryId, candidate.sourceVersionId) === key)
    return expectedSource !== undefined && source.contentLength === expectedSource.contentLength
  })
}
