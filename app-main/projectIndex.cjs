'use strict'

// Disposable projections only. Callers supply verified authoritative snapshots.
// No path or manuscript is ever resolved from an index row.
const { createHash } = require('node:crypto')
const INDEX_SCHEMA_VERSION = 2
const INDEX_DATA_VERSION = 1
const sha = value => createHash('sha256').update(value).digest('hex')
function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(item => stable(item) ?? 'null').join(',') + ']'
  return '{' + Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}'
}
const collections = {
  candidates: 'candidates', review_findings: 'reviewFindings', chapter_reviews: 'chapterReviews',
  canon_mutations: 'canonMutations', ai_runs: 'aiRuns', story_memories: 'storyMemories', impact_reports: 'impactReports',
}
const novelCollections = { volumes: 'volumes', characters: 'characters', story_events: 'eventLog', story_arcs: 'storyArcs',
  chapter_plans: 'chapterPlans', data_panels: 'dataPanels', data_panel_changes: 'dataPanelChanges',
  chat_messages: 'chatHistory', inspiration_messages: 'inspirationHistory', story_proposals: 'storyStateProposals' }
const rowTables = [...Object.keys(collections), ...Object.keys(novelCollections), 'creation_drafts', 'chapter_revisions']
const columns = {
  chapters: ['id', 'title', 'chapter_index', 'content_filename', 'content_hash', 'archived', 'position', 'data', 'row_version'],
  ...Object.fromEntries(rowTables.map(table => [table, ['id', 'status', 'chapter_id', 'position', 'data', 'row_version']])),
}
const schemas = {
  project_meta: 'CREATE TABLE project_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  chapters: 'CREATE TABLE chapters (id TEXT PRIMARY KEY, title TEXT NOT NULL, chapter_index INTEGER NOT NULL, content_filename TEXT NOT NULL, content_hash TEXT NOT NULL, archived INTEGER NOT NULL, position INTEGER NOT NULL, data TEXT NOT NULL, row_version TEXT NOT NULL)',
  ...Object.fromEntries(rowTables.map(table => [table, 'CREATE TABLE ' + table + ' (id TEXT PRIMARY KEY, status TEXT, chapter_id TEXT, position INTEGER NOT NULL, data TEXT NOT NULL, row_version TEXT NOT NULL)'])),
}
function versioned(cells) { return [...cells, sha(stable([INDEX_DATA_VERSION, ...cells]))] }
function collectionRows(rows) {
  return rows.map((row, position) => versioned([row.id, row.status || null, row.chapterId || null, position, stable(row)]))
}
function createIndexProjection(ref, novel, workspace, revisions = []) {
  if (novel.id !== ref.id || workspace && workspace.novelId !== ref.id || revisions.some(row => row.novelId !== ref.id)) throw new Error('Index source ownership mismatch')
  const chapters = [...novel.chapters.map(row => ({ row, archived: 0 })), ...(novel.archivedChapters || []).map(row => ({ row, archived: 1 }))]
  const tables = { chapters: chapters.map(({ row, archived }, position) => {
    const contentHash = sha(Buffer.from(row.content, 'utf8'))
    // Active text is a project-relative hash file; archived text resides in
    // project.json within the snapshot named by project_meta.snapshot.
    return versioned([row.id, row.title, row.chapterIndex, archived ? 'project.json' : 'chapters/' + contentHash + '.md',
      contentHash, archived, position, stable({ ...row, content: undefined })])
  }) }
  for (const [table, field] of Object.entries(collections)) tables[table] = collectionRows(workspace?.[field] || [])
  for (const [table, field] of Object.entries(novelCollections)) tables[table] = collectionRows(novel[field] || [])
  tables.creation_drafts = collectionRows(workspace?.creationDraft ? [workspace.creationDraft] : [])
  tables.chapter_revisions = collectionRows(revisions)
  for (const rows of Object.values(tables)) {
    if (rows.some(row => typeof row[0] !== 'string' || !row[0]) || new Set(rows.map(row => row[0])).size !== rows.length) throw new Error('Index source IDs are missing or duplicated')
    rows.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
  }
  const excluded = new Set(['chapters', 'archivedChapters', ...Object.values(novelCollections)])
  const metadata = stable(Object.fromEntries(Object.entries(novel).filter(([key]) => !excluded.has(key))))
  // Hash row versions, not another joined copy of every stored manuscript and
  // request payload. Each row version already covers every canonical cell.
  const projectionHash = createHash('sha256').update(metadata)
  for (const table of Object.keys(tables).sort()) projectionHash.update(stable([table, tables[table].map(row => row.at(-1))]))
  const meta = { id: ref.id, title: novel.title, snapshot: ref.snapshot, schema_version: String(INDEX_SCHEMA_VERSION),
    source_format_version: '2', data_version: String(INDEX_DATA_VERSION), metadata, projection_hash: projectionHash.digest('hex') }
  return { meta, tables }
}
function rows(db, query) { return db.exec(query)[0]?.values || [] }
function assertIndex(db, projection) {
  if (stable(rows(db, 'PRAGMA integrity_check')) !== '[["ok"]]') throw new Error('Index integrity check failed')
  if (rows(db, 'PRAGMA user_version')[0]?.[0] !== INDEX_SCHEMA_VERSION) throw new Error('Index schema version mismatch')
  // Only SQLite's implicit primary-key indexes may accompany these tables.
  const actualSchema = rows(db, "SELECT name, sql FROM sqlite_master WHERE type IN ('table','view','trigger','index') AND sql IS NOT NULL ORDER BY name")
  if (actualSchema.length !== Object.keys(schemas).length || actualSchema.some(([name, sql]) => schemas[name] !== sql)) throw new Error('Index schema mismatch')
  const meta = Object.fromEntries(rows(db, 'SELECT key, value FROM project_meta'))
  if (meta.id !== projection.meta.id || meta.snapshot !== projection.meta.snapshot) throw new Error('Index snapshot mismatch')
  if (stable(meta) !== stable(projection.meta)) throw new Error('Index metadata mismatch')
  for (const [table, fields] of Object.entries(columns)) {
    const actual = rows(db, 'SELECT ' + fields.join(',') + ' FROM ' + table)
    actual.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
    // A valid SQLite file can contain forged data/hashes. Compare all cells to
    // the source projection before using it as an incremental-update baseline.
    const expected = projection.tables[table]
    if (actual.length !== expected.length || actual.some((row, index) => row.length !== expected[index].length
      || row.some((cell, column) => cell !== expected[index][column]))) throw new Error('Index row mismatch: ' + table)
  }
}
function openProjectIndex(SQL, data, projection) {
  if (!data) return { db: null, state: 'missing', reason: '尚未建立索引' }
  let db
  try {
    db = new SQL.Database(data)
    const schemaVersion = rows(db, 'PRAGMA user_version')[0]?.[0]
    if (schemaVersion !== INDEX_SCHEMA_VERSION) { db.close(); return { db: null, state: 'stale', reason: '索引格式需要更新' } }
    const meta = Object.fromEntries(rows(db, 'SELECT key, value FROM project_meta'))
    if (meta.data_version !== projection.meta.data_version || meta.source_format_version !== projection.meta.source_format_version) {
      db.close(); return { db: null, state: 'stale', reason: '索引数据格式需要更新' }
    }
    if (meta.snapshot !== projection.meta.snapshot) { db.close(); return { db: null, state: 'stale', reason: '索引与当前正式版本不一致' } }
    assertIndex(db, projection)
    return { db, state: 'ready', reason: '索引与当前正式版本一致' }
  } catch {
    try { db?.close() } catch { /* A damaged cache is never authoritative. */ }
    return { db: null, state: 'corrupt', reason: '索引校验未通过，可从正式内容重建' }
  }
}
function updateProjectIndex(SQL, data, projection, previous, force = false) {
  const opened = !force && previous ? openProjectIndex(SQL, data, previous) : { db: null }
  const db = opened.db || new SQL.Database(), rebuilt = !opened.db
  const stats = { mode: rebuilt ? 'rebuilt' : 'incremental', inserted: 0, updated: 0, deleted: 0, unchanged: 0, metadataUpdated: 0 }
  try {
    db.run('BEGIN')
    if (rebuilt) {
      for (const schema of Object.values(schemas)) db.run(schema)
      db.run('PRAGMA user_version = ' + INDEX_SCHEMA_VERSION)
    }
    for (const [table, fields] of Object.entries(columns)) {
      const old = new Map((rebuilt ? [] : previous.tables[table]).map(row => [row[0], row]))
      const next = new Map(projection.tables[table].map(row => [row[0], row]))
      for (const id of old.keys()) if (!next.has(id)) { db.run('DELETE FROM ' + table + ' WHERE id = ?', [id]); stats.deleted++ }
      for (const [id, row] of next) {
        if (old.get(id)?.at(-1) === row.at(-1)) { stats.unchanged++; continue }
        if (old.has(id)) {
          db.run('UPDATE ' + table + ' SET ' + fields.slice(1).map(field => field + ' = ?').join(',') + ' WHERE id = ?', [...row.slice(1), id])
          stats.updated++
        } else { db.run('INSERT INTO ' + table + ' (' + fields.join(',') + ') VALUES (' + fields.map(() => '?').join(',') + ')', row); stats.inserted++ }
      }
    }
    for (const [key, value] of Object.entries(projection.meta)) if (rebuilt || previous.meta[key] !== value) {
      db.run('INSERT OR REPLACE INTO project_meta(key,value) VALUES(?,?)', [key, value]); stats.metadataUpdated++
    }
    db.run('COMMIT')
    assertIndex(db, projection)
    return { data: Buffer.from(db.export()), stats }
  } finally { db.close() }
}

module.exports = { INDEX_SCHEMA_VERSION, INDEX_DATA_VERSION, createIndexProjection, openProjectIndex, updateProjectIndex }
