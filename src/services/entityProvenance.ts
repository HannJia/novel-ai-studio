import type { EventLogEntry, Novel } from '@/types/novel'
import {
  CHARACTER_CANON_FIELDS,
  EVENT_CANON_FIELDS,
  ARC_CANON_FIELDS,
  ARC_NODE_CANON_FIELDS,
} from '@/types/entityProvenance'
import type {
  EntityFieldChange,
  EntityKind,
  EntityProvenance,
  EntityRevision,
  EntitySource,
  EntitySourceEvidence,
  EntityValue,
} from '@/types/entityProvenance'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'

export { CHARACTER_CANON_FIELDS, EVENT_CANON_FIELDS, ARC_CANON_FIELDS, ARC_NODE_CANON_FIELDS }

const EXISTS_FIELD = '$exists'
const ALL_CANON_FIELDS: Record<EntityKind, readonly string[]> = {
  character: CHARACTER_CANON_FIELDS,
  event: EVENT_CANON_FIELDS,
  arc: ARC_CANON_FIELDS,
  arc_node: ARC_NODE_CANON_FIELDS,
}

type PlainObject = Record<string, unknown>

type EntityLike = PlainObject & {
  id?: unknown
  name?: unknown
  title?: unknown
  source?: unknown
  provenance?: unknown
}

type ChapterLike = {
  id?: unknown
  chapterIndex?: unknown
  content?: unknown
}

export interface EntitySourceIssue {
  entityType: EntityKind
  entityId: string
  label: string
  field: string
  reason: string
  revisionId?: string
}

type RevisionWithIndex = {
  revision: EntityRevision
  index: number
}

type SourceCheck = {
  valid: boolean
  reasons: string[]
  firstEvidenceOffset: number
}

type FieldState = {
  known: boolean
  value?: unknown
}

type ExistenceState = FieldState & {
  value: boolean
}

type FieldProblem = {
  item: RevisionWithIndex
  check: SourceCheck
}

type ChapterBody = {
  chapter?: ChapterLike
  content?: string
  sourceVersionId?: string
}

const projectedOrigins = new WeakMap<object, object>()
const projectedCollectionOrigins = new WeakMap<object, unknown[]>()

function isObject(value: unknown): value is PlainObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function cloneJson<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

function hasOwn(value: unknown, key: string): boolean {
  return isObject(value) && Object.prototype.hasOwnProperty.call(value, key)
}

function valueAt(value: unknown, key: string): unknown {
  return isObject(value) ? value[key] : undefined
}

function optionalValue(value: unknown): EntityValue | undefined {
  return value === undefined ? undefined : cloneJson(value as EntityValue)
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return left === right
  return JSON.stringify(left) === JSON.stringify(right)
}

function changeValue(change: EntityFieldChange, side: 'before' | 'after'): unknown {
  return Object.prototype.hasOwnProperty.call(change, side) ? change[side] : undefined
}

function hasChangeValue(change: EntityFieldChange, side: 'before' | 'after'): boolean {
  return Object.prototype.hasOwnProperty.call(change, side)
}

function sourceCopy(source: EntitySource): EntitySource {
  return cloneJson(source)
}

function canonicalFields(kind: EntityKind): readonly string[] {
  return ALL_CANON_FIELDS[kind]
}

function validateFieldList(kind: EntityKind, fields: readonly string[] | undefined): readonly string[] {
  const allowed = new Set<string>([...canonicalFields(kind), EXISTS_FIELD])
  const selected = fields ? [...fields] : [...canonicalFields(kind)]
  for (const field of selected) {
    if (!allowed.has(field)) throw new Error('Invalid entity provenance field: ' + field)
  }
  return selected
}

function makeChange(field: string, before: unknown, after: unknown, hasBefore: boolean, hasAfter: boolean): EntityFieldChange {
  const change: EntityFieldChange = { field }
  if (hasBefore && before !== undefined) change.before = optionalValue(before)
  if (hasAfter && after !== undefined) change.after = optionalValue(after)
  return change
}

