import type { DataPanelChange, DataPanelItem, DataPanelVersion, Novel } from '@/types/novel'
import { calculateDataPanelFields, findDataPanelField } from './dataPanel'
import { equipmentSnapshot } from './dataPanelEquipment'
import { captureDataPanelReferenceItem, dataPanelAcceptedSource, recordDataPanelReference } from './dataPanelReference'
import { dataPanelProposalSourceIsCurrent, initializeDataPanelTimeBaselines, usesStoryTime } from './dataPanelProposalSource'
import { captureStoryTimePoint, mergeStoryTimePointSources, type StoryTimePointSource } from './storyTime'

type ResolvedOwner = { id?: string; createName?: string }
type ResolvedChange = DataPanelChange & { updatedAt?: string }

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function dataPanelSnapshot(item: DataPanelItem): string {
  return JSON.stringify({
    category: item.category,
    name: item.name,
    fields: item.fields,
    relatedKeywords: item.relatedKeywords,
    ownerItemId: item.ownerItemId,
    equipmentState: item.equipmentState,
    lastMentionChapterIndex: item.lastMentionChapterIndex,
  })
}

function appendSnapshot(item: DataPanelItem, snapshot: string, label: string, now: string, nextId: () => string): void {
  const previous = item.versions || []
  if (previous[previous.length - 1]?.snapshot === snapshot) return
  const version: DataPanelVersion = { id: nextId(), label, savedAt: now, snapshot }
  item.versions = [...previous, version].slice(-20)
}

function resolveOwner(items: DataPanelItem[], name: string): ResolvedOwner | null {
  const trimmed = name.trim()
  if (!trimmed) return {}
  const candidates = items.filter(item => item.category === '角色' && item.name === trimmed)
  if (candidates.length > 1) return null
  if (candidates.length === 1) return { id: candidates[0].id }
  return { createName: trimmed }
}

function createOwner(name: string, now: string, nextId: () => string): DataPanelItem {
  const owner: DataPanelItem = {
    id: nextId(), category: '角色', name, fields: [], relatedKeywords: [name],
    createdAt: now, updatedAt: now,
  }
  calculateDataPanelFields(owner)
  return owner
}

function proposalTime(novel: Novel, change: DataPanelChange): StoryTimePointSource | undefined {
  const source = change.sourceBinding
  const chapter = source && source.kind !== 'author' ? novel.chapters.find(row => row.id === source.chapterId && row.chapterIndex === change.chapterIndex)
    : novel.chapters.find(row => row.chapterIndex === change.chapterIndex)
  return chapter ? captureStoryTimePoint(novel, chapter.id) : undefined
}

function freshRuleProgress(item: DataPanelItem): void {
  for (const field of item.fields) for (const rule of field.automationRules || []) {
    delete rule.lastSourceValue; delete rule.storyTimeCursor; delete rule.storyTimeCursorPending; delete rule.lastEvaluatedChapterIndex
    delete rule.pendingChapterIndex; delete rule.appliedCount
  }
}

/** Consume exactly the bound steps; rejection of stale evidence consumes nothing. */
function settleBoundAutomation(novel: Novel, item: DataPanelItem, change: DataPanelChange): void {
  const source = change.sourceBinding
  if (source?.kind !== 'automation') return
  if (!dataPanelProposalSourceIsCurrent(novel, change)) throw new Error('自动提案的时间或数据来源已变化，未结算规则。')
  const field = findDataPanelField(item, change.fieldId, change.fieldName)
  const updates = source.ruleSteps.map(entry => {
    const rule = field!.automationRules!.find(rule => rule.id === entry.ruleId)!
    const nextValue = rule.trigger === 'elapsed_days' && rule.lastSourceValue !== undefined
      ? rule.lastSourceValue + entry.steps * Math.max(1, rule.interval) : undefined
    const appliedCount = (rule.appliedCount || 0) + entry.steps
    if (nextValue !== undefined && !Number.isFinite(nextValue) || !Number.isSafeInteger(appliedCount)) throw new Error('规则结算数值超出有效范围。')
    return { rule, nextValue, appliedCount }
  })
  for (const { rule, nextValue, appliedCount } of updates) {
    rule.lastEvaluatedChapterIndex = change.chapterIndex
    rule.appliedCount = appliedCount
    if (nextValue !== undefined) rule.lastSourceValue = nextValue
    if (usesStoryTime(rule)) {
      const cursor = source.time!.cursors.find(row => row.ruleId === rule.id)!.cursor
      rule.storyTimeCursor = { value: nextValue!, sources: mergeStoryTimePointSources(novel, cursor.sources, source.time!.end) }
    }
    delete rule.pendingChapterIndex
  }
}

function markResolved(change: DataPanelChange, status: 'accepted' | 'rejected', now: string): void {
  const resolved = change as ResolvedChange
  resolved.status = status
  resolved.updatedAt = now
}

