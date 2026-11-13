import type { CanonMutationRecord } from '@/types/reconstruction'
import type { Novel } from '@/types/novel'
import type { MemoryKnowledgeEdge } from '@/types/characterMemory'
import { assertRelationshipDimension, characterMemoryEvidenceSignature, relationshipIdentity } from './characterMemoryIdentity'
import type { EvidenceRef } from '@/types/reconstruction'

const fail = (path: string): never => { throw new Error('人物记忆数据无效：' + path) }
const object = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path)
  return value as Record<string, unknown>
}
const text = (value: unknown, path: string, required = true) => {
  if (typeof value !== 'string' || value.length > 5_000_000 || (required && (!value.trim() || ['__proto__','prototype','constructor'].includes(value)))) fail(path)
}
function signature(value: unknown, path: string): unknown[] {
  text(value, path)
  let parsed: unknown
  try { parsed = JSON.parse(String(value)) } catch { fail(path) }
  if (!Array.isArray(parsed) || parsed.length !== 8 || !Array.isArray(parsed[7])) fail(path)
  return parsed as unknown[]
}
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.keys(value).filter(key => (value as Record<string,unknown>)[key] !== undefined).sort().map(key => JSON.stringify(key) + ':' + stable((value as Record<string,unknown>)[key])).join(',') + '}'
  return JSON.stringify(value) ?? 'null'
}
export function assertStoredCharacterMemory(value: unknown, path = 'characterState') {
  const change = object(value, path)
  for (const field of ['before','after']) {
    if (field === 'before' && change[field] === undefined) continue
    const state = object(change[field], path + '.' + field)
    if (change.kind === 'relationship') {
      assertRelationshipDimension(state.dimension)
      continue
    }
    if (change.kind !== 'knowledge') fail(path + '.kind')
    {
      const p = object(state.proposition, path + '.proposition')
      if (p.version !== 1 || p.id !== state.factId || p.text !== state.fact || !['explicit','unresolved'].includes(String(p.identityStatus))) fail(path + '.proposition.identity')
      text(p.id, path + '.proposition.id'); text(p.text, path + '.proposition.text'); text(p.scope, path + '.proposition.scope')
      for (const key of ['subjectId','objectId']) if (p[key] !== undefined) text(p[key], path + '.proposition.' + key)
      if (p.identityStatus === 'explicit' && !p.subjectId) fail(path + '.proposition.subjectId')
    }
    if (state.stateIdentityId !== undefined) text(state.stateIdentityId, path + '.stateIdentityId')
    if (state.projectedFactId !== undefined || state.conflictGroupId !== undefined) fail(path + '（投影字段不得持久化）')
    if (state.propositionDecision !== undefined) {
      const d = object(state.propositionDecision, path + '.propositionDecision')
      if (d.version !== 1 || !['link','merge'].includes(String(d.action)) || d.confirmedBy !== 'author') fail(path + '.propositionDecision.author')
      for (const key of ['id','targetId','targetSignature','chapterId','sourceVersionId','confirmedAt']) text(d[key], path + '.decision.' + key)
      if (signature(d.targetSignature, path + '.decision.targetSignature')[1] !== d.targetId) fail(path + '.decision.targetSignature.id')
      if (!Number.isFinite(Date.parse(String(d.confirmedAt))) || !Number.isSafeInteger(d.chapterIndex) || Number(d.chapterIndex) < 0) fail(path + '.decision.boundary')
      if (!Array.isArray(d.fromIds) || d.fromIds.length !== (d.action === 'merge' ? 2 : 1) || new Set(d.fromIds).size !== d.fromIds.length || !d.fromIds.includes(state.factId) || d.fromIds.includes(d.targetId)) fail(path + '.decision.fromIds')
      const fromIds = d.fromIds as unknown[]
      fromIds.forEach(id => text(id, path + '.decision.fromIds'))
      text(d.reason, path + '.decision.reason', d.action === 'merge')
      if (d.action === 'merge') {
        const from = signature(d.mergeFromSignature, path + '.decision.mergeFromSignature')[1]
        if (!fromIds.includes(from) || from === state.factId) fail(path + '.decision.mergeFromSignature.id')
      }
      if (!Array.isArray(d.evidence) || !d.evidence.length || !Array.isArray(state.evidence)
        || characterMemoryEvidenceSignature(d.evidence as EvidenceRef[]) !== characterMemoryEvidenceSignature(state.evidence as EvidenceRef[])) fail(path + '.decision.evidence')
      const firstEvidence = (d.evidence as Array<{ sourceId?: string; sourceVersionId?: string }>)[0]
      if (d.chapterIndex !== state.knownSinceChapter || firstEvidence.sourceId !== d.chapterId || firstEvidence.sourceVersionId !== d.sourceVersionId) fail(path + '.decision.source')
      if (d.resolvedStateIds !== undefined) {
        if (!Array.isArray(d.resolvedStateIds) || !d.resolvedStateIds.length || d.resolvedStateIds.length > 100_000 || new Set(d.resolvedStateIds).size !== d.resolvedStateIds.length) fail(path + '.decision.resolvedStateIds')
        ;(d.resolvedStateIds as unknown[]).forEach(id => text(id, path + '.decision.resolvedStateIds'))
        text(d.resolutionSignature, path + '.decision.resolutionSignature'); text(d.reason, path + '.decision.reason')
      } else if (d.resolutionSignature !== undefined) fail(path + '.decision.resolutionSignature')
    }
    if (state.stateIdentityId && state.stateIdentityId !== state.factId) {
      const d = object(state.propositionDecision, path + '.decision')
      let signature: unknown
      try { signature = JSON.parse(String(d.targetSignature)) } catch { fail(path + '.decision.targetSignature') }
      if (d.action !== 'link' || !Array.isArray(signature) || signature[0] !== state.stateIdentityId) fail(path + '.stateIdentityId')
    }
  }
  if (change.kind === 'relationship' && change.before) {
    const before = object(change.before,path), after = object(change.after,path)
    if (relationshipIdentity(String(before.characterId),String(before.targetCharacterId),before.dimension as string | undefined) !== relationshipIdentity(String(after.characterId),String(after.targetCharacterId),after.dimension as string | undefined)) fail(path + '.before.dimension')
  }
  if (change.kind === 'knowledge' && change.before) {
    const before = object(change.before,path), after = object(change.after,path)
    if (before.characterId !== after.characterId
      || ![before.factId, before.stateIdentityId].includes(after.stateIdentityId || after.factId)) fail(path + '.before.identity')
  }
}

