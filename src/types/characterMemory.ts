import type { KnowledgeEdge, CharacterRelationshipState, EvidenceRef } from './reconstruction'

export interface StoryProposition {
  version: 1
  id: string
  text: string
  subjectId?: string
  objectId?: string
  scope: string
  identityStatus: 'explicit' | 'unresolved' | 'legacy'
}
/** Separate UI/transaction argument. Never deserialize this authorization from proposedValue. */
export interface CharacterMemoryAuthorDecision {
  action: 'new' | 'link' | 'merge'
  confirmed: boolean
  targetId?: string
  targetSignature?: string
  mergeFromId?: string
  mergeFromSignature?: string
  reason?: string
  resolvedStateIds?: string[]
  resolutionSignature?: string
}
export interface PropositionDecision {
  version: 1
  id: string
  action: 'link' | 'merge'
  fromIds: string[]
  targetId: string
  targetSignature: string
  mergeFromSignature?: string
  confirmedBy: 'author'
  confirmedAt: string
  reason: string
  chapterId: string
  chapterIndex: number
  sourceVersionId: string
  evidence: EvidenceRef[]
  resolvedStateIds?: string[]
  resolutionSignature?: string
}
export type MemoryKnowledgeEdge = KnowledgeEdge & {
  proposition?: StoryProposition
  propositionDecision?: PropositionDecision
  stateIdentityId?: string
  projectedFactId?: string
  conflictGroupId?: string
}
export type MemoryRelationshipState = CharacterRelationshipState & { dimension?: string }
export interface CharacterMemoryConfirmation {
  authorDecision?: CharacterMemoryAuthorDecision
  confirmedAt?: string
  mode?: 'proposal' | 'confirm'
}
export interface PropositionCatalogEntry {
  proposition: StoryProposition
  canonicalId: string
  evidence: EvidenceRef[]
  signature: string
}
