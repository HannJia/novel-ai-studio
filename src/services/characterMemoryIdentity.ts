import type { CharacterMemoryAuthorDecision, MemoryKnowledgeEdge, StoryProposition, PropositionCatalogEntry } from '@/types/characterMemory'
import type { CanonMutationRecord, EvidenceRef } from '@/types/reconstruction'

// Compare evidence values, independently of JSON property insertion order.
export function characterMemoryEvidenceSignature(evidence: EvidenceRef[]): string {
  return JSON.stringify(evidence.map(ref => [ref.id, ref.sourceType, ref.sourceId, ref.sourceVersionId, ref.label, ref.startOffset, ref.endOffset, ref.quote]))
}
export function knowledgeResolutionSignature(states: MemoryKnowledgeEdge[]): string {
  return JSON.stringify([...states].sort((a,b) => a.id.localeCompare(b.id)).map(state => [state.id, state.characterId, state.factId, state.fact, state.state, state.belief || '', state.knownSinceChapter, characterMemoryEvidenceSignature(state.evidence)]))
}
export function assertRepeatedCharacterMemoryDecision(record: CanonMutationRecord, requested?: CharacterMemoryAuthorDecision): void {
  if (!requested) return
  const stored = record.characterState?.kind === 'knowledge' ? (record.characterState.after as MemoryKnowledgeEdge).propositionDecision : undefined
  if (!requested.confirmed || requested.action !== (stored?.action || 'new')
    || (requested.action !== 'new' && (requested.targetId !== stored?.targetId || requested.targetSignature !== stored?.targetSignature
      || (requested.reason || '') !== stored?.reason || (requested.mergeFromId || '') !== (stored?.action === 'merge' ? stored.fromIds[1] : '')
      || (requested.mergeFromSignature || '') !== (stored?.mergeFromSignature || '')
      || JSON.stringify([...(requested.resolvedStateIds || [])].sort()) !== JSON.stringify([...(stored?.resolvedStateIds || [])].sort())
      || (requested.resolutionSignature || '') !== (stored?.resolutionSignature || '')))) throw new Error('该候选已经以另一命题身份或冲突处理决定入库，请重新核对。')
}

export const relationshipDimensionOptions = [
  { value: 'kinship', label: '亲属' }, { value: 'trust', label: '信任' },
  { value: 'intimacy', label: '亲密' }, { value: 'allegiance', label: '阵营' },
  { value: 'hierarchy', label: '上下级' }, { value: 'unclassified', label: '待分类' },
]
export function relationshipDimension(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : 'unclassified'
}
export function relationshipDimensionLabel(value: unknown): string {
  const dimension = relationshipDimension(value)
  return relationshipDimensionOptions.find(option => option.value === dimension)?.label || dimension.replace(/^custom:/, '自定义：')
}
export function assertRelationshipDimension(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 160
    || (!relationshipDimensionOptions.some(option => option.value === value) && !/^custom:[^\s].{0,120}$/u.test(value))) {
    throw new Error('请选择关系维度；选择自定义时请填写名称。')
  }
  return value.trim()
}
export function relationshipIdentity(source: string, target: string, dimension?: string): string {
  return JSON.stringify([source, target, relationshipDimension(dimension)])
}
export function propositionOf(edge: MemoryKnowledgeEdge): StoryProposition {
  if (!edge.proposition) throw new Error('人物记忆缺少 V3 命题身份，已停止投影。')
  return edge.proposition
}
export function propositionSignature(entry: Omit<PropositionCatalogEntry, 'signature'>): string {
  const p = entry.proposition
  return JSON.stringify([entry.canonicalId, p.id, p.text, p.subjectId || '', p.objectId || '', p.scope, p.identityStatus,
    entry.evidence.map(ref => [ref.sourceId, ref.sourceVersionId, ref.startOffset, ref.endOffset, ref.quote]).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))])
}
export function describeProposition(proposition: StoryProposition): string {
  return '命题ID：' + proposition.id + '；主体ID：' + (proposition.subjectId || '指代未确认')
    + '；对象ID：' + (proposition.objectId || '未指定') + '；范围：' + proposition.scope
    + (proposition.identityStatus === 'explicit' ? '' : '（身份/范围待作者核对，独立保留）')
}