export function assertCharacterMemoryReferences(novels: Novel[], novelId: string, records: CanonMutationRecord[], path = 'canonMutations') {
  const own = records.filter(record => record.novelId === novelId)
  const ids = new Set(own.flatMap(record => record.characterState?.kind === 'knowledge' ? [record.characterState.after.factId] : []))
  const states = new Map(own.flatMap(record => record.characterState?.kind === 'knowledge' ? [[record.characterState.after.id, record] as const] : []))
  const identities = new Map<string,string>()
  for (const record of records) {
    if (!record.characterState) continue
    if (record.novelId !== novelId) fail(path + '.novelId')
    assertStoredCharacterMemory(record.characterState, path + '.' + record.id)
    if (record.characterState.kind !== 'knowledge') continue
    const state = record.characterState.after as MemoryKnowledgeEdge
    const d = state.propositionDecision
    const p = state.proposition
    if (p) {
      const identity = stable(p), prior = identities.get(p.id)
      if (prior !== undefined && prior !== identity) fail(path + '.proposition.id（同编号身份不一致）')
      identities.set(p.id, identity)
    }
    if (d && (d.chapterId !== record.chapterId || d.confirmedAt !== record.appliedAt || [...d.fromIds, d.targetId].some(id => !ids.has(id)))) fail(path + '.decision.references')
    const before = record.characterState.before as MemoryKnowledgeEdge | undefined
    if (before) {
      const original = states.get(before.id)
      if (!original || original.id === record.id || original.characterState?.kind !== 'knowledge'
        || stable(original.characterState.after) !== stable(before) || before.knownSinceChapter > state.knownSinceChapter) fail(path + '.before.history')
    }
    if (d?.resolvedStateIds?.some(id => {
      const prior = states.get(id), old = prior?.characterState
      return !prior || prior.id === record.id || old?.kind !== 'knowledge' || old.after.characterId !== state.characterId
        || old.after.knownSinceChapter > state.knownSinceChapter
    })) fail(path + '.decision.resolvedStateIds.history')
    for (const id of [state.proposition?.subjectId,state.proposition?.objectId].filter(Boolean)) {
      if (novels.some(novel => novel.id !== novelId && novel.characters.some(character => character.id === id))) fail(path + '.proposition（属于其他作品）')
    }
  }
}
export function assertStoredRelationshipDimensions(value: unknown) {
  if (!Array.isArray(value)) fail('relationships')
  const seen = new Set<string>()
  for (const raw of value as unknown[]) {
    const row = object(raw,'relationships')
    const dimension = assertRelationshipDimension(row.dimension)
    const key = JSON.stringify([row.targetId, dimension])
    if (seen.has(key)) fail('relationships（同方向同维度重复）')
    seen.add(key)
  }
}
