import { execute, initDb, queryAll, runTransaction } from '../database'
import { emptySyncState, type SyncState, type SyncConflict } from '../cloudSyncModel'
import type { ProjectBackup } from '../projectBackup'
import { clearNovelRows, writeNovelRows } from './novels'
import { clearKnowledgeRows, writeKnowledgeBaseRows } from './knowledge'
import { writeChapterRevisionRow } from './chapterRevisions'
import { writeInspirationSessions } from './inspirationSessions'

async function ready() { await initDb() }
export async function readCloudState(): Promise<SyncState> {
  await ready()
  const row = queryAll<{ value: string }>("SELECT value FROM cloud_sync_state WHERE id='main'")[0]
  return row ? JSON.parse(row.value) : emptySyncState()
}
export async function readCloudConflicts(): Promise<SyncConflict[]> {
  await ready()
  return queryAll<{ value: string }>('SELECT value FROM cloud_sync_conflicts ORDER BY created_at DESC')
    .map(row => JSON.parse(row.value))
}
export async function persistCloudState(state: SyncState, conflicts: SyncConflict[] = [], project?: ProjectBackup): Promise<void> {
  await ready()
  await runTransaction(() => {
    if (project) {
      clearNovelRows()
      clearKnowledgeRows()
      for (const kb of project.knowledgeBases) writeKnowledgeBaseRows(kb)
      for (const novel of project.novels) writeNovelRows(novel)
      for (const revision of project.chapterRevisions || []) writeChapterRevisionRow(revision)
      if (project.inspirationSessions) writeInspirationSessions(project.inspirationSessions)
      execute('DELETE FROM semantic_index')
    }
    execute("INSERT INTO cloud_sync_state(id,value) VALUES('main',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      [JSON.stringify(state)])
    for (const conflict of conflicts) {
      execute('INSERT INTO cloud_sync_conflicts(id,value,created_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
        [conflict.id, JSON.stringify(conflict), conflict.createdAt])
    }
  }, { restoreOnWriteFailure: true })
}
