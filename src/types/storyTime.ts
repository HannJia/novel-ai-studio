import type { Chapter, Novel, StoryClock } from './novel'

export type StoryTimeBoundary = 'origin' | 'chapter'
export type StoryTimeRecordKind = 'origin' | 'absolute' | 'relative'
export type StoryTimeRecordStatus = 'current' | 'superseded' | 'invalid' | 'legacy'

/** A durable, replayable time fact. The record is never rebound to a new chapter number. */
export interface StoryTimeRecord {
  id: string
  kind: StoryTimeRecordKind
  status: StoryTimeRecordStatus
  boundary: StoryTimeBoundary
  chapterId?: string
  chapterIndex?: number
  startDay: number
  endDay: number
  elapsedDays: number
  confirmedAt: string
  confirmationOrder: number
  source: 'author' | 'canon' | 'legacy'
  sourceVersionId?: string
  dependsOnRecordId?: string
  label?: string
  invalidReason?: string
}

export interface StoryTimeOrigin {
  id: string
  day: number
  label: string
  confirmedAt: string
  source: 'author' | 'legacy'
}

export interface StoryTimeProjection {
  known: boolean
  startDay?: number
  endDay?: number
  elapsedDays?: number
  label?: string
  recordId?: string
  startRecordId?: string
  sourceVersionId?: string
  reason?: string
}

/** A specific coordinate in an immutable, author-confirmed time record. */
export interface StoryTimePointSource {
  recordId: string
  boundary: 'start' | 'end'
  day: number
}

export interface StoryTimeConfirmation {
  chapterId: string
  chapterIndex: number
  content: string
  mode: 'absolute' | 'relative'
  elapsedDays?: number
  startDay?: number
  endDay?: number
  label?: string
  source: 'author' | 'canon'
  expectedRecordId?: string
  expectedSourceVersionId?: string
  replace?: boolean
}

export interface StoryTimeMutationResult {
  changed: boolean
  record?: StoryTimeRecord
  projection: StoryTimeProjection
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const finiteDay = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const nonempty = (value: unknown): value is string => typeof value === 'string' && !!value.trim()
const validDate = (value: unknown): value is string => nonempty(value) && Number.isFinite(Date.parse(value))
const orderValid = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const roundDay = (value: number) => Math.round(value * 100) / 100

export function storyTimeOriginWellFormed(value: unknown): value is StoryTimeOrigin {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as StoryTimeOrigin
  return nonempty(row.id) && finiteDay(row.day) && row.day >= 0 && typeof row.label === 'string'
    && validDate(row.confirmedAt) && ['author', 'legacy'].includes(row.source)
}

export function storyTimeRecordWellFormed(value: unknown): value is StoryTimeRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as StoryTimeRecord
  if (!nonempty(row.id) || !['origin', 'absolute', 'relative'].includes(row.kind)
    || !['current', 'superseded', 'invalid', 'legacy'].includes(row.status)
    || !['origin', 'chapter'].includes(row.boundary) || !['author', 'canon', 'legacy'].includes(row.source)
    || !finiteDay(row.startDay) || !finiteDay(row.endDay) || !finiteDay(row.elapsedDays)
    || row.startDay < 0 || row.endDay < row.startDay || row.elapsedDays < 0
    || Math.abs(roundDay(row.endDay - row.startDay) - row.elapsedDays) > 0.000001
    || !validDate(row.confirmedAt) || !orderValid(row.confirmationOrder)
    || (row.label !== undefined && typeof row.label !== 'string')
    || (row.invalidReason !== undefined && typeof row.invalidReason !== 'string')) return false
  if (row.boundary === 'origin') return row.kind === 'origin' && row.source !== 'canon'
    && row.chapterId === undefined && row.chapterIndex === undefined && row.sourceVersionId === undefined
    && row.dependsOnRecordId === undefined && row.startDay === row.endDay && row.elapsedDays === 0
  return row.kind !== 'origin' && nonempty(row.chapterId) && orderValid(row.chapterIndex)
    && nonempty(row.sourceVersionId) && (row.kind === 'relative' ? nonempty(row.dependsOnRecordId) : row.dependsOnRecordId === undefined)
}

