import initSqlJs, { Database, SqlJsStatic, SqlValue } from 'sql.js'
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url'

const DB_STORAGE_KEY = 'novel-writer-sqlite-db'

let SQL: SqlJsStatic | null = null
let db: Database | null = null
let saveQueue: Promise<void> = Promise.resolve()
let initialization: Promise<Database> | null = null
const DB_BACKUP_KEY = `${DB_STORAGE_KEY}.bak`
let transactionRows = 0
let lastTransactionStats = { rowsWritten: 0, sqlMs: 0, persistMs: 0, bytes: 0 }
export function getLastTransactionStats() { return { ...lastTransactionStats } }
let rowCacheEpoch = 0
export function getRowCacheEpoch() { return rowCacheEpoch }

// 检测是否在 Electron 环境中（有 IPC 可用）
function hasElectronIPC(): boolean {
  return !!window.electronAPI?.dbRead
}

// 初始化数据库
export async function initDb(): Promise<Database> {
  if (initialization) return initialization
  if (db) return db
  initialization = initializeDatabase().finally(() => { initialization = null })
  return initialization
}

export class DatabaseRecoveryError extends Error {
  constructor(public readonly backupAvailable: boolean) {
    super('数据库无法通过完整性检查。已停止写入，原文件未被覆盖。')
    this.name = 'DatabaseRecoveryError'
  }
}

function decodeStored(value: string): Uint8Array {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0))
}

function checkedDatabase(data: Uint8Array): Database {
  const candidate = new SQL!.Database(data)
  try {
    const check = candidate.exec('PRAGMA integrity_check')
    if (check.length !== 1 || check[0].values.length !== 1 || check[0].values[0][0] !== 'ok') throw new Error('完整性检查失败')
    return candidate
  } catch (error) { candidate.close(); throw error }
}

async function readBackup(): Promise<Database | null> {
  try {
    if (hasElectronIPC()) {
      const bytes = await window.electronAPI?.dbReadBackup?.()
      return bytes ? checkedDatabase(new Uint8Array(bytes)) : null
    }
    const encoded = localStorage.getItem(DB_BACKUP_KEY)
    return encoded ? checkedDatabase(decodeStored(encoded)) : null
  } catch { return null }
}

async function initializeDatabase(): Promise<Database> {
  if (!SQL) {
    SQL = await initSqlJs({
      locateFile: () => typeof document === 'undefined' && sqlWasmUrl.startsWith('/')
        ? `.${sqlWasmUrl}`
        : sqlWasmUrl,
    })
  }

  let candidate: Database | null = null
  let migrating = false
  let schemaChanged = false
  try {
    if (hasElectronIPC()) {
      const fileData = await window.electronAPI!.dbRead()
      if (fileData) candidate = checkedDatabase(new Uint8Array(fileData))
    }
    // Migration is allowed only for an absent file, never for a failed read.
    if (!candidate) {
      const saved = localStorage.getItem(DB_STORAGE_KEY)
      if (saved) {
        candidate = checkedDatabase(decodeStored(saved))
        migrating = hasElectronIPC()
      } else if (!hasElectronIPC() && localStorage.getItem(DB_BACKUP_KEY)) {
        throw new Error('主库缺失，存在备份')
      } else candidate = new SQL.Database()
    }
    schemaChanged = initializeSchema(candidate)
  } catch {
    candidate?.close()
    const backup = await readBackup()
    const available = !!backup
    backup?.close()
    throw new DatabaseRecoveryError(available)
  }
  db = candidate
  rowCacheEpoch++
  try {
    if (schemaChanged || migrating) await persistDatabase()
    if (migrating) {
      localStorage.removeItem(DB_STORAGE_KEY)
    }
  } catch (error) {
    db = null
    candidate.close()
    throw error
  }
  return candidate
}

