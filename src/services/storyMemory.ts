import type { Chapter, Novel, Volume } from '@/types/novel'
import type { KnowledgeSummaryCoverage } from '@/types/knowledge'
import type {
  StoryMemoryBinding,
  StoryMemoryRecord,
  StoryMemoryRevision,
  StoryMemoryScope,
} from '@/types/storyMemory'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import { coverageMatchesSources, isKnowledgeSummaryCoverage } from './knowledgeSummaryCoverage'

export interface ResolvedStoryMemoryChapter {
  chapterId: string
  title: string
  chapterIndex: number
  volumeIndex: number
  sourceVersionId: string
  content: string
  startOffset: number
  endOffset: number
}

export interface ResolvedStoryMemorySource {
  versionId: string
  label: string
  throughChapterIndex: number
  chapters: ResolvedStoryMemoryChapter[]
}

export type StoryMemoryStatus = 'current' | 'stale' | 'unverified'

const MAX_TITLE_LENGTH = 200
const MAX_SUMMARY_LENGTH = 6000
const MAX_AUTHOR_SUMMARY_LENGTH = 12000
const MAX_HISTORY_LENGTH = 20

type PlainRecord = Record<string, unknown>
type SourceChapter = Pick<Chapter, 'id' | 'title' | 'chapterIndex' | 'volumeIndex' | 'content'>

function isRecord(value: unknown): value is PlainRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(value: PlainRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every(key => actual.includes(key))
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isSafeChapterVolumeIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= -1
}

function isValidDate(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false
  const date = value
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(date)
    || !Number.isFinite(Date.parse(date))) return false
  return new Date(date.slice(0, 10) + 'T00:00:00Z').toISOString().slice(0, 10) === date.slice(0, 10)
}

function assertRecord(value: unknown, label: string): asserts value is PlainRecord {
  if (!isRecord(value)) throw new Error(`${label} 必须是普通对象`)
}

function assertExactKeys(value: PlainRecord, keys: readonly string[], label: string): void {
  if (!hasExactKeys(value, keys)) throw new Error(`${label} 字段形状无效`)
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (!isNonEmptyString(value)) throw new Error(`${label} 必须是非空字符串`)
}

function assertBoundedText(value: unknown, label: string, maxLength: number): asserts value is string {
  assertNonEmptyString(value, label)
  if (value.length > maxLength) throw new Error(`${label} 不能超过 ${maxLength} 个字符`)
}

function assertDate(value: unknown, label: string): asserts value is string {
  if (!isValidDate(value)) throw new Error(`${label} 必须是真实日期`)
}

function assertSafeNonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (!isSafeNonNegativeInteger(value)) throw new Error(`${label} 必须是安全的非负整数`)
}

function assertOrigin(value: unknown, label: string): asserts value is 'author' | 'ai' {
  if (value !== 'author' && value !== 'ai') throw new Error(`${label} 必须是 author 或 ai`)
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xD800 && code <= 0xDBFF
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xDC00 && code <= 0xDFFF
}

function splitsSurrogatePair(content: string, offset: number): boolean {
  return offset > 0
    && offset < content.length
    && isHighSurrogate(content.charCodeAt(offset - 1))
    && isLowSurrogate(content.charCodeAt(offset))
}

function validateScopeShape(value: unknown, label: string): asserts value is StoryMemoryScope {
  assertRecord(value, label)
  if (value.kind === 'scene') {
    assertExactKeys(value, ['kind', 'chapterId', 'startOffset', 'endOffset'], label)
    assertNonEmptyString(value.chapterId, `${label}.chapterId`)
    assertSafeNonNegativeInteger(value.startOffset, `${label}.startOffset`)
    assertSafeNonNegativeInteger(value.endOffset, `${label}.endOffset`)
    if (value.startOffset >= value.endOffset) throw new Error(`${label} 区间必须非空`)
    return
  }
  if (value.kind === 'volume') {
    assertExactKeys(value, ['kind', 'volumeId', 'throughChapterId'], label)
    assertNonEmptyString(value.volumeId, `${label}.volumeId`)
    assertNonEmptyString(value.throughChapterId, `${label}.throughChapterId`)
    return
  }
  if (value.kind === 'book') {
    assertExactKeys(value, ['kind', 'throughChapterId'], label)
    assertNonEmptyString(value.throughChapterId, `${label}.throughChapterId`)
    return
  }
  throw new Error(`${label}.kind 无效`)
}

