import type {
  DataPanelAutomationRule,
  DataPanelChange,
  DataPanelField,
  DataPanelItem,
  Novel,
} from '@/types/novel'
import { evaluateFormula } from './safeFormula'

export const STORY_CLOCK_SOURCE = '__story_clock__'

function normalizeStoryClockSource(value?: string): string {
  return value === '故事时间' || value === '当前故事日' ? STORY_CLOCK_SOURCE : (value || '')
}

export type DataPanelHistoryCleanup =
  | { mode: 'all' }
  | { mode: 'count'; value: number }
  | { mode: 'chapters'; value: number }

export interface DataPanelItemFilter {
  query?: string
  category?: string
  recent?: 'all' | 'never' | number
  latestChapterIndex?: number
}

export interface DataPanelChangeFilter {
  itemId?: string
  fieldId?: string
  status?: DataPanelChange['status'] | 'all'
}

export interface DataPanelAutomationSuggestion {
  itemId: string
  fieldId: string
  itemName: string
  fieldName: string
  oldValue: string
  newValue: string
  reason: string
  chapterIndex: number
  rules: DataPanelAutomationRule[]
}

export function createDataPanelId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function normalizeDataPanelFieldType(value?: string): DataPanelField['type'] {
  const aliases: Record<string, NonNullable<DataPanelField['type']>> = {
    文本: 'text', text: 'text', 数字: 'number', number: 'number', 百分比: 'percent', percent: 'percent',
    天数: 'days', days: 'days', 倒计时: 'countdown', countdown: 'countdown', 公式: 'formula', formula: 'formula',
  }
  return aliases[value || ''] || 'text'
}

export function parseDataPanelFields(text: string): DataPanelField[] {
  return text.split(/\r?\n/).reduce<DataPanelField[]>((fields, line) => {
    const parts = line.split('=').map(value => value.trim())
    if (!parts[0]) return fields
    const type = normalizeDataPanelFieldType(parts[3])
    fields.push({
      id: createDataPanelId(),
      name: parts[0],
      value: parts[1] || '',
      unit: parts[2] || '',
      note: '',
      type,
      formula: parts[4] || '',
      autoCalculate: type === 'formula' || Boolean(parts[4]),
    })
    return fields
  }, [])
}

export function formatDataPanelFields(fields: DataPanelField[]): string {
  return fields.map(field => `${field.name}=${field.value}=${field.unit || ''}=${field.type || 'text'}=${field.formula || ''}`).join('\n')
}

function toDataPanelNumber(value: string): number {
  const match = String(value || '').match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : 0
}

function formatDataPanelNumber(value: number): string {
  return String(Math.round(value * 100) / 100)
}

function calculateFormulaFields(fields: DataPanelField[]): void {
  const byName = new Map<string, DataPanelField>()
  const duplicateNames = new Set<string>()
  const values = new Map<DataPanelField, number>()
  const visiting = new Set<DataPanelField>()
  for (const field of fields) {
    delete field.calculationError
    if (byName.has(field.name)) duplicateNames.add(field.name)
    byName.set(field.name, field)
  }
  function resolve(name: string): number {
    const field = byName.get(name)
    if (!field) throw new Error(`未知字段：${name}`)
    if (duplicateNames.has(name)) throw new Error(`字段名重复：${name}`)
    if (values.has(field)) return values.get(field)!
    if (visiting.has(field)) throw new Error(`循环依赖：${name}`)
    if (visiting.size >= 64) throw new Error('字段依赖过深')
    visiting.add(field)
    try {
      const numeric = String(field.value).trim().match(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[%％]|天)?$/)
      const next = field.autoCalculate && field.formula
        ? evaluateFormula(field.formula, resolve)
        : numeric ? Number.parseFloat(numeric[0]) : NaN
      if (!Number.isFinite(next)) throw new Error(`字段“${name}”不是有效数字`)
      values.set(field, next)
      return next
    } finally { visiting.delete(field) }
  }
  for (const field of fields) {
    if (!field.autoCalculate || !field.formula) continue
    try {
      field.value = formatDataPanelNumber(resolve(field.name))
    } catch (error) {
      field.calculationError = error instanceof Error ? error.message : '公式计算失败'
    }
  }
}

export function calculateDataPanelFields(item: DataPanelItem): void {
  calculateFormulaFields(item.fields)
}

/**
 * Keep dashboard filtering in a pure service so large books can be benchmarked
 * without mounting Vue, and the workspace does not duplicate matching rules.
 */
