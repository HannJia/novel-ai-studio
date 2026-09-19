import { ref } from 'vue'
import { useNovelStore } from '@/stores/novel'
import { useKnowledgeStore } from '@/stores/knowledge'
import { useInspirationSessionsStore } from '@/stores/inspirationSessions'
import { chapterBackgroundQueue } from './aiTaskQueue'
import { replaceProjectInDb } from './db/project'
import { createProjectBackup, parseProjectBackup, type ProjectBackup } from './projectBackup'
import { loadProjectChapterRevisions } from './db/chapterRevisions'
import { appUpdateInstalling, cloudApplyBusy } from './appLifecycle'

export const projectTransferBusy = ref(false)

export async function importProject(backup: ProjectBackup): Promise<void> {
  if (cloudApplyBusy.value) throw new Error('正在合并云端内容，请稍后重试。')
  if (appUpdateInstalling.value) throw new Error('正在准备安装更新，暂时不能导入项目。')
  if (projectTransferBusy.value) throw new Error('项目导入正在进行')
  if (chapterBackgroundQueue.pendingCount) throw new Error('请等待章节后台任务结束后再导入项目')
  const checked = parseProjectBackup(JSON.stringify(backup))
  const novels = useNovelStore()
  const knowledge = useKnowledgeStore()
  const inspiration = useInspirationSessionsStore()
  projectTransferBusy.value = true
  try {
    await Promise.all([novels.flushPendingSaves(), knowledge.flushPendingSaves(), inspiration.flushPendingSaves()])
    // Keep a separate, validated restore point. The database transaction also
    // preserves its previous on-disk image; this reference documents the exact
    // project state that was present before import.
    const before = createProjectBackup(novels.novels, knowledge.knowledgeBases, await loadProjectChapterRevisions(), inspiration.sessions)
    const { retainProjectRestorePoint } = await import('./database')
    await retainProjectRestorePoint(JSON.stringify(before))
    await replaceProjectInDb(checked)
    novels.adoptImportedNovels(checked.novels)
    knowledge.adoptImportedKnowledgeBases(checked.knowledgeBases)
    if (checked.inspirationSessions) inspiration.adopt(checked.inspirationSessions)
  } finally { projectTransferBusy.value = false }
}
