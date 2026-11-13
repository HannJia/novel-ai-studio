import { queryAll, execute, initDb, runTransaction } from '../database'
import type { KnowledgeBase } from '@/stores/knowledge'
import { upsertRow } from './upsert'
import { usesProjectKernel, readKernelBackup } from '../projectKernelClient'
import { saveKernelKnowledge, deleteKernelKnowledge } from '../projectKernelRepository'

export async function loadAllKnowledgeBasesFromDb(): Promise<KnowledgeBase[]> {
  if (usesProjectKernel()) return (await readKernelBackup()).knowledgeBases
  await initDb()
  return readAllKnowledgeRows()
}

export function readAllKnowledgeRows(): KnowledgeBase[] {
  const kbsRow = queryAll<any>('SELECT * FROM knowledge_bases ORDER BY created_at DESC')
  const knowledgeBases: KnowledgeBase[] = kbsRow.map(row => ({
    id: row.id,
    name: row.name,
    description: row.description,
    summary: row.summary || '',
    summaryLevel: row.summary_level || 'standard',
    summaryUpdatedAt: row.summary_updated_at || '',
    summarySource: row.summary_source ? JSON.parse(row.summary_source) : undefined,
    summaryHistory: row.summary_history ? JSON.parse(row.summary_history) : undefined,
    createdAt: row.created_at,
    entries: []
  }))

  for (const kb of knowledgeBases) {
    const entriesRows = queryAll<any>('SELECT * FROM knowledge_entries WHERE kb_id = ? ORDER BY created_at DESC', [kb.id])
    kb.entries = entriesRows.map(r => ({
      id: r.id,
      category: r.category,
      title: r.title,
      content: r.content,
      summary: r.summary || '',
      summarySource: r.summary_source ? JSON.parse(r.summary_source) : undefined,
      summaryHistory: r.summary_history ? JSON.parse(r.summary_history) : undefined,
      tags: JSON.parse(r.tags || '[]'),
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }))
  }

  return knowledgeBases
}

export async function saveKnowledgeBaseToDb(kb: KnowledgeBase) {
  if (usesProjectKernel()) return saveKernelKnowledge(kb)
  await initDb()
  await runTransaction(() => writeKnowledgeBaseRows(kb), { restoreOnWriteFailure: true })
}

export function writeKnowledgeBaseRows(kb: KnowledgeBase) {
    upsertRow('knowledge_bases', 'id, name, description, summary, summary_level, summary_updated_at, created_at, summary_source, summary_history', [
      kb.id, kb.name, kb.description, kb.summary || '', kb.summaryLevel || 'standard', kb.summaryUpdatedAt || '', kb.createdAt,
      kb.summarySource ? JSON.stringify(kb.summarySource) : null, kb.summaryHistory ? JSON.stringify(kb.summaryHistory) : null,
    ])

    const existingEntryIds = queryAll<{ id: string }>('SELECT id FROM knowledge_entries WHERE kb_id = ?', [kb.id]).map(r => r.id)
    const currentEntryIds = new Set(kb.entries.map(e => e.id))
    for (const id of existingEntryIds) {
      if (!currentEntryIds.has(id)) execute('DELETE FROM knowledge_entries WHERE id = ?', [id])
    }

    for (const e of kb.entries) {
      upsertRow('knowledge_entries', 'id, kb_id, category, title, content, summary, tags, created_at, updated_at, summary_source, summary_history', [
        e.id, kb.id, e.category, e.title, e.content, e.summary || '', JSON.stringify(e.tags), e.createdAt, e.updatedAt,
        e.summarySource ? JSON.stringify(e.summarySource) : null, e.summaryHistory ? JSON.stringify(e.summaryHistory) : null,
      ])
    }
}

export async function deleteKnowledgeBaseFromDb(kbId: string) {
  if (usesProjectKernel()) return deleteKernelKnowledge(kbId)
  await initDb()
  await runTransaction(() => {
    execute('DELETE FROM knowledge_entries WHERE kb_id = ?', [kbId])
    execute("DELETE FROM semantic_index WHERE source_type = 'knowledge' AND source_id NOT IN (SELECT id FROM knowledge_entries)")
    execute('DELETE FROM knowledge_bases WHERE id = ?', [kbId])
  })
}

export function clearKnowledgeRows() {
    execute('DELETE FROM knowledge_entries')
    execute('DELETE FROM knowledge_bases')
}