export async function recoverDatabase(mode: 'backup' | 'empty'): Promise<void> {
  if (!SQL || db || initialization) throw new Error('当前不在数据库恢复状态')
  const candidate = mode === 'backup' ? await readBackup() : new SQL.Database()
  if (!candidate) throw new Error('没有通过完整性检查的备份')
  try {
    if (hasElectronIPC()) {
      if (!window.electronAPI?.dbPrepareRecovery) throw new Error('当前桌面版本不支持安全恢复，请更新后重试')
      await window.electronAPI.dbPrepareRecovery()
    } else {
      // Preserve both original blobs. If storage is full, fail instead of losing
      // either source; the user can export/copy browser data before recovery.
      const suffix = `${Date.now()}-${crypto.randomUUID()}`
      for (const key of [DB_STORAGE_KEY, DB_BACKUP_KEY]) {
        const value = localStorage.getItem(key)
        if (value) localStorage.setItem(`${key}.recovery-${suffix}`, value)
      }
    }
    initializeSchema(candidate)
    db = candidate
    rowCacheEpoch++
    await persistDatabase(true)
  } catch (error) {
    db = null
    candidate.close()
    throw error
  }
}

async function persistDatabase(preserveBackup = false): Promise<void> {
  if (!db) return
  const data = db.export()
  lastTransactionStats.bytes = data.byteLength
  if (hasElectronIPC()) {
    await window.electronAPI!.dbWrite(data.buffer as ArrayBuffer)
  } else {
    const parts: string[] = []
    for (let i = 0; i < data.length; i += 0x8000) parts.push(String.fromCharCode(...data.subarray(i, i + 0x8000)))
    const encoded = btoa(parts.join(''))
    const previous = localStorage.getItem(DB_STORAGE_KEY)
    if (previous && !preserveBackup) localStorage.setItem(DB_BACKUP_KEY, previous)
    localStorage.setItem(DB_STORAGE_KEY, encoded)
  }
}

function enqueueWrite(write: () => Promise<void>): Promise<void> {
  const next = saveQueue.then(write)
  saveQueue = next.catch(() => undefined)
  return next
}

export async function retainProjectRestorePoint(serialized: string): Promise<void> {
  if (hasElectronIPC()) {
    if (!window.electronAPI?.dbRetainProjectBackup) throw new Error('请更新桌面程序后再使用安全导入')
    await window.electronAPI.dbRetainProjectBackup(serialized)
  } else {
    localStorage.setItem('novel-writer-before-import', serialized)
  }
}

