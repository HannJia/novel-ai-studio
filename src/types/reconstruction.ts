import type { EventCausalityRevision } from './eventCausality'
import type { EntityRevision } from './entityProvenance'
import type { StoryMemoryRecord, StoryMemoryTaskState } from './storyMemory'
import type { StoredReviewCoverage } from '@/services/chapterReviewCoverage'
import type { StoryImpactReport } from './storyImpact'
import type { ScenePlanningRecovery } from './planningRecovery'
export type ReconstructionId = string
export type IsoDateTime = string

export type CreationEntry = 'idea' | 'import' | 'blank'
export type CreationMode = 'author' | 'collaborative' | 'autonomous'
export type CreationStage = 'contract' | 'skeleton' | 'volume-outline' | 'chapter-outline' | 'scene-outline' | 'ready'
export type ApprovalState = 'draft' | 'awaiting_approval' | 'approved' | 'rejected'

export type PlotlineType = 'main' | 'subplot' | 'character' | 'relationship' | 'mystery' | 'world'
export type PlotlineStatus = 'planned' | 'active' | 'paused' | 'completed' | 'abandoned'
export type ForeshadowingStatus = 'planted' | 'hinted' | 'advanced' | 'paid_off' | 'abandoned'
export type KnowledgeState = 'knows' | 'suspects' | 'does_not_know' | 'false_belief'
export type CandidateChangeStatus = 'proposed' | 'accepted' | 'edited' | 'rejected' | 'deferred' | 'merged' | 'stale'

export type ReviewSeverity = 'blocker' | 'warning' | 'suggestion'
export type ReviewFindingType =
  | 'continuity'
  | 'character'
  | 'timeline'
  | 'plot'
  | 'foreshadowing'
  | 'knowledge'
  | 'world_rule'
  | 'style'
  | 'pacing'
  | 'format'

export type ReviewFindingStatus = 'open' | 'accepted' | 'rejected' | 'intentional' | 'deferred' | 'stale'
export type ChapterWorkflowStatus =
  | 'idea'
  | 'outlined'
  | 'drafting'
  | 'reviewing'
  | 'needs_revision'
  | 'ready_to_finalize'
  | 'finalized'
  | 'canonized'

export type AiRunMode = 'assist' | 'collaborative' | 'autonomous'
export type AiRunStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'needs_author'

export interface EvidenceRef {
  id: ReconstructionId
  sourceType: 'chapter' | 'scene' | 'character' | 'event' | 'plotline' | 'rule' | 'outline'
  sourceId: ReconstructionId
  sourceVersionId?: ReconstructionId
  quote?: string
  startOffset?: number
  endOffset?: number
  label?: string
}

export interface StoryContract {
  id: ReconstructionId
  title: string
  genre: string
  subGenre?: string
  audience?: string
  format: 'serial' | 'complete' | 'undecided'
  targetWordCountMin?: number
  targetWordCountMax?: number
  pacingDirection?: string
  pointOfView?: string
  tense?: string
  styleDirection?: string
  coreTheme?: string
  readerPromise?: string
  protagonistPremise?: string
  protagonistGoal?: string
  protagonistFear?: string
  centralConflict?: string
  endingDirection?: string
  romanceDirection?: string
  worldRules: string[]
  forbiddenTopics: string[]
  authorPreferences: string[]
  cardConfirmations?: { cardId: string; signature: string; confirmedAt: IsoDateTime }[]
  approval: ApprovalState
  updatedAt: IsoDateTime
}

export interface ContractSuggestion {
  cardId: string
  baseline: string
  values: Partial<StoryContract>
}
export interface ContractExploration {
  input: string
  messages: {
    id: string
    role: 'user' | 'assistant'
    content: string
    status: 'completed' | 'running' | 'partial' | 'failed' | 'interrupted'
    reply?: string
    suggestions?: ContractSuggestion[]
  }[]
}

export interface StoryBeat {
  id: ReconstructionId
  title: string
  description: string
  kind: 'opening' | 'inciting' | 'turning_point' | 'midpoint' | 'low_point' | 'climax' | 'resolution' | 'custom'
  targetRange?: string
  relatedPlotlineIds: ReconstructionId[]
  relatedCharacterIds: ReconstructionId[]
}

