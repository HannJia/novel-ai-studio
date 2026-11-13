/** Direction is always fromEventId → toEventId; no reverse implication. */
export type EventCausalityRelation = 'causes' | 'enables' | 'blocks' | 'motivates'
export interface EventCausalityEvidence {
  chapterId: string
  chapterIndex: number
  sourceVersionId: string
  quote: string
  startOffset: number
  endOffset: number
}
export interface EventCausalityBinding {
  eventId: string
  chapterId: string
  chapterIndex: number
  sourceVersionId: string
  /** Exact projected endpoint identity, not a title match. */
  eventSnapshot: string
}
export interface EventCausalityRevision {
  edgeId: string
  fromEventId: string
  toEventId: string
  relation: EventCausalityRelation
  explanation: string
  action: 'confirm' | 'revoke'
  effectiveChapterId: string
  effectiveChapterIndex: number
  chapterOrder: string[]
  evidence: EventCausalityEvidence
  endpoints: [EventCausalityBinding, EventCausalityBinding]
  /** Written only by a trusted author-decision transaction, never parsed from model JSON. */
  authorDecision: 'confirmed'
}
export interface EventCausalityDraft {
  edgeId: string
  fromEventId: string
  toEventId: string
  relation: EventCausalityRelation
  explanation: string
  chapterId: string
  quote: string
  startOffset: number
  action: 'confirm' | 'revoke'
}
export interface EventCausalityEdit {
  draft: EventCausalityDraft
  openBaseline: string
  candidateId?: string
  expectedCandidate?: string
  authorNote?: string
}