function validateBinding(value: unknown, label: string): asserts value is StoryMemoryBinding {
  assertRecord(value, label)
  const baseKeys = ['version', 'sourceVersionId', 'value', 'origin', 'confirmedAt']
  if (!hasExactKeys(value, baseKeys) && !hasExactKeys(value, [...baseKeys, 'coverage'])) {
    throw new Error(`${label} 字段形状无效`)
  }
  if (value.version !== 1) throw new Error(`${label}.version 无效`)
  assertNonEmptyString(value.sourceVersionId, `${label}.sourceVersionId`)
  assertNonEmptyString(value.value, `${label}.value`)
  assertOrigin(value.origin, `${label}.origin`)
  assertDate(value.confirmedAt, `${label}.confirmedAt`)
  if ('coverage' in value && !isKnowledgeSummaryCoverage(value.coverage)) {
    throw new Error(`${label}.coverage 结构无效`)
  }
}

interface ExpectedCoverageSource {
  entryId: string
  sourceVersionId: string
  contentLength: number
}

function validateRevision(value: unknown, index: number): asserts value is StoryMemoryRevision {
  const label = `history[${index}]`
  assertRecord(value, label)
  assertExactKeys(value, ['id', 'title', 'summary', 'scope', 'source', 'replacedAt'], label)
  assertNonEmptyString(value.id, `${label}.id`)
  assertBoundedText(value.title, `${label}.title`, MAX_TITLE_LENGTH)
  validateScopeShape(value.scope, `${label}.scope`)
  validateBinding(value.source, `${label}.source`)
  if (value.source.value !== value.summary) throw new Error(`${label}.source.value 必须等于 summary`)
  assertBoundedText(
    value.summary,
    `${label}.summary`,
    value.source.origin === 'author' ? MAX_AUTHOR_SUMMARY_LENGTH : MAX_SUMMARY_LENGTH,
  )
  assertDate(value.replacedAt, `${label}.replacedAt`)
}

export function assertStoryMemoryRecord(
  record: unknown,
  novelId: string,
): asserts record is StoryMemoryRecord {
  assertNonEmptyString(novelId, 'novelId')
  assertRecord(record, 'story memory record')
  assertExactKeys(record, ['id', 'novelId', 'title', 'scope', 'summary', 'source', 'history'], 'story memory record')
  assertNonEmptyString(record.id, 'record.id')
  assertNonEmptyString(record.novelId, 'record.novelId')
  if (record.novelId !== novelId) throw new Error('record.novelId 与小说不匹配')
  assertBoundedText(record.title, 'record.title', MAX_TITLE_LENGTH)
  validateScopeShape(record.scope, 'record.scope')
  validateBinding(record.source, 'record.source')
  if (record.source.value !== record.summary) throw new Error('record.source.value 必须等于 summary')
  assertBoundedText(
    record.summary,
    'record.summary',
    record.source.origin === 'author' ? MAX_AUTHOR_SUMMARY_LENGTH : MAX_SUMMARY_LENGTH,
  )
  if (!Array.isArray(record.history) || record.history.length > MAX_HISTORY_LENGTH) {
    throw new Error(`record.history 最多只能有 ${MAX_HISTORY_LENGTH} 条`)
  }
  const historyIds = new Set<string>()
  for (let index = 0; index < record.history.length; index += 1) {
    validateRevision(record.history[index], index)
    const revision = record.history[index]
    if (revision.id === record.id || historyIds.has(revision.id)) {
      throw new Error('history id 必须唯一且不能等于当前记录 id')
    }
    historyIds.add(revision.id)
  }
}