// 初始化表结构
function initializeSchema(database: Database) {
  const versionBefore = database.exec('PRAGMA schema_version')[0]?.values[0][0]
  const schema = `
    -- 小说主表
    CREATE TABLE IF NOT EXISTS novels (
      id TEXT PRIMARY KEY,
      title TEXT,
      genre TEXT, sub_genre TEXT,
      genre_label TEXT, sub_genre_label TEXT,
      tags TEXT,           -- JSON 数组
      target_min INTEGER, target_max INTEGER,
      current_word_count INTEGER DEFAULT 0,
      writing_style TEXT,  -- JSON
      settings TEXT,       -- JSON
      outline TEXT,
      synopsis TEXT,
      knowledge_base_ids TEXT, -- JSON 数组
      chapter_plans TEXT DEFAULT '[]', -- next / near / far 章节计划
      chapter_plan_confirmed INTEGER DEFAULT 0,
      story_state_proposals TEXT DEFAULT '[]', -- 待审批的故事状态变更
      status TEXT DEFAULT 'creating',
      created_at TEXT, updated_at TEXT
    );

    -- 分卷表
    CREATE TABLE IF NOT EXISTS volumes (
      id TEXT PRIMARY KEY,
      novel_id TEXT REFERENCES novels(id) ON DELETE CASCADE,
      volume_index INTEGER,
      title TEXT, theme TEXT, summary TEXT,
      key_turning_points TEXT, character_changes TEXT,
      estimated_chapters INTEGER, estimated_word_count INTEGER,
      versions TEXT DEFAULT '[]'
    );

    -- 章节表
    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY,
      novel_id TEXT REFERENCES novels(id) ON DELETE CASCADE,
      volume_index INTEGER, chapter_index INTEGER,
      title TEXT, content TEXT, summary TEXT,
      banned_review TEXT DEFAULT '', content_review TEXT DEFAULT '',
      content_review_signature TEXT DEFAULT '',
      scene_notes TEXT DEFAULT '[]',
      versions TEXT DEFAULT '[]',
      word_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'draft',
      created_at TEXT, updated_at TEXT
    );

    -- AI or user-proposed chapter changes. Proposals are applied only after approval.
    CREATE TABLE IF NOT EXISTS chapter_revisions (
      id TEXT PRIMARY KEY,
      novel_id TEXT REFERENCES novels(id) ON DELETE CASCADE,
      chapter_id TEXT REFERENCES chapters(id) ON DELETE CASCADE,
      base_content TEXT NOT NULL,
      proposed_content TEXT NOT NULL,
      diff TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'user',
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      applied_at TEXT
    );

    -- 角色表
    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      novel_id TEXT REFERENCES novels(id) ON DELETE CASCADE,
      name TEXT, aliases TEXT,
      identity TEXT, personality TEXT,
      power_level TEXT, faction TEXT,
      status TEXT DEFAULT '活跃',
      first_appear_chapter INTEGER,
      description TEXT, relationships TEXT, -- JSON
      events TEXT, avatar_color TEXT      -- JSON
    );

    -- 剧情时间线事件
    CREATE TABLE IF NOT EXISTS story_events (
      id TEXT PRIMARY KEY,
      novel_id TEXT REFERENCES novels(id) ON DELETE CASCADE,
      chapter_index INTEGER,
      category TEXT,        -- main_plot/sub_plot/foreshadowing/turning_point/battle/other
      scope TEXT DEFAULT 'chapter', -- global/volume/chapter
      title TEXT,
      description TEXT,
      characters TEXT,      -- JSON 数组
      status TEXT,          -- planted/developing/resolved/abandoned
      hint_count INTEGER DEFAULT 0,
      story_time TEXT DEFAULT '',
      location TEXT DEFAULT '',
      target_chapter INTEGER,
      importance INTEGER DEFAULT 3,
      source TEXT DEFAULT 'user',
      created_at TEXT,
      updated_at TEXT
    );

    -- 跨章节叙事弧线；节点以 JSON 保存，随弧线一起原子更新。
    CREATE TABLE IF NOT EXISTS story_arcs (
      id TEXT PRIMARY KEY,
      novel_id TEXT REFERENCES novels(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      arc_type TEXT NOT NULL DEFAULT 'sub',
      importance INTEGER NOT NULL DEFAULT 3,
      status TEXT NOT NULL DEFAULT 'active',
      reactivate_at TEXT DEFAULT '',
      character_ids TEXT DEFAULT '[]',
      nodes TEXT DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 数据面板对象表
    CREATE TABLE IF NOT EXISTS data_panels (
      id TEXT PRIMARY KEY,
      novel_id TEXT REFERENCES novels(id) ON DELETE CASCADE,
      category TEXT,
      name TEXT,
      fields TEXT,
      related_keywords TEXT,
      last_mention_chapter_index INTEGER,
      created_at TEXT,
      updated_at TEXT
    );

    -- 数据面板变更建议表
    CREATE TABLE IF NOT EXISTS data_panel_changes (
      id TEXT PRIMARY KEY,
      novel_id TEXT REFERENCES novels(id) ON DELETE CASCADE,
      item_id TEXT,
      field_id TEXT,
      item_name TEXT,
      field_name TEXT,
      old_value TEXT,
      new_value TEXT,
      reason TEXT,
      confidence TEXT DEFAULT 'clear',
      chapter_index INTEGER,
      status TEXT,
      created_at TEXT
    );

    -- AI 对话历史表
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      novel_id TEXT REFERENCES novels(id) ON DELETE CASCADE,
      role TEXT, content TEXT,
      timestamp TEXT
    );

    -- 知识库表
    CREATE TABLE IF NOT EXISTS knowledge_bases (
      id TEXT PRIMARY KEY,
      name TEXT,
      description TEXT,
      created_at TEXT
    );

    -- 知识库条目表
    CREATE TABLE IF NOT EXISTS knowledge_entries (
      id TEXT PRIMARY KEY,
      kb_id TEXT REFERENCES knowledge_bases(id) ON DELETE CASCADE,
      category TEXT,
      title TEXT,
      content TEXT,
      summary TEXT DEFAULT '',
      tags TEXT, -- JSON
      created_at TEXT,
      updated_at TEXT
    );

    -- 语义记忆索引：知识库、章节摘要、角色、事件、数据面板统一召回
    CREATE TABLE IF NOT EXISTS semantic_index (
      id TEXT PRIMARY KEY,
      novel_id TEXT,
      source_type TEXT,
      source_id TEXT,
      title TEXT,
      content TEXT,
      embedding TEXT,
      metadata TEXT,
      updated_at TEXT
    );

    -- AI 后台任务记录：用于批量任务、失败排查和重启后的任务状态保留
    CREATE TABLE IF NOT EXISTS ai_tasks (
      id TEXT PRIMARY KEY,
      name TEXT,
      group_name TEXT,
      status TEXT,
      error TEXT,
      created_at TEXT,
      updated_at TEXT,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_novels_updated_at ON novels(updated_at);
    CREATE INDEX IF NOT EXISTS idx_chapters_novel_index ON chapters(novel_id, chapter_index);
    CREATE INDEX IF NOT EXISTS idx_story_events_novel_category_status ON story_events(novel_id, category, status);
    CREATE INDEX IF NOT EXISTS idx_story_arcs_novel_status ON story_arcs(novel_id, status, importance);
    CREATE INDEX IF NOT EXISTS idx_knowledge_entries_kb_category ON knowledge_entries(kb_id, category);
    CREATE INDEX IF NOT EXISTS idx_data_panel_changes_novel_status_chapter ON data_panel_changes(novel_id, status, chapter_index);
    CREATE INDEX IF NOT EXISTS idx_semantic_index_novel_source ON semantic_index(novel_id, source_type);
    CREATE INDEX IF NOT EXISTS idx_ai_tasks_status_created ON ai_tasks(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_chapter_revisions_chapter_status ON chapter_revisions(chapter_id, status, created_at);
  `

  database.exec(schema)
  // Existing local databases predate planning version snapshots.
  try { database.run("ALTER TABLE novels ADD COLUMN writing_mode TEXT") } catch { /* already migrated */ }
  try { database.run("ALTER TABLE novels ADD COLUMN chat_web_search INTEGER DEFAULT 0") } catch { /* already migrated */ }
  try { database.run("ALTER TABLE novels ADD COLUMN chapter_plan_confirmed INTEGER DEFAULT 0") } catch { /* already migrated */ }
  try { database.run("ALTER TABLE chat_messages ADD COLUMN search_record TEXT") } catch { /* already migrated */ }
  try { database.run("ALTER TABLE chat_messages ADD COLUMN failed INTEGER DEFAULT 0") } catch { /* already migrated */ }
  try { database.run("ALTER TABLE volumes ADD COLUMN versions TEXT DEFAULT '[]'") } catch { /* already migrated */ }
  try { database.run("ALTER TABLE chapters ADD COLUMN scene_notes TEXT DEFAULT '[]'") } catch { /* already migrated */ }
  try { database.run("ALTER TABLE chapters ADD COLUMN versions TEXT DEFAULT '[]'") } catch { /* already migrated */ }
  try { database.run("ALTER TABLE data_panels ADD COLUMN versions TEXT DEFAULT '[]'") } catch { /* already migrated */ }
  // One-time separation of explicitly tagged inspiration messages in existing
  // test books. Move complete records atomically; never infer from message text.
  const novelColumns = database.exec('PRAGMA table_info(novels)')[0].values
  if (!novelColumns.some(column => column[1] === 'inspiration_history')) {
    database.run('BEGIN')
    try {
      database.run("ALTER TABLE novels ADD COLUMN inspiration_history TEXT NOT NULL DEFAULT '[]'")
      const rows = database.exec('SELECT id, novel_id, role, content, timestamp, search_record, failed FROM chat_messages ORDER BY timestamp ASC, rowid ASC')[0]?.values || []
      const archives = new Map<string, import('@/types/novel').DialogueMessage[]>()
      for (const [id, novelId, role, content, timestamp, search, failed] of rows) {
        const prefix = `inspiration-${novelId}-`
        if (typeof id !== 'string' || !id.startsWith(prefix) || !/^\d+$/.test(id.slice(prefix.length))) continue
        const messages = archives.get(String(novelId)) || []
        messages.push({ id, role: role as 'user' | 'assistant', content: String(content), timestamp: String(timestamp),
          search: search ? JSON.parse(String(search)) : undefined, failed: failed === 1 })
        archives.set(String(novelId), messages)
      }
      for (const [novelId, messages] of archives) {
        database.run('UPDATE novels SET inspiration_history = ? WHERE id = ?', [JSON.stringify(messages), novelId])
        if (database.getRowsModified() !== 1) continue
        for (const message of messages) database.run('DELETE FROM chat_messages WHERE id = ? AND novel_id = ?', [message.id, novelId])
      }
      database.run('COMMIT')
    } catch (error) { database.run('ROLLBACK'); throw error }
  }
  return database.exec('PRAGMA schema_version')[0]?.values[0][0] !== versionBefore
}

