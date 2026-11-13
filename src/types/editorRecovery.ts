/** Non-formal author input. Never a Canon record, approval, or model configuration. */
export type EditorDraftKind = 'character-form' | 'character-scan' | 'relationship-scan'
  | 'event-form' | 'event-causality' | 'story-planner' | 'chapter-form' | 'scene-form' | 'outline-form'
  | 'event-form' | 'event-causality' | 'story-planner' | 'chapter-form' | 'scene-form' | 'outline-form'
export type EditorJson = null | boolean | number | string | EditorJson[] | { [key: string]: EditorJson }
export type EditorDraftPayload = { [key: string]: EditorJson }

export interface EditorDraftIdentity {
  id: string
  novelId: string
  kind: EditorDraftKind
  scope: string
  targetId?: string
  /** Original open/request baseline; recovery must not refresh it. */
  openedBaseline: string
}
export interface EditorDraft extends EditorDraftIdentity {
  status: 'active' | 'discarded'
  payload: EditorDraftPayload | null
  revision: number
  lastOperationId: string
  createdAt: string
  updatedAt: string
}
export interface EditorDraftVersion {
  revision: number
  /** Prevents ABA after project/history replacement with an older revision. */
  operationId: string | null
}
export type EditorDraftCommand = {
  novelId: string
  id: string
  expected: EditorDraftVersion
  operationId: string
} & ({ action: 'save'; draft: EditorDraftIdentity & { payload: EditorDraftPayload } } | { action: 'discard' })

export interface CharacterEditorPayload extends EditorDraftPayload {
  name: string
  aliasesText: string
  identity: string
  personality: string
  powerLevel: string
  faction: string
  status: string
  description: string
  avatarId: string
  relationships: Array<{ targetId: string; targetName: string; relation: string; dimension: string; dimensionName: string }>
}
