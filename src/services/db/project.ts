import { execute, initDb, runTransaction } from '../database'
import { clearNovelRows, writeNovelRows } from './novels'
import { clearKnowledgeRows, writeKnowledgeBaseRows } from './knowledge'
import { parseProjectBackup, type ProjectBackup } from '../projectBackup'
import { writeChapterRevisionRow } from './chapterRevisions'
import { writeInspirationSessions } from './inspirationSessions'
import { writeReconstructionWorkspaceRows } from './reconstruction'
import { usesProjectKernel, mutateProjectLibrary } from '../projectKernelClient'

/** The caller validates first and owns the transaction, including rollback. */
export function writeProjectRows(checked: ProjectBackup): void {
  clearNovelRows()
  clearKnowledgeRows()
  for (const kb of checked.knowledgeBases) writeKnowledgeBaseRows(kb)
  for (const novel of checked.novels) writeNovelRows(novel)
  for (const revision of checked.chapterRevisions) writeChapterRevisionRow(revision)
  writeInspirationSessions(checked.inspirationSessions)
  // Prevent a later first-time initialization from merging pre-import sessions.
  execute("INSERT OR IGNORE INTO local_migrations(id) VALUES('inspiration-sessions')")
  for (const workspace of checked.reconstructionWorkspaces) writeReconstructionWorkspaceRows(workspace.novelId, workspace)
}

export async function replaceProjectInDb(backup: ProjectBackup): Promise<void> {
  // Defense in depth: this entry point cannot bypass validation via a caller cast.
  const checked = parseProjectBackup(JSON.stringify(backup))
  if (usesProjectKernel()) return mutateProjectLibrary(draft => { draft.backup = checked })
  await initDb()
  await runTransaction(() => {
    execute('DELETE FROM ai_tasks')
    writeProjectRows(checked)
  }, { restoreOnWriteFailure: true })
}