export function storyTimeSourceVersion(content: string): string {
  let hash = 2166136261
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `story-content:${(hash >>> 0).toString(16)}:${content.length}`
}

export function createStoryClock(novelId: string, now: string, day: number, label?: string): StoryClock {
  if (!finiteDay(day) || day < 0 || !Number.isFinite(day * 100)) throw new Error('故事起点必须是有效的非负数字。')
  const safeDay = Math.round(day * 100) / 100
  const display = label?.trim() || `第 ${safeDay + 1} 天`
  const origin: StoryTimeOrigin = { id: `story-time-origin:${novelId}`, day: safeDay, label: display, confirmedAt: now, source: 'author' }
  const record: StoryTimeRecord = { id: origin.id, kind: 'origin', status: 'current', boundary: 'origin', startDay: safeDay, endDay: safeDay,
    elapsedDays: 0, confirmedAt: now, confirmationOrder: 0, source: 'author', label: display }
  return { currentDay: safeDay, label: display, lastChapterIndex: -1, updatedAt: now, origin, confirmationSequence: 0, history: [record] }
}

export function normalizeStoryClock(value: unknown, fallbackUpdatedAt: string): StoryClock | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Partial<StoryClock> & { history?: unknown; origin?: unknown }
  if (!finiteDay(raw.currentDay) || typeof raw.label !== 'string') return undefined
  const maxStoredOrder = Array.isArray(raw.history) ? raw.history.reduce((max, item) =>
    Math.max(max, item && orderValid(item.confirmationOrder) ? item.confirmationOrder : 0), 0) : 0
  const normalizeRecord = (item: unknown, index: number): StoryTimeRecord => {
    const row = item && typeof item === 'object' && !Array.isArray(item) ? item as Partial<StoryTimeRecord> : {}
    const valid = storyTimeRecordWellFormed(row)
    if (valid) return clone(row as StoryTimeRecord)
    const startDay = finiteDay(row.startDay) && row.startDay >= 0 ? row.startDay : 0
    const endDay = finiteDay(row.endDay) && row.endDay >= startDay ? row.endDay : startDay
    return { id: nonempty(row.id) ? row.id : `invalid-story-time:${index}`,
      kind: row.kind && ['origin', 'absolute', 'relative'].includes(row.kind) ? row.kind : row.boundary === 'origin' ? 'origin' : 'relative', status: 'invalid',
      boundary: row.boundary === 'origin' || row.kind === 'origin' ? 'origin' : 'chapter',
      ...(nonempty(row.chapterId) ? { chapterId: row.chapterId } : {}), ...(orderValid(row.chapterIndex) ? { chapterIndex: row.chapterIndex } : {}),
      ...(nonempty(row.sourceVersionId) ? { sourceVersionId: row.sourceVersionId } : {}),
      ...(nonempty(row.dependsOnRecordId) ? { dependsOnRecordId: row.dependsOnRecordId } : {}),
      ...(typeof row.label === 'string' ? { label: row.label } : {}),
      startDay, endDay, elapsedDays: finiteDay(row.elapsedDays) && row.elapsedDays >= 0 ? row.elapsedDays : roundDay(endDay - startDay),
      confirmedAt: validDate(row.confirmedAt) ? row.confirmedAt : fallbackUpdatedAt,
      confirmationOrder: orderValid(row.confirmationOrder) ? row.confirmationOrder : maxStoredOrder + index + 1,
      source: row.source && ['author', 'canon', 'legacy'].includes(row.source) ? row.source : 'legacy', invalidReason: '故事时间历史记录格式无效。' }
  }
  const history = Array.isArray(raw.history) ? raw.history.map(normalizeRecord) : undefined
  // A corrupt append still shadows the old head; preserve both as history.
  for (const row of history || []) {
    const peers = (history || []).filter(item => row.boundary === 'origin' ? item.boundary === 'origin' : item.chapterId === row.chapterId)
    if (row.status === 'current' && latestRecord(peers) !== row) row.status = 'superseded'
  }
  const origin = storyTimeOriginWellFormed(raw.origin) ? clone(raw.origin) : undefined
  return { currentDay: Math.max(0, raw.currentDay), label: raw.label.trim() || `第 ${raw.currentDay + 1} 天`,
    lastChapterIndex: Number.isSafeInteger(raw.lastChapterIndex) ? raw.lastChapterIndex : undefined,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : fallbackUpdatedAt,
    ...(origin ? { origin } : {}), ...(history?.length ? { history } : {}),
    ...(history?.length ? { confirmationSequence: history.reduce((max, row) => Math.max(max, row.confirmationOrder),
      orderValid(raw.confirmationSequence) ? raw.confirmationSequence : 0) }
      : orderValid(raw.confirmationSequence) ? { confirmationSequence: raw.confirmationSequence } : {}) }
}

