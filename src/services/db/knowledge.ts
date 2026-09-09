import { queryAll, execute, initDb, runTransaction } from '../database'
import type { KnowledgeBase } from '@/stores/knowledge'
import { upsertRow } from './upsert'

export async function loadAllKnowledgeBasesFromDb(): Promise<KnowledgeBase[]> {
  await initDb()
  const kbsRow = queryAll<any>('SELECT * FROM knowledge_bases ORDER BY created_at DESC')
  const knowledgeBases: KnowledgeBase[] = kbsRow.map(row => ({
    id: row.id,
    name: row.name,
    description: row.description,
    summary: row.summary || '',
    summaryLevel: row.summary_level || 'standard',
    summaryUpdatedAt: row.summary_updated_at || '',
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
      tags: JSON.parse(r.tags || '[]'),
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }))
  }

  return knowledgeBases
}

export async function saveKnowledgeBaseToDb(kb: KnowledgeBase) {
  await initDb()
  await runTransaction(() => writeKnowledgeBaseRows(kb))
}

export function writeKnowledgeBaseRows(kb: KnowledgeBase) {
    upsertRow('knowledge_bases', 'id, name, description, summary, summary_level, summary_updated_at, created_at', [
      kb.id, kb.name, kb.description, kb.summary || '', kb.summaryLevel || 'standard', kb.summaryUpdatedAt || '', kb.createdAt,
    ])

    const existingEntryIds = queryAll<{ id: string }>('SELECT id FROM knowledge_entries WHERE kb_id = ?', [kb.id]).map(r => r.id)
    const currentEntryIds = new Set(kb.entries.map(e => e.id))
    for (const id of existingEntryIds) {
      if (!currentEntryIds.has(id)) execute('DELETE FROM knowledge_entries WHERE id = ?', [id])
    }

    for (const e of kb.entries) {
      upsertRow('knowledge_entries', 'id, kb_id, category, title, content, summary, tags, created_at, updated_at', [e.id, kb.id, e.category, e.title, e.content, e.summary || '', JSON.stringify(e.tags), e.createdAt, e.updatedAt])
    }
}

export async function deleteKnowledgeBaseFromDb(kbId: string) {
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