export interface PlotSkeleton {
  id: ReconstructionId
  title: string
  premise: string
  logline: string
  promise: string
  ending: string
  beats: StoryBeat[]
  approval: ApprovalState
  sourceRunId?: ReconstructionId
  /** A partial model response remains incomplete until an explicit author save. */
  complete?: boolean
  revisionId?: ReconstructionId
  updatedAt: IsoDateTime
}

export type SkeletonField = 'title' | 'premise' | 'logline' | 'promise' | 'ending'
export interface SkeletonSourceSelection {
  revisionId: ReconstructionId
  field: SkeletonField | 'beat'
  beatId?: ReconstructionId
  targetBeatId?: ReconstructionId
}
export interface SkeletonRevision {
  id: ReconstructionId
  skeletonId: ReconstructionId
  kind: 'initial' | 'model' | 'author' | 'mixed' | 'restored' | 'confirmed' | 'import'
  snapshot: PlotSkeleton
  parentRevisionId?: ReconstructionId
  attemptId?: ReconstructionId
  sources: SkeletonSourceSelection[]
  createdAt: IsoDateTime
}
export interface SkeletonGenerationAttempt {
  id: ReconstructionId
  parentAttemptId?: ReconstructionId
  mode: 'generate' | 'retry' | 'continue'
  status: 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled' | 'interrupted' | 'conflict'
  baseline: string
  modelId: string
  modelSettings?: { modelName: string; maxTokens: number; temperature: number; topP: number }
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
  output: string
  finishReason?: string
  error?: string
  candidateIds: ReconstructionId[]
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}
export interface CreationEditorDraft {
  id: ReconstructionId
  baseline: string
  surface?: 'skeleton' | 'manual-outline' | 'outline' | 'contract'
  savedAt?: IsoDateTime
  contract?: StoryContract
  exploration?: ContractExploration
  skeleton?: PlotSkeleton
  manualOutline: string
  outlineText: string
  updatedAt: IsoDateTime
}

export interface Plotline {
  id: ReconstructionId
  title: string
  type: PlotlineType
  goal: string
  conflict: string
  expectedResolution?: string
  status: PlotlineStatus
  participantCharacterIds: ReconstructionId[]
  dependencyPlotlineIds: ReconstructionId[]
  nodeIds: ReconstructionId[]
  evidence: EvidenceRef[]
}

export interface PlotNode {
  id: ReconstructionId
  plotlineId: ReconstructionId
  title: string
  description: string
  targetChapterStart?: number
  targetChapterEnd?: number
  status: 'planned' | 'active' | 'completed' | 'cancelled'
  prerequisiteNodeIds: ReconstructionId[]
  consequenceEventIds: ReconstructionId[]
  evidence: EvidenceRef[]
}

export interface StoryEvent {
  id: ReconstructionId
  title: string
  description: string
  storyTime?: string
  narrativeChapter?: number
  locationId?: ReconstructionId
  participantCharacterIds: ReconstructionId[]
  prerequisiteEventIds: ReconstructionId[]
  consequenceEventIds: ReconstructionId[]
  changedFactIds: ReconstructionId[]
  status: 'planned' | 'occurred' | 'revised' | 'cancelled'
  evidence: EvidenceRef[]
}

export interface CharacterArc {
  id: ReconstructionId
  characterId: ReconstructionId
  initialState: string
  coreDesire?: string
  coreFear?: string
  falseBelief?: string
  turningPointEventIds: ReconstructionId[]
  relationshipChangeIds: ReconstructionId[]
  finalState?: string
  status: 'planned' | 'active' | 'completed' | 'abandoned'
}

export interface KnowledgeEdge {
  proposition?: import('./characterMemory').StoryProposition
  propositionDecision?: import('./characterMemory').PropositionDecision
  stateIdentityId?: string
  id: ReconstructionId
  characterId: ReconstructionId
  factId: ReconstructionId
  fact: string
  state: KnowledgeState
  belief?: string
  learnedFrom?: string
  knownSinceChapter: number
  sourceEventId?: ReconstructionId
  evidence: EvidenceRef[]
}

