import { execute, initDb, queryAll, runTransaction, getRowCacheEpoch } from '../database'
import { parseProjectBackup, type ProjectBackup } from '../projectBackup'
import { readAllNovelRows, writeNovelRows } from './novels'
import { readAllKnowledgeRows } from './knowledge'
import { readReconstructionWorkspaceRows, writeReconstructionWorkspaceRows } from './reconstruction'
import { readProjectChapterRevisionRows, writeChapterRevisionRow } from './chapterRevisions'
import { validateReconstructionAiRun } from '../reconstructionBackupValidation'
import type { ProjectHistoryEntry, ProjectHistoryScope, ProjectHistoryRunsPage, ProjectHistoryCapacity } from '@/types/projectHistory'
import type { AiRun } from '@/types/reconstruction'

export async function sqlHistoryRunsBaseline(): Promise<string> {
  await initDb()
  return sqlLedgerBaseline()
}
function sqlLedgerBaseline(): string {
  return String(getRowCacheEpoch()) + ':' + (queryAll<{ revision: string }>('SELECT revision FROM project_history ORDER BY rowid DESC LIMIT 1')[0]?.revision || '')
}
export async function readSqlHistoryRuns(projectId: string, baseRevision: string, cursor: number): Promise<ProjectHistoryRunsPage> {
  if (await sqlHistoryRunsBaseline() !== baseRevision) throw new Error('读取账本期间本地项目已更新，请重新预览。')
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('无效账本页码。')
  // Extract only target-book ledger JSON inside SQLite. Do not deserialize every
  // historical library/manuscript in the renderer or trust project_ids as evidence.
  const row = queryAll<{ position: number; revision: string; format: string; version: number; ledger: string | null; count: number; novel_count: number }>(`
    SELECT h.rowid AS position, h.revision, json_extract(h.value, '$.format') AS format,
      json_extract(h.value, '$.version') AS version,
      (SELECT json_extract(w.value, '$.aiRuns') FROM json_each(h.value, '$.reconstructionWorkspaces') w
        WHERE json_extract(w.value, '$.novelId') = ?) AS ledger,
      (SELECT COUNT(*) FROM json_each(h.value, '$.reconstructionWorkspaces') w
        WHERE json_extract(w.value, '$.novelId') = ?) AS count,
      (SELECT COUNT(*) FROM json_each(h.value, '$.novels') n
        WHERE json_extract(n.value, '$.id') = ?) AS novel_count
    FROM project_history h WHERE h.rowid > ? ORDER BY h.rowid LIMIT 1`, [projectId, projectId, projectId, cursor])[0]
  if (!row) return { projectId, baseRevision, source: null, nextCursor: null }
  if (row.format !== 'ai-novel-writer-backup' || row.version !== 3 || row.count > 1 || row.count !== row.novel_count) throw new Error('历史账本来源无效。')
  const runs: AiRun[] = row.count === 0 ? [] : JSON.parse(row.ledger || 'null')
  if (!Array.isArray(runs) || new Set(runs.map(run => run.id)).size !== runs.length) throw new Error('历史账本损坏。')
  for (const run of runs) validateReconstructionAiRun(run)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(row.ledger || '[]'))
  const workspaceHash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  if (await sqlHistoryRunsBaseline() !== baseRevision) throw new Error('读取账本期间本地项目已更新，请重新预览。')
  return { projectId, baseRevision, nextCursor: row.position, source: { revision: row.revision, snapshot: workspaceHash, workspaceHash,
    runs: runs.map(run => { const value = { ...run }; delete value.chapterDrafts; return value }) } }
}
export async function previewSqlHistoryCapacity(): Promise<ProjectHistoryCapacity> {
  const baseRevision = await sqlHistoryRunsBaseline()
  const pageSize = Number(Object.values(queryAll('PRAGMA page_size')[0] || {})[0])
  const pages = Number(Object.values(queryAll('PRAGMA page_count')[0] || {})[0])
  const freePages = Number(Object.values(queryAll('PRAGMA freelist_count')[0] || {})[0])
  const size = queryAll<{ count: number; bytes: number }>('SELECT COUNT(*) AS count, COALESCE(SUM(length(CAST(value AS BLOB))), 0) AS bytes FROM project_history')[0]
  return { token: '', baseRevision, totalFiles: size.count, totalBytes: size.bytes, reclaimableFiles: 0, reclaimableBytes: 0,
    protectedVersions: size.count, protectedReasons: ['当前浏览器中的全部手动恢复点、作者决定及请求账本保留。'],
    limitations: [`当前数据库 ${(pages * pageSize / 1024).toFixed(1)} KB，其中可压缩的空闲页 ${(freePages * pageSize / 1024).toFixed(1)} KB；空间不足时保存会先尝试无损压缩。`, '此处统计恢复点 JSON 数据字节，不包含 SQLite 页、当前稿或浏览器其他存储。', '浏览器恢复点暂不提供裁剪；桌面孤立文件清理仅适用于桌面项目存储。'] }
}

