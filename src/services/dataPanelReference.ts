import type { DataPanelChange, DataPanelField, DataPanelItem, DataPanelReferenceHistory, DataPanelReferenceSource, DataPanelReferenceValue, DataPanelReferenceRevision, Novel } from '@/types/novel'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import { calculateDataPanelFields, STORY_CLOCK_SOURCE } from './dataPanel'
import { captureStoryTimePoint, storyTimePointIsCurrent } from './storyTime'

type State = Record<string, DataPanelReferenceValue>
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
const fieldKey = (id: string) => 'field:' + id
const projectionUnknown = new WeakMap<DataPanelItem, ReadonlySet<string>>()
export function dataPanelReferenceUnknown(item: DataPanelItem): ReadonlySet<string> {
  return projectionUnknown.get(item) || new Set<string>()
}

export function captureDataPanelReferenceItem(item: DataPanelItem): DataPanelItem {
  const { referenceHistory: _history, versions: _versions, ...current } = item
  return clone(current)
}

function fieldReference(field: DataPanelField): DataPanelField {
  const { calculationError: _error, automationRules, ...definition } = field
  return { ...definition, ...(automationRules ? { automationRules: automationRules.map(rule => ({
    id: rule.id, trigger: rule.trigger, amount: rule.amount, interval: rule.interval,
    schedule: rule.schedule, sourceFieldName: rule.sourceFieldName, enabled: rule.enabled,
  })) } : {}) }
}

/** The reference includes field definitions, but excludes runtime reservations and UI history. */
export function dataPanelReferenceState(item?: DataPanelItem): State {
  if (!item) return {}
  const result: State = { $exists: true, name: item.name, category: item.category,
    relatedKeywords: item.relatedKeywords, fieldOrder: item.fields.map(field => field.id), equipmentState: item.equipmentState || 'stored' }
  if (item.ownerItemId !== undefined) result.ownerItemId = item.ownerItemId
  if (item.lastMentionChapterIndex !== undefined) result.lastMentionChapterIndex = item.lastMentionChapterIndex
  for (const field of item.fields) result[fieldKey(field.id)] = fieldReference(field)
  return clone(result)
}

export function dataPanelAcceptedSource(change: DataPanelChange): DataPanelReferenceSource {
  const source = change.sourceBinding
  if (!source) return { kind: 'unverified' }
  return source.kind === 'author' ? { kind: 'author' } : { ...clone(source), chapterIndex: change.chapterIndex }
}

function legacyDataPanelHistory(novel: Novel, item: DataPanelItem): DataPanelReferenceHistory | undefined {
  const baseline = dataPanelReferenceState(item), keys = new Set<string>()
  for (const change of novel.dataPanelChanges || []) {
    if (change.itemId !== item.id || change.status !== 'accepted') continue
    if (change.mutation?.kind === 'create') Object.keys(baseline).forEach(key => keys.add(key))
    else if (change.mutation?.kind === 'equipment') { keys.add('ownerItemId'); keys.add('equipmentState') }
    else {
      const target = change.mutation?.kind === 'field' ? change.mutation.field.id : change.fieldId
      const matching = item.fields.filter(field => field.id === target)
      const fields = matching.length ? matching : item.fields.filter(field => field.name === change.fieldName)
      fields.forEach(field => keys.add(fieldKey(field.id)))
    }
  }
  const changes = [...keys].filter(key => baseline[key] !== undefined)
    .map(key => ({ key, before: baseline[key], after: baseline[key] }))
  if (!changes.length) return undefined
  return { baseline, revisions: [{ id: 'legacy-data:' + buildAnalysisSourceVersionId(item.id), appliedAt: item.updatedAt,
    source: { kind: 'unverified' }, changes }] }
}

/** Preserve uncertainty independently before the user prunes the proposal display history. */
export function preserveDataPanelReferenceHistory(novel: Novel): void {
  for (const item of novel.dataPanels) if (!item.referenceHistory) {
    const history = legacyDataPanelHistory(novel, item)
    if (history) item.referenceHistory = history
  }
}

/** Inputs used by chapter projection, independent of proposal/UI history and run counters. */
export function dataPanelProvenanceInput(novel: Novel) {
  const value = (key: string, entry: DataPanelReferenceValue | undefined) =>
    key.startsWith('field:') && entry && typeof entry === 'object' && !Array.isArray(entry)
      ? fieldReference(entry) : entry
  const state = (entries: State) => Object.keys(entries).sort().map(key => [key, value(key, entries[key])])
  return (novel.dataPanels || []).map(item => {
    const history = item.referenceHistory || legacyDataPanelHistory(novel, item)
    return [item.id, history ? { baseline: state(history.baseline), revisions: history.revisions.map(revision => {
      const source = revision.source
      return { source: source.kind === 'author' || source.kind === 'unverified' ? { kind: source.kind } : {
        kind: source.kind, novelId: source.novelId, chapterId: source.chapterId, chapterIndex: source.chapterIndex,
        sourceVersionId: source.sourceVersionId, ...(source.kind === 'chapter' ? { quote: source.quote } : {}),
        ...(source.kind === 'automation' ? { ruleSteps: source.ruleSteps, time: source.time } : {}),
      }, changes: revision.changes.map(change => [change.key, value(change.key, change.after)]),
      dependencies: state(revision.dependencies || {}) }
    }) } : null]
  })
}

