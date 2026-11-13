import { ref } from 'vue'
import type { ProjectKernelRequest, ProjectKernelResponse, ProjectLibraryState, ProjectSnapshotEntry, ProjectIndexStatus } from '@/types/projectKernel'
import { createProjectBackup, parseProjectBackup, type ProjectBackup } from './projectBackup'
import type { ProjectHistoryRunsPage, ProjectHistoryCapacity, ProjectHistoryCleanupResult, ProjectHistoryRetentionState, ProjectHistoryRetentionPreview, ProjectHistoryRetentionResult } from '@/types/projectHistory'

let library: ProjectLibraryState | null = null
let initialized = false
let initializing: Promise<void> | null = null
let pending: Promise<unknown> = Promise.resolve()
export const projectIndexWarnings = ref<Array<{ projectId: string; message: string }>>([])
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

export function usesProjectKernel(): boolean { return initialized }
export function hasProjectKernelBridge(): boolean { return typeof window !== 'undefined' && typeof window.electronAPI?.projectRequest === 'function' }

export class ProjectKernelError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'ProjectKernelError' }
}

async function invoke<T>(request: ProjectKernelRequest): Promise<T> {
  const bridge = window.electronAPI?.projectRequest
  if (!bridge) throw new ProjectKernelError('PROJECT_UNAVAILABLE', '主进程项目存储不可用，已停止保存。')
  const result = await bridge(request) as ProjectKernelResponse<T>
  if (!result?.ok) throw new ProjectKernelError(result?.error?.code || 'PROJECT_UNAVAILABLE', result?.error?.message || '项目存储返回无效响应。')
  return result.value
}

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const task = pending.catch(() => undefined).then(operation)
  pending = task
  return task
}

function assertReady(): void {
  if (!initialized || !library?.backup) throw new ProjectKernelError('PROJECT_UNAVAILABLE', '项目存储尚未加载完成。')
}

function checkedLibrary(value: ProjectLibraryState, allowEmpty = false): ProjectLibraryState {
  if (!value || !value.sync || !Array.isArray(value.sync.conflicts)
    || (value.sync.state !== null && (typeof value.sync.state !== 'object' || Array.isArray(value.sync.state)))
    || (value.backup === null
      ? !allowEmpty || value.revision !== null
      : typeof value.revision !== 'string' || !value.revision)) {
    throw new ProjectKernelError('PROJECT_CORRUPT', '项目存储返回的数据不完整，已停止应用。')
  }
  if (value.backup !== null) parseProjectBackup(JSON.stringify(value.backup))
  if (value.indexWarnings) {
    const warned = new Set(value.indexWarnings.map(row => row.projectId))
    projectIndexWarnings.value = [...projectIndexWarnings.value.filter(row => !warned.has(row.projectId)), ...value.indexWarnings]
  }
  // Cache diagnostics must not become part of the authoritative library state
  // or its next CAS draft. Keep a warning until an explicit inspection/repair.
  return clone({ revision: value.revision, backup: value.backup, sync: value.sync })
}

/** One-time transfer from the current local V2 state; the old file is retained. */
export async function initializeProjectKernel(): Promise<void> {
  if (initialized || !hasProjectKernelBridge()) return
  if (!initializing) initializing = (async () => {
    let current = checkedLibrary(await invoke<ProjectLibraryState>({ method: 'read' }), true)
    if (!current.backup) {
      // Adapters use the existing database only until this transfer commits. This
      // path cannot run again once a main-process library has been published.
      const [{ loadAllNovelsFromDb }, { loadAllKnowledgeBasesFromDb }, { loadProjectChapterRevisions },
        { loadInspirationSessions }, { loadReconstructionWorkspace }, { readCloudState, readCloudConflicts }] = await Promise.all([
        import('./db/novels'), import('./db/knowledge'), import('./db/chapterRevisions'), import('./db/inspirationSessions'),
        import('./db/reconstruction'), import('./db/cloudSync'),
      ])
      const [novels, knowledgeBases, chapterRevisions, inspirationSessions, state, conflicts] = await Promise.all([
        loadAllNovelsFromDb(), loadAllKnowledgeBasesFromDb(), loadProjectChapterRevisions(), loadInspirationSessions(), readCloudState(), readCloudConflicts(),
      ])
      const reconstructionWorkspaces = await Promise.all(novels.map(async novel => {
        const workspace = await loadReconstructionWorkspace(novel.id)
        return { ...workspace, novelId: novel.id, chapterReviews: workspace.chapterReviews || [], aiRuns: workspace.aiRuns || [] }
      }))
      const backup = parseProjectBackup(JSON.stringify(createProjectBackup({ novels, knowledgeBases, chapterRevisions, inspirationSessions, reconstructionWorkspaces })))
      current = await invoke<ProjectLibraryState>({ method: 'commit', baseRevision: current.revision, backup, sync: { state, conflicts } })
    }
    library = checkedLibrary(current)
    initialized = true
  })().finally(() => { initializing = null })
  await initializing
}

