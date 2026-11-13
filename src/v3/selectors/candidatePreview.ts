import type { CandidateChange } from '@/types/reconstruction'
import type { Character, EventLogEntry } from '@/types/novel'
import { candidateFieldValues, parseEditableCandidate } from '@/services/candidateEditing'
import { memoryCandidateFields } from '@/services/characterMemoryCandidateEditing'
import { eventCausalityLabels } from '@/services/eventCausalityValidation'

export function candidatePreview(candidate: CandidateChange, characters: Character[], events: EventLogEntry[] = []) {
  try {
    const data = parseEditableCandidate(candidate)
    if (candidate.type === 'event_causality') {
      const eventTitle = (id: unknown, missingLabel: string) => events.find(event => event.id === id)?.title || missingLabel
      const fromTitle = eventTitle(data.fromEventId, '起因事件未找到')
      const toTitle = eventTitle(data.toEventId, '结果事件未找到')
      const relation = typeof data.relation === 'string' && Object.prototype.hasOwnProperty.call(eventCausalityLabels, data.relation)
        ? eventCausalityLabels[data.relation as keyof typeof eventCausalityLabels]
        : '因果关系待核'
      const explanation = typeof data.explanation === 'string' ? data.explanation.trim() : ''
      return { title: '事件因果候选', detail: `${fromTitle} —${relation}→ ${toTitle}${explanation ? ` · ${explanation}` : ''}` }
    }
    const fields = memoryCandidateFields(candidate, data, characters)
    const values = candidateFieldValues(fields, data)
    const characterName = (name: unknown, id: unknown) => typeof name === 'string' && name.trim()
      ? name.trim() : characters.find(character => character.id === id)?.name || '未关联角色'
    const identity = candidate.type === 'knowledge' || candidate.type === 'relationship'
      ? `角色：${characterName(data.characterName, data.characterId)}` + (candidate.type === 'relationship'
        ? ` → ${characterName(data.targetCharacterName, data.targetCharacterId)}（仅此方向）` : '') : ''
    return { title: String(data.title || data.name || data.fact || data.relation || '故事变化候选'),
      detail: [identity, ...fields.filter(field => values[field.key]).map(field => field.label + '：'
        + (field.options?.find(option => option.value === values[field.key])?.label || values[field.key]))].filter(Boolean).join('\n') }
  } catch { return { title: '候选格式需要核对', detail: '候选内容无法解析，请在写作台核对。' } }
}
