import type { CandidateChange } from '@/types/reconstruction'
import { assertEventCausalityPayload, eventCausalityLabels } from './eventCausalityValidation'

export interface CandidateField {
  key: string; label: string; kind?: 'text' | 'multiline' | 'list' | 'number' | 'select'
  required?: boolean; options?: Array<{ value: string; label: string }>; readonly?: boolean
}
const choices = (items: Record<string, string>) => Object.entries(items).map(([value, label]) => ({ value, label }))
const eventStatus = choices({ planted: '已埋下', developing: '发展中', resolved: '已回收', abandoned: '已放弃' })
const characterStatus = choices({ 活跃: '活跃', 退场: '退场', 死亡: '死亡', 失踪: '失踪' })
const text = (key: string, label: string, required = false): CandidateField => ({ key, label, required })

export function parseEditableCandidate(candidate: CandidateChange): Record<string, unknown> {
  let value: unknown
  try { value = JSON.parse(candidate.proposedValue) } catch { throw new Error('候选格式无法编辑，请忽略后重新分析。') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('候选需要包含结构化内容，请重新分析。')
  return value as Record<string, unknown>
}

export function candidateFields(candidate: Pick<CandidateChange, 'type'>, value: Record<string, unknown>): CandidateField[] {
  if (candidate.type === 'event_causality') return [
    text('fromEventId', '来源事件 ID（起因）', true), text('toEventId', '目标事件 ID（结果或行动）', true),
    { key:'relation', label:'有向关系类型', kind:'select', required:true, options:choices(eventCausalityLabels) },
    { key:'explanation', label:'因果说明', kind:'multiline', required:true },
  ]
  if (candidate.type === 'knowledge') return [
    { ...text('fact', '命题', true), readonly: Boolean(value.factId) },
    { key: 'state', label: '知情状态', kind: 'select', required: true, options: choices({ knows: '知道', suspects: '怀疑', does_not_know: '不知道', false_belief: '错误信念' }) },
    text('belief', '角色实际相信的内容（错误信念时必填）'), text('learnedFrom', '获知途径'),
  ]
  if (candidate.type === 'relationship') return [text('relation', '关系', true), { key: 'description', label: '关系说明', kind: 'multiline' }]
  if (candidate.type === 'state') return [{ key: 'status', label: '角色状态', kind: 'select', required: true, options: characterStatus }]
  if (candidate.type === 'timeline') return [{ key: 'elapsedDays', label: '故事推进天数', kind: 'number', required: true }]
  if (candidate.type === 'plotline') return [
    { key: 'status', label: '发展状态', kind: 'select', required: true, options: [...eventStatus, ...choices({ active: '进行中（剧情线）', paused: '暂停（剧情线）', completed: '已完成（剧情线）' })] },
    { key: 'note', label: '说明', kind: 'multiline' },
  ]
  if (candidate.type === 'fact' && value.kind === 'character') return [
    text('name', '角色名', true), { key: 'aliases', label: '别名（每行一个）', kind: 'list' },
    text('identity', '身份'), text('personality', '性格'), text('powerLevel', '实力'), text('faction', '阵营'),
    { key: 'description', label: '角色说明', kind: 'multiline' },
    { key: 'status', label: '角色状态', kind: 'select', options: characterStatus },
  ]
  return [text('title', '事件标题', true), { key: 'description', label: '发生了什么', kind: 'multiline' },
    { key: 'characters', label: '相关角色（每行一个）', kind: 'list' },
    ...(candidate.type === 'foreshadowing' ? [] : [{ key: 'eventType', label: '事件类型', kind: 'select' as const, options: choices({ 主线: '主线', 支线: '支线', 伏笔: '伏笔', 转折: '转折', 战斗: '战斗', 其他: '其他' }) }]),
    { key: 'status', label: '事件状态', kind: 'select', options: eventStatus },
  ]
}

export function candidateFieldValues(fields: CandidateField[], value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(fields.map(field => [field.key, field.kind === 'list' && Array.isArray(value[field.key])
    ? (value[field.key] as unknown[]).map(String).join('\n') : value[field.key] == null ? '' : String(value[field.key])]))
}

/** Rebuild only exposed fields; provenance and referenced identities are never editable. */
export function buildEditedCandidateValue(candidate: CandidateChange, draft: Record<string, string>): string {
  const value = parseEditableCandidate(candidate)
  const fields = candidateFields(candidate, value)
  const original = candidateFieldValues(fields, value)
  for (const field of fields) {
    const next = field.readonly ? original[field.key] : (draft[field.key] ?? original[field.key]).trim()
    if (field.required && !next) throw new Error('请填写' + field.label)
    if (field.kind === 'select' && next && !field.options?.some(option => option.value === next)) throw new Error(field.label + '无效，请重新选择。')
    if (field.readonly || next === original[field.key]) continue
    if (field.kind === 'number') {
      const number = Number(next)
      if (!Number.isFinite(number) || number <= 0) throw new Error('推进天数必须是大于 0 的有限数字。')
      value[field.key] = number
    } else if (field.kind === 'list') value[field.key] = next.split(/\r?\n/).map(item => item.trim()).filter(Boolean)
    else value[field.key] = next
  }
  if (candidate.type === 'timeline' && (!Number.isFinite(Number(value.elapsedDays)) || Number(value.elapsedDays) <= 0)) throw new Error('推进天数必须是大于 0 的有限数字。')
  if (candidate.type === 'knowledge' && value.state === 'false_belief' && !String(value.belief || '').trim()) throw new Error('请填写角色实际相信的内容。')
  if (candidate.type === 'event_causality') {
    assertEventCausalityPayload(value)
    return JSON.stringify({ fromEventId:value.fromEventId, toEventId:value.toEventId, relation:value.relation, explanation:value.explanation })
  }
  return JSON.stringify(value)
}