export async function readProjectLibrary(refresh = false): Promise<ProjectLibraryState> {
  return serialize(async () => {
    assertReady()
    if (refresh) {
      const current = await invoke<ProjectLibraryState>({ method: 'read' })
      library = checkedLibrary(current)
    }
    return clone(library!)
  })
}

export async function readKernelBackup(): Promise<ProjectBackup> {
  return (await readProjectLibrary()).backup!
}

/** Serialized compare-and-swap; a rejected write never changes this cache. */
export async function mutateProjectLibrary(change: (draft: ProjectLibraryState & { backup: ProjectBackup }) => void): Promise<void> {
  return serialize(async () => {
    assertReady()
    const draft = clone(library!) as ProjectLibraryState & { backup: ProjectBackup }
    change(draft)
    draft.backup.exportedAt = new Date().toISOString()
    parseProjectBackup(JSON.stringify(draft.backup))
    const committed = await invoke<ProjectLibraryState>({ method: 'commit', baseRevision: library!.revision, backup: draft.backup, sync: draft.sync })
    library = checkedLibrary(committed)
  })
}

export async function listProjectSnapshots(): Promise<ProjectSnapshotEntry[]> { return invoke({ method: 'history' }) }
export async function readKernelHistoryRuns(projectId: string, baseRevision: string | null, cursor: number): Promise<ProjectHistoryRunsPage> {
  return invoke({ method: 'historyRuns', projectId, baseRevision, cursor })
}
export async function readKernelHistoryRetention(): Promise<ProjectHistoryRetentionState> { return invoke({ method: 'historyRetention' }) }
export async function previewKernelHistoryRetention(policy: ProjectHistoryRetentionPreview['policy'], pinnedRevisions: string[]): Promise<ProjectHistoryRetentionPreview> {
  return invoke({ method: 'previewHistoryRetention', policy: clone(policy), pinnedRevisions: [...pinnedRevisions] })
}
export async function confirmKernelHistoryRetention(token: string, baseRevision: string | null): Promise<ProjectHistoryRetentionResult> {
  return serialize(async () => {
    assertReady()
    const result = await invoke<ProjectHistoryRetentionResult>({ method: 'confirmHistoryRetention', token, baseRevision })
    const current = checkedLibrary(await invoke<ProjectLibraryState>({ method: 'read' }))
    library = current
    return result
  })
}
export async function previewKernelHistoryCapacity(): Promise<ProjectHistoryCapacity> { return invoke({ method: 'historyCapacity' }) }
export async function cleanupKernelHistory(token: string, baseRevision: string | null): Promise<ProjectHistoryCleanupResult> {
  return invoke({ method: 'cleanupHistory', token, baseRevision })
}
export async function readHistoricalProject(revision: string): Promise<ProjectBackup> {
  return parseProjectBackup(JSON.stringify(await invoke({ method: 'readSnapshot', revision })))
}
export async function createKernelHistoryPoint(novelId: string): Promise<void> {
  return serialize(async () => {
    assertReady()
    library = checkedLibrary(await invoke({ method: 'checkpoint', baseRevision: library!.revision, novelId }))
  })
}
export async function restoreKernelNovel(baseRevision: string, revision: string, novelId: string, scope: import('@/types/projectHistory').ProjectHistoryScope): Promise<ProjectBackup> {
  return serialize(async () => {
    assertReady()
    const committed = checkedLibrary(await invoke<ProjectLibraryState>({ method: 'restoreNovel', baseRevision, revision, novelId, scope }))
    library = committed
    return clone(committed.backup!)
  })
}
export async function restoreProjectSnapshot(revision: string): Promise<ProjectBackup> {
  return serialize(async () => {
    assertReady()
    const restored = await invoke<ProjectLibraryState>({ method: 'restore', baseRevision: library!.revision, revision })
    library = checkedLibrary(restored)
    return clone(restored.backup!)
  })
}

export async function getProjectLocation(projectId: string): Promise<string> { return invoke({ method: 'location', projectId }) }
export async function inspectProjectIndex(projectId: string): Promise<ProjectIndexStatus> {
  const status = await invoke<ProjectIndexStatus>({ method: 'indexStatus', projectId })
  if (status.state === 'ready') projectIndexWarnings.value = projectIndexWarnings.value.filter(row => row.projectId !== projectId)
  return status
}
export async function rebuildProjectIndex(projectId: string): Promise<ProjectIndexStatus> {
  const status = await invoke<ProjectIndexStatus>({ method: 'rebuildIndex', projectId })
  projectIndexWarnings.value = projectIndexWarnings.value.filter(row => row.projectId !== projectId)
  return status
}