function hasRevisionHistory(value: unknown): boolean {
  const provenance = isObject(value) ? value.provenance : undefined
  return isObject(provenance) && Array.isArray(provenance.revisions) && provenance.revisions.length > 0
}

function seedBaseline(kind: EntityKind, before: object): EntityFieldChange[] {
  const changes: EntityFieldChange[] = [{ field: EXISTS_FIELD, before: true, after: true }]
  for (const field of canonicalFields(kind)) {
    if (hasOwn(before, field) && valueAt(before, field) !== undefined) {
      changes.push({ field, before: optionalValue(valueAt(before, field)) })
    }
  }
  return changes
}

export function captureEntityRevision(
  kind: EntityKind,
  before: object | undefined,
  after: object,
  source: EntitySource,
  now: string,
  id: string,
  fields?: readonly string[],
): EntityRevision {
  const selected = validateFieldList(kind, fields)
  const changes: EntityFieldChange[] = []

  if (before === undefined) {
    changes.push({ field: EXISTS_FIELD, after: true })
    for (const field of canonicalFields(kind)) {
      changes.push(makeChange(
        field,
        undefined,
        valueAt(after, field),
        false,
        hasOwn(after, field) && valueAt(after, field) !== undefined,
      ))
    }
  } else {
    for (const field of selected) {
      if (field === EXISTS_FIELD) {
        changes.push({ field: EXISTS_FIELD, before: true, after: true })
        continue
      }
      const beforeHasValue = hasOwn(before, field) && valueAt(before, field) !== undefined
      const afterHasValue = hasOwn(after, field) && valueAt(after, field) !== undefined
      if (fields?.includes(field) || !sameValue(valueAt(before, field), valueAt(after, field))) {
        changes.push(makeChange(field, valueAt(before, field), valueAt(after, field), beforeHasValue, afterHasValue))
      }
    }
  }

  const revision: EntityRevision = {
    id,
    entityType: kind,
    entityId: String(valueAt(after, 'id') ?? valueAt(before, 'id') ?? ''),
    source: sourceCopy(source),
    appliedAt: now,
    changes,
  }
  const canSeed = kind === 'character' || valueAt(before, 'source') !== 'ai'
  if (before !== undefined && !hasRevisionHistory(before) && canSeed) revision.baseline = seedBaseline(kind, before)
  return revision
}

export function appendEntityRevision(entity: { provenance?: EntityProvenance }, revision: EntityRevision): void {
  if (!entity.provenance || !Array.isArray(entity.provenance.revisions)) entity.provenance = { revisions: [] }
  if (entity.provenance.revisions.some(item => item.id === revision.id)) return
  entity.provenance.revisions.push(cloneJson(revision))
}

function allOccurrences(text: string, quote: string): number[] {
  const offsets: number[] = []
  let from = 0
  while (from <= text.length - quote.length) {
    const offset = text.indexOf(quote, from)
    if (offset < 0) break
    offsets.push(offset)
    from = offset + 1
  }
  return offsets
}