/** 单向关系；A 信任 B 不表示 B 同样信任 A。 */
export interface CharacterRelationshipState {
  dimension?: string
  id: ReconstructionId
  characterId: ReconstructionId
  targetCharacterId: ReconstructionId
  relation: string
  description: string
  sinceChapter: number
  evidence: EvidenceRef[]
}

export type CharacterStateChange =
  | { kind: 'knowledge'; before?: KnowledgeEdge; after: KnowledgeEdge }
  | { kind: 'relationship'; before?: CharacterRelationshipState; after: CharacterRelationshipState }

export interface Foreshadowing {
  id: ReconstructionId
  title: string
  surfaceMeaning?: string
  intendedMeaning?: string
  introducedChapter?: number
  expectedPayoffChapterStart?: number
  expectedPayoffChapterEnd?: number
  status: ForeshadowingStatus
  relatedEventIds: ReconstructionId[]
  evidence: EvidenceRef[]
}

export interface VolumeOutline {
  id: ReconstructionId
  sourceVersion?: string
  title: string
  objective: string
  conflict: string
  openingState: string
  midpointChange?: string
  endingState: string
  chapterPlanIds: ReconstructionId[]
  plotlineIds: ReconstructionId[]
  approval: ApprovalState
}

export interface StructuredChapterPlan {
  id: ReconstructionId
  sourceVersion?: string
  volumeId?: ReconstructionId
  number: number
  endNumber?: number
  title: string
  objective: string
  conflict: string
  openingState: string
  endingState: string
  requiredEvents: string[]
  prohibitedReveals: string[]
  characterChangeNotes: string[]
  foreshadowingIds: ReconstructionId[]
  scenePlanIds: ReconstructionId[]
  status: 'planned' | 'active' | 'awaiting_review' | 'completed' | 'archived'
  approval: ApprovalState
}

export interface ScenePlan {
  id: ReconstructionId
  chapterPlanId: ReconstructionId
  order: number
  title: string
  purpose: string
  viewpointCharacterId?: ReconstructionId
  locationId?: ReconstructionId
  conflict?: string
  requiredActions: string[]
  informationChanges: string[]
  outputState: string
  status: 'planned' | 'drafted' | 'completed'
  approval: ApprovalState
}

export interface CandidateChange {
  id: ReconstructionId
  novelId?: ReconstructionId
  chapterId?: ReconstructionId
  type: 'fact' | 'state' | 'relationship' | 'timeline' | 'plotline' | 'foreshadowing' | 'knowledge' | 'event_causality'
  targetId?: ReconstructionId
  sourceVersionId?: ReconstructionId
  proposedValue: string
  /** Original proposal retained when the author edits before confirmation. */
  originalProposedValue?: string
  evidence: EvidenceRef[]
  status: CandidateChangeStatus
  source?: 'ai' | 'author' | 'import'
  confidence?: 'confirmed' | 'probable' | 'uncertain'
  authorNote?: string
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}

/**
 * 记录一次已经写入故事 Canon 的候选变化。
 * CandidateChange 表示作者确认的提议，CanonMutationRecord 表示提议已经真正作用于故事状态。
 */
export interface CanonMutationRecord {
  id: ReconstructionId
  candidateId: ReconstructionId
  novelId: ReconstructionId
  chapterId?: ReconstructionId
  type: CandidateChange['type']
  targetId?: ReconstructionId
  summary: string
  appliedAt: IsoDateTime
  eventCausality?: EventCausalityRevision
  characterState?: CharacterStateChange
  entityChanges?: EntityRevision[]
}

export interface ReviewFinding {
  id: ReconstructionId
  type: ReviewFindingType
  severity: ReviewSeverity
  title: string
  explanation: string
  chapterId: ReconstructionId
  sourceVersionId?: ReconstructionId
  sceneId?: ReconstructionId
  startOffset?: number
  endOffset?: number
  quotedText?: string
  expectedState?: string
  suggestedFix?: string
  evidence: EvidenceRef[]
  blocksFinalization: boolean
  status: ReviewFindingStatus
  authorNote?: string
}

