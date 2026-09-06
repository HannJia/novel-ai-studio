import { execute, initDb, queryAll, runTransaction } from '@/services/database'
import type { ChapterRevision, ChapterRevisionSource, ChapterRevisionStatus } from '@/types/novel'
import { createTextDiff } from '@/utils/textDiff'

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
}

function createId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function rowToRevision(row: RevisionRow): ChapterRevision {
  return {
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
  }
}

export async function loadProjectChapterRevisions(): Promise<ChapterRevision[]> {
  await initDb()
  return queryAll<RevisionRow>('SELECT * FROM chapter_revisions ORDER BY created_at').map(rowToRevision)
}

export function writeChapterRevisionRow(revision: ChapterRevision): void {
  execute(`INSERT INTO chapter_revisions
    (id, novel_id, chapter_id, base_content, proposed_content, diff, source, reason, status, created_at, updated_at, applied_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    revision.id, revision.novelId, revision.chapterId, revision.baseContent, revision.proposedContent,
    revision.diff, revision.source, revision.reason, revision.status, revision.createdAt, revision.updatedAt, revision.appliedAt || null,
  ])
}

export async function createChapterRevision(
  novelId: string,
  chapterId: string,
  baseContent: string,
  proposedContent: string,
  source: ChapterRevisionSource = 'ai',
  reason = '',
): Promise<ChapterRevision> {
  await initDb()
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
  }

  await runTransaction(() => {
    execute(`
      INSERT INTO chapter_revisions
      (id, novel_id, chapter_id, base_content, proposed_content, diff, source, reason, status, created_at, updated_at, applied_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      revision.id, revision.novelId, revision.chapterId, revision.baseContent,
      revision.proposedContent, revision.diff, revision.source, revision.reason,
      revision.status, revision.createdAt, revision.updatedAt, null,
    ])
  })
  return revision
}

export async function getChapterRevision(id: string): Promise<ChapterRevision | null> {
  await initDb()
  const row = queryAll<RevisionRow>('SELECT * FROM chapter_revisions WHERE id = ?', [id])[0]
  return row ? rowToRevision(row) : null
}

export async function listChapterRevisions(chapterId: string, limit = 50): Promise<ChapterRevision[]> {
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
): Promise<void> {
  await initDb()
  const now = new Date().toISOString()
  await runTransaction(() => {
    execute(
      'UPDATE chapter_revisions SET status = ?, updated_at = ?, applied_at = ? WHERE id = ?',
      [status, now, appliedAt || null, id],
    )
  })
}