function evidenceCheck(content: string, evidence: EntitySourceEvidence[]): SourceCheck {
  const reasons: string[] = []
  let validEvidence = 0
  let firstEvidenceOffset = Number.POSITIVE_INFINITY
  const noOffsetQuotes = new Set<string>()

  if (!Array.isArray(evidence) || evidence.length === 0) {
    return { valid: false, reasons: ['evidence_missing'], firstEvidenceOffset }
  }

  for (const item of evidence) {
    if (!isObject(item) || typeof item.quote !== 'string' || item.quote.length === 0) {
      reasons.push('evidence_quote_invalid')
      continue
    }
    const quote = item.quote
    const hasStart = Object.prototype.hasOwnProperty.call(item, 'startOffset')
    const hasEnd = Object.prototype.hasOwnProperty.call(item, 'endOffset')
    if (hasStart !== hasEnd) {
      reasons.push('evidence_offset_mismatch')
      continue
    }

    const occurrences = allOccurrences(content, quote)
    let matched = false
    let matchedOffset: number | undefined

    if (!hasStart && !hasEnd) {
      if (noOffsetQuotes.has(quote)) reasons.push('evidence_ambiguous_duplicate')
      noOffsetQuotes.add(quote)
      if (occurrences.length === 1) {
        matched = true
        matchedOffset = occurrences[0]
      } else {
        reasons.push(occurrences.length > 1 ? 'evidence_ambiguous' : 'evidence_not_found')
      }
    } else {
      const start = item.startOffset
      const end = item.endOffset
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
        || start! < 0 || end! < start! || end! > content.length
        || end! - start! !== quote.length
        || content.slice(start!, end!) !== quote) {
        reasons.push('evidence_offset_mismatch')
      } else {
        matched = true
        matchedOffset = start
      }
    }

    if (matched) {
      validEvidence += 1
      if (matchedOffset !== undefined) firstEvidenceOffset = Math.min(firstEvidenceOffset, matchedOffset)
    }
  }

  return {
    valid: validEvidence > 0 && reasons.length === 0,
    reasons: [...new Set(reasons)],
    firstEvidenceOffset,
  }
}

function chapterById(novel: Novel, chapterId: string): ChapterLike | undefined {
  const chapters = (novel as unknown as { chapters?: unknown }).chapters
  if (!Array.isArray(chapters)) return undefined
  return (chapters as unknown[]).find(item => isObject(item) && item.id === chapterId) as ChapterLike | undefined
}

function sourceOf(revision: EntityRevision): EntitySource | undefined {
  const source = revision.source
  if (!isObject(source) || (source.kind !== 'author' && source.kind !== 'chapter')) return undefined
  return source as EntitySource
}

function chapterBody(novel: Novel, chapterId: string, cache?: Map<string, ChapterBody>): ChapterBody {
  const cached = cache?.get(chapterId)
  if (cached) return cached
  const chapter = chapterById(novel, chapterId)
  const result: ChapterBody = {
    chapter,
    ...(typeof chapter?.content === 'string'
      ? { content: chapter.content, sourceVersionId: buildAnalysisSourceVersionId(chapter.content) }
      : {}),
  }
  cache?.set(chapterId, result)
  return result
}

function checkSource(novel: Novel, source: EntitySource | undefined, cache?: Map<string, ChapterBody>): SourceCheck {
  if (!source) return { valid: false, reasons: ['source_invalid'], firstEvidenceOffset: Number.POSITIVE_INFINITY }
  if (source.kind === 'author') return { valid: true, reasons: [], firstEvidenceOffset: Number.NEGATIVE_INFINITY }
  if (typeof source.chapterId !== 'string' || !Number.isSafeInteger(source.chapterIndex)
    || typeof source.sourceVersionId !== 'string' || !Array.isArray(source.evidence)) {
    return { valid: false, reasons: ['source_invalid'], firstEvidenceOffset: Number.POSITIVE_INFINITY }
  }
  const body = chapterBody(novel, source.chapterId, cache)
  const chapter = body.chapter
  if (!chapter) return { valid: false, reasons: ['chapter_missing'], firstEvidenceOffset: Number.POSITIVE_INFINITY }
  if (chapter.chapterIndex !== source.chapterIndex) {
    return { valid: false, reasons: ['chapter_index_mismatch'], firstEvidenceOffset: Number.POSITIVE_INFINITY }
  }
  if (typeof body.content !== 'string' || body.sourceVersionId !== source.sourceVersionId) {
    return { valid: false, reasons: ['source_version_mismatch'], firstEvidenceOffset: Number.POSITIVE_INFINITY }
  }
  return evidenceCheck(body.content, source.evidence)
}