function records(clock: StoryClock | undefined): StoryTimeRecord[] { return clock?.history || [] }
/** Select the head before validation: a bad latest record must shadow older facts. */
function latestRecord(rows: StoryTimeRecord[]): StoryTimeRecord | undefined {
  return rows.reduce<StoryTimeRecord | undefined>((head, row) => !head
    || (orderValid(row.confirmationOrder) ? row.confirmationOrder : Number.MAX_SAFE_INTEGER)
      >= (orderValid(head.confirmationOrder) ? head.confirmationOrder : Number.MAX_SAFE_INTEGER) ? row : head, undefined)
}
function chapterRecord(clock: StoryClock | undefined, chapterId: string): StoryTimeRecord | undefined {
  return latestRecord(records(clock).filter(row => row.chapterId === chapterId))
}
function originRecord(clock: StoryClock | undefined): StoryTimeRecord | undefined {
  return latestRecord(records(clock).filter(row => row.boundary === 'origin' || row.kind === 'origin'))
}

/** Per-snapshot memoization: long relative chains are traversed once, without recursion. */
function recordValidator(novel: Novel): (row: StoryTimeRecord) => boolean {
  const counts = new Map<string, number>(), heads = new Map<string, StoryTimeRecord>()
  const byId = new Map(novel.chapters.map(chapter => [chapter.id, chapter]))
  const byIndex = new Map(novel.chapters.map(chapter => [chapter.chapterIndex, chapter]))
  const versions = new Map<string, string>(), memo = new Map<StoryTimeRecord, boolean>()
  const originHead = originRecord(novel.storyClock)
  for (const row of records(novel.storyClock)) {
    counts.set(row.id, (counts.get(row.id) || 0) + 1)
    if (row.chapterId) heads.set(row.chapterId, latestRecord([...(heads.has(row.chapterId) ? [heads.get(row.chapterId)!] : []), row])!)
  }
  return initial => {
    const path: StoryTimeRecord[] = [], seen = new Set<string>()
    let row = initial, valid = false
    while (true) {
      if (memo.has(row)) { valid = memo.get(row)!; break }
      path.push(row)
      if (!storyTimeRecordWellFormed(row) || row.status !== 'current' || row.source === 'legacy'
        || seen.has(row.id) || counts.get(row.id) !== 1) break
      seen.add(row.id)
      if (row.boundary === 'origin') {
        const origin = novel.storyClock?.origin
        valid = originHead === row && storyTimeOriginWellFormed(origin) && origin.source === 'author'
          && row.source === 'author' && origin.id === row.id && origin.day === row.endDay
          && origin.label === row.label && origin.confirmedAt === row.confirmedAt
        break
      }
      const chapter = byId.get(row.chapterId!)
      if (!chapter || chapter.chapterIndex !== row.chapterIndex || heads.get(chapter.id) !== row) break
      if (!versions.has(chapter.id)) versions.set(chapter.id, storyTimeSourceVersion(chapter.content))
      if (row.sourceVersionId !== versions.get(chapter.id)) break
      if (row.kind === 'absolute') { valid = true; break }
      const previous = byIndex.get(chapter.chapterIndex - 1)
      const dependency = chapter.chapterIndex === 0 ? originHead : previous ? heads.get(previous.id) : undefined
      if (!dependency || dependency.id !== row.dependsOnRecordId || dependency.endDay !== row.startDay
        || dependency.confirmationOrder >= row.confirmationOrder) break
      row = dependency
    }
    for (const item of path) memo.set(item, valid)
    return valid
  }
}
function recordValid(novel: Novel, row: StoryTimeRecord): boolean { return recordValidator(novel)(row) }

