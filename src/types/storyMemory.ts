import type { KnowledgeSummaryCoverage } from '@/types/knowledge'

export type StoryMemoryScope =
  | { kind: 'scene'; chapterId: string; startOffset: number; endOffset: number }
  | { kind: 'volume'; volumeId: string; throughChapterId: string }
  | { kind: 'book'; throughChapterId: string }

export interface StoryMemoryBinding {
  version: 1
  sourceVersionId: string
  value: string
  origin: 'author' | 'ai'
  confirmedAt: string
  coverage?: KnowledgeSummaryCoverage
}

export interface StoryMemoryRevision {
  id: string
  title: string
  summary: string
  scope: StoryMemoryScope
  source: StoryMemoryBinding
  replacedAt: string
}

export interface StoryMemoryRecord {
  id: string
  novelId: string
  title: string
  scope: StoryMemoryScope
  summary: string
  source: StoryMemoryBinding
  history: StoryMemoryRevision[]
}

export type StoryMemorySummaryNodeKind = 'leaf' | 'merge'
export type StoryMemorySummaryNodeStatus = 'pending' | 'running' | 'completed' | 'failed' | 'unknown' | 'reused'
export type StoryMemoryTaskStage = 'draft' | 'planned' | 'running' | 'interrupted' | 'paused' | 'awaiting_author' | 'failed' | 'cancelled' | 'committed'

export interface StoryMemorySourceRange {
  entryId: string
  sourceVersionId: string
  start: number
  end: number
  contentLength: number
}

export interface StoryMemorySourceFingerprint {
  entryId: string
  start: number
  end: number
  digest: string
}

export interface StoryMemorySummaryNode {
  id: string
  kind: StoryMemorySummaryNodeKind
  level: number
  dependencyIds: string[]
  sourceRanges: StoryMemorySourceRange[]
  sourceFingerprints: StoryMemorySourceFingerprint[]
  signature: string
  outputLimit: number
  status: StoryMemorySummaryNodeStatus
  output?: string
  requestId?: string
  requestSignature?: string
  reusedFrom?: { requestId: string; sourceRanges: StoryMemorySourceRange[] }
  error?: string
  inputTokens: number
  outputTokens: number
  usageSource?: 'reserved' | 'reported' | 'estimated'
}

/** Same requestId as AiRun.requests. Accounting fields are checked projections; source evidence is immutable. */
export interface StoryMemoryRequestLedgerEntry {
  id: string
  nodeId: string
  runId: string
  executionId: string
  nodeSignature: string
  requestSignature: string
  modelSignature: string
  promptSignature: string
  sourceRanges: StoryMemorySourceRange[]
  sourceFingerprints: StoryMemorySourceFingerprint[]
  partialOutput?: string
  status: 'pending' | 'completed' | 'failed' | 'unknown' | 'interrupted' | 'not_sent'
  reservedTokens: number
  inputTokens: number
  outputTokens: number
  usageSource: 'reservation' | 'reported' | 'estimated'
  startedAt: string
  completedAt?: string
  error?: string
}

export interface StoryMemoryTaskState {
  version: 1
  executionId?: string
  scope: StoryMemoryScope
  sourceVersionId: string
  openBaseline: string
  titleDraft: string
  bodyDraft: string
  level: 'brief' | 'standard' | 'detailed'
  modelSignature: string
  promptSignature: string
  stage: StoryMemoryTaskStage
  graph: StoryMemorySummaryNode[]
  finalNodeId: string
  candidate?: { title: string; summary: string; sourceVersionId: string; coverage: KnowledgeSummaryCoverage }
  requests: StoryMemoryRequestLedgerEntry[]
  reservedTokens: number
  /** Latest explicit continuation only; cumulative budget uses AiRun.usedTokens. */
  currentInputTokens: number
  currentOutputTokens: number
  /** Whole task lifetime, including the current continuation and uncertain reservations. */
  historicalInputTokens: number
  historicalOutputTokens: number
  usageEstimated: boolean
  updatedAt: string
}