export function recordDataPanelReference(novel: Novel, item: DataPanelItem, before: DataPanelItem | undefined,
  source: DataPanelReferenceSource, now: string, id: string, dependencyFieldId?: string, confirmedKeys: string[] = []): void {
  const previous = dataPanelReferenceState(before), current = dataPanelReferenceState(item)
  const changes = [...new Set([...Object.keys(previous), ...Object.keys(current)])]
    .filter(key => !equal(previous[key], current[key]) || confirmedKeys.includes(key)
      || source.kind !== 'unverified' && key === fieldKey(dependencyFieldId || '') && current[key] !== undefined)
    .map(key => ({ key, before: previous[key], after: current[key] }))
  if (!changes.length) return
  const dependencies: State = {}
  if (source.kind === 'automation' && before) {
    const field = before.fields.find(row => row.id === dependencyFieldId)
    const names = new Set((field?.automationRules || []).map(rule => rule.sourceFieldName).filter(name => name && name !== STORY_CLOCK_SOURCE))
    for (const candidate of before.fields) if (candidate === field || names.has(candidate.name)) {
      dependencies[fieldKey(candidate.id)] = previous[fieldKey(candidate.id)]
    }
  }
  item.referenceHistory ??= (before ? legacyDataPanelHistory(novel, before) : undefined) || { baseline: previous, revisions: [] }
  item.referenceHistory.revisions.push(clone({ id, appliedAt: now, source, changes,
    ...(Object.keys(dependencies).length ? { dependencies } : {}) }))
}

function setValue(state: State, key: string, value: DataPanelReferenceValue | undefined) {
  if (value === undefined) delete state[key]
  else state[key] = clone(value)
}

function sourceProblem(novel: Novel, source: DataPanelReferenceSource): string {
  if (source.kind === 'author') return ''
  if (source.kind === 'unverified') return '缺少可验证来源'
  const chapter = novel.chapters.find(row => row.id === source.chapterId)
  if (source.novelId !== novel.id || !chapter) return '来源章节已不存在'
  if (chapter.chapterIndex !== source.chapterIndex || buildAnalysisSourceVersionId(chapter.content) !== source.sourceVersionId) return '来源正文或章节位置已变化'
  if (source.kind === 'chapter' && (!source.quote || chapter.content.indexOf(source.quote) < 0
    || chapter.content.indexOf(source.quote) !== chapter.content.lastIndexOf(source.quote))) return '原文证据不再唯一有效'
  return ''
}

function automationTimeProblem(novel: Novel, revision: DataPanelReferenceRevision): string {
  const source = revision.source
  if (source.kind !== 'automation') return ''
  if (!Array.isArray(source.ruleSteps) || !source.ruleSteps.length
    || source.ruleSteps.some(step => !step || typeof step.ruleId !== 'string' || !Number.isSafeInteger(step.steps) || step.steps < 1)
    || new Set(source.ruleSteps.map(step => step.ruleId)).size !== source.ruleSteps.length
    || !Object.keys(revision.dependencies || {}).length) return '自动推算缺少计算依据'
  const inputRules = Object.entries(revision.dependencies || {}).flatMap(([key, value]) => key.startsWith('field:')
    && value && typeof value === 'object' && !Array.isArray(value) ? value.automationRules || [] : [])
  if (source.ruleSteps.some(step => inputRules.filter(rule => rule.id === step.ruleId && rule.enabled).length !== 1)) return '自动推算的规则依据不完整'
  const rules = inputRules.filter(rule => rule.trigger === 'elapsed_days' && rule.sourceFieldName === STORY_CLOCK_SOURCE
    && source.ruleSteps.some(step => step.ruleId === rule.id))
  const required = new Set(rules.map(rule => rule.id))
  if (!required.size && !source.time) return ''
  const time = source.time
  if (!time || !required.size || !storyTimePointIsCurrent(novel, time.end, source.chapterIndex) || time.end.boundary !== 'end'
    || !equal(captureStoryTimePoint(novel, source.chapterId), time.end)
    || !Array.isArray(time.cursors) || time.cursors.length !== required.size
    || time.cursors.some(row => !row || typeof row.ruleId !== 'string')
    || new Set(time.cursors.map(row => row.ruleId)).size !== required.size) return '自动推算的章节时间来源缺失、已替代或失效'
  for (const entry of time.cursors) {
    const rule = rules.find(rule => rule.id === entry.ruleId), cursor = entry.cursor
    if (!rule || !cursor || !Number.isFinite(cursor.value) || cursor.value < 0 || !Array.isArray(cursor.sources)
      || !cursor.sources.length || cursor.sources.some(point => !storyTimePointIsCurrent(novel, point, source.chapterIndex))
      || source.ruleSteps.find(step => step.ruleId === rule.id)?.steps
        !== Math.floor(Math.max(0, time.end.day - cursor.value) / Math.max(1, rule.interval))) return '自动推算所依据的已结算时间来源已失效'
  }
  return ''
}