export function storyTimePointWellFormed(value: unknown): value is StoryTimePointSource {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const point = value as StoryTimePointSource
  return nonempty(point.recordId) && ['start', 'end'].includes(point.boundary) && finiteDay(point.day) && point.day >= 0
}

export function storyTimePointIsCurrent(novel: Novel, point: StoryTimePointSource, throughChapterIndex?: number): boolean {
  if (!storyTimePointWellFormed(point)) return false
  const row = records(novel.storyClock).find(record => record.id === point.recordId)
  return !!row && recordValid(novel, row) && (point.boundary === 'start' ? row.startDay : row.endDay) === point.day
    && (throughChapterIndex === undefined || row.boundary === 'origin' || row.chapterIndex! <= throughChapterIndex)
}

export function captureStoryTimePoint(novel: Novel, chapterId?: string, boundary: 'start' | 'end' = 'end'): StoryTimePointSource | undefined {
  const row = chapterId === undefined ? originRecord(novel.storyClock) : chapterRecord(novel.storyClock, chapterId)
  return row && recordValid(novel, row) ? { recordId: row.id, boundary, day: boundary === 'start' ? row.startDay : row.endDay } : undefined
}

/** Relative chains already retain their ancestors. Keep independent absolute anchors explicitly. */
export function mergeStoryTimePointSources(novel: Novel, sources: StoryTimePointSource[], end: StoryTimePointSource): StoryTimePointSource[] {
  const history = new Map(records(novel.storyClock).map(row => [row.id, row]))
  const ancestors = new Set<string>()
  let row = history.get(end.recordId)
  while (row && !ancestors.has(row.id)) {
    ancestors.add(row.id)
    row = row.dependsOnRecordId ? history.get(row.dependsOnRecordId) : undefined
  }
  return [...sources.filter(point => !ancestors.has(point.recordId)), end].map(point => ({ ...point }))
}

export function projectStoryTimeOrigin(novel: Novel): StoryTimeProjection {
  const row = originRecord(novel.storyClock)
  return row && recordValid(novel, row)
    ? { known: true, startDay: row.startDay, endDay: row.endDay, label: row.label, recordId: row.id }
    : { known: false, recordId: row?.id, reason: '故事起点缺少有效的作者确认来源。' }
}

export function projectStoryTime(novel: Novel, chapter: Chapter): StoryTimeProjection {
  return projectChapterTime(novel, chapter, recordValidator(novel))
}
function projectChapterTime(novel: Novel, chapter: Chapter, valid: (row: StoryTimeRecord) => boolean): StoryTimeProjection {
  const row = chapterRecord(novel.storyClock, chapter.id)
  if (row && valid(row)) return { known: true, startDay: row.startDay, endDay: row.endDay, elapsedDays: row.elapsedDays,
    label: row.label, recordId: row.id, sourceVersionId: row.sourceVersionId, startRecordId: row.dependsOnRecordId || row.id }
  const previous = novel.chapters.find(item => item.chapterIndex === chapter.chapterIndex - 1)
  const prior = chapter.chapterIndex === 0 ? originRecord(novel.storyClock)
    : previous ? chapterRecord(novel.storyClock, previous.id) : undefined
  const start = prior && valid(prior) ? { startDay: prior.endDay, startRecordId: prior.id } : {}
  return { known: false, ...start, recordId: row?.id, sourceVersionId: row?.sourceVersionId,
    reason: row ? '本章最新时间来源已失效，需作者重新确认。'
      : start.startDay !== undefined ? '本章结束时间尚未由作者确认。' : '缺少有效的紧邻前序时间来源。' }
}

export function projectStoryTimeAtChapter(novel: Novel, chapterIndex: number): StoryTimeProjection {
  const chapter = novel.chapters.find(item => item.chapterIndex === chapterIndex)
  return chapter ? projectStoryTime(novel, chapter) : { known: false, reason: '章节不存在。' }
}

