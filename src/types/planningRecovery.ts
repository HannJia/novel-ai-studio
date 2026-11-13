import type { StructuredChapterPlan, ScenePlan } from './reconstruction'

/** These records are editor recovery data, never approved planning or Canon. */
export interface SceneEditorDraft {
  id: string
  chapterPlanId: string
  baseline: string
  sequence: number
  chapter: StructuredChapterPlan
  scenes: ScenePlan[]
  instructions: string
  title: string
  optionId?: string
  revisionId?: string
  incomplete: boolean
  incompleteSignature?: string
  updatedAt: string
}

export interface ScenePlanOption {
  id: string
  chapterPlanId: string
  revisionId: string
  createdAt: string
}

export interface SceneOptionRevision {
  id: string
  optionId: string
  chapterPlanId: string
  parentRevisionId?: string
  attemptId?: string
  kind: 'author' | 'model' | 'restored'
  title: string
  baseline: string
  chapter: StructuredChapterPlan
  instructions: string
  scenes: ScenePlan[]
  complete: boolean
  createdAt: string
}

export interface SceneGenerationAttempt {
  id: string
  chapterPlanId: string
  parentAttemptId?: string
  mode: 'generate' | 'retry' | 'continue'
  status: 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled' | 'interrupted' | 'conflict'
  sequence: number
  baseline: string
  modelId: string
  modelSettings: { modelName: string; maxTokens: number; temperature: number; topP: number }
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  input: SceneEditorDraft
  output: string
  finishReason?: string
  error?: string
  createdAt: string
  updatedAt: string
}

export interface SceneOptionSelection {
  chapterPlanId: string
  optionId: string
  revisionId: string
  updatedAt: string
}

export interface ScenePlanningRecovery {
  editors: SceneEditorDraft[]
  options: ScenePlanOption[]
  revisions: SceneOptionRevision[]
  attempts: SceneGenerationAttempt[]
  selections: SceneOptionSelection[]
}

export type SceneRecoveryEdit =
  | { kind: 'scene-editor'; value: SceneEditorDraft }
  | { kind: 'scene-discard-editor'; id: string; expected: string }
  | { kind: 'scene-revision'; option: ScenePlanOption; revision: SceneOptionRevision; expectedRevisionId?: string }
  | { kind: 'scene-attempt'; value: SceneGenerationAttempt }
  | { kind: 'scene-selection'; value: SceneOptionSelection }