/** Read-only chapter projection. Invalid evidence makes the affected value unknown, never an assumed old value. */
export function projectDataPanelReferences(novel: Novel, beforeChapterIndex?: number): { items: DataPanelItem[]; issues: string[]; unknownFields: Map<string, string[]> } {
  const items: DataPanelItem[] = [], issues: string[] = [], unknownFields = new Map<string, string[]>()
  for (const original of novel.dataPanels || []) {
    for (const field of original.fields) for (const rule of field.automationRules || []) {
      if (beforeChapterIndex !== undefined || !rule.enabled || rule.trigger !== 'elapsed_days' || rule.sourceFieldName !== STORY_CLOCK_SOURCE
        || rule.lastSourceValue === undefined && rule.storyTimeCursor === undefined && !rule.storyTimeCursorPending) continue
      if (rule.storyTimeCursorPending) {
        issues.push(`${original.name}/${field.name}：数值已由作者重新确认；将在下次推算所选章节的有效结束日重新累计，不补算旧时间区间`)
        continue
      }
      const cursor = rule.storyTimeCursor
      if (!cursor || cursor.value !== rule.lastSourceValue || !Array.isArray(cursor.sources) || !cursor.sources.length
        || cursor.sources.some(point => !storyTimePointIsCurrent(novel, point))) {
        issues.push(`${original.name}/${field.name}：时间规则结算来源待核对，请编辑并确认该字段后重新推算`)
      }
    }
    const history = original.referenceHistory || legacyDataPanelHistory(novel, original)
    const state = history ? clone(history.baseline) : dataPanelReferenceState(original)
    const head = clone(state), problems = new Map<string, string>()
    for (const revision of history?.revisions || []) {
      for (const change of revision.changes) setValue(head, change.key, change.after)
      const source = revision.source
      if ((source.kind === 'chapter' || source.kind === 'automation') && beforeChapterIndex !== undefined
        && source.chapterIndex >= beforeChapterIndex) continue
      let problem = sourceProblem(novel, source) || automationTimeProblem(novel, revision)
      if (!problem && source.kind === 'automation' && Object.entries(revision.dependencies || {}).some(([key, value]) => !equal(state[key], value))) {
        problem = '自动推算所依赖的数据已失效'
      }
      for (const change of revision.changes) {
        if (problem) {
          delete state[change.key]
          if (!['lastMentionChapterIndex', 'fieldOrder'].includes(change.key)) problems.set(change.key, problem)
        }
        else { setValue(state, change.key, change.after); problems.delete(change.key) }
      }
    }
    // Never replay recorded history over a newer, unrecorded edit.
    if (history) {
      const live = dataPanelReferenceState(original)
      for (const key of new Set([...Object.keys(head), ...Object.keys(live)])) if (!equal(head[key], live[key])) {
        delete state[key]
        if (!['lastMentionChapterIndex', 'fieldOrder'].includes(key)) problems.set(key, '存在未记录来源的后续修改')
      }
    }
    for (const problem of new Set(problems.values())) issues.push(original.name + '：' + problem)
    if (problems.size) unknownFields.set(original.id, [...problems.keys()])
    if (state.$exists !== true || typeof state.name !== 'string' || typeof state.category !== 'string') continue
    const order = Array.isArray(state.fieldOrder) ? state.fieldOrder as string[] : Object.keys(state).filter(key => key.startsWith('field:')).map(key => key.slice(6))
    const fields = order.flatMap(id => {
      const value = state[fieldKey(id)]
      return value && typeof value === 'object' && !Array.isArray(value) ? [clone(value)] : []
    })
    const item: DataPanelItem = { ...original, name: state.name, category: state.category as DataPanelItem['category'], fields,
      relatedKeywords: Array.isArray(state.relatedKeywords) ? state.relatedKeywords as string[] : [],
      ownerItemId: typeof state.ownerItemId === 'string' ? state.ownerItemId : undefined,
      equipmentState: state.equipmentState as DataPanelItem['equipmentState'],
      lastMentionChapterIndex: typeof state.lastMentionChapterIndex === 'number' ? state.lastMentionChapterIndex : undefined }
    delete item.referenceHistory; delete item.versions
    projectionUnknown.set(item, new Set(problems.keys()))
    calculateDataPanelFields(item)
    item.fields = item.fields.filter(field => !field.calculationError)
    items.push(item)
  }
  // A holder excluded by provenance cannot contribute equipment totals through a stale ID.
  for (const item of items) if (item.ownerItemId && !items.some(owner => owner.id === item.ownerItemId)) {
    delete item.ownerItemId
    projectionUnknown.set(item, new Set([...dataPanelReferenceUnknown(item), 'ownerItemId']))
    issues.push(item.name + '：持有人的来源不可用')
  }
  return { items, issues, unknownFields }
}