export function projectStoryTimeTimeline(novel: Novel, beforeChapterIndex: number): Array<{ chapterId: string; chapterIndex: number; title: string; time: StoryTimeProjection }> {
  const valid = recordValidator(novel)
  return novel.chapters.filter(chapter => chapter.chapterIndex < beforeChapterIndex).sort((a, b) => a.chapterIndex - b.chapterIndex)
    .map(chapter => ({ chapterId: chapter.id, chapterIndex: chapter.chapterIndex, title: chapter.title, time: projectChapterTime(novel, chapter, valid) }))
}

function nextOrder(clock: StoryClock | undefined): number {
  const sequence = clock?.confirmationSequence
  const order = records(clock).reduce((max, row) => Math.max(max, orderValid(row.confirmationOrder) ? row.confirmationOrder : 0),
    orderValid(sequence) ? sequence : 0) + 1
  if (!Number.isSafeInteger(order)) throw new Error('时间历史顺序已损坏，请先修复来源记录。')
  return order
}

export function recordStoryTime(novel: Novel, input: StoryTimeConfirmation, now: string, id: () => string): StoryTimeMutationResult {
  const chapter = novel.chapters.find(item => item.id === input.chapterId)
  if (!chapter || chapter.chapterIndex !== input.chapterIndex) throw new Error('故事时间对应章节已经变化，请重新打开后确认。')
  if (chapter.content !== input.content) throw new Error('正文已经变化，请重新核对故事时间。')
  if (chapter.status === 'locked') throw new Error('章节已锁定，请先解锁。')
  if (!['author', 'canon'].includes(input.source) || !['absolute', 'relative'].includes(input.mode)) throw new Error('时间确认来源或模式无效。')
  const sourceVersionId = storyTimeSourceVersion(input.content)
  if (input.expectedSourceVersionId !== undefined && input.expectedSourceVersionId !== sourceVersionId) throw new Error('正文来源版本已变化，请重新核对。')
  const existing = chapterRecord(novel.storyClock, chapter.id)
  if ((input.replace || input.expectedRecordId !== undefined) && input.expectedRecordId !== existing?.id) throw new Error('时间记录已变化，请重新打开后确认。')
  const normalizedLabel = input.label === undefined ? existing?.label : input.label.trim() || undefined
  if (existing && recordValid(novel, existing) && existing.sourceVersionId === sourceVersionId) {
    const same = input.mode === 'relative'
      ? input.elapsedDays === existing.elapsedDays && normalizedLabel === existing.label
      : input.startDay === existing.startDay && input.endDay === existing.endDay && normalizedLabel === existing.label
    if (same && (!input.replace || existing.kind === input.mode)) return { changed: false, record: existing, projection: projectStoryTime(novel, chapter) }
    if (!input.replace || input.expectedRecordId !== existing.id || input.source !== 'author') throw new Error('本章已经确认过当前正文的故事时间，请先明确替换已有锚点。')
  } else if (existing && (!recordValid(novel, existing) || existing.sourceVersionId !== sourceVersionId)
    && (!input.replace || input.expectedRecordId !== existing.id || input.source !== 'author')) {
    throw new Error('本章最新故事时间来源已经失效，请先明确替换该来源。')
  }
  let startDay: number, endDay: number, dependsOnRecordId: string | undefined
  if (input.mode === 'relative') {
    if (!finiteDay(input.elapsedDays) || input.elapsedDays < 0) throw new Error('本章经过天数必须是明确的非负数字。')
    const previous = novel.chapters.find(item => item.chapterIndex === chapter.chapterIndex - 1)
    const dependency = chapter.chapterIndex === 0 ? originRecord(novel.storyClock)
      : previous ? chapterRecord(novel.storyClock, previous.id) : undefined
    if (!dependency || !recordValid(novel, dependency)) {
      throw new Error('紧邻前序时间来源无效，请先核对前序章节或明确填写绝对开始日和结束日。')
    }
    startDay = dependency.endDay; endDay = roundDay(startDay + input.elapsedDays)
    dependsOnRecordId = dependency.id
  } else {
    if (!finiteDay(input.startDay) || !finiteDay(input.endDay) || input.startDay < 0 || input.endDay < input.startDay) {
      throw new Error('绝对故事时间锚点必须包含有效的开始日和结束日。')
    }
    startDay = Math.round(input.startDay * 100) / 100; endDay = Math.round(input.endDay * 100) / 100
  }
  if (!finiteDay(startDay) || !finiteDay(endDay)) throw new Error('时间数值超出有效范围。')
  const clock = novel.storyClock || { currentDay: endDay, label: '起点待确认', updatedAt: now }
  const history = [...records(clock).map(row => row.chapterId === chapter.id && row.status === 'current' ? { ...row, status: 'superseded' as const } : row)]
  const order = nextOrder(clock)
  const record: StoryTimeRecord = { id: id(), kind: input.mode, status: 'current', boundary: 'chapter', chapterId: chapter.id,
    chapterIndex: chapter.chapterIndex, startDay, endDay, elapsedDays: Math.round((endDay - startDay) * 100) / 100,
    confirmedAt: now, confirmationOrder: order, source: input.source, sourceVersionId, dependsOnRecordId, label: normalizedLabel }
  if (!storyTimeRecordWellFormed(record) || history.some(row => row.id === record.id)) throw new Error('时间记录无效或标识重复。')
  novel.storyClock = { ...clock, history: [...history, record], confirmationSequence: order, currentDay: endDay,
    label: normalizedLabel || `第 ${endDay + 1} 天`, lastChapterIndex: chapter.chapterIndex, updatedAt: now }
  invalidateStoryTimeSources(novel)
  chapter.storyDaysElapsed = record.elapsedDays; chapter.storyDay = record.endDay
  return { changed: true, record, projection: projectStoryTime(novel, chapter) }
}

