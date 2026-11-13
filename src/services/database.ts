import initSqlJs, { Database, SqlJsStatic, SqlValue } from 'sql.js'
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { initializeSchema, assertCurrentSchema, UnsupportedProjectSchemaError } from './databaseSchema'
import { readIndexedDatabase, writeIndexedDatabase, archiveIndexedDatabase, retainIndexedProjectBackup } from './browserDatabaseStorage'

const DB_STORAGE_KEY = 'mojian-v3-sqlite-db'

let SQL: SqlJsStatic | null = null
let db: Database | null = null
let saveQueue: Promise<void> = Promise.resolve()
let initialization: Promise<Database> | null = null
let browserStorageBaseline: string | null = null
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
  constructor(public readonly backupAvailable: boolean, message = '数据库无法通过完整性检查。已停止写入，原文件未被覆盖。') {
    super(message)
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
      if (!bytes) return null
      const candidate = checkedDatabase(new Uint8Array(bytes))
      try { assertCurrentSchema(candidate); return candidate } catch (error) { candidate.close(); throw error }
    }
    const indexed = await readIndexedDatabase()
    const encoded = indexed ? indexed.backup : localStorage.getItem(DB_BACKUP_KEY)
    if (!encoded) return null
    const candidate = checkedDatabase(decodeStored(encoded))
    try { assertCurrentSchema(candidate); return candidate } catch (error) { candidate.close(); throw error }
  } catch { return null }
}

async function initializeDatabase(): Promise<Database> {
  if (!SQL) {
    SQL = await initSqlJs({
      locateFile: () => {
        const nodeProcess = (globalThis as typeof globalThis & {
          process?: { cwd?: () => string; versions?: { node?: string } }
        }).process
        if (nodeProcess?.versions?.node && sqlWasmUrl.startsWith('/')) {
          return (nodeProcess.cwd?.() || '.') + sqlWasmUrl
        }
        if (typeof document === 'undefined' && sqlWasmUrl.startsWith('/')) return '.' + sqlWasmUrl
        return sqlWasmUrl
      },
    })
  }

  let candidate: Database | null = null
  let schemaChanged = false
  try {
    if (hasElectronIPC()) {
      const fileData = await window.electronAPI!.dbRead()
      if (fileData) candidate = checkedDatabase(new Uint8Array(fileData))
    }
    // Desktop and browser use their own V3 stores; neither imports the other.
    if (!candidate) {
      const indexed = hasElectronIPC() ? undefined : await readIndexedDatabase()
      const saved = hasElectronIPC() ? null : indexed ? indexed.main : localStorage.getItem(DB_STORAGE_KEY)
      browserStorageBaseline = saved
      if (saved) {
        candidate = checkedDatabase(decodeStored(saved))
      } else if (!hasElectronIPC() && (indexed?.backup || localStorage.getItem(DB_BACKUP_KEY))) {
        throw new Error('主库缺失，存在备份')
      } else candidate = new SQL.Database()
    }
    schemaChanged = initializeSchema(candidate)
  } catch (cause) {
    candidate?.close()
    const backup = await readBackup()
    const available = !!backup
    backup?.close()
    throw new DatabaseRecoveryError(available, cause instanceof UnsupportedProjectSchemaError ? cause.message : undefined)
  }
  db = candidate
  rowCacheEpoch++
  try {
    if (schemaChanged) await persistDatabase()
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
      if (await readIndexedDatabase()) await archiveIndexedDatabase()
      else {
        const suffix = `${Date.now()}-${crypto.randomUUID()}`
        for (const key of [DB_STORAGE_KEY, DB_BACKUP_KEY]) {
          const value = localStorage.getItem(key)
          if (value) localStorage.setItem(`${key}.recovery-${suffix}`, value)
        }
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
    let encoded = btoa(parts.join(''))
    const publish = () => {
      const previous = localStorage.getItem(DB_STORAGE_KEY)
      if (previous !== browserStorageBaseline) throw new Error('其他浏览器窗口已更新本地项目，已停止覆盖。请保留当前编辑并重新打开项目。')
      if (previous && !preserveBackup && encoded.length < previous.length) {
        // A compacted database frees space before rotating the backup. If the
        // backup cannot be stored, restore the original main blob and fail.
        localStorage.setItem(DB_STORAGE_KEY, encoded)
        try { localStorage.setItem(DB_BACKUP_KEY, previous) }
        catch (error) { localStorage.setItem(DB_STORAGE_KEY, previous); throw error }
      } else {
        if (previous && !preserveBackup) localStorage.setItem(DB_BACKUP_KEY, previous)
        localStorage.setItem(DB_STORAGE_KEY, encoded)
      }
      browserStorageBaseline = encoded
    }
    const publishWithCompaction = () => {
      try { publish() } catch (error) {
        const freePages = db!.exec('PRAGMA freelist_count')[0]?.values[0]?.[0]
        if (!(error instanceof Error) || error.name !== 'QuotaExceededError' || !Number(freePages)) throw error
        // Reclaim unused SQLite pages only; retain every manuscript, history
        // snapshot and ledger row. Never delete browser keys to make room.
        db!.run('VACUUM')
        const compacted = db!.export(), compactParts: string[] = []
        for (let i = 0; i < compacted.length; i += 0x8000) compactParts.push(String.fromCharCode(...compacted.subarray(i, i + 0x8000)))
        encoded = btoa(compactParts.join(''))
        lastTransactionStats.bytes = compacted.byteLength
        publish()
      }
    }
    const persistBrowser = async () => {
      if (await readIndexedDatabase()) await writeIndexedDatabase(encoded, browserStorageBaseline, preserveBackup)
      else {
        try { publishWithCompaction() } catch (error) {
          if (!(error instanceof Error) || error.name !== 'QuotaExceededError') throw error
          await writeIndexedDatabase(encoded, browserStorageBaseline, preserveBackup)
        }
      }
      browserStorageBaseline = encoded
    }
    // The comparison and publication share an origin-wide lock across tabs.
    if (typeof navigator !== 'undefined' && navigator.locks) {
      let publishFailed = false
      let publishError: unknown
      await navigator.locks.request('mojian-local-database-write', async () => {
        try { await persistBrowser() }
        catch (error) { publishFailed = true; publishError = error }
      })
      if (publishFailed) throw publishError
    } else {
      await persistBrowser()
    }
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
    if (await readIndexedDatabase()) await retainIndexedProjectBackup(serialized)
    else {
      try { localStorage.setItem('mojian-v3-before-import', serialized) }
      catch (error) {
        if (!(error instanceof Error) || error.name !== 'QuotaExceededError') throw error
        await retainIndexedProjectBackup(serialized)
      }
    }
  }
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
