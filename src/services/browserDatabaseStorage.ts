const DATABASE_NAME = 'mojian-browser-project-storage'
const STORE_NAME = 'database'
const SNAPSHOT_KEY = 'current'
export const BROWSER_DATABASE_KEY = 'novel-writer-sqlite-db'
const stale = () => new Error('其他浏览器窗口已更新本地项目，已停止覆盖。请保留当前编辑并重新打开项目。')

interface Snapshot {
  main: string | null
  backup: string | null
  localBaseline: string | null
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('浏览器项目存储正被其他窗口占用，请关闭旧窗口后重试。'))
  })
}

function checked(value: unknown): Snapshot | undefined {
  if (value === undefined) return undefined
  const row = value as Snapshot
  const fields: (keyof Snapshot)[] = ['main', 'backup', 'localBaseline']
  if (!row || !fields.every(key => row[key] === null || typeof row[key] === 'string')) {
    throw new Error('浏览器项目存储格式损坏，已停止覆盖。')
  }
  if (localStorage.getItem(BROWSER_DATABASE_KEY) !== row.localBaseline) throw stale()
  return row
}

/** An existing IndexedDB snapshot is authoritative; never silently fall back on a failed read. */
export async function readIndexedDatabase(): Promise<Snapshot | undefined> {
  if (typeof indexedDB === 'undefined') return undefined
  const connection = await open()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = connection.transaction(STORE_NAME, 'readonly')
      const request = transaction.objectStore(STORE_NAME).get(SNAPSHOT_KEY)
      transaction.oncomplete = () => {
        try { resolve(checked(request.result)) }
        catch (error) { reject(error) }
      }
      transaction.onabort = () => reject(transaction.error || new Error('读取浏览器项目存储失败。'))
    })
  } finally {
    connection.close()
  }
}

/** Main, backup and CAS are committed together, including the first quota migration. */
export async function writeIndexedDatabase(main: string, expected: string | null, preserveBackup: boolean): Promise<void> {
  if (typeof indexedDB === 'undefined') throw new DOMException('浏览器本地存储空间不足。', 'QuotaExceededError')
  const connection = await open()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = connection.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.get(SNAPSHOT_KEY)
      let failure: unknown
      request.onsuccess = () => {
        try {
          const saved = checked(request.result)
          const previous = saved ? saved.main : localStorage.getItem(BROWSER_DATABASE_KEY)
          if (previous !== expected) throw stale()
          const backup = saved ? saved.backup : localStorage.getItem(BROWSER_DATABASE_KEY + '.bak')
          store.put({
            main,
            backup: preserveBackup ? backup : previous || backup,
            localBaseline: saved?.localBaseline ?? localStorage.getItem(BROWSER_DATABASE_KEY),
          } satisfies Snapshot, SNAPSHOT_KEY)
        } catch (error) {
          failure = error
          transaction.abort()
        }
      }
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(failure || transaction.error || new Error('保存浏览器项目存储失败。'))
    })
  } finally {
    connection.close()
  }
}

/** Keep corrupt originals available before an explicit recovery replaces them. */
export async function archiveIndexedDatabase(): Promise<void> {
  const connection = await open()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = connection.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.get(SNAPSHOT_KEY)
      request.onsuccess = () => {
        if (request.result) store.put(request.result, 'recovery:' + crypto.randomUUID())
      }
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    connection.close()
  }
}

/** Save the pre-import project before cloud merge or project replacement. */
export async function retainIndexedProjectBackup(serialized: string): Promise<void> {
  if (typeof indexedDB === 'undefined') throw new DOMException('浏览器本地存储空间不足。', 'QuotaExceededError')
  const connection = await open()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = connection.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).put(serialized, 'before-import')
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error || new Error('保存合并前保护备份失败。'))
    })
  } finally {
    connection.close()
  }
}
