import type { DataPanelChange, DataPanelItem, Novel, StoryClock } from '@/types/novel'
import type { StoryAggregate } from './storyAggregate'
import { buildDataPanelAutomationSuggestions, calculateDataPanelFields, dataPanelReferenceInput } from './dataPanel'
import { applyDataPanelProposal, rejectDataPanelProposal } from './dataPanelProposalMutations'
import { bindDataPanelProposalSource, dataPanelProposalSourceIsCurrent, initializeDataPanelTimeBaselines,
  automationFieldInputsCurrent, dataPanelTimeCursorIsCurrent, preserveDataPanelTimeProgress, usesStoryTime } from './dataPanelProposalSource'
import { captureStoryImpact } from './storyImpactAnalysis'
import { appendStoryImpactReport, invalidateWrittenChapterReviews } from './storyImpactTransactions'
import { captureDataPanelReferenceItem, dataPanelProvenanceInput, projectDataPanelReferences, recordDataPanelReference } from './dataPanelReference'
import { projectStoryTime, projectStoryTimeOrigin, captureStoryTimePoint, recordStoryTime, setStoryTimeOrigin, type StoryTimeConfirmation } from './storyTime'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
export const captureDataPanelBaseline = (novel: Novel, itemId = '') => JSON.stringify([novel.id, itemId, novel.dataPanels, novel.storyClock])
export const captureDataClockBaseline = (novel: Novel) => JSON.stringify([novel.storyClock || null,
  novel.chapters.map(chapter => [chapter.id, chapter.chapterIndex, chapter.content, chapter.status === 'locked'])])

function snapshot(item: DataPanelItem): string {
  const { category, name, fields, relatedKeywords, ownerItemId, equipmentState, lastMentionChapterIndex } = item
  return JSON.stringify({ category, name, fields, relatedKeywords, ownerItemId, equipmentState, lastMentionChapterIndex })
}

export function recordDataPanelImpact(aggregate: StoryAggregate, before: ReturnType<typeof captureStoryImpact>,
  fields: string[], now: string, nextId: () => string) {
  const reviewChapterIds = invalidateWrittenChapterReviews(aggregate)
  const target = { kind: 'novel' as const, id: aggregate.novel.id, label: aggregate.novel.title }
  appendStoryImpactReport(aggregate, before, [{ target, action: 'update', fields }], reviewChapterIds, now, nextId)
}

export type DataPanelEdit =
  | { action: 'create'; item: Partial<DataPanelItem> }
  | { action: 'update'; itemId: string; item: Partial<DataPanelItem> }
  | { action: 'delete'; itemId: string }
  | { action: 'restore'; itemId: string; versionId: string }

export interface DataPanelEditResult { item: DataPanelItem | null; changed: boolean }
export interface DataClockEditResult { clock: StoryClock; changed: boolean }