export interface ChapterReview {
  id: ReconstructionId
  chapterId: ReconstructionId
  sourceVersionId: ReconstructionId
  startedAt: IsoDateTime
  completedAt?: IsoDateTime
  deterministicChecksPassed: boolean
  semanticChecksPassed?: boolean
  findings: ReviewFinding[]
  candidateChanges: CandidateChange[]
  status: 'running' | 'needs_revision' | 'ready_to_finalize' | 'approved' | 'failed'
}

export interface ContextPack {
  id: ReconstructionId
  targetType: 'creation' | 'outline' | 'scene' | 'chapter' | 'review' | 'autonomous_run'
  targetId?: ReconstructionId
  hardRules: string[]
  currentPlan: string[]
  relevantEntityIds: ReconstructionId[]
  relevantEventIds: ReconstructionId[]
  relevantPlotlineIds: ReconstructionId[]
  relevantForeshadowingIds: ReconstructionId[]
  evidence: EvidenceRef[]
  recentText?: string
  authorInstruction?: string
  tokenBudget?: number
  characterState?: string
}

export interface AiRunRequest {
  id: ReconstructionId
  chapterIndex: number
  phase: 'writing' | 'review' | 'analysis'
  modelId: string
  status: 'pending' | 'completed' | 'failed' | 'interrupted' | 'unknown' | 'not_sent'
  reservedTokens: number
  inputTokens: number
  outputTokens: number
  usageSource: 'reservation' | 'reported' | 'estimated'
  startedAt: IsoDateTime
  completedAt?: IsoDateTime
}

export interface AiChapterDraft {
  id: ReconstructionId
  chapterId: ReconstructionId
  chapterIndex: number
  baseContent: string
  content: string
  contextVersion: string
  status: 'pending' | 'accepted' | 'rejected'
  stage: 'generated' | 'reviewed' | 'analyzed'
  generationFinishReason?: string
  report?: string
  reviewCoverage?: StoredReviewCoverage
  review?: ChapterReview
  analysisError?: string
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  acceptedAt?: IsoDateTime
  history: Array<{ content: string; updatedAt: IsoDateTime }>
}

export interface AiRun {
  id: ReconstructionId
  mode: AiRunMode
  taskType: 'brainstorm' | 'contract' | 'skeleton' | 'outline' | 'draft' | 'review' | 'memory_update' | 'export'
  targetId?: ReconstructionId
  chapterStart?: number
  chapterEnd?: number
  tokenBudget?: number
  /** Pause at an author checkpoint after every N completed chapters. */
  checkpointEvery?: number
  usedTokens?: number
  requestLimit?: number
  requests?: AiRunRequest[]
  chapterDrafts?: AiChapterDraft[]
  memoryTask?: StoryMemoryTaskState
  status: AiRunStatus
  checkpoint?: string
  error?: string
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}

export interface CreationDraft {
  id: ReconstructionId
  entry: CreationEntry
  /** Immutable author input captured by the first creation commit; source only, never an approval. */
  initialInput?: import('./creationEntry').CreationEntryInput
  mode: CreationMode
  stage: CreationStage
  contract: StoryContract
  skeletons: PlotSkeleton[]
  selectedSkeletonId?: ReconstructionId
  /** Editor selection never replaces the confirmed selectedSkeletonId. */
  editingSkeletonId?: ReconstructionId
  skeletonHistory?: SkeletonRevision[]
  skeletonAttempts?: SkeletonGenerationAttempt[]
  editorDrafts?: CreationEditorDraft[]
  /** Scene drafts, alternatives and request checkpoints; never formal planning. */
  sceneRecovery?: ScenePlanningRecovery
  outlineCandidate?: {
    content: string
    source: 'author' | 'model'
    complete?: boolean
    skeletonId?: ReconstructionId
    contextBaseline: string
    directionSignature: string
    updatedAt: IsoDateTime
  }
  acceptedOutline?: { contentSignature: string; directionSignature: string; confirmedAt: IsoDateTime }
  volumes: VolumeOutline[]
  chapterPlans: StructuredChapterPlan[]
  scenePlans: ScenePlan[]
  approval: Partial<Record<CreationStage, ApprovalState>>
  updatedAt: IsoDateTime
}

