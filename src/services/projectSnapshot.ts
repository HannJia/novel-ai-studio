import { useNovelStore } from '@/stores/novel'
import { useKnowledgeStore } from '@/stores/knowledge'
import { useInspirationSessionsStore } from '@/stores/inspirationSessions'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { loadProjectChapterRevisions } from './db/chapterRevisions'
import { loadReconstructionWorkspace } from './db/reconstruction'
import { createProjectBackup, parseProjectBackup, type ProjectBackup } from './projectBackup'
import { flushEditorDrafts } from './appLifecycle'
import { usesProjectKernel, readProjectLibrary } from './projectKernelClient'

export async function flushProjectState(): Promise<void> {
  await flushEditorDrafts()
  const novels = useNovelStore()
  const inspiration = useInspirationSessionsStore()
  await inspiration.initialize()
  await useKnowledgeStore().flushPendingSaves()
  await novels.flushPendingSaves()
  await Promise.all([inspiration.flushPendingSaves(),
    useReconstructionWorkspaceStore().flushPendingSaves(novels.novels.map(novel => novel.id))])
}

/** Capture after flushing, including workspaces never opened in this session. */
export async function captureProjectSnapshot(): Promise<ProjectBackup> {
  if (usesProjectKernel()) return (await readProjectLibrary(true)).backup!
  const novels = useNovelStore()
  const [chapterRevisions, reconstructionWorkspaces] = await Promise.all([
    loadProjectChapterRevisions(),
    Promise.all(novels.novels.map(async novel => {
      const snapshot = await loadReconstructionWorkspace(novel.id)
      return { ...snapshot, novelId: novel.id, chapterReviews: snapshot.chapterReviews || [], aiRuns: snapshot.aiRuns || [] }
    })),
  ])
  return parseProjectBackup(JSON.stringify(createProjectBackup({
    novels: novels.novels, knowledgeBases: useKnowledgeStore().knowledgeBases,
    chapterRevisions, inspirationSessions: useInspirationSessionsStore().sessions, reconstructionWorkspaces,
  })))
}

/** Publish all aggregates together, only after successful durable replacement. */
export function adoptProjectSnapshot(project: ProjectBackup): void {
  useNovelStore().adoptImportedNovels(project.novels)
  useKnowledgeStore().adoptImportedKnowledgeBases(project.knowledgeBases)
  useInspirationSessionsStore().adopt(project.inspirationSessions)
  useReconstructionWorkspaceStore().adoptProjectWorkspaces(project.reconstructionWorkspaces)
}