export function editDataPanel(aggregate: StoryAggregate, edit: DataPanelEdit, baseline: string, now: string,
  nextId: () => string): DataPanelEditResult {
  const { novel } = aggregate, itemId = edit.action === 'create' ? '' : edit.itemId
  if (baseline !== captureDataPanelBaseline(novel, itemId)) throw new Error('数据面板或故事时间已变化，请重新打开并核对后保存。')
  const before = captureStoryImpact(novel, aggregate.workspace)
  const current = novel.dataPanels.find(item => item.id === itemId)
  const beforeReference = current ? captureDataPanelReferenceItem(current) : undefined
  const unknownKeys = current ? projectDataPanelReferences(novel).unknownFields.get(itemId) || [] : []
  if (edit.action !== 'create' && !current) return { item: null, changed: false }
  if (edit.action === 'delete') {
    novel.dataPanels = novel.dataPanels.filter(item => item.id !== itemId)
    for (const item of novel.dataPanels) if (item.ownerItemId === itemId) {
      const beforeOwner = captureDataPanelReferenceItem(item)
      item.versions = [...(item.versions || []), { id: nextId(), label: '持有人删除前', savedAt: now, snapshot: snapshot(item) }].slice(-20)
      delete item.ownerItemId; item.equipmentState = 'stored'; item.updatedAt = now
      recordDataPanelReference(novel, item, beforeOwner, { kind: 'author' }, now, nextId())
    }
    // Preserve proposal decisions and evidence as history even when their target disappears.
  } else {
    let updates: Partial<DataPanelItem>
    if (edit.action === 'restore') {
      const version = current!.versions?.find(row => row.id === edit.versionId)
      if (!version) return { item: null, changed: false }
      try { updates = JSON.parse(version.snapshot) } catch { throw new Error('历史数据版本无效。') }
      if (!updates || !Array.isArray(updates.fields) || !Array.isArray(updates.relatedKeywords) || typeof updates.name !== 'string') throw new Error('历史数据版本不完整。')
      // An absent optional key in a snapshot must remove its current value.
      updates.ownerItemId ??= undefined; updates.equipmentState ??= undefined; updates.lastMentionChapterIndex ??= undefined
    } else updates = edit.item
    const item: DataPanelItem = current || { id: nextId(), category: '自定义', name: '未命名数据', fields: [], relatedKeywords: [], createdAt: now, updatedAt: now }
    const previous = snapshot(item)
    for (const key of ['category', 'name', 'fields', 'relatedKeywords', 'ownerItemId', 'equipmentState', 'lastMentionChapterIndex'] as const) {
      if (Object.prototype.hasOwnProperty.call(updates, key)) Object.assign(item, { [key]: updates[key] === undefined ? undefined : clone(updates[key]) })
    }
    if (!item.name.trim()) throw new Error('请填写数据名称。')
    if (item.ownerItemId && (item.ownerItemId === item.id || !novel.dataPanels.some(row => row.id === item.ownerItemId))) throw new Error('数据持有人不存在，请重新选择。')
    calculateDataPanelFields(item)
    if (edit.action === 'update' && beforeReference) preserveDataPanelTimeProgress(item, beforeReference)
    if (edit.action === 'restore') for (const field of item.fields) for (const rule of field.automationRules || []) {
      if (!usesStoryTime(rule)) continue
      // Restoring a value is a new author decision, not a replay of its old settlement cursor.
      delete rule.lastSourceValue; delete rule.storyTimeCursor; delete rule.pendingChapterIndex
      delete rule.lastEvaluatedChapterIndex; delete rule.appliedCount
      rule.storyTimeCursorPending = true
    }
    initializeDataPanelTimeBaselines(novel, [item], captureStoryTimePoint(novel), Object.prototype.hasOwnProperty.call(updates, 'fields'))
    const confirmedKeys = unknownKeys.filter(key => key.startsWith('field:') || key === 'fieldOrder'
      ? Object.prototype.hasOwnProperty.call(updates, 'fields')
      : key === '$exists' ? Object.prototype.hasOwnProperty.call(updates, 'name') : Object.prototype.hasOwnProperty.call(updates, key))
    if (current && snapshot(item) === previous && !confirmedKeys.length) return { item: current, changed: false }
    if (current) item.versions = [...(item.versions || []), { id: nextId(), label: edit.action === 'restore' ? '恢复前版本' : '编辑前版本', savedAt: now, snapshot: previous }].slice(-20)
    else novel.dataPanels.push(item)
    item.updatedAt = now
    recordDataPanelReference(novel, item, beforeReference, { kind: 'author' }, now, nextId(), undefined, confirmedKeys)
  }
  novel.updatedAt = now
  recordDataPanelImpact(aggregate, before, ['dataPanels'], now, nextId)
  return { item: novel.dataPanels.find(item => item.id === itemId) || current || novel.dataPanels[novel.dataPanels.length - 1], changed: true }
}

/** A stale suggestion may be dismissed, but cannot consume a newly edited rule. */
function releaseStaleReservations(novel: Novel) {
  for (const item of novel.dataPanels) for (const field of item.fields) for (const rule of field.automationRules || []) {
    if (rule.pendingChapterIndex === undefined) continue
    const current = novel.dataPanelChanges.some(change => change.status === 'pending' && change.sourceBinding?.kind === 'automation'
      && change.itemId === item.id && change.fieldId === field.id && change.chapterIndex === rule.pendingChapterIndex
      && dataPanelProposalSourceIsCurrent(novel, change))
    if (!current) delete rule.pendingChapterIndex
  }
}