// 辅助函数：执行查询并返回 JSON 数组
export function queryAll<T>(sql: string, params?: SqlValue[]): T[] {
  if (!db) throw new Error('Database not initialized')
  
  const stmt = db.prepare(sql)
  if (params) {
    stmt.bind(params)
  }
  
  const results: T[] = []
  while (stmt.step()) {
    results.push(stmt.getAsObject() as unknown as T)
  }
  
  stmt.free()
  return results
}

// 辅助函数：执行写操作（注意：不再自动保存，需要调用者手动调用 saveDb() 或者使用 runTransaction）
export function execute(sql: string, params?: SqlValue[]): void {
  if (!db) throw new Error('Database not initialized')
  const safeParams = params ? params.map(p => p === undefined ? null : p) : undefined
  if (/^\s*(?:DELETE|UPDATE|REPLACE|INSERT\s+OR\s+REPLACE|DROP|ALTER)\b/i.test(sql)) rowCacheEpoch++
  db.run(sql, safeParams)
  transactionRows += db.getRowsModified()
}

// 事务包装器
export async function runTransaction(callback: () => void, options: { restoreOnWriteFailure?: boolean } = {}): Promise<void> {
  if (!db) throw new Error('Database not initialized')
  await enqueueWrite(async () => {
    transactionRows = 0
    const sqlStarted = performance.now()
    const before = options.restoreOnWriteFailure ? db!.export() : null
    try {
      db!.run('BEGIN TRANSACTION;')
      callback()
      db!.run('COMMIT;')
    } catch (error) {
      rowCacheEpoch++
      try { db!.run('ROLLBACK;') } catch { /* A failed COMMIT can close the transaction. */ }
      throw error
    }
    const persistStarted = performance.now()
    lastTransactionStats = { rowsWritten: transactionRows, sqlMs: persistStarted - sqlStarted, persistMs: 0, bytes: 0 }
    try { await persistDatabase(); lastTransactionStats.persistMs = performance.now() - persistStarted }
    catch (error) {
      rowCacheEpoch++
      if (before) {
        db!.close()
        db = new SQL!.Database(before)
      }
      throw error
    }
  })
}