function revisionSourceCheck(
  novel: Novel,
  revision: EntityRevision,
  beforeChapterIndex?: number,
  cache?: Map<string, ChapterBody>,
): SourceCheck {
  const source = sourceOf(revision)
  if (!source) return checkSource(novel, source, cache)
  if (source.kind === 'author') return checkSource(novel, source, cache)
  if (beforeChapterIndex !== undefined && source.chapterIndex >= beforeChapterIndex) {
    return { valid: false, reasons: ['future_source'], firstEvidenceOffset: Number.POSITIVE_INFINITY }
  }
  return checkSource(novel, source, cache)
}

function compareChapterOrder(left: RevisionWithIndex, right: RevisionWithIndex): number {
  const aSource = sourceOf(left.revision)
  const bSource = sourceOf(right.revision)
  if (!aSource || aSource.kind !== 'chapter' || !bSource || bSource.kind !== 'chapter') return left.index - right.index
  if (aSource.chapterIndex !== bSource.chapterIndex) return aSource.chapterIndex - bSource.chapterIndex

  const aEvidence = Array.isArray(aSource.evidence) ? aSource.evidence : []
  const bEvidence = Array.isArray(bSource.evidence) ? bSource.evidence : []
  const aOffset = aEvidence.reduce(
    (min, evidence) => isObject(evidence) && Number.isSafeInteger(evidence.startOffset) ? Math.min(min, evidence.startOffset!) : min,
    Number.POSITIVE_INFINITY,
  )
  const bOffset = bEvidence.reduce(
    (min, evidence) => isObject(evidence) && Number.isSafeInteger(evidence.startOffset) ? Math.min(min, evidence.startOffset!) : min,
    Number.POSITIVE_INFINITY,
  )
  if (aOffset !== bOffset) return aOffset - bOffset
  if (left.revision.appliedAt !== right.revision.appliedAt) return left.revision.appliedAt < right.revision.appliedAt ? -1 : 1
  return left.index - right.index
}

function revisionsFrom(entity: EntityLike): RevisionWithIndex[] {
  const provenance = isObject(entity.provenance) ? entity.provenance : undefined
  const revisions = provenance?.revisions
  if (!Array.isArray(revisions)) return []
  return revisions
    .map((revision, index) => ({ revision: revision as EntityRevision, index }))
    .filter(item => isObject(item.revision)
      && Array.isArray(item.revision.changes)
      && item.revision.entityId === String(entity.id ?? ''))
}

function issueLabel(kind: EntityKind, entity: EntityLike, revisions: RevisionWithIndex[]): string {
  const own = kind === 'character' ? entity.name : entity.title
  if (typeof own === 'string' && own.trim()) return own
  for (const item of [...revisions].reverse()) {
    for (const change of item.revision.changes) {
      if (change.field === (kind === 'character' ? 'name' : 'title')) {
        const value = changeValue(change, 'after')
        if (typeof value === 'string' && value.trim()) return value
      }
    }
  }
  return String(entity.id ?? '')
}

function issueFor(
  kind: EntityKind,
  entity: EntityLike,
  label: string,
  field: string,
  reason: string,
  revisionId?: string,
): EntitySourceIssue {
  return {
    entityType: kind,
    entityId: String(entity.id ?? ''),
    label,
    field,
    reason,
    ...(revisionId ? { revisionId } : {}),
  }
}

function unknownValue(kind: EntityKind, field: string): unknown {
  if (field === 'name' || field === 'title') return undefined
  if (field === 'status') return kind === 'character' ? '待核对' : 'unverified'
  if (['aliases', 'relationships', 'events', 'characters', 'relatedArcIds', 'characterIds', 'dependencyArcIds', 'turningPointEventIds', 'prerequisiteNodeIds', 'consequenceEventIds'].includes(field)) return []
  if (['firstAppearChapter', 'chapterIndex', 'targetChapter', 'actualChapter', 'importance', 'hintCount', 'lastProgressChapterIndex', 'resolvedChapterIndex'].includes(field)) return undefined
  return ''
}