export function decideDataPanelProposals(aggregate: StoryAggregate, ids: string[], decision: 'accept' | 'reject',
  drafts: Record<string, string>, now: string, nextId: () => string): number {
  const { novel } = aggregate, before = captureStoryImpact(novel, aggregate.workspace)
  const referenceInput = () => JSON.stringify([dataPanelReferenceInput(novel.dataPanels), dataPanelProvenanceInput(novel)])
  const original = referenceInput()
  const selected = [...new Set(ids)].map(id => novel.dataPanelChanges.find(change => change.id === id))
    .filter((change): change is DataPanelChange => Boolean(change && change.status === 'pending'))
    .sort((a, b) => a.chapterIndex - b.chapterIndex
      || Number(!(a.mutation?.kind === 'create' && a.mutation.item.category === '角色')) - Number(!(b.mutation?.kind === 'create' && b.mutation.item.category === '角色'))
      || a.createdAt.localeCompare(b.createdAt))
  // Every decision must be valid both before the batch and immediately before application.
  const current = new Set(selected.filter(change => dataPanelProposalSourceIsCurrent(novel, change)).map(change => change.id))
  const createdOwners = new Map<string, string>()
  const sourceStillCurrent = (change: DataPanelChange): boolean => {
    if (dataPanelProposalSourceIsCurrent(novel, change)) return true
    const source = change.sourceBinding, owner = source?.ownerTarget
    const createdId = owner && owner.itemId === null ? createdOwners.get(owner.name) : undefined
    if (!source || !owner || !createdId) return false
    // A separately selected role creation may satisfy this batch's explicit missing owner.
    // All other source dependencies must still match; never adopt an unrelated replacement.
    return dataPanelProposalSourceIsCurrent(novel, { ...change, sourceBinding: { ...source, ownerTarget: { ...owner, itemId: createdId } } })
  }
  let count = 0
  for (const change of selected) {
    const valid = current.has(change.id) && sourceStillCurrent(change)
    const changed = decision === 'accept' ? valid && applyDataPanelProposal(novel, change.id, drafts[change.id], now, nextId)
      : rejectDataPanelProposal(novel, change.id, now, valid)
    if (changed) {
      count++
      if (decision === 'accept' && change.mutation?.kind === 'create' && change.mutation.item.category === '角色') {
        createdOwners.set(change.mutation.item.name, change.itemId)
      }
    }
  }
  if (count) {
    releaseStaleReservations(novel)
    if (original !== referenceInput()) recordDataPanelImpact(aggregate, before, ['dataPanels'], now, nextId)
  }
  return count
}

export function queueDataPanelAutomation(novel: Novel, chapterIndex: number, expectedContent: string, now: string, nextId: () => string) {
  const chapter = novel.chapters.find(row => row.chapterIndex === chapterIndex)
  if (!chapter || chapter.content !== expectedContent) throw new Error('自动推算所依据的正文已变化，请重新核对。')
  const chapterTime = projectStoryTime(novel, chapter), storyDay = chapterTime.known ? chapterTime.endDay : undefined
  const before = JSON.stringify([novel.dataPanels, novel.dataPanelChanges])
  releaseStaleReservations(novel)
  initializeDataPanelTimeBaselines(novel, novel.dataPanels, captureStoryTimePoint(novel, chapter.id, 'start'), false, captureStoryTimePoint(novel, chapter.id))
  const reference = projectDataPanelReferences(novel, chapterIndex + 1)
  const eligible = novel.dataPanels.map(item => ({ ...item, fields: item.fields
    .filter(field => automationFieldInputsCurrent(novel, chapterIndex, item.id, field.id, reference))
    .map(field => ({ ...field, automationRules: field.automationRules?.filter(rule => !usesStoryTime(rule) || dataPanelTimeCursorIsCurrent(novel, rule, chapterIndex)) })) }))
  const suggestions = chapter.content.trim() ? buildDataPanelAutomationSuggestions(eligible, chapterIndex, chapter.content, storyDay) : []
  let added = 0
  for (const { rules, ruleSteps, ...proposal } of suggestions) {
    const sourceBinding = bindDataPanelProposalSource(novel, chapter, proposal, 'automation', ruleSteps)
    const existing = novel.dataPanelChanges.find(change => change.itemId === proposal.itemId && change.fieldId === proposal.fieldId && change.chapterIndex === chapterIndex
      && JSON.stringify(change.sourceBinding) === JSON.stringify(sourceBinding))
    if (existing) {
      if (existing.status === 'pending') for (const rule of rules) rule.pendingChapterIndex = chapterIndex
      continue
    }
    novel.dataPanelChanges.unshift({ ...proposal, id: nextId(), createdAt: now, status: 'pending', confidence: 'clear', sourceBinding })
    for (const rule of rules) rule.pendingChapterIndex = chapterIndex
    added++
  }
  const changed = before !== JSON.stringify([novel.dataPanels, novel.dataPanelChanges])
  if (changed) novel.updatedAt = now
  return { added, changed }
}

