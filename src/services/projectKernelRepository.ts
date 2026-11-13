// Transitional UI adapter. The main-process kernel has no dependency on this
// module, Pinia, or the renderer's SQL database.
import type { Novel, ChapterRevision } from '@/types/novel'
import type { KnowledgeBase } from '@/stores/knowledge'
import type { ReconstructionWorkspaceSnapshot, AiRun } from '@/types/reconstruction'
import type { ProjectWorkspaceSnapshot } from './projectBackup'
import { mutateProjectLibrary, readKernelBackup } from './projectKernelClient'

export function emptyKernelWorkspace(novelId: string): ProjectWorkspaceSnapshot {
  return { novelId, editorDrafts: [], candidates: [], reviewFindings: [], chapterReviews: [], aiRuns: [], canonMutations: [], impactReports: [] }
}

export async function saveKernelNovel(novel: Novel): Promise<void> {
  const captured = JSON.parse(JSON.stringify(novel)) as Novel
  await mutateProjectLibrary(({ backup }) => {
    const index = backup.novels.findIndex(book => book.id === captured.id)
    if (index < 0) {
      backup.novels.push(captured)
      backup.reconstructionWorkspaces.push(emptyKernelWorkspace(captured.id))
    } else backup.novels[index] = captured
    const chapters = new Set([...captured.chapters, ...(captured.archivedChapters || [])].map(chapter => chapter.id))
    backup.chapterRevisions = backup.chapterRevisions.filter(revision => revision.novelId !== captured.id || chapters.has(revision.chapterId))
  })
}

export async function deleteKernelNovel(novelId: string): Promise<void> {
  await mutateProjectLibrary(({ backup }) => {
    backup.novels = backup.novels.filter(book => book.id !== novelId)
    backup.reconstructionWorkspaces = backup.reconstructionWorkspaces.filter(workspace => workspace.novelId !== novelId)
    backup.chapterRevisions = backup.chapterRevisions.filter(revision => revision.novelId !== novelId)
  })
}

export async function saveKernelKnowledge(kb: KnowledgeBase): Promise<void> {
  const captured = JSON.parse(JSON.stringify(kb)) as KnowledgeBase
  await mutateProjectLibrary(({ backup }) => {
    const index = backup.knowledgeBases.findIndex(item => item.id === captured.id)
    if (index < 0) backup.knowledgeBases.push(captured)
    else backup.knowledgeBases[index] = captured
  })
}

export async function deleteKernelKnowledge(id: string): Promise<void> {
  await mutateProjectLibrary(({ backup }) => {
    backup.knowledgeBases = backup.knowledgeBases.filter(kb => kb.id !== id)
    for (const novel of backup.novels) novel.knowledgeBaseIds = novel.knowledgeBaseIds.filter(value => value !== id)
    for (const session of backup.inspirationSessions) if (session.knowledgeIds) session.knowledgeIds = session.knowledgeIds.filter(value => value !== id)
  })
}

export async function loadKernelWorkspace(novelId: string): Promise<ReconstructionWorkspaceSnapshot> {
  const workspace = (await readKernelBackup()).reconstructionWorkspaces.find(item => item.novelId === novelId)
  if (!workspace) return emptyKernelWorkspace(novelId)
  const { novelId: _owner, ...snapshot } = workspace
  return snapshot
}

export async function changeKernelWorkspace(novelId: string, change: (workspace: ProjectWorkspaceSnapshot) => void): Promise<void> {
  await mutateProjectLibrary(({ backup }) => {
    const workspace = backup.reconstructionWorkspaces.find(item => item.novelId === novelId)
    if (!workspace) throw new Error('作品尚未保存，不能保存其创作工作区。')
    change(workspace)
  })
}

export async function saveKernelWorkspace(novelId: string, snapshot: ReconstructionWorkspaceSnapshot): Promise<void> {
  const captured = JSON.parse(JSON.stringify(snapshot)) as ReconstructionWorkspaceSnapshot
  await changeKernelWorkspace(novelId, workspace => {
    delete workspace.creationDraft
    Object.assign(workspace, captured, { novelId, editorDrafts: captured.editorDrafts || [], chapterReviews: captured.chapterReviews || [], aiRuns: captured.aiRuns || [], storyMemories: captured.storyMemories || [], impactReports: captured.impactReports || [] })
  })
}

export async function saveKernelRevision(revision: ChapterRevision): Promise<void> {
  const captured = JSON.parse(JSON.stringify(revision)) as ChapterRevision
  await mutateProjectLibrary(({ backup }) => { backup.chapterRevisions.push(captured) })
}

export async function saveKernelRun(novelId: string, run: AiRun): Promise<void> {
  const captured = JSON.parse(JSON.stringify(run)) as AiRun
  await changeKernelWorkspace(novelId, workspace => {
    const index = workspace.aiRuns.findIndex(item => item.id === captured.id)
    if (index < 0) workspace.aiRuns.push(captured)
    else workspace.aiRuns[index] = captured
  })
}
