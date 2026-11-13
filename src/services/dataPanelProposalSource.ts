import type { Chapter, DataPanelChange, DataPanelProposalSource, DataPanelRuleStep, Novel, DataPanelAutomationRule, DataPanelAutomationTime, DataPanelItem } from '@/types/novel'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import { findDataPanelField, initializeElapsedRuleBaselines, STORY_CLOCK_SOURCE } from './dataPanel'
import { captureStoryTimePoint, storyTimePointIsCurrent, type StoryTimePointSource } from './storyTime'
import { dataPanelReferenceState, projectDataPanelReferences } from './dataPanelReference'

type Proposal = Omit<DataPanelChange, 'id' | 'status' | 'createdAt' | 'sourceBinding'>

export const usesStoryTime = (rule: DataPanelAutomationRule) => rule.trigger === 'elapsed_days' && rule.sourceFieldName === STORY_CLOCK_SOURCE

/** Form parsing keeps rule IDs but may omit new runtime fields. Keep the stored progress authoritative. */
export function preserveDataPanelTimeProgress(item: DataPanelItem, previous: DataPanelItem): void {
  for (const field of item.fields) for (const rule of field.automationRules || []) {
    if (!usesStoryTime(rule)) continue
    const old = previous.fields.find(row => row.id === field.id)?.automationRules?.find(row => row.id === rule.id
      && usesStoryTime(row) && row.amount === rule.amount && row.interval === rule.interval
      && JSON.stringify(row.schedule || []) === JSON.stringify(rule.schedule || []))
    if (!old) continue
    for (const key of ['lastSourceValue', 'storyTimeCursor', 'storyTimeCursorPending', 'lastEvaluatedChapterIndex', 'appliedCount', 'pendingChapterIndex'] as const) {
      if (old[key] === undefined) delete rule[key]
      else Object.assign(rule, { [key]: JSON.parse(JSON.stringify(old[key])) })
    }
  }
}

export function dataPanelTimeCursorIsCurrent(novel: Novel, rule: DataPanelAutomationRule, throughChapterIndex?: number): boolean {
  const cursor = rule.storyTimeCursor
  return !rule.storyTimeCursorPending && !!cursor && Number.isFinite(cursor.value) && cursor.value >= 0 && cursor.value === rule.lastSourceValue
    && Array.isArray(cursor.sources) && cursor.sources.length > 0 && cursor.sources.every(point => storyTimePointIsCurrent(novel, point, throughChapterIndex))
}

/** Existing unbound progress is never promoted to evidence. Only an author edit may reset it. */
export function initializeDataPanelTimeBaselines(novel: Novel, items: DataPanelItem[], point?: StoryTimePointSource, authorReset = false,
  recoveryPoint?: StoryTimePointSource): void {
  initializeElapsedRuleBaselines(items) // Non-clock elapsed rules keep their ordinary field baseline.
  for (const item of items) for (const field of item.fields) for (const rule of field.automationRules || []) {
    if (!usesStoryTime(rule) || dataPanelTimeCursorIsCurrent(novel, rule)) continue
    if (rule.lastSourceValue !== undefined || rule.storyTimeCursor !== undefined) {
      if (!authorReset) continue
      delete rule.lastSourceValue; delete rule.storyTimeCursor; delete rule.pendingChapterIndex
      delete rule.lastEvaluatedChapterIndex; delete rule.appliedCount
      rule.storyTimeCursorPending = true
    }
    const anchor = rule.storyTimeCursorPending ? recoveryPoint : point
    if (anchor && storyTimePointIsCurrent(novel, anchor)) {
      rule.lastSourceValue = anchor.day
      rule.storyTimeCursor = { value: anchor.day, sources: [{ ...anchor }] }
      delete rule.storyTimeCursorPending
    }
  }
}

/** Never derive a new value from an invalid accepted value or from future chapter data. */
export function automationFieldInputsCurrent(novel: Novel, chapterIndex: number, itemId: string, fieldId: string,
  projection = projectDataPanelReferences(novel, chapterIndex + 1)): boolean {
  const item = novel.dataPanels.find(row => row.id === itemId), field = item?.fields.find(row => row.id === fieldId)
  if (!item || !field) return false
  const effective = projection.items.find(row => row.id === itemId)
  if (!effective) return false
  const live = dataPanelReferenceState(item), known = dataPanelReferenceState(effective)
  const names = new Set((field.automationRules || []).filter(rule => rule.enabled && rule.trigger === 'elapsed_days'
    && !usesStoryTime(rule)).map(rule => rule.sourceFieldName))
  const inputs = [field, ...item.fields.filter(row => names.has(row.name))]
  return inputs.every(row => known['field:' + row.id] !== undefined
    && JSON.stringify(live['field:' + row.id]) === JSON.stringify(known['field:' + row.id]))
}