export function setStoryTimeOrigin(novel: Novel, day: number, label: string | undefined, now: string, id: () => string): StoryClock {
  if (!finiteDay(day) || day < 0) throw new Error('故事起点必须是有效的非负数字。')
  const clock = novel.storyClock || { currentDay: 0, label: '未确认起点', updatedAt: now }
  const order = nextOrder(clock), safeDay = Math.round(day * 100) / 100, display = label?.trim() || `第 ${safeDay + 1} 天`
  const history = records(clock).map(row => row.boundary === 'origin' && row.status === 'current' ? { ...row, status: 'superseded' as const } : row)
  const origin: StoryTimeOrigin = { id: id(), day: safeDay, label: display, confirmedAt: now, source: 'author' }
  const record: StoryTimeRecord = { id: origin.id, kind: 'origin', status: 'current', boundary: 'origin', startDay: safeDay, endDay: safeDay,
    elapsedDays: 0, confirmedAt: now, confirmationOrder: order, source: 'author', label: display }
  if (!storyTimeRecordWellFormed(record) || history.some(row => row.id === record.id)) throw new Error('时间起点记录无效或标识重复。')
  novel.storyClock = { ...clock, lastChapterIndex: -1, origin, history: [...history, record], confirmationSequence: order, currentDay: safeDay, label: display, updatedAt: now }
  invalidateStoryTimeSources(novel)
  return novel.storyClock
}

/** Mark source-bound records invalid while retaining their historical values. */
export function invalidateStoryTimeSources(novel: Novel): number {
  const valid = recordValidator(novel)
  const invalid = records(novel.storyClock).filter(row => row.status === 'current' && !valid(row))
  for (const row of invalid) {
    row.status = 'invalid'
    row.invalidReason = '时间来源格式、正文、章节顺序或紧邻依赖已失效、替代或删除。'
  }
  return invalid.length
}

export function storyTimeHistory(novel: Novel): StoryTimeRecord[] {
  const valid = recordValidator(novel)
  return clone(records(novel.storyClock).map(row => row.status === 'current' && !valid(row)
    ? { ...row, status: 'invalid' as const, invalidReason: row.invalidReason || '来源或依赖已失效，需重新确认。' } : row))
}