export interface CreationStageResult {
  draft: CreationDraft
  issues: string[]
}

/** Persisted author workspace, independent of the storage implementation. */
export interface ReconstructionWorkspaceSnapshot {
  /** Unsubmitted author forms, independent of creation stage and formal story state. */
  editorDrafts?: import('./editorRecovery').EditorDraft[]
  storyMemories?: StoryMemoryRecord[]
  impactReports?: StoryImpactReport[]
  creationDraft?: CreationDraft
  candidates: CandidateChange[]
  reviewFindings: ReviewFinding[]
  chapterReviews?: ChapterReview[]
  aiRuns?: AiRun[]
  canonMutations: CanonMutationRecord[]
}

export function validateCreationStage(draft: CreationDraft): string[] {
  switch (draft.stage) {
    case 'contract': {
      const issues: string[] = []
      if (!draft.contract.title.trim()) issues.push('请填写作品名称')
      if (!draft.contract.genre.trim()) issues.push('请选择作品类型')
      if (!draft.contract.centralConflict?.trim()) issues.push('请填写主线冲突')
      if (!draft.contract.endingDirection?.trim()) issues.push('请填写结局方向，或明确标记为暂不确定')
      const { targetWordCountMin: min, targetWordCountMax: max } = draft.contract
      if (min !== undefined && (!Number.isFinite(min) || min <= 0)) issues.push('目标最少字数必须大于 0')
      if (max !== undefined && (!Number.isFinite(max) || max <= 0)) issues.push('目标最多字数必须大于 0')
      if (min !== undefined && max !== undefined && min > max) issues.push('目标最多字数不能少于最少字数')
      return issues
    }
    case 'skeleton':
      return draft.selectedSkeletonId ? [] : ['请选择或确认一个故事骨架']
    case 'volume-outline':
      return draft.volumes.length ? [] : ['请至少生成或添加一个篇章/卷']
    case 'chapter-outline':
      return draft.chapterPlans.length ? [] : ['请至少生成或添加一个章节计划']
    case 'scene-outline':
      return draft.scenePlans.length ? [] : ['请至少生成或添加一个场景计划']
    case 'ready':
      return []
  }
}

const creationStageOrder: CreationStage[] = [
  'contract',
  'skeleton',
  'volume-outline',
  'chapter-outline',
  'scene-outline',
  'ready',
]

export function approveCreationStage(draft: CreationDraft, now: IsoDateTime): CreationStageResult {
  const issues = validateCreationStage(draft)
  if (issues.length) return { draft, issues }

  const currentIndex = creationStageOrder.indexOf(draft.stage)
  const nextStage = creationStageOrder[Math.min(currentIndex + 1, creationStageOrder.length - 1)]
  return {
    draft: {
      ...draft,
      stage: nextStage,
      approval: { ...draft.approval, [draft.stage]: 'approved' },
      contract: draft.stage === 'contract' ? { ...draft.contract, approval: 'approved', updatedAt: now } : draft.contract,
      updatedAt: now,
    },
    issues: [],
  }
}

export function createEmptyCreationDraft(input: {
  id: ReconstructionId
  now: IsoDateTime
  entry?: CreationEntry
  mode?: CreationMode
}): CreationDraft {
  return {
    id: input.id,
    entry: input.entry ?? 'idea',
    mode: input.mode ?? 'author',
    stage: 'contract',
    contract: {
      id: input.id + ':contract',
      title: '',
      genre: '',
      format: 'undecided',
      worldRules: [],
      forbiddenTopics: [],
      authorPreferences: [],
      cardConfirmations: [],
      approval: 'draft',
      updatedAt: input.now,
    },
    skeletons: [],
    volumes: [],
    chapterPlans: [],
    scenePlans: [],
    approval: {},
    updatedAt: input.now,
  }
}
