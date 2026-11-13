import type { Chapter } from '@/types/novel'
import type { ChapterSourceBinding } from '@/types/derivedSources'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'

export type ChapterSourceInspection =
  | 'current'
  | 'unverified'
  | 'source_missing'
  | 'content_changed'
  | 'value_changed'

export type ChapterSummaryStatus = 'empty' | 'current' | 'unverified' | 'stale'

type ChapterShape = Pick<Chapter, 'id' | 'content'>
type SummaryChapter = Pick<Chapter, 'id' | 'content' | 'summary'> & {
  summarySource?: ChapterSourceBinding
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isValidDate(value: unknown): value is string {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value))
}

function isValidOrigin(value: unknown): value is ChapterSourceBinding['origin'] {
  return value === 'ai' || value === 'author'
}

function isValidChapterRecord(value: unknown): value is ChapterShape {
  if (!isRecord(value)) return false
  return isNonEmptyString(value.id) && typeof value.content === 'string'
}

function isValidChapterShape(value: unknown): value is ChapterShape {
  return isValidChapterRecord(value) && isNonEmptyString(value.content)
}

function isValidBinding(value: unknown): value is ChapterSourceBinding {
  if (!isRecord(value)) return false
  return isNonEmptyString(value.chapterId)
    && isNonEmptyString(value.sourceVersionId)
    && isNonEmptyString(value.derivedValue)
    && isValidDate(value.createdAt)
    && isValidOrigin(value.origin)
}

function assertChapterForBinding(chapter: Pick<Chapter, 'id' | 'content'>): asserts chapter is ChapterShape {
  if (!isValidChapterShape(chapter)) {
    throw new Error('章节来源绑定要求非空章节 ID 和正文')
  }
}

function assertNonEmpty(value: string, label: string): void {
  if (!isNonEmptyString(value)) throw new Error(label + '不能为空')
}

function assertDate(value: string): void {
  if (!isValidDate(value)) throw new Error('createdAt 必须是有效日期')
}

export function createChapterSourceBinding(
  chapter: Pick<Chapter, 'id' | 'content'>,
  derivedValue: string,
  origin: ChapterSourceBinding['origin'],
  now: string,
): ChapterSourceBinding {
  assertChapterForBinding(chapter)
  assertNonEmpty(derivedValue, '派生值')
  if (!isValidOrigin(origin)) throw new Error('origin 无效')
  assertDate(now)

  return {
    chapterId: chapter.id,
    sourceVersionId: buildAnalysisSourceVersionId(chapter.content),
    derivedValue,
    createdAt: now,
    origin,
  }
}

export function inspectChapterSource(
  chapters: ReadonlyArray<Pick<Chapter, 'id' | 'content'>>,
  binding: ChapterSourceBinding | undefined,
  derivedValue: string,
): ChapterSourceInspection {
  try {
    if (binding === undefined || !isNonEmptyString(derivedValue) || !Array.isArray(chapters)) return 'unverified'
    if (!chapters.every(isValidChapterRecord) || !isValidBinding(binding)) return 'unverified'

    const matches = chapters.filter(chapter => chapter.id === binding.chapterId)
    if (matches.length !== 1) return 'source_missing'
    if (!isValidChapterShape(matches[0])) return 'unverified'

    if (buildAnalysisSourceVersionId(matches[0].content) !== binding.sourceVersionId) return 'content_changed'
    if (binding.derivedValue !== derivedValue) return 'value_changed'
    return 'current'
  } catch {
    return 'unverified'
  }
}

export function getCurrentChapterSummary(chapter: SummaryChapter): string {
  if (!isNonEmptyString(chapter.summary) || chapter.summarySource === undefined) return ''
  return inspectChapterSource([chapter], chapter.summarySource, chapter.summary) === 'current'
    ? chapter.summary
    : ''
}

export function getChapterSummaryStatus(chapter: SummaryChapter): ChapterSummaryStatus {
  if (typeof chapter.summary !== 'string' || chapter.summary.trim().length === 0) return 'empty'
  if (chapter.summarySource === undefined) return 'unverified'

  return inspectChapterSource([chapter], chapter.summarySource, chapter.summary) === 'current'
    ? 'current'
    : 'stale'
}

