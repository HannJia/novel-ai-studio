/** Immutable explanation of references affected by an author definition edit. */
export type StoryImpactKind = 'novel' | 'volume' | 'character' | 'event' | 'arc' | 'node' | 'plan' | 'scene' | 'chapter' | 'memory'
export interface StoryImpactRef { kind: StoryImpactKind; id: string; label: string; parentId?: string }
export interface StoryImpactChange {
  target: StoryImpactRef
  action: 'create' | 'update' | 'delete' | 'confirm'
  fields: string[]
}
export interface StoryImpactReason {
  from: StoryImpactRef
  relation: string
  phase: 'before' | 'after'
  /** Omitted by historical version-1 reports, whose edges were all traversable. */
  kind?: 'dependency' | 'association'
}
export interface StoryImpactItem { target: StoryImpactRef; depth: number; reasons: StoryImpactReason[] }
export interface StoryImpactReport {
  id: string
  novelId: string
  createdAt: string
  version: 1
  beforeVersion: string
  afterVersion: string
  changes: StoryImpactChange[]
  affected: StoryImpactItem[]
  /** Literal matches are clues only and never propagate through the dependency graph. */
  mentions: Array<{ chapter: StoryImpactRef; terms: string[] }>
  reviewPolicy: 'all-written' | 'changed-inputs'
  reviewChapterIds: string[]
}