function entityList(novel: Novel, kind: EntityKind): unknown[] {
  const source = kind === 'character'
    ? (novel as unknown as { characters?: unknown }).characters
    : kind === 'event' ? (novel as unknown as { eventLog?: unknown }).eventLog : novel.storyArcs
  if (!Array.isArray(source)) return []
  return projectedCollectionOrigins.get(source) ?? source
}

function addIssue(issues: EntitySourceIssue[], issue: EntitySourceIssue): void {
  const key = [issue.entityType, issue.entityId, issue.field, issue.reason, issue.revisionId ?? ''].join('|')
  if (!issues.some(existing => [existing.entityType, existing.entityId, existing.field, existing.reason, existing.revisionId ?? ''].join('|') === key)) {
    issues.push(issue)
  }
}

function revisionChangesForField(
  item: RevisionWithIndex,
  field: string,
): Array<{ change: EntityFieldChange; changeIndex: number }> {
  return item.revision.changes
    .map((change, changeIndex) => ({ change, changeIndex }))
    .filter(entry => entry.change.field === field)
}

function latestAuthorForField(
  revisions: RevisionWithIndex[],
  field: string,
): { item: RevisionWithIndex; change: EntityFieldChange } | undefined {
  let latest: { item: RevisionWithIndex; change: EntityFieldChange } | undefined
  for (const item of revisions) {
    if (sourceOf(item.revision)?.kind !== 'author') continue
    const changes = revisionChangesForField(item, field)
    const change = changes[changes.length - 1]?.change
    if (change) latest = { item, change }
  }
  return latest
}

function latestSeedForField(
  revisions: RevisionWithIndex[],
  field: string,
): { item: RevisionWithIndex; change: EntityFieldChange } | undefined {
  let latest: { item: RevisionWithIndex; change: EntityFieldChange } | undefined
  for (const item of revisions) {
    const baseline = Array.isArray(item.revision.baseline) ? item.revision.baseline : []
    const change = baseline.find(candidate => candidate.field === field && hasChangeValue(candidate, 'before'))
    if (change) latest = { item, change }
  }
  return latest
}

function latestRawWriteForField(
  revisions: RevisionWithIndex[],
  field: string,
): { item: RevisionWithIndex; change: EntityFieldChange } | undefined {
  let latest: { item: RevisionWithIndex; change: EntityFieldChange } | undefined
  for (const item of revisions) {
    const changes = revisionChangesForField(item, field)
    const change = changes[changes.length - 1]?.change
    if (change) latest = { item, change }
  }
  return latest
}

