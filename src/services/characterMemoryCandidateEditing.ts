import type { CandidateChange } from '@/types/reconstruction'
import type { Character } from '@/types/novel'
import { candidateFields, buildEditedCandidateValue, parseEditableCandidate, type CandidateField } from './candidateEditing'
import { assertRelationshipDimension, relationshipDimensionOptions } from './characterMemoryIdentity'

export function memoryCandidateFields(candidate: CandidateChange, value: Record<string, unknown>, characters: Character[]): CandidateField[] {
  const fields = candidateFields(candidate, value)
  if (candidate.type === 'knowledge') {
    const options = characters.map(character => ({ value: character.id, label: character.name + ' [' + character.id + ']' }))
    return fields.map(field => field.key === 'fact' ? { ...field, readonly: false } : field.key === 'state'
      ? { ...field, options: field.options?.map(option => option.value === 'does_not_know' ? { ...option, label: '明确不知情' } : option) } : field).concat([
      { key: 'subjectId', label: '命题主体（留空表示指代未确认）', kind: 'select', options },
      { key: 'objectId', label: '命题对象（可选）', kind: 'select', options },
      { key: 'scope', label: '条件、时间或适用范围（不明确可留空，独立保留）', kind: 'multiline' },
    ])
  }
  if (candidate.type === 'relationship') return [...fields, { key: 'dimension', label: '关系维度', kind: 'select', required: true, options: [
    ...relationshipDimensionOptions, { value: 'custom', label: '自定义维度' },
  ] }, { key: 'dimensionName', label: '自定义维度名称（选择自定义时填写）' }]
  return fields
}
export function memoryCandidateValue(candidate: CandidateChange, draft: Record<string, string>): string {
  if (!['knowledge','relationship'].includes(candidate.type)) return buildEditedCandidateValue(candidate, draft)
  const original = parseEditableCandidate(candidate)
  // The model may suggest an ID; it cannot lock text or carry authorization.
  for (const key of ['factId','authorDecision','propositionDecision','stateIdentityId','projectedFactId','conflictGroupId','mergeConfirmed','confirmed']) delete original[key]
  const value = JSON.parse(buildEditedCandidateValue({ ...candidate, proposedValue: JSON.stringify(original) }, draft))
  if (candidate.type === 'knowledge') {
    value.subjectId = draft.subjectId?.trim() || undefined
    value.objectId = draft.objectId?.trim() || undefined
    value.scope = draft.scope?.trim() || ''
  } else value.dimension = assertRelationshipDimension(draft.dimension === 'custom' ? 'custom:' + (draft.dimensionName || '').trim() : draft.dimension)
  return JSON.stringify(value)
}