export function editDataStoryClock(aggregate: StoryAggregate, currentDay: number, label: string | undefined, baseline: string,
  now: string, nextId: () => string, chapterIndex?: number): DataClockEditResult {
  const { novel } = aggregate
  if (captureDataClockBaseline(novel) !== baseline) throw new Error('故事时间已经变化，请重新核对后保存。')
  if (!Number.isFinite(currentDay) || currentDay < 0) throw new Error('故事时间必须是有效的非负天数。')
  const before = captureStoryImpact(novel, aggregate.workspace), day = Math.round(currentDay * 100) / 100
  const previous = novel.storyClock
  if (chapterIndex !== undefined) {
    const chapter = novel.chapters.find(row => row.chapterIndex === chapterIndex)
    if (!chapter) throw new Error('故事时间对应章节已不存在。')
    const prior = novel.chapters.find(row => row.chapterIndex === chapterIndex - 1)
    const priorTime = chapterIndex === 0 ? projectStoryTimeOrigin(novel) : prior ? projectStoryTime(novel, prior) : undefined
    if (!priorTime?.known || priorTime.endDay === undefined) throw new Error('请先明确填写本章绝对开始日和结束日，不能从未知前章补时间。')
    const startDay = priorTime.endDay
    // Only the end was entered here; the inferred start must retain its dependency.
    const result = recordStoryTime(novel, { chapterId: chapter.id, chapterIndex, content: chapter.content, mode: 'relative',
      elapsedDays: Math.round((day - startDay) * 100) / 100, label, source: 'author' }, now, nextId)
    if (!result.changed) return { clock: novel.storyClock!, changed: false }
    queueDataPanelAutomation(novel, chapterIndex, chapter.content, now, nextId)
  } else {
    const nextDay = Math.round(day * 100) / 100, nextLabel = label?.trim() || `第 ${nextDay + 1} 天`
    const originTime = projectStoryTimeOrigin(novel)
    if (originTime.known && previous && originTime.endDay === nextDay && originTime.label === nextLabel) return { clock: previous, changed: false }
    setStoryTimeOrigin(novel, day, label, now, nextId)
    initializeDataPanelTimeBaselines(novel, novel.dataPanels, captureStoryTimePoint(novel))
  }
  novel.updatedAt = now
  recordDataPanelImpact(aggregate, before, ['storyClock'], now, nextId)
  return { clock: novel.storyClock!, changed: true }
}

/** Author-confirmed chapter edits, including explicit replacement, share one atomic path. */
export function confirmDataChapterTime(aggregate: StoryAggregate, input: StoryTimeConfirmation, baseline: string,
  now: string, nextId: () => string): DataClockEditResult {
  const { novel } = aggregate
  if (captureDataClockBaseline(novel) !== baseline) throw new Error('正文或故事时间已变化，请重新打开并核对。')
  const before = captureStoryImpact(novel, aggregate.workspace)
  const result = recordStoryTime(novel, input, now, nextId)
  if (!result.changed) return { clock: novel.storyClock!, changed: false }
  queueDataPanelAutomation(novel, input.chapterIndex, input.content, now, nextId)
  novel.updatedAt = now
  recordDataPanelImpact(aggregate, before, ['storyClock'], now, nextId)
  return { clock: novel.storyClock!, changed: true }
}

export function confirmStoryTimeRelative(aggregate: StoryAggregate, chapterId: string, elapsedDays: number, baseline: string,
  now: string, nextId: () => string, source: 'author' | 'canon' = 'author'): DataClockEditResult {
  const { novel } = aggregate
  if (captureDataClockBaseline(novel) !== baseline) throw new Error('故事时间已经变化，请重新核对后保存。')
  const chapter = novel.chapters.find(row => row.id === chapterId)
  if (!chapter || chapter.status === 'locked') throw new Error('章节不存在或已锁定。')
  const before = captureStoryImpact(novel, aggregate.workspace)
  const result = recordStoryTime(novel, { chapterId, chapterIndex: chapter.chapterIndex, content: chapter.content, mode: 'relative', elapsedDays, source }, now, nextId)
  if (!result.changed) return { clock: novel.storyClock!, changed: false }
  queueDataPanelAutomation(novel, chapter.chapterIndex, chapter.content, now, nextId)
  novel.updatedAt = now
  recordDataPanelImpact(aggregate, before, ['storyClock'], now, nextId)
  return { clock: novel.storyClock!, changed: true }
}