function projectEntity(
  novel: Novel,
  kind: EntityKind,
  input: unknown,
  beforeChapterIndex: number | undefined,
  issues: EntitySourceIssue[],
): PlainObject | undefined {
  if (!isObject(input)) return undefined
  const original = projectedOrigins.get(input) as EntityLike | undefined
  const entity = original ?? input as EntityLike
  const revisions = revisionsFrom(entity)
  const label = issueLabel(kind, entity, revisions)
  const provenance = isObject(entity.provenance) && Array.isArray(entity.provenance.revisions)
  const nameField = kind === 'character' ? 'name' : 'title'

  if (!provenance) {
    if (kind === 'event' && entity.source === 'ai') {
      addIssue(issues, issueFor(kind, entity, label, '$exists', 'source_ai_without_provenance'))
      return undefined
    }
    if (typeof valueAt(entity, nameField) !== 'string' || !(valueAt(entity, nameField) as string).trim()) {
      addIssue(issues, issueFor(kind, entity, label, nameField, 'invalid_entity_name'))
      return undefined
    }
    const output = cloneJson(entity)
    projectedOrigins.set(output, entity)
    return output
  }

  const checks = new Map<number, SourceCheck>()
  const chapterBodies = new Map<string, ChapterBody>()
  const getCheck = (item: RevisionWithIndex): SourceCheck => {
    const existing = checks.get(item.index)
    if (existing) return existing
    const check = revisionSourceCheck(novel, item.revision, beforeChapterIndex, chapterBodies)
    checks.set(item.index, check)
    return check
  }

  const currentVersionFields = new Map<string, Map<string, number>>()
  for (const item of revisions) {
    const source = sourceOf(item.revision)
    if (!source || source.kind !== 'chapter') continue
    const check = checkSource(novel, source, chapterBodies)
    if (!check.valid) continue
    const fields = currentVersionFields.get(source.chapterId) ?? new Map<string, number>()
    for (const change of item.revision.changes) {
      if (canonicalFields(kind).includes(change.field) || change.field === '$exists') {
        fields.set(change.field, Math.max(fields.get(change.field) ?? -1, item.index))
      }
    }
    currentVersionFields.set(source.chapterId, fields)
  }

  const isSuppressedStaleVersion = (item: RevisionWithIndex, field: string, check: SourceCheck): boolean => {
    const source = sourceOf(item.revision)
    return source?.kind === 'chapter'
      && check.reasons.includes('source_version_mismatch')
      && (currentVersionFields.get(source.chapterId)?.get(field) ?? -1) > item.index
  }

  const states = new Map<string, FieldState>()
  const problems = new Map<string, FieldProblem>()
  const baselineIndexes = new Map<string, { index: number; inclusive: boolean }>()

  for (const field of canonicalFields(kind)) {
    const author = latestAuthorForField(revisions, field)
    const seed = latestSeedForField(revisions, field)

    if (author) {
      states.set(field, { known: true, value: cloneJson(changeValue(author.change, 'after')) })
      baselineIndexes.set(field, { index: author.item.index, inclusive: false })
    } else if (seed) {
      states.set(field, { known: true, value: cloneJson(changeValue(seed.change, 'before')) })
      baselineIndexes.set(field, { index: seed.item.index, inclusive: true })
    } else {
      states.set(field, { known: false, value: undefined })
    }
  }

  const chapterItems = revisions
    .filter(item => sourceOf(item.revision)?.kind === 'chapter')
    .filter(item => {
      const source = sourceOf(item.revision)
      return source?.kind === 'chapter' && (beforeChapterIndex === undefined || source.chapterIndex < beforeChapterIndex)
    })
    .sort(compareChapterOrder)

  const resolveField = (field: string): void => {
    const baseline = baselineIndexes.get(field)
    const applicable = chapterItems.filter(item =>
      !baseline || (baseline.inclusive ? item.index >= baseline.index : item.index > baseline.index),
    )

    for (const item of applicable) {
      const check = getCheck(item)
      for (const entry of revisionChangesForField(item, field)) {
        if (!check.valid && isSuppressedStaleVersion(item, field, check)) continue
        if (check.valid) {
          states.set(field, { known: true, value: cloneJson(changeValue(entry.change, 'after')) })
          problems.delete(field)
        } else {
          states.set(field, { known: false, value: undefined })
          problems.set(field, { item, check })
        }
      }
    }
  }
  for (const field of canonicalFields(kind)) resolveField(field)

  let existence: ExistenceState = { known: false, value: false }
  const existenceAuthor = latestAuthorForField(revisions, '$exists')
  const existenceSeed = latestSeedForField(revisions, '$exists')
  const existenceBaseline = existenceAuthor
    ? { index: existenceAuthor.item.index, inclusive: false }
    : existenceSeed
      ? { index: existenceSeed.item.index, inclusive: true }
      : undefined

  const hasReachableEvidence = [...states.values()].some(state => state.known)
    || Boolean(existenceBaseline)
    || chapterItems.some(item => item.revision.changes.some(change =>
      change.field === '$exists' || canonicalFields(kind).includes(change.field),
    ))

  // An entity created only by chapters at or after the boundary is outside
  // this historical view.  Do not turn its raw future fields into warnings.
  if (beforeChapterIndex !== undefined && !hasReachableEvidence) return undefined

  if (existenceAuthor) existence = { known: true, value: changeValue(existenceAuthor.change, 'after') === true }
  else if (existenceSeed) existence = { known: true, value: changeValue(existenceSeed.change, 'before') === true }

  let existenceProblem: FieldProblem | undefined
  for (const item of chapterItems) {
    if (existenceBaseline && (existenceBaseline.inclusive
      ? item.index < existenceBaseline.index
      : item.index <= existenceBaseline.index)) continue
    const check = getCheck(item)
    for (const entry of revisionChangesForField(item, '$exists')) {
      if (!check.valid && isSuppressedStaleVersion(item, '$exists', check)) continue
      if (check.valid) {
        existence = { known: true, value: changeValue(entry.change, 'after') === true }
        existenceProblem = undefined
      } else {
        existence = { known: false, value: false }
        existenceProblem = { item, check }
      }
    }
  }

  for (const [field, problem] of problems) {
    addIssue(issues, issueFor(kind, entity, label, field, problem.check.reasons.join('|') || 'invalid_source', problem.item.revision.id))
  }
  if (existenceProblem) {
    addIssue(issues, issueFor(
      kind,
      entity,
      label,
      '$exists',
      existenceProblem.check.reasons.join('|') || 'invalid_source',
      existenceProblem.item.revision.id,
    ))
  }

  for (const field of canonicalFields(kind)) {
    if (!states.get(field)?.known && !problems.has(field) && hasOwn(entity, field)) {
      addIssue(issues, issueFor(kind, entity, label, field, 'unconfirmed_field'))
    }
  }

  for (const field of canonicalFields(kind)) {
    const latest = latestRawWriteForField(revisions, field)
    if (!latest || problems.has(field)) continue
    const source = sourceOf(latest.item.revision)
    const writeInBoundary = beforeChapterIndex === undefined
      || source?.kind === 'author'
      || (source?.kind === 'chapter' && source.chapterIndex < beforeChapterIndex)
    if (!writeInBoundary) continue
    if (!revisionSourceCheck(novel, latest.item.revision, beforeChapterIndex, chapterBodies).valid) continue
    const expectedHasValue = hasChangeValue(latest.change, 'after') && changeValue(latest.change, 'after') !== undefined
    const currentHasValue = hasOwn(entity, field) && valueAt(entity, field) !== undefined
    if (currentHasValue !== expectedHasValue || !sameValue(valueAt(entity, field), changeValue(latest.change, 'after'))) {
      addIssue(issues, issueFor(kind, entity, label, field, 'raw_mismatch', latest.item.revision.id))
      states.set(field, { known: false, value: undefined })
    }
  }

  if (!existence.known || !existence.value) {
    addIssue(issues, issueFor(kind, entity, label, '$exists', existence.known ? 'entity_not_exists' : 'entity_existence_unconfirmed'))
    return undefined
  }

  const output = cloneJson(entity)
  for (const field of canonicalFields(kind)) {
    const state = states.get(field)
    output[field] = cloneJson(state?.known ? state.value : unknownValue(kind, field))
  }

  const outputName = output[nameField]
  if (typeof outputName !== 'string' || !outputName.trim()) {
    addIssue(issues, issueFor(kind, entity, label, nameField, 'invalid_entity_name'))
    return undefined
  }
  projectedOrigins.set(output, entity)
  return output
}