interface HistoryRow { revision: string; created_at: string; label: string; novel_id: string; source_revision: string | null; value: string; project_ids?: string | null }
export async function listSqlHistory(): Promise<ProjectHistoryEntry[]> {
  await initDb()
  return queryAll<HistoryRow>('SELECT revision, created_at, label, novel_id, source_revision, project_ids FROM project_history ORDER BY rowid DESC').map(row => {
    const projectIds: string[] | undefined = row.project_ids ? JSON.parse(row.project_ids) : undefined
    if (projectIds && (!Array.isArray(projectIds) || projectIds.some(id => typeof id !== 'string'))) throw new Error('历史索引损坏，已停止读取。')
    return { revision: row.revision, parentRevision: null, createdAt: row.created_at, label: row.label, projectCount: projectIds?.length || 0, projectIds,
      action: { kind: row.label === '作者确认单作品恢复' ? 'restore-novel' : 'checkpoint', novelId: row.novel_id, sourceRevision: row.source_revision, label: row.label } }
  })
}
export async function readSqlHistory(revision: string): Promise<ProjectBackup> {
  await initDb()
  const row = queryAll<HistoryRow>('SELECT value FROM project_history WHERE revision = ?', [revision])[0]
  if (!row) throw new Error('恢复点不存在。')
  return parseProjectBackup(row.value)
}
function insertHistory(backup: ProjectBackup, novelId: string, label: string, source: string | null): string {
  const revision = crypto.randomUUID()
  // Only domain snapshots enter history. History tables and audit entries never nest in a backup.
  execute('INSERT INTO project_history(revision, created_at, label, novel_id, source_revision, value, project_ids) VALUES(?,?,?,?,?,?,?)',
    [revision, new Date().toISOString(), label, novelId, source, JSON.stringify(backup), JSON.stringify(backup.novels.map(row => row.id))])
  return revision
}
export async function saveSqlHistory(backup: ProjectBackup, novelId: string, label: string, source: string | null = null, ledgerBaseline?: string): Promise<string> {
  const checked = parseProjectBackup(JSON.stringify(backup))
  await initDb()
  let revision = ''
  await runTransaction(() => {
    if (ledgerBaseline !== undefined && sqlLedgerBaseline() !== ledgerBaseline) throw new Error('历史账本已有更新，请重新预览。')
    revision = insertHistory(checked, novelId, label, source)
  }, { restoreOnWriteFailure: true })
  return revision
}
export async function restoreSqlHistory(scope: ProjectHistoryScope, result: ProjectBackup, epoch: number, source: string, assertLive: () => void, ledgerBaseline: string): Promise<void> {
  const checked = parseProjectBackup(JSON.stringify(result)), novel = scope.novel!, workspace = scope.workspace!
  await runTransaction(() => {
    if (getRowCacheEpoch() !== epoch) throw new Error('本地数据已变化，请重新预览后恢复。')
    if (sqlLedgerBaseline() !== ledgerBaseline) throw new Error('恢复准备期间历史账本已有更新，请重新预览。')
    assertLive()
    // Revalidate against the actual queued transaction state, including new rows
    // that did not invalidate the SQL row cache. ID collisions must never move a row between books.
    const liveNovels = readAllNovelRows()
    const nextNovels = [...liveNovels.filter(row => row.id !== novel.id), novel]
    const durable = parseProjectBackup(JSON.stringify({ ...checked, novels: nextNovels, knowledgeBases: readAllKnowledgeRows(),
      chapterRevisions: [...readProjectChapterRevisionRows().filter(row => row.novelId !== novel.id), ...scope.chapterRevisions],
      inspirationSessions: queryAll<{ value: string }>('SELECT value FROM inspiration_sessions').map(row => JSON.parse(row.value)),
      reconstructionWorkspaces: nextNovels.map(row => {
        const value = row.id === novel.id ? workspace : readReconstructionWorkspaceRows(row.id)
        return { ...value, novelId: row.id, chapterReviews: value.chapterReviews || [], aiRuns: value.aiRuns || [] }
      }),
    }))
    // Never use whole-library replacement: all deletes are explicitly owned by this book.
    execute('DELETE FROM chapter_revisions WHERE novel_id = ?', [novel.id])
    execute('DELETE FROM semantic_index WHERE novel_id = ?', [novel.id])
    writeNovelRows(novel)
    writeReconstructionWorkspaceRows(novel.id, workspace)
    for (const revision of scope.chapterRevisions) writeChapterRevisionRow(revision)
    insertHistory(durable, novel.id, '作者确认单作品恢复', source)
  }, { restoreOnWriteFailure: true })
}