function automationTime(novel: Novel, proposal: Proposal, steps: DataPanelRuleStep[]): DataPanelAutomationTime | undefined {
  const item = novel.dataPanels.find(row => row.id === proposal.itemId)
  const field = findDataPanelField(item, proposal.fieldId, proposal.fieldName)
  const rules = (field?.automationRules || []).filter(rule => usesStoryTime(rule) && steps.some(step => step.ruleId === rule.id))
  if (!rules.length) return undefined
  const chapter = novel.chapters.find(row => row.chapterIndex === proposal.chapterIndex)
  const end = chapter ? captureStoryTimePoint(novel, chapter.id) : undefined
  if (!end || rules.some(rule => !dataPanelTimeCursorIsCurrent(novel, rule, proposal.chapterIndex))) throw new Error('自动推算的章节时间或已结算时间来源失效，请先由作者核对。')
  return { end, cursors: rules.map(rule => ({ ruleId: rule.id, cursor: JSON.parse(JSON.stringify(rule.storyTimeCursor!)) })) }
}

function withoutPending(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutPending)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'pendingChapterIndex').map(([key, entry]) => [key, withoutPending(entry)]))
  return value
}

/** Bind interpretation and rule inputs; the private mutation also checks the actual old value. */
export function dataProposalReferenceVersion(novel: Novel, proposal: Proposal, kind: 'chapter' | 'automation', ruleSteps: DataPanelRuleStep[] = []): string {
  const item = novel.dataPanels.find(row => row.id === proposal.itemId)
  let reference: unknown
  if (kind === 'automation') {
    const field = item?.fields.find(row => row.id === proposal.fieldId)
    const sources = (field?.automationRules || []).map(rule => usesStoryTime(rule)
      ? undefined : item?.fields.find(row => row.name === rule.sourceFieldName)?.value)
    reference = ['data-automation-v2', field ? withoutPending(field) : null, sources, item?.id, item?.name, item?.relatedKeywords,
      ruleSteps, automationTime(novel, proposal, ruleSteps)]
  } else if (proposal.mutation?.kind === 'create') {
    const draft = proposal.mutation.item
    reference = [draft.name, draft.category, novel.dataPanels.filter(row => row.name === draft.name && row.category === draft.category).map(row => row.id)]
  } else {
    const field = findDataPanelField(item, proposal.fieldId, proposal.fieldName)
    const definition = field ? [field.id, field.name, field.unit, field.note, field.type, field.formula, field.autoCalculate, field.modifier] : null
    reference = [item?.id, item?.name, item?.category, item?.ownerItemId, item?.equipmentState,
      proposal.mutation?.kind === 'field' ? item?.fields.map(row => [row.id, row.name]) : definition]
  }
  return buildAnalysisSourceVersionId(JSON.stringify(reference))
}

function uniqueOriginalQuote(content: string, reason: string): string {
  const text = content.replace(/\s/g, ''), quote = reason.replace(/\s/g, '')
  const start = text.indexOf(quote)
  if (quote.length < 2 || start < 0 || start !== text.lastIndexOf(quote)) throw new Error('数据提案需要当前正文中唯一的连续原文依据。')
  const offsets: number[] = []
  for (let index = 0; index < content.length; index++) if (!/\s/.test(content[index])) offsets.push(index)
  return content.slice(offsets[start], offsets[start + quote.length - 1] + 1)
}

function ownerTarget(novel: Novel, proposal: Proposal): DataPanelProposalSource['ownerTarget'] {
  const name = (proposal.mutation?.kind === 'create' ? proposal.mutation.item.ownerItemName
    : proposal.mutation?.kind === 'equipment' ? proposal.mutation.ownerItemName : undefined)?.trim()
  if (!name) return undefined
  const matches = novel.dataPanels.filter(item => item.category === '角色' && item.name === name)
  if (matches.length > 1) throw new Error('存在多个同名数据持有人，请先明确身份。')
  return { name, itemId: matches[0]?.id || null }
}

