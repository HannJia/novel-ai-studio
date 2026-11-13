export type EntityKind = 'character' | 'event' | 'arc' | 'arc_node'

export const ARC_CANON_FIELDS = [
  'title', 'description', 'type', 'importance', 'status', 'reactivateAt', 'characterIds',
  'goal', 'conflict', 'expectedResolution', 'dependencyArcIds',
  'initialState', 'desire', 'fear', 'falseBelief', 'finalState', 'turningPointEventIds',
] as const

export const ARC_NODE_CANON_FIELDS = [
  'title', 'description', 'targetChapter', 'actualChapter', 'status',
  'prerequisiteNodeIds', 'consequenceEventIds',
] as const

export const CHARACTER_CANON_FIELDS = [
  'name', 'aliases', 'identity', 'personality', 'powerLevel', 'faction', 'status',
  'firstAppearChapter', 'description', 'relationships', 'events',
] as const

export const EVENT_CANON_FIELDS = [
  'title', 'description', 'characters', 'type', 'scope', 'status', 'hintCount',
  'storyTime', 'location', 'chapterIndex', 'targetChapter', 'importance',
  'relatedArcIds', 'lastProgressChapterIndex', 'resolvedChapterIndex', 'evidence',
] as const

export type EntityRelationshipValue = {
  dimension?: string
  targetId: string
  targetName: string
  relation: string
}

export type EntityValue =
  | string
  | number
  | boolean
  | string[]
  | EntityRelationshipValue[]

export type EntitySourceEvidence = {
  quote: string
  startOffset?: number
  endOffset?: number
}

export type EntitySource =
  | { kind: 'author' }
  | {
    kind: 'chapter'
    chapterId: string
    chapterIndex: number
    sourceVersionId: string
    evidence: EntitySourceEvidence[]
  }

export interface EntityFieldChange {
  field: string
  before?: EntityValue
  after?: EntityValue
}

export interface EntityRevision {
  id: string
  entityType: EntityKind
  entityId: string
  source: EntitySource
  appliedAt: string
  changes: EntityFieldChange[]
  /**
   * A legacy entity can receive its first tracked update after it already
   * existed in the author's data.  These values are the truthful pre-update
   * baseline and are intentionally separate from chapter evidence.
   */
  baseline?: EntityFieldChange[]
}

export interface EntityProvenance {
  revisions: EntityRevision[]
}