export function filterDataPanelItems(items: DataPanelItem[], filter: DataPanelItemFilter = {}): DataPanelItem[] {
  const needle = filter.query?.trim().toLowerCase() || ''
  const category = filter.category || 'all'
  const recent = filter.recent ?? 'all'
  const latestChapter = filter.latestChapterIndex ?? -1
  return items.filter(item => {
    if (category !== 'all' && item.category !== category) return false
    if (recent === 'never' && item.lastMentionChapterIndex !== undefined) return false
    if (typeof recent === 'number') {
      const threshold = latestChapter - recent + 1
      if (item.lastMentionChapterIndex === undefined || item.lastMentionChapterIndex < threshold) return false
    }
    if (!needle) return true
    return [item.name, ...item.relatedKeywords, ...item.fields.map(field => field.name)]
      .some(value => value.toLowerCase().includes(needle))
  })
}

export function filterDataPanelChanges(changes: DataPanelChange[], filter: DataPanelChangeFilter = {}): DataPanelChange[] {
  return changes
    .filter(change => !filter.itemId || change.itemId === filter.itemId)
    .filter(change => !filter.fieldId || change.fieldId === filter.fieldId)
    .filter(change => !filter.status || filter.status === 'all' || change.status === filter.status)
    .sort((a, b) => b.chapterIndex - a.chapterIndex || b.createdAt.localeCompare(a.createdAt))
}

export function calculateDataPanelFieldValues(fields: DataPanelField[]): DataPanelField[] {
  const cloned = fields.map(field => ({
    ...field,
    automationRules: field.automationRules?.map(rule => ({ ...rule })),
  }))
  calculateFormulaFields(cloned)
  return cloned
}

function signedNumber(value: string): number | null {
  const match = value.replace(/\s+/g, '').match(/[+-]?\d+(?:\.\d+)?/)
  if (!match) return null
  const number = Number(match[0])
  return Number.isFinite(number) ? number : null
}

function ruleSignature(rule: DataPanelAutomationRule): string {
  return [
    rule.trigger,
    rule.amount,
    rule.interval,
    (rule.schedule || []).join(','),
    rule.sourceFieldName || '',
  ].join('|')
}

function preserveRuleState(
  rule: DataPanelAutomationRule,
  oldRules: DataPanelAutomationRule[],
): DataPanelAutomationRule {
  const old = oldRules.find(item => ruleSignature(item) === ruleSignature(rule))
  if (!old) return rule
  return {
    ...rule,
    id: old.id,
    lastEvaluatedChapterIndex: old.lastEvaluatedChapterIndex,
    lastSourceValue: old.lastSourceValue,
    appliedCount: old.appliedCount,
    pendingChapterIndex: old.pendingChapterIndex,
  }
}

export function parseDataPanelAutomationRules(
  text: string,
  fields: DataPanelField[],
  previousFields: DataPanelField[] = [],
): DataPanelField[] {
  const rulesByField = new Map<string, DataPanelAutomationRule[]>()
  const defaultDayField = fields.find(field => field.type === 'days')?.name

  for (const rawLine of text.split(/\r?\n/)) {
    const [fieldNamePart, ...specParts] = rawLine.split(/[|｜]/)
    const fieldName = fieldNamePart?.trim()
    const spec = specParts.join('|').trim()
    if (!fieldName || !spec || !fields.some(field => field.name === fieldName)) continue

    let rule: DataPanelAutomationRule | null = null
    const chapterMatch = spec.match(/每章\s*(.+)/)
    const mentionMatch = spec.match(/每次出现\s*(.+)/)
    const elapsedMatch = spec.match(/经过\s*(\d+(?:\.\d+)?)\s*天(?:后)?\s*(.*)/)

    if (chapterMatch) {
      const schedule = [...chapterMatch[1].matchAll(/[+-]?\s*\d+(?:\.\d+)?/g)]
        .map(match => signedNumber(match[0]))
        .filter((value): value is number => value !== null)
      if (schedule.length) {
        rule = {
          id: createDataPanelId(),
          trigger: 'per_chapter',
          amount: schedule[0],
          interval: 1,
          schedule,
          enabled: true,
        }
      }
    } else if (mentionMatch) {
      const amount = signedNumber(mentionMatch[1])
      if (amount !== null) {
        rule = {
          id: createDataPanelId(),
          trigger: 'on_mention',
          amount,
          interval: 1,
          enabled: true,
        }
      }
    } else if (elapsedMatch) {
      const amount = signedNumber(elapsedMatch[2])
      const sourceMatch = spec.match(/基于\s*[:：]\s*([^）)]+)/)
      if (amount !== null) {
        rule = {
          id: createDataPanelId(),
          trigger: 'elapsed_days',
          amount,
          interval: Math.max(1, Number(elapsedMatch[1])),
          sourceFieldName: normalizeStoryClockSource(sourceMatch?.[1]?.trim() || defaultDayField),
          enabled: true,
        }
      }
    }

    if (!rule) continue
    const previous = previousFields.find(field => field.name === fieldName)?.automationRules || []
    const next = preserveRuleState(rule, previous)
    rulesByField.set(fieldName, [...(rulesByField.get(fieldName) || []), next])
  }

  return fields.map(field => ({
    ...field,
    automationRules: rulesByField.get(field.name) || [],
  }))
}

