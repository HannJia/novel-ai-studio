import { execute, initDb, queryAll, runTransaction } from '../database'
import { emptySyncState, type SyncState, type SyncConflict } from '../cloudSyncModel'
import { parseProjectBackup, type ProjectBackup } from '../projectBackup'
import { writeProjectRows } from './project'
import { usesProjectKernel, readProjectLibrary, mutateProjectLibrary } from '../projectKernelClient'

async function ready() { await initDb() }
export async function readCloudState(): Promise<SyncState> {
  if (usesProjectKernel()) return (await readProjectLibrary()).sync.state || emptySyncState()
  await ready()
  const row = queryAll<{ value: string }>("SELECT value FROM cloud_sync_state WHERE id='main'")[0]
  return row ? JSON.parse(row.value) : emptySyncState()
}
export async function readCloudConflicts(): Promise<SyncConflict[]> {
  if (usesProjectKernel()) return (await readProjectLibrary()).sync.conflicts.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  await ready()
  return queryAll<{ value: string }>('SELECT value FROM cloud_sync_conflicts ORDER BY created_at DESC')
    .map(row => JSON.parse(row.value))
}
export async function persistCloudState(state: SyncState, conflicts: SyncConflict[] = [], project?: ProjectBackup): Promise<void> {
  const checked = project ? parseProjectBackup(JSON.stringify(project)) : undefined
  if (usesProjectKernel()) {
    const savedState = JSON.parse(JSON.stringify(state)) as SyncState
    const savedConflicts = JSON.parse(JSON.stringify(conflicts)) as SyncConflict[]
    return mutateProjectLibrary(draft => {
      if (checked) draft.backup = checked
      draft.sync.state = savedState
      for (const conflict of savedConflicts) {
        const index = draft.sync.conflicts.findIndex(item => item.id === conflict.id)
        if (index < 0) draft.sync.conflicts.push(conflict)
        else draft.sync.conflicts[index] = conflict
      }
    })
  }
  await ready()
  await runTransaction(() => {
    if (checked) writeProjectRows(checked)
    execute("INSERT INTO cloud_sync_state(id,value) VALUES('main',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      [JSON.stringify(state)])
    for (const conflict of conflicts) {
      execute('INSERT INTO cloud_sync_conflicts(id,value,created_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
        [conflict.id, JSON.stringify(conflict), conflict.createdAt])
    }
  }, { restoreOnWriteFailure: true })
}