interface ValidatedNovel {
  chapters: SourceChapter[]
  volumes: Volume[]
  volumeByIndex: Map<number, Volume>
}

function validateNovel(novel: Novel): ValidatedNovel {
  if (!isRecord(novel)) throw new Error('novel 必须是普通对象')
  assertNonEmptyString(novel.id, 'novel.id')
  if (!Array.isArray(novel.chapters)) throw new Error('novel.chapters 必须是数组')
  if (!Array.isArray(novel.volumes)) throw new Error('novel.volumes 必须是数组')

  const chapters = novel.chapters as unknown as SourceChapter[]
  const volumes = novel.volumes as unknown as Volume[]
  const chapterIds = new Set<string>()
  const chapterIndexes = new Set<number>()
  const volumeIds = new Set<string>()
  const volumeIndexes = new Set<number>()
  const volumeByIndex = new Map<number, Volume>()

  for (const volume of volumes) {
    if (!isRecord(volume)) throw new Error('卷数据形状无效')
    assertNonEmptyString(volume.id, 'volume.id')
    assertNonEmptyString(volume.title, 'volume.title')
    assertSafeNonNegativeInteger(volume.volumeIndex, 'volume.volumeIndex')
    if (volumeIds.has(volume.id) || volumeIndexes.has(volume.volumeIndex)) {
      throw new Error('卷 id 或 volumeIndex 重复')
    }
    volumeIds.add(volume.id)
    volumeIndexes.add(volume.volumeIndex)
    volumeByIndex.set(volume.volumeIndex, volume)
  }

  for (const chapter of chapters) {
    if (!isRecord(chapter)) throw new Error('章节数据形状无效')
    assertNonEmptyString(chapter.id, 'chapter.id')
    if (typeof chapter.title !== 'string') throw new Error('chapter.title 必须是字符串')
    if (typeof chapter.content !== 'string') throw new Error('chapter.content 必须是字符串')
    assertSafeNonNegativeInteger(chapter.chapterIndex, 'chapter.chapterIndex')
    if (!isSafeChapterVolumeIndex(chapter.volumeIndex)) {
      throw new Error('chapter.volumeIndex 必须是大于等于 -1 的安全整数')
    }
    if (chapterIds.has(chapter.id) || chapterIndexes.has(chapter.chapterIndex)) {
      throw new Error('章节 id 或 chapterIndex 重复')
    }
    chapterIds.add(chapter.id)
    chapterIndexes.add(chapter.chapterIndex)
  }
  return { chapters, volumes, volumeByIndex }
}

function sourceVersionForChapter(chapter: SourceChapter, startOffset: number, endOffset: number): string {
  const fullVersion = buildAnalysisSourceVersionId(chapter.content)
  return `chapter:${chapter.id}|${fullVersion}|range:${startOffset}:${endOffset}`
}

function makeVersionId(
  novelId: string,
  scope: StoryMemoryScope,
  chapters: ResolvedStoryMemoryChapter[],
  sourceChapters: SourceChapter[],
  volumeByIndex: Map<number, Volume>,
): string {
  const sourceChapterById = new Map(sourceChapters.map(chapter => [chapter.id, chapter]))
  const payload = {
    version: 1,
    novelId,
    scope,
    chapters: chapters.map(chapter => {
      const volume = volumeByIndex.get(chapter.volumeIndex)
      return {
        chapterId: chapter.chapterId,
        title: chapter.title,
        chapterIndex: chapter.chapterIndex,
        volumeIndex: chapter.volumeIndex,
        volumeId: volume?.id,
        volumeTitle: volume?.title,
        fullContentVersionId: buildAnalysisSourceVersionId(
          sourceChapterById.get(chapter.chapterId)!.content,
        ),
        startOffset: chapter.startOffset,
        endOffset: chapter.endOffset,
      }
    }),
  }
  return `story-memory-v1:${buildAnalysisSourceVersionId(JSON.stringify(payload))}`
}