function signedLabel(value: number): string {
  return value >= 0 ? `+${value}` : String(value)
}

export function formatDataPanelAutomationRules(fields: DataPanelField[]): string {
  const lines: string[] = []
  for (const field of fields) {
    for (const rule of field.automationRules || []) {
      if (rule.trigger === 'per_chapter') {
        const schedule = rule.schedule?.length ? rule.schedule : [rule.amount]
        lines.push(`${field.name}｜每章 ${schedule.map(signedLabel).join(', ')}`)
      } else if (rule.trigger === 'on_mention') {
        lines.push(`${field.name}｜每次出现 ${signedLabel(rule.amount)}`)
      } else {
        const source = rule.sourceFieldName
          ? `（基于：${rule.sourceFieldName === STORY_CLOCK_SOURCE ? '故事时间' : rule.sourceFieldName}）`
          : ''
        lines.push(`${field.name}｜经过 ${rule.interval} 天 ${signedLabel(rule.amount)}${source}`)
      }
    }
  }
  return lines.join('\n')
}

export function getDataPanelRuleLabel(rule: DataPanelAutomationRule, field: DataPanelField): string {
  if (rule.trigger === 'per_chapter') {
    const schedule = rule.schedule?.length ? rule.schedule : [rule.amount]
    return `每章 ${schedule.map(signedLabel).join(' / ')}${field.unit || ''}`
  }
  if (rule.trigger === 'on_mention') return `每次出现 ${signedLabel(rule.amount)}${field.unit || ''}`
  return `每 ${rule.interval} 天 ${signedLabel(rule.amount)}${field.unit || ''}`
}

function itemIsMentioned(item: DataPanelItem, text: string): boolean {
  return [item.name, ...(item.relatedKeywords || [])]
    .filter(Boolean)
    .some(keyword => text.includes(keyword))
}

function ruleDelta(
  rule: DataPanelAutomationRule,
  item: DataPanelItem,
  chapterIndex: number,
  chapterText: string,
  storyDay?: number,
): { delta: number; steps: number } | null {
  if (!rule.enabled || rule.pendingChapterIndex !== undefined) return null
  if (rule.lastEvaluatedChapterIndex !== undefined && rule.lastEvaluatedChapterIndex >= chapterIndex) return null

  if (rule.trigger === 'on_mention') {
    return itemIsMentioned(item, chapterText) ? { delta: rule.amount, steps: 1 } : null
  }

  if (rule.trigger === 'elapsed_days') {
    if (rule.sourceFieldName === STORY_CLOCK_SOURCE) {
      if (storyDay === undefined || rule.lastSourceValue === undefined) return null
      const steps = Math.floor(Math.max(0, storyDay - rule.lastSourceValue) / Math.max(1, rule.interval))
      return steps > 0 ? { delta: steps * rule.amount, steps } : null
    }
    const source = item.fields.find(field => field.name === rule.sourceFieldName)
    if (!source) return null
    const current = toDataPanelNumber(source.value)
    if (rule.lastSourceValue === undefined) return null
    const steps = Math.floor(Math.max(0, current - rule.lastSourceValue) / Math.max(1, rule.interval))
    return steps > 0 ? { delta: steps * rule.amount, steps } : null
  }

  const start = rule.lastEvaluatedChapterIndex ?? item.lastMentionChapterIndex ?? chapterIndex - 1
  const steps = Math.floor(Math.max(0, chapterIndex - start) / Math.max(1, rule.interval))
  if (steps <= 0) return null
  const schedule = rule.schedule?.length ? rule.schedule : [rule.amount]
  let delta = 0
  for (let offset = 0; offset < steps; offset++) {
    const index = Math.min((rule.appliedCount || 0) + offset, schedule.length - 1)
    delta += schedule[index]
  }
  return { delta, steps }
}

export function buildDataPanelAutomationSuggestions(
  items: DataPanelItem[],
  chapterIndex: number,
  chapterText: string,
  storyDay?: number,
): DataPanelAutomationSuggestion[] {
  const suggestions: DataPanelAutomationSuggestion[] = []
  for (const item of items) {
    for (const field of item.fields) {
      const matchedRules: DataPanelAutomationRule[] = []
      let delta = 0
      for (const rule of field.automationRules || []) {
        const result = ruleDelta(rule, item, chapterIndex, chapterText, storyDay)
        if (!result) continue
        delta += result.delta
        matchedRules.push(rule)
      }
      if (!matchedRules.length || delta === 0) continue
      suggestions.push({
        itemId: item.id,
        fieldId: field.id,
        itemName: item.name,
        fieldName: field.name,
        oldValue: field.value,
        newValue: formatDataPanelNumber(toDataPanelNumber(field.value) + delta),
        reason: matchedRules.map(rule => `自动规则「${getDataPanelRuleLabel(rule, field)}」`).join('；'),
        chapterIndex,
        rules: matchedRules,
      })
    }
  }
  return suggestions
}

