import type { ChapterRevision, Novel } from '@/types/novel'
import type { ProjectWorkspaceSnapshot } from '@/services/projectBackup'
import type { InspirationSession } from '@/services/inspirationSessions'
import type { AiRun } from '@/types/reconstruction'

/** One verified workspace at a time; no manuscript or other book is returned. */
export interface ProjectHistoryRetentionState {
  supported: boolean
  policy: { keepLatest: number | null; keepSince: string | null }
  pinnedRevisions: string[]
  fingerprint: string
  limitations: string[]
}

export interface ProjectHistoryRetentionPreview {
  token: string
  baseRevision: string | null
  fingerprint: string
  policy: { keepLatest: number | null; keepSince: string | null }
  pinnedRevisions: string[]
  prunedRevisions: string[]
  archiveSources: Array<{ revision: string; projectId: string; snapshot: string }>
}

export interface ProjectHistoryRetentionResult {
  revision: string | null
  policy: { keepLatest: number | null; keepSince: string | null }
  pinnedRevisions: string[]
  prunedRevisions: string[]
}

export interface ProjectHistoryRunsPage {
  projectId: string
  baseRevision: string | null
  nextCursor: number | null
  source: { revision: string; snapshot: string; workspaceHash: string; runs: AiRun[] } | null
}

export interface ProjectHistoryCapacity {
  token: string
  baseRevision: string | null
  totalFiles: number
  totalBytes: number
  reclaimableFiles: number
  reclaimableBytes: number
  protectedVersions: number
  protectedReasons: string[]
  limitations: string[]
}

export interface ProjectHistoryCleanupResult {
  removedFiles: number
  removedBytes: number
  skippedFiles: number
}

export interface ProjectHistoryEntry {
  revision: string
  parentRevision: string | null
  createdAt: string
  projectCount: number
  projectIds?: string[]
  prunedAt?: string | null
  pinned?: boolean
  label?: string
  action?: { kind: string; novelId: string; sourceRevision: string | null; label: string }
}

export interface ProjectHistoryScope {
  novel: Novel | null
  chapterRevisions: ChapterRevision[]
  workspace: ProjectWorkspaceSnapshot | null
  inspirationSessions: InspirationSession[]
  knowledgeBaseIds: string[]
}

export type ProjectHistoryChangeKind = 'added' | 'removed' | 'changed'

export interface ProjectHistoryTextChange {
  beforeLength: number
  afterLength: number
  sameLength: boolean
  diff: string
  addedLines: number
  removedLines: number
}

export interface ProjectHistoryChange {
  id: string
  label: string
  kind: ProjectHistoryChangeKind
  changedFields: string[]
  before?: unknown
  after?: unknown
  text?: ProjectHistoryTextChange
}

export interface ProjectHistoryDiffSection {
  key: string
  label: string
  summary: string
  changes: ProjectHistoryChange[]
}

export interface ProjectHistoryDiff {
  novelId: string
  summary: string
  sections: ProjectHistoryDiffSection[]
  scopeStatement: string
  sharedKnowledgeBaseIds: string[]
  unchangedKnowledgeBaseIds: string[]
  budgetNotes: string[]
}

export interface ProjectHistoryKernelPreview {
  currentRevision: string
  targetRevision: string
  novelId: string
  current: ProjectHistoryScope
  historical: ProjectHistoryScope
}

export interface ProjectHistoryPreview extends ProjectHistoryKernelPreview {
  token: string
  diff: ProjectHistoryDiff
}