/** Apply one already source-validated proposal to a caller-owned Novel draft. */
export function applyDataPanelProposal(
  novel: Novel,
  changeId: string,
  newValue: string | undefined,
  now: string,
  nextId: () => string,
): boolean {
  const items = novel.dataPanels
  const changes = novel.dataPanelChanges
  if (!items || !changes) return false
  const change = changes.find(item => item.id === changeId)
  if (!change || change.status !== 'pending') return false
  if (change.sourceBinding?.kind === 'automation' && !dataPanelProposalSourceIsCurrent(novel, change)) return false

  const mutation = change.mutation
  if (mutation?.kind === 'create') {
    const draft = mutation.item
    if (change.oldValue !== '未记录') return false
    if (items.some(item => item.name === draft.name && item.category === draft.category)) return false
    const owner = resolveOwner(items, draft.ownerItemName || '')
    if (!owner) return false

    // Allocate and prepare all new objects before publishing any reference into the draft.
    const additions: DataPanelItem[] = []
    let ownerId = owner.id
    if (owner.createName) {
      const ownerItem = createOwner(owner.createName, now, nextId)
      ownerId = ownerItem.id
      additions.push(ownerItem)
    }
    const copied = clone(draft)
    const created: DataPanelItem = {
      id: nextId(), category: copied.category, name: copied.name,
      fields: clone(copied.fields), relatedKeywords: clone(copied.relatedKeywords),
      ownerItemId: ownerId, equipmentState: copied.equipmentState,
      lastMentionChapterIndex: change.chapterIndex, createdAt: now, updatedAt: now,
    }
    calculateDataPanelFields(created)
    freshRuleProgress(created)
    initializeDataPanelTimeBaselines(novel, [created], proposalTime(novel, change))
    additions.push(created)

    for (const addition of additions) recordDataPanelReference(addition, undefined, dataPanelAcceptedSource(change), now, nextId())

    items.push(...additions)
    change.itemId = created.id
    markResolved(change, 'accepted', now)
    novel.updatedAt = now
    return true
  }

  const item = items.find(candidate => candidate.id === change.itemId)
  if (!item) return false
  const beforeReference = captureDataPanelReferenceItem(item)

  if (mutation?.kind === 'equipment') {
    if (!['装备', '道具'].includes(item.category)) return false
    if (equipmentSnapshot(item, items) !== change.oldValue) return false
    if ((item.lastMentionChapterIndex ?? -1) > change.chapterIndex) return false
    const owner = resolveOwner(items, mutation.ownerItemName)
    if (!owner) return false

    const ownerItem = owner.createName
      ? createOwner(owner.createName, now, nextId)
      : undefined
    const snapshot = dataPanelSnapshot(item)
    appendSnapshot(item, snapshot, '装备状态变更前', now, nextId)
    if (ownerItem) {
      recordDataPanelReference(ownerItem, undefined, dataPanelAcceptedSource(change), now, nextId())
      items.push(ownerItem)
    }
    item.ownerItemId = ownerItem?.id || owner.id
    item.equipmentState = mutation.state
    item.lastMentionChapterIndex = change.chapterIndex
    item.updatedAt = now
    recordDataPanelReference(item, beforeReference, dataPanelAcceptedSource(change), now, nextId())
    markResolved(change, 'accepted', now)
    novel.updatedAt = now
    return true
  }

  if (mutation?.kind === 'field') {
    if (change.oldValue !== '未记录') return false
    if ((item.lastMentionChapterIndex ?? -1) > change.chapterIndex) return false
    if (item.fields.some(field => field.name === mutation.field.name)) return false
    const field = clone(mutation.field)
    const newFieldItem = { ...item, fields: [field] }
    freshRuleProgress(newFieldItem)
    initializeDataPanelTimeBaselines(novel, [newFieldItem], proposalTime(novel, change))
    const snapshot = dataPanelSnapshot(item)
    appendSnapshot(item, snapshot, '新增字段前', now, nextId)
    item.fields.push(field)
    calculateDataPanelFields(item)
    item.lastMentionChapterIndex = change.chapterIndex
    item.updatedAt = now
    recordDataPanelReference(item, beforeReference, dataPanelAcceptedSource(change), now, nextId())
    markResolved(change, 'accepted', now)
    novel.updatedAt = now
    return true
  }

  const field = findDataPanelField(item, change.fieldId, change.fieldName)
  if (!field) return false
  if (String(field.value) !== String(change.oldValue)) return false
  if ((item.lastMentionChapterIndex ?? -1) > change.chapterIndex) return false
  const value = newValue?.trim() || change.newValue
  if (!value.trim()) return false

  const snapshot = dataPanelSnapshot(item)
  appendSnapshot(item, snapshot, '字段值变更前', now, nextId)
  settleBoundAutomation(novel, item, change)
  field.value = value
  change.newValue = value
  calculateDataPanelFields(item)
  if (change.sourceBinding?.kind !== 'automation') {
    const point = proposalTime(novel, change)
    // An explicit independent value confirmation may recover stale elapsed-time bookkeeping.
    initializeDataPanelTimeBaselines(novel, [{ ...item, fields: [field] }], point, true, point)
  }
  item.lastMentionChapterIndex = change.chapterIndex
  item.updatedAt = now
  recordDataPanelReference(item, beforeReference, dataPanelAcceptedSource(change), now, nextId(), field.id)
  markResolved(change, 'accepted', now)
  novel.updatedAt = now
  return true
}

/** Reject one pending proposal and settle only its pending automation bookkeeping. */
export function rejectDataPanelProposal(novel: Novel, changeId: string, now: string, settleAutomation = true): boolean {
  const changes = novel.dataPanelChanges
  if (!changes) return false
  const change = changes.find(item => item.id === changeId)
  if (!change || change.status !== 'pending') return false
  const item = novel.dataPanels?.find(candidate => candidate.id === change.itemId)
  if (settleAutomation && change.sourceBinding?.kind === 'automation' && item && !change.mutation
    && dataPanelProposalSourceIsCurrent(novel, change)) settleBoundAutomation(novel, item, change)
  markResolved(change, 'rejected', now)
  novel.updatedAt = now
  return true
}