export function initializeElapsedRuleBaselines(items: DataPanelItem[], storyDay?: number): boolean {
  let changed = false
  for (const item of items) {
    for (const field of item.fields) {
      for (const rule of field.automationRules || []) {
        if (rule.trigger !== 'elapsed_days' || rule.lastSourceValue !== undefined) continue
        if (rule.sourceFieldName === STORY_CLOCK_SOURCE) {
          if (storyDay === undefined) continue
          rule.lastSourceValue = storyDay
        } else {
          const source = item.fields.find(candidate => candidate.name === rule.sourceFieldName)
          if (!source) continue
          rule.lastSourceValue = toDataPanelNumber(source.value)
        }
        changed = true
      }
    }
  }
  return changed
}

export function settleDataPanelAutomationRules(item: DataPanelItem, change: DataPanelChange, storyDay?: number): void {
  const field = item.fields.find(candidate => candidate.id === change.fieldId || candidate.name === change.fieldName)
  if (!field) return
  for (const rule of field.automationRules || []) {
    if (rule.pendingChapterIndex !== change.chapterIndex) continue
    rule.lastEvaluatedChapterIndex = change.chapterIndex
    rule.appliedCount = (rule.appliedCount || 0) + 1
    if (rule.trigger === 'elapsed_days' && rule.sourceFieldName === STORY_CLOCK_SOURCE) {
      if (storyDay !== undefined) rule.lastSourceValue = storyDay
    } else if (rule.trigger === 'elapsed_days') {
      const source = item.fields.find(candidate => candidate.name === rule.sourceFieldName)
      if (source) rule.lastSourceValue = toDataPanelNumber(source.value)
    }
    delete rule.pendingChapterIndex
  }
}

export function pruneDataPanelChangeHistory(
  changes: DataPanelChange[],
  cleanup: DataPanelHistoryCleanup,
): { changes: DataPanelChange[]; removed: number } {
  const pending = changes.filter(change => change.status === 'pending')
  const resolved = changes
    .filter(change => change.status !== 'pending')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  let keptResolved: DataPanelChange[]
  if (cleanup.mode === 'all') {
    keptResolved = []
  } else if (cleanup.mode === 'count') {
    keptResolved = resolved.slice(0, Math.max(0, Math.floor(cleanup.value)))
  } else {
    const maxChapter = resolved.reduce((max, change) => Math.max(max, change.chapterIndex), -1)
    const threshold = maxChapter - Math.max(1, Math.floor(cleanup.value)) + 1
    keptResolved = resolved.filter(change => change.chapterIndex >= threshold)
  }

  const keptIds = new Set([...pending, ...keptResolved].map(change => change.id))
  return {
    changes: changes.filter(change => keptIds.has(change.id)),
    removed: changes.length - keptIds.size,
  }
}

export function dataPanelsToMarkdown(novel: Pick<Novel, 'title' | 'dataPanels' | 'dataPanelChanges'>): string {
  const lines = [`# ${novel.title} - 数据面板`, '']
  for (const item of novel.dataPanels || []) {
    lines.push(`## ${item.name}`, '', `- 分类：${item.category}`)
    if (item.relatedKeywords.length) lines.push(`- 关键词：${item.relatedKeywords.join('、')}`)
    if (item.lastMentionChapterIndex !== undefined) lines.push(`- 最近出现：第 ${item.lastMentionChapterIndex + 1} 章`)
    lines.push('', '| 字段 | 当前值 | 类型 | 公式/规则 |', '| --- | --- | --- | --- |')
    for (const field of item.fields) {
      const rules = (field.automationRules || []).map(rule => getDataPanelRuleLabel(rule, field)).join('；')
      lines.push(`| ${field.name} | ${field.value}${field.unit ? ` ${field.unit}` : ''} | ${field.type || 'text'} | ${field.formula || rules || '-'} |`)
    }
    const changes = (novel.dataPanelChanges || []).filter(change => change.itemId === item.id)
    if (changes.length) {
      lines.push('', '### 变更记录', '', '| 章节 | 字段 | 变化 | 状态 | 依据 |', '| --- | --- | --- | --- | --- |')
      for (const change of changes) {
        const status = change.status === 'pending' ? '待确认' : change.status === 'accepted' ? '已应用' : '已忽略'
        lines.push(`| 第 ${change.chapterIndex + 1} 章 | ${change.fieldName} | ${change.oldValue} -> ${change.newValue} | ${status} | ${change.reason.replace(/\|/g, '\\|')} |`)
      }
    }
    lines.push('')
  }
  return lines.join('\n')
}
