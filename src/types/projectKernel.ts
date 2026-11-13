import type { ProjectBackup } from '@/services/projectBackup'
import type { ProjectHistoryScope } from './projectHistory'
import type { SyncConflict, SyncState } from '@/services/cloudSyncModel'

export interface ProjectLibraryState {
  revision: string | null
  backup: ProjectBackup | null
  sync: { state: SyncState | null; conflicts: SyncConflict[] }
  /** Transient cache failures from this commit; never part of the manuscript. */
  indexWarnings?: Array<{ projectId: string; message: string }>
}

export interface ProjectIndexStats {
  mode: 'rebuilt' | 'incremental'
  inserted: number
  updated: number
  deleted: number
  unchanged: number
  metadataUpdated: number
}

export interface ProjectIndexStatus {
  projectId: string
  /** Verified published target, including when the disposable cache is stale. */
  snapshot: string
  revision: string
  /** Required cache versions; stale/corrupt files are not reported as these versions. */
  schemaVersion: number
  dataVersion: number
  state: 'ready' | 'missing' | 'stale' | 'corrupt'
  reason: string
  stats?: ProjectIndexStats
}

export interface ProjectSnapshotEntry {
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

export type ProjectKernelRequest =
  | { method: 'read' }
  | { method: 'readSnapshot'; revision: string }
  | { method: 'checkpoint'; baseRevision: string | null; novelId: string }
  | { method: 'restoreNovel'; baseRevision: string; revision: string; novelId: string; scope: ProjectHistoryScope }
  | { method: 'commit'; baseRevision: string | null; backup: ProjectBackup; sync?: ProjectLibraryState['sync'] }
  | { method: 'history' }
  | { method: 'historyRuns'; projectId: string; baseRevision: string | null; cursor: number }
  | { method: 'historyRetention' }
  | { method: 'previewHistoryRetention'; policy: { keepLatest: number | null; keepSince: string | null }; pinnedRevisions: string[] }
  | { method: 'confirmHistoryRetention'; token: string; baseRevision: string | null }
  | { method: 'historyCapacity' }
  | { method: 'cleanupHistory'; token: string; baseRevision: string | null }
  | { method: 'restore'; baseRevision: string | null; revision: string }
  | { method: 'location'; projectId: string }
  | { method: 'rebuildIndex'; projectId: string }
  | { method: 'indexStatus'; projectId: string }

export type ProjectKernelResponse<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } }
