import { execute, initDb, runTransaction } from '../database'
import { clearNovelRows, writeNovelRows } from './novels'
import { clearKnowledgeRows, writeKnowledgeBaseRows } from './knowledge'
import { parseProjectBackup, type ProjectBackup } from '../projectBackup'
import { writeChapterRevisionRow } from './chapterRevisions'
import { writeInspirationSessions } from './inspirationSessions'

export async function replaceProjectInDb(backup: ProjectBackup): Promise<void> {
  // Defense in depth: this entry point cannot bypass validation via a caller cast.
  const checked = parseProjectBackup(JSON.stringify(backup))
  await initDb()
  await runTransaction(() => {
    clearNovelRows()
    clearKnowledgeRows()
    execute('DELETE FROM ai_tasks')
    for (const kb of checked.knowledgeBases) writeKnowledgeBaseRows(kb)
    for (const novel of checked.novels) writeNovelRows(novel)
    for (const revision of checked.chapterRevisions || []) writeChapterRevisionRow(revision)
    if (checked.inspirationSessions) writeInspirationSessions(checked.inspirationSessions)
  }, { restoreOnWriteFailure: true })
}