function chapterLabel(chapterIndex: number): string {
  return `第 ${chapterIndex + 1} 章`
}

function resolveEndChapter(chapters: SourceChapter[], chapterId: string): SourceChapter {
  const matches = chapters.filter(chapter => chapter.id === chapterId)
  if (matches.length !== 1) throw new Error('结束章节不存在或不唯一')
  return matches[0]
}

function ensureSelectedChaptersExist(chapters: SourceChapter[]): void {
  if (chapters.length === 0) throw new Error('来源范围没有章节')
}

export function resolveStoryMemorySource(
  novel: Novel,
  scope: StoryMemoryScope,
): ResolvedStoryMemorySource {
  const validated = validateNovel(novel)
  validateScopeShape(scope, 'scope')
  const chapters = validated.chapters
  let selected: SourceChapter[]
  let throughChapter: SourceChapter
  let scopeLabel: string

  if (scope.kind === 'scene') {
    const chapter = resolveEndChapter(chapters, scope.chapterId)
    if (scope.startOffset >= scope.endOffset
      || scope.endOffset > chapter.content.length
      || splitsSurrogatePair(chapter.content, scope.startOffset)
      || splitsSurrogatePair(chapter.content, scope.endOffset)) {
      throw new Error('scene 必须是章内不拆代理对的非空 UTF16 半开区间')
    }
    selected = [chapter]
    throughChapter = chapter
    scopeLabel = `${chapterLabel(chapter.chapterIndex)}片段`
  } else if (scope.kind === 'volume') {
    const volumeMatches = validated.volumes.filter(volume => volume.id === scope.volumeId)
    if (volumeMatches.length !== 1) throw new Error('卷不存在或不唯一')
    const volume = volumeMatches[0]
    throughChapter = resolveEndChapter(chapters, scope.throughChapterId)
    if (throughChapter.volumeIndex !== volume.volumeIndex) throw new Error('结束章节不在指定卷内')
    selected = chapters.filter(chapter =>
      chapter.volumeIndex === volume.volumeIndex && chapter.chapterIndex <= throughChapter.chapterIndex,
    )
    scopeLabel = `卷「${volume.title}」${chapterLabel(throughChapter.chapterIndex)}止`
  } else {
    throughChapter = resolveEndChapter(chapters, scope.throughChapterId)
    selected = chapters.filter(chapter => chapter.chapterIndex <= throughChapter.chapterIndex)
    scopeLabel = `全书${chapterLabel(throughChapter.chapterIndex)}止`
  }

  ensureSelectedChaptersExist(selected)
  selected.sort((left, right) => left.chapterIndex - right.chapterIndex)
  const resolvedChapters = selected.map(chapter => {
    const startOffset = scope.kind === 'scene' ? scope.startOffset : 0
    const endOffset = scope.kind === 'scene' ? scope.endOffset : chapter.content.length
    return {
      chapterId: chapter.id,
      title: chapter.title,
      chapterIndex: chapter.chapterIndex,
      volumeIndex: chapter.volumeIndex,
      sourceVersionId: sourceVersionForChapter(chapter, startOffset, endOffset),
      content: chapter.content.slice(startOffset, endOffset),
      startOffset,
      endOffset,
    }
  })
  if (resolvedChapters.some(chapter => chapter.content.trim().length === 0)) {
    throw new Error('选中的正文不能为空或只能包含空白字符')
  }
  const versionId = makeVersionId(novel.id, scope, resolvedChapters, selected, validated.volumeByIndex)
  return {
    versionId,
    label: scopeLabel,
    throughChapterIndex: throughChapter.chapterIndex,
    chapters: resolvedChapters,
  }
}

function cloneCoverage(coverage: KnowledgeSummaryCoverage): KnowledgeSummaryCoverage {
  return JSON.parse(JSON.stringify(coverage)) as KnowledgeSummaryCoverage
}

