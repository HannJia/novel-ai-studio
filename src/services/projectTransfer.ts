import { ref } from 'vue'
import { useNovelStore } from '@/stores/novel'
import { useKnowledgeStore } from '@/stores/knowledge'
import { chapterBackgroundQueue } from './aiTaskQueue'
import { replaceProjectInDb } from './db/project'
import { createProjectBackup, parseProjectBackup, type ProjectBackup } from './projectBackup'
import { loadProjectChapterRevisions } from './db/chapterRevisions'

export const projectTransferBusy = ref(false)

export async function importProject(backup: ProjectBackup): Promise<void> {
  if (projectTransferBusy.value) throw new Error('项目导入正在进行')
  if (chapterBackgroundQueue.pendingCount) throw new Error('请等待章节后台任务结束后再导入项目')
  const checked = parseProjectBackup(JSON.stringify(backup))
  const novels = useNovelStore()
  const knowledge = useKnowledgeStore()
  projectTransferBusy.value = true
  try {
    await Promise.all([novels.flushPendingSaves(), knowledge.flushPendingSaves()])
    // Keep a separate, validated restore point. The database transaction also
    // preserves its previous on-disk image; this reference documents the exact
    // project state that was present before import.
    const before = createProjectBackup(novels.novels, knowledge.knowledgeBases, await loadProjectChapterRevisions())
    const { retainProjectRestorePoint } = await import('./database')
    await retainProjectRestorePoint(JSON.stringify(before))
    await replaceProjectInDb(checked)
    novels.adoptImportedNovels(checked.novels)
    knowledge.adoptImportedKnowledgeBases(checked.knowledgeBases)
  } finally { projectTransferBusy.value = false }
}