export function bindDataPanelProposalSource(novel: Novel, chapter: Chapter, proposal: Proposal, kind: 'chapter' | 'automation', ruleSteps?: DataPanelRuleStep[]): DataPanelProposalSource {
  if (chapter.chapterIndex !== proposal.chapterIndex || !novel.chapters.some(row => row.id === chapter.id && row.content === chapter.content)) throw new Error('数据提案不属于当前作品章节。')
  if (kind === 'automation' && proposal.mutation) throw new Error('自动规则只能提出已有字段的数值变化。')
  if (kind === 'automation' && (!Array.isArray(ruleSteps) || !ruleSteps.length
    || ruleSteps.some(row => !Number.isSafeInteger(row.steps) || row.steps < 1))) throw new Error('自动提案缺少有效计算步数。')
  const source = { novelId: novel.id, chapterId: chapter.id, sourceVersionId: buildAnalysisSourceVersionId(chapter.content),
    referenceVersion: dataProposalReferenceVersion(novel, proposal, kind, ruleSteps), ownerTarget: ownerTarget(novel, proposal) }
  if (kind === 'chapter') return { ...source, kind, quote: uniqueOriginalQuote(chapter.content, proposal.reason) }
  if (!ruleSteps?.length || ruleSteps.some(row => !Number.isInteger(row.steps) || row.steps < 1)
    || new Set(ruleSteps.map(row => row.ruleId)).size !== ruleSteps.length) throw new Error('自动提案缺少完整计算步数。')
  if (!automationFieldInputsCurrent(novel, chapter.chapterIndex, proposal.itemId, proposal.fieldId)) throw new Error('自动推算所依赖的数据来源已失效。')
  const time = automationTime(novel, proposal, ruleSteps)
  return { ...source, kind, ruleSteps: ruleSteps.map(row => ({ ...row })), ...(time ? { time } : {}) }
}

export function bindAuthorDataPanelProposalSource(novel: Novel, proposal: Proposal): DataPanelProposalSource {
  return { kind: 'author', novelId: novel.id, referenceVersion: dataProposalReferenceVersion(novel, proposal, 'chapter'), ownerTarget: ownerTarget(novel, proposal) }
}

export function dataPanelProposalSourceIsCurrent(novel: Novel, change: DataPanelChange): boolean {
  const source = change.sourceBinding
  if (!source) return false
  try {
    const owner = ownerTarget(novel, change)
    if (source.ownerTarget?.name !== owner?.name || source.ownerTarget?.itemId !== owner?.itemId) return false
  } catch { return false }
  if (source.kind === 'author') return source.novelId === novel.id && source.referenceVersion === dataProposalReferenceVersion(novel, change, 'chapter')
  const chapter = novel.chapters.find(row => row.id === source.chapterId && row.chapterIndex === change.chapterIndex)
  if (source.novelId !== novel.id || !chapter || buildAnalysisSourceVersionId(chapter.content) !== source.sourceVersionId) return false
  try {
    if (dataProposalReferenceVersion(novel, change, source.kind, source.kind === 'automation' ? source.ruleSteps : []) !== source.referenceVersion) return false
  } catch { return false }
  if (source.kind === 'automation') {
    if (change.mutation) return false
    const item = novel.dataPanels.find(row => row.id === change.itemId)
    const field = findDataPanelField(item, change.fieldId, change.fieldName)
    if (!Array.isArray(source.ruleSteps)) return false
    try {
      if (JSON.stringify(source.time) !== JSON.stringify(automationTime(novel, change, source.ruleSteps))) return false
    } catch { return false }
    return automationFieldInputsCurrent(novel, change.chapterIndex, change.itemId, change.fieldId) && source.ruleSteps.length > 0
      && new Set(source.ruleSteps.map(row => row.ruleId)).size === source.ruleSteps.length
      && source.ruleSteps.every(entry => Number.isSafeInteger(entry.steps) && entry.steps > 0
        && field?.automationRules?.some(rule => rule.id === entry.ruleId && rule.enabled && rule.pendingChapterIndex === change.chapterIndex
          && (!usesStoryTime(rule) || !!source.time && dataPanelTimeCursorIsCurrent(novel, rule)
            && entry.steps === Math.floor(Math.max(0, source.time.end.day - rule.storyTimeCursor!.value) / Math.max(1, rule.interval)))))
  }
  try { return uniqueOriginalQuote(chapter.content, change.reason) === source.quote } catch { return false }
}