function expectedSources(source: ResolvedStoryMemorySource): ExpectedCoverageSource[] {
  return source.chapters.map(chapter => ({
    entryId: chapter.chapterId,
    sourceVersionId: chapter.sourceVersionId,
    contentLength: chapter.content.length,
  }))
}

export function createStoryMemoryBinding(
  novel: Novel,
  scope: StoryMemoryScope,
  summary: string,
  origin: StoryMemoryBinding['origin'],
  now: string,
  coverage?: KnowledgeSummaryCoverage,
): StoryMemoryBinding {
  const source = resolveStoryMemorySource(novel, scope)
  assertOrigin(origin, 'origin')
  assertDate(now, 'confirmedAt')
  assertBoundedText(
    summary,
    'summary',
    origin === 'author' ? MAX_AUTHOR_SUMMARY_LENGTH : MAX_SUMMARY_LENGTH,
  )
  if (origin === 'ai') {
    if (!isKnowledgeSummaryCoverage(coverage) || !coverageMatchesSources(coverage, expectedSources(source))) {
      throw new Error('AI 记忆必须提供完整且匹配来源章节的 coverage')
    }
    return {
      version: 1,
      sourceVersionId: source.versionId,
      value: summary,
      origin,
      confirmedAt: now,
      coverage: cloneCoverage(coverage),
    }
  }
  return {
    version: 1,
    sourceVersionId: source.versionId,
    value: summary,
    origin,
    confirmedAt: now,
  }
}

export function getStoryMemoryStatus(novel: Novel, record: unknown): StoryMemoryStatus {
  try {
    assertStoryMemoryRecord(record, novel.id)
  } catch {
    return 'unverified'
  }
  if (record.source.value !== record.summary) return 'unverified'

  let source: ResolvedStoryMemorySource
  try {
    source = resolveStoryMemorySource(novel, record.scope)
  } catch {
    return 'stale'
  }
  if (record.source.sourceVersionId !== source.versionId) return 'stale'
  if (record.source.origin === 'ai' && !coverageMatchesSources(record.source.coverage, expectedSources(source))) {
    return 'unverified'
  }
  return 'current'
}

interface ContextCandidate {
  record: StoryMemoryRecord
  source: ResolvedStoryMemorySource
  intervals: Array<{ chapterId: string; startOffset: number; endOffset: number }>
  breadth: number
  span: number
  entry: string
}

interface EligibleStoryMemory {
  record: StoryMemoryRecord
  source: ResolvedStoryMemorySource
}

function eligibleStoryMemories(
  novel: Novel,
  records: ReadonlyArray<StoryMemoryRecord>,
  beforeChapterIndex: number,
): EligibleStoryMemory[] {
  if (!Array.isArray(records) || !isSafeNonNegativeInteger(beforeChapterIndex)) return []
  const eligible: EligibleStoryMemory[] = []
  for (const record of records) {
    if (getStoryMemoryStatus(novel, record) !== 'current') continue
    try {
      const source = resolveStoryMemorySource(novel, record.scope)
      if (source.throughChapterIndex < beforeChapterIndex) eligible.push({ record, source })
    } catch {
      // A record can be valid backup data while its source has since disappeared.
    }
  }
  return eligible
}

function normalizedScope(scope: StoryMemoryScope): StoryMemoryScope {
  if (scope.kind === 'scene') {
    return {
      kind: 'scene',
      chapterId: scope.chapterId,
      startOffset: scope.startOffset,
      endOffset: scope.endOffset,
    }
  }
  if (scope.kind === 'volume') {
    return {
      kind: 'volume',
      volumeId: scope.volumeId,
      throughChapterId: scope.throughChapterId,
    }
  }
  return { kind: 'book', throughChapterId: scope.throughChapterId }
}