export function projectCanonicalEntities(
  novel: Novel,
  beforeChapterIndex?: number,
): { characters: import('@/types/novel').Character[]; events: EventLogEntry[]; arcs: import('@/types/novel').StoryArc[]; issues: EntitySourceIssue[] } {
  const issues: EntitySourceIssue[] = []
  const characterInput = entityList(novel, 'character')
  const eventInput = entityList(novel, 'event')
  const arcInput = entityList(novel, 'arc')
  const characters = characterInput
    .map(entity => projectEntity(novel, 'character', entity, beforeChapterIndex, issues))
    .filter((entity): entity is PlainObject => !!entity) as unknown as import('@/types/novel').Character[]
  const events = eventInput
    .map(entity => projectEntity(novel, 'event', entity, beforeChapterIndex, issues))
    .filter((entity): entity is PlainObject => !!entity) as unknown as EventLogEntry[]
  const arcs = arcInput.flatMap(entity => {
    const arc = projectEntity(novel, 'arc', entity, beforeChapterIndex, issues)
    if (!arc) return []
    // Project original nodes independently: parent revisions never contain node histories.
    const nodes = (entity as import('@/types/novel').StoryArc).nodes || []
    arc.nodes = nodes.flatMap(node => {
      const output = projectEntity(novel, 'arc_node', node, beforeChapterIndex, issues)
      if (!output) return []
      if (output.status === 'completed') {
        const revisions = revisionsFrom(node as unknown as EntityLike)
        const completion = revisions.some(({ revision }) => revision.source.kind === 'chapter'
          && revision.source.chapterIndex === output.actualChapter
          && revisionSourceCheck(novel, revision, beforeChapterIndex).valid
          && revision.changes.some(change => change.field === 'status' && change.after === 'completed')
          && revision.changes.some(change => change.field === 'actualChapter' && change.after === output.actualChapter))
        if (!completion || latestAuthorForField(revisions, 'status')?.change.after === 'completed') {
          addIssue(issues, issueFor('arc_node', node as unknown as EntityLike, node.title, 'status', 'completion_without_chapter_evidence'))
          output.status = 'unverified'; output.actualChapter = undefined
        }
      }
      return [output]
    })
    return [arc]
  }) as unknown as import('@/types/novel').StoryArc[]
  // A valid child source cannot make an invalid or future prerequisite true.
  const allNodes = new Map(arcs.flatMap(arc => arc.nodes.map(node => [node.id, node] as const)))
  let dependenciesChanged = true
  while (dependenciesChanged) {
    dependenciesChanged = false
    for (const node of allNodes.values()) if (node.status === 'completed' && node.prerequisiteNodeIds?.some(id => {
      const parent = allNodes.get(id)
      return !parent || parent.status !== 'completed' || parent.actualChapter === undefined || node.actualChapter === undefined || parent.actualChapter > node.actualChapter
    })) {
      addIssue(issues, issueFor('arc_node', node as unknown as EntityLike, node.title, 'status', 'prerequisite_unconfirmed'))
      node.status = 'unverified'; node.actualChapter = undefined; dependenciesChanged = true
    }
  }
  projectedCollectionOrigins.set(characters, characterInput)
  projectedCollectionOrigins.set(events, eventInput)
  projectedCollectionOrigins.set(arcs, arcInput)
  return { characters, events, arcs, issues }
}

export function getEntitySourceIssues(
  novel: Novel,
  kind: EntityKind,
  entity: object,
  beforeChapterIndex?: number,
): EntitySourceIssue[] {
  if (kind === 'arc' || kind === 'arc_node') return projectCanonicalEntities(novel, beforeChapterIndex).issues
    .filter(issue => issue.entityType === kind && issue.entityId === String((entity as EntityLike).id ?? ''))
  const issues: EntitySourceIssue[] = []
  projectEntity(novel, kind, entity, beforeChapterIndex, issues)
  return issues.filter(issue => issue.entityId === String((entity as EntityLike).id ?? ''))
}

export function getEntityHistory(
  novel: Novel,
  kind: EntityKind,
  entity: object,
): Array<{ revision: EntityRevision; issue?: string }> {
  const input = entity as EntityLike
  const revisions = revisionsFrom(input)
  const chapterBodies = new Map<string, ChapterBody>()
  return revisions
    .map(item => {
      const check = checkSource(novel, sourceOf(item.revision), chapterBodies)
      return {
        revision: cloneJson(item.revision),
        ...(check.valid ? {} : { issue: check.reasons.join('|') || 'invalid_source' }),
      }
    })
    .filter(item => item.revision.entityType === kind)
}

