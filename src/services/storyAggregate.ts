import type { Novel, ChapterRevision } from '@/types/novel'
import type { ReconstructionWorkspaceSnapshot } from '@/types/reconstruction'
import { execute, initDb, runTransaction } from './database'
import { readAllNovelRows, writeNovelRows } from './db/novels'
import { readAllKnowledgeRows } from './db/knowledge'
import { readReconstructionWorkspaceRows, writeReconstructionWorkspaceRows } from './db/reconstruction'
import { readProjectChapterRevisionRows, writeChapterRevisionRow } from './db/chapterRevisions'
import { createProjectBackup, parseProjectBackup } from './projectBackup'
import { usesProjectKernel, readKernelBackup, mutateProjectLibrary, ProjectKernelError } from './projectKernelClient'
import { emptyKernelWorkspace } from './projectKernelRepository'

export interface StoredStoryAggregate {
  novel: Novel | null
  workspace: ReconstructionWorkspaceSnapshot
}
export interface StoryAggregate extends StoredStoryAggregate { novel: Novel }
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

function withoutOwner(workspace: ReconstructionWorkspaceSnapshot & { novelId?: string }): ReconstructionWorkspaceSnapshot {
  const { novelId: _owner, ...snapshot } = workspace
  return snapshot
}

export async function readStoryAggregate(novelId: string): Promise<StoredStoryAggregate> {
  if (usesProjectKernel()) {
    const backup = await readKernelBackup()
    return { novel: backup.novels.find(novel => novel.id === novelId) || null,
      workspace: withoutOwner(backup.reconstructionWorkspaces.find(workspace => workspace.novelId === novelId) || emptyKernelWorkspace(novelId)) }
  }
  await initDb()
  return { novel: readAllNovelRows().find(novel => novel.id === novelId) || null, workspace: readReconstructionWorkspaceRows(novelId) }
}

function assertUnchanged(current: StoredStoryAggregate, expected: StoredStoryAggregate) {
  if (JSON.stringify(current) !== JSON.stringify(expected)) {
    throw new ProjectKernelError('PROJECT_CONFLICT', '作品或审核记录已经更新，本次操作未保存，请刷新相关记录后重试。')
  }
}

export interface RevisionAcceptance { expected: ChapterRevision; acceptedAt: string }

function acceptRevision(revisions: ChapterRevision[], acceptance: RevisionAcceptance | undefined, novel: Novel): ChapterRevision[] {
  if (!acceptance) return revisions
  const expected = acceptance.expected
  const current = revisions.find(revision => revision.id === expected.id)
  if (!current || JSON.stringify(current) !== JSON.stringify(expected) || current.status !== 'pending') {
    throw new ProjectKernelError('PROJECT_CONFLICT', '正文修订记录已经变化，请刷新后重试。')
  }
  const chapter = novel.chapters.find(chapter => chapter.id === current.chapterId)
  if (current.novelId !== novel.id || !chapter || chapter.content !== current.proposedContent) throw new Error('修订稿与待保存的正文不一致。')
  return revisions.map(revision => revision.id === current.id ? { ...revision, status: 'accepted',
    updatedAt: acceptance.acceptedAt, appliedAt: acceptance.acceptedAt } : revision)
}

/** Commit manuscript and author decisions together. The caller owns UI publication. */
export async function saveStoryAggregate(aggregate: StoryAggregate, expected: StoredStoryAggregate, revisionAcceptance?: RevisionAcceptance,
  assertLive: () => void = () => {}): Promise<void> {
  const captured = clone(aggregate), base = clone(expected)
  const acceptance = revisionAcceptance ? clone(revisionAcceptance) : undefined
  const novelId = captured.novel.id
  if (base.novel && base.novel.id !== novelId) throw new Error('作品事务的版本不属于当前作品。')
  if (usesProjectKernel()) return mutateProjectLibrary(({ backup }) => {
    assertLive()
    const novelIndex = backup.novels.findIndex(novel => novel.id === novelId)
    const workspaceIndex = backup.reconstructionWorkspaces.findIndex(workspace => workspace.novelId === novelId)
    assertUnchanged({ novel: backup.novels[novelIndex] || null,
      workspace: withoutOwner(backup.reconstructionWorkspaces[workspaceIndex] || emptyKernelWorkspace(novelId)) }, base)
    if (novelIndex < 0) backup.novels.push(captured.novel)
    else backup.novels[novelIndex] = captured.novel
    const workspace = { ...captured.workspace, novelId, chapterReviews: captured.workspace.chapterReviews || [], aiRuns: captured.workspace.aiRuns || [] }
    if (workspaceIndex < 0) backup.reconstructionWorkspaces.push(workspace)
    else backup.reconstructionWorkspaces[workspaceIndex] = workspace
    const chapters = new Set([...captured.novel.chapters, ...(captured.novel.archivedChapters || [])].map(chapter => chapter.id))
    backup.chapterRevisions = acceptRevision(backup.chapterRevisions, acceptance, captured.novel)
      .filter(revision => revision.novelId !== novelId || chapters.has(revision.chapterId))
  })
  await initDb()
  await runTransaction(() => {
    assertLive()
    const storedNovels = readAllNovelRows()
    assertUnchanged({ novel: storedNovels.find(novel => novel.id === novelId) || null, workspace: readReconstructionWorkspaceRows(novelId) }, base)
    const novels = [...storedNovels.filter(novel => novel.id !== novelId), captured.novel]
    const reconstructionWorkspaces = novels.map(novel => {
      const workspace = novel.id === novelId ? captured.workspace : readReconstructionWorkspaceRows(novel.id)
      return { ...workspace, novelId: novel.id, chapterReviews: workspace.chapterReviews || [], aiRuns: workspace.aiRuns || [] }
    })
    const chapterIds = new Set([...captured.novel.chapters, ...(captured.novel.archivedChapters || [])].map(chapter => chapter.id))
    const chapterRevisions = acceptRevision(readProjectChapterRevisionRows(), acceptance, captured.novel)
      .filter(revision => revision.novelId !== novelId || chapterIds.has(revision.chapterId))
    parseProjectBackup(JSON.stringify(createProjectBackup({ novels, knowledgeBases: readAllKnowledgeRows(),
      chapterRevisions, inspirationSessions: [], reconstructionWorkspaces })))
    writeNovelRows(captured.novel)
    writeReconstructionWorkspaceRows(novelId, captured.workspace)
    if (acceptance) {
      execute('DELETE FROM chapter_revisions WHERE id = ?', [acceptance.expected.id])
      writeChapterRevisionRow(chapterRevisions.find(revision => revision.id === acceptance.expected.id)!)
    }
  }, { restoreOnWriteFailure: true })
}