export function storyMemorySignature(
  novel: Novel,
  records: ReadonlyArray<StoryMemoryRecord>,
  beforeChapterIndex: number,
): string {
  const tuples = eligibleStoryMemories(novel, records, beforeChapterIndex)
    .map(({ record, source }) => [
      record.id,
      record.title,
      normalizedScope(record.scope),
      source.versionId,
      record.summary,
    ] as const)
    .sort((left, right) => {
      const leftKey = JSON.stringify(left)
      const rightKey = JSON.stringify(right)
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
    })
  return JSON.stringify(tuples)
}

function contextBoundary(record: StoryMemoryRecord, source: ResolvedStoryMemorySource): string {
  if (record.scope.kind === 'scene') {
    const chapter = source.chapters[0]
    return `${chapterLabel(chapter.chapterIndex)}片段 ${chapter.startOffset}–${chapter.endOffset}`
  }
  const first = source.chapters[0]
  const last = source.chapters[source.chapters.length - 1]
  return `${chapterLabel(first.chapterIndex)}–${chapterLabel(last.chapterIndex)}`
}

function mergeCoveredInterval(
  intervals: Array<{ startOffset: number; endOffset: number }>,
  next: { startOffset: number; endOffset: number },
): Array<{ startOffset: number; endOffset: number }> {
  const merged = [...intervals, next].sort((left, right) =>
    left.startOffset - right.startOffset || left.endOffset - right.endOffset,
  )
  const result: Array<{ startOffset: number; endOffset: number }> = []
  for (const interval of merged) {
    const previous = result[result.length - 1]
    if (previous && interval.startOffset <= previous.endOffset) {
      previous.endOffset = Math.max(previous.endOffset, interval.endOffset)
    } else {
      result.push({ ...interval })
    }
  }
  return result
}

function isIntervalCovered(
  intervals: Array<{ startOffset: number; endOffset: number }> | undefined,
  candidate: { startOffset: number; endOffset: number },
): boolean {
  return intervals?.some(interval =>
    interval.startOffset <= candidate.startOffset && interval.endOffset >= candidate.endOffset,
  ) ?? false
}

export function formatStoryMemoryContext(
  novel: Novel,
  records: ReadonlyArray<StoryMemoryRecord>,
  beforeChapterIndex: number,
  maxChars = 1800,
): string {
  if (!Array.isArray(records)
    || !isSafeNonNegativeInteger(beforeChapterIndex)
    || !isSafeNonNegativeInteger(maxChars)
    || maxChars === 0) return ''

  const candidates: ContextCandidate[] = []
  for (const { record, source } of eligibleStoryMemories(novel, records, beforeChapterIndex)) {
    const entry = `【已写正文回顾｜覆盖 ${contextBoundary(record, source)}｜${record.title}】\n${record.summary}`
    candidates.push({
      record,
      source,
      intervals: source.chapters.map(chapter => ({
        chapterId: chapter.chapterId,
        startOffset: chapter.startOffset,
        endOffset: chapter.endOffset,
      })),
      breadth: source.chapters.length,
      span: source.chapters.reduce((total, chapter) => total + chapter.endOffset - chapter.startOffset, 0),
      entry,
    })
  }

  candidates.sort((left, right) =>
    right.source.throughChapterIndex - left.source.throughChapterIndex
    || right.breadth - left.breadth
    || right.span - left.span
    || left.record.id.localeCompare(right.record.id),
  )

  const coveredIntervals = new Map<string, Array<{ startOffset: number; endOffset: number }>>()
  const selected: string[] = []
  for (const candidate of candidates) {
    const addsCoverage = candidate.intervals.some(interval =>
      !isIntervalCovered(coveredIntervals.get(interval.chapterId), interval),
    )
    if (!addsCoverage) continue
    const nextLength = selected.length === 0
      ? candidate.entry.length
      : selected.join('\n\n').length + 2 + candidate.entry.length
    if (nextLength > maxChars) continue
    selected.push(candidate.entry)
    for (const interval of candidate.intervals) {
      coveredIntervals.set(interval.chapterId, mergeCoveredInterval(
        coveredIntervals.get(interval.chapterId) || [],
        interval,
      ))
    }
  }
  return selected.join('\n\n')
}
