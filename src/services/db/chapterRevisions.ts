import { execute, initDb, queryAll, runTransaction } from '@/services/database'
import type { ChapterRevision, ChapterRevisionSource, ChapterRevisionStatus, ChapterSelectionRevision } from '@/types/novel'
import { createTextDiff } from '@/utils/textDiff'
import { usesProjectKernel, readKernelBackup, mutateProjectLibrary } from '../projectKernelClient'
import { saveKernelRevision } from '../projectKernelRepository'
import { validateSelectionRevision } from '../selectionRevisionMetadata'

interface RevisionRow {
  id: string
  novel_id: string
  chapter_id: string
  base_content: string
  proposed_content: string
  diff: string
  source: ChapterRevisionSource
  reason: string
  status: ChapterRevisionStatus
  created_at: string
  updated_at: string
  applied_at: string | null
  selection_json?: string | null
}

function createId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function rowToRevision(row: RevisionRow): ChapterRevision {
  const revision: ChapterRevision = {
    id: row.id,
    novelId: row.novel_id,
    chapterId: row.chapter_id,
    baseContent: row.base_content,
    proposedContent: row.proposed_content,
    diff: row.diff,
    source: row.source,
    reason: row.reason || '',
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    appliedAt: row.applied_at || undefined,
    selection: row.selection_json ? JSON.parse(row.selection_json) : undefined,
  }
  validateSelectionRevision(revision)
  return revision
}

export async function loadProjectChapterRevisions(): Promise<ChapterRevision[]> {
  if (usesProjectKernel()) return (await readKernelBackup()).chapterRevisions
  await initDb()
  return readProjectChapterRevisionRows()
}

/** Synchronous reader used by an owning manuscript transaction. */
export function readProjectChapterRevisionRows(): ChapterRevision[] {
  return queryAll<RevisionRow>('SELECT * FROM chapter_revisions ORDER BY created_at').map(rowToRevision)
}

export function writeChapterRevisionRow(revision: ChapterRevision): void {
  validateSelectionRevision(revision)
  execute(`INSERT INTO chapter_revisions
    (id, novel_id, chapter_id, base_content, proposed_content, diff, source, reason, status, created_at, updated_at, applied_at, selection_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    revision.id, revision.novelId, revision.chapterId, revision.baseContent, revision.proposedContent,
    revision.diff, revision.source, revision.reason, revision.status, revision.createdAt, revision.updatedAt, revision.appliedAt || null,
    revision.selection ? JSON.stringify(revision.selection) : null,
  ])
}

export async function createChapterRevision(
  novelId: string,
  chapterId: string,
  baseContent: string,
  proposedContent: string,
  source: ChapterRevisionSource = 'ai',
  reason = '',
  selection?: ChapterSelectionRevision,
): Promise<ChapterRevision> {
  if (!usesProjectKernel()) await initDb()
  const now = new Date().toISOString()
  const revision: ChapterRevision = {
    id: createId(),
    novelId,
    chapterId,
    baseContent,
    proposedContent,
    diff: createTextDiff(baseContent, proposedContent).diff,
    source,
    reason,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    ...(selection ? { selection } : {}),
  }
  validateSelectionRevision(revision)

  if (usesProjectKernel()) {
    await saveKernelRevision(revision)
    return revision
  }
  await runTransaction(() => writeChapterRevisionRow(revision), { restoreOnWriteFailure: true })
  return revision
}

/** Author edits the candidate; the base manuscript and scope remain fixed. */
export async function editPendingChapterRevision(expected: ChapterRevision, proposedContent: string): Promise<ChapterRevision> {
  const edited: ChapterRevision = { ...expected, proposedContent, diff: createTextDiff(expected.baseContent, proposedContent).diff, updatedAt: new Date().toISOString() }
  if (expected.status !== 'pending') throw new Error('该修订已经处理，不能再编辑。')
  validateSelectionRevision(edited)
  const assertCurrent = (current: ChapterRevision | undefined) => {
    if (!current || JSON.stringify(current) !== JSON.stringify(expected)) throw new Error('候选已经变化，请刷新后重试。')
  }
  if (usesProjectKernel()) await mutateProjectLibrary(({ backup }) => {
    const index = backup.chapterRevisions.findIndex(revision => revision.id === expected.id)
    assertCurrent(backup.chapterRevisions[index])
    backup.chapterRevisions[index] = edited
  })
  else {
    await initDb()
    await runTransaction(() => {
      assertCurrent(readProjectChapterRevisionRows().find(revision => revision.id === expected.id))
      execute('DELETE FROM chapter_revisions WHERE id = ?', [expected.id])
      writeChapterRevisionRow(edited)
    }, { restoreOnWriteFailure: true })
  }
  return edited
}

export async function getChapterRevision(id: string): Promise<ChapterRevision | null> {
  if (usesProjectKernel()) return (await readKernelBackup()).chapterRevisions.find(item => item.id === id) || null
  await initDb()
  const row = queryAll<RevisionRow>('SELECT * FROM chapter_revisions WHERE id = ?', [id])[0]
  return row ? rowToRevision(row) : null
}

export async function listChapterRevisions(chapterId: string, limit = 50): Promise<ChapterRevision[]> {
  if (usesProjectKernel()) return (await readKernelBackup()).chapterRevisions.filter(item => item.chapterId === chapterId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit)
  await initDb()
  return queryAll<RevisionRow>(
    'SELECT * FROM chapter_revisions WHERE chapter_id = ? ORDER BY created_at DESC LIMIT ?',
    [chapterId, limit],
  ).map(rowToRevision)
}

export async function updateChapterRevisionStatus(
  id: string,
  status: ChapterRevisionStatus,
  appliedAt?: string,
  expectedStatus?: ChapterRevisionStatus,
): Promise<void> {
  const assertStatus = (revision: ChapterRevision | undefined) => {
    if (!revision) throw new Error('正文修订记录已不存在。')
    if (expectedStatus && revision.status !== expectedStatus) throw new Error('正文修订记录已经变化，请刷新后重试。')
  }
  if (usesProjectKernel()) return mutateProjectLibrary(({ backup }) => {
    const revision = backup.chapterRevisions.find(item => item.id === id)
    assertStatus(revision)
    Object.assign(revision!, { status, updatedAt: new Date().toISOString(), appliedAt })
  })
  await initDb()
  const now = new Date().toISOString()
  await runTransaction(() => {
    assertStatus(readProjectChapterRevisionRows().find(revision => revision.id === id))
    execute(
      'UPDATE chapter_revisions SET status = ?, updated_at = ?, applied_at = ? WHERE id = ?',
      [status, now, appliedAt || null, id],
    )
  }, { restoreOnWriteFailure: true })
}
