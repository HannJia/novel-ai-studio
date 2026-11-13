import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { BROWSER_DATABASE_KEY as key, readIndexedDatabase, writeIndexedDatabase } from './browserDatabaseStorage'
import { retainProjectRestorePoint } from './database'
let memory: Map<string, string>
beforeEach(() => {
  memory = new Map([[key, 'legacy-main'], [key + '.bak', 'legacy-backup']])
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('localStorage', { getItem: (name: string) => memory.get(name) ?? null })
})
afterEach(() => vi.unstubAllGlobals())
it('migrates main and last good backup without deleting legacy data', async () => {
  expect(await readIndexedDatabase()).toBeUndefined()
  await writeIndexedDatabase('new-main', 'legacy-main', false)
  expect(await readIndexedDatabase()).toMatchObject({ main: 'new-main', backup: 'legacy-main' })
  expect(memory.get(key)).toBe('legacy-main')
  expect(memory.get(key + '.bak')).toBe('legacy-backup')
})
it('serializes competing tab writes and refuses the stale writer atomically', async () => {
  await writeIndexedDatabase('a', 'legacy-main', false)
  const outcomes = await Promise.allSettled([writeIndexedDatabase('b', 'a', false), writeIndexedDatabase('c', 'a', false)])
  expect(outcomes.filter(row => row.status === 'fulfilled')).toHaveLength(1)
  const saved = await readIndexedDatabase()
  expect(['b', 'c']).toContain(saved?.main)
  expect(saved?.backup).toBe('a')
})
it('refuses a legacy window change instead of silently loading an older copy', async () => {
  await writeIndexedDatabase('a', 'legacy-main', false)
  memory.set(key, 'other-window')
  await expect(readIndexedDatabase()).rejects.toThrow('其他浏览器窗口')
  await expect(writeIndexedDatabase('b', 'a', false)).rejects.toThrow('其他浏览器窗口')
  memory.set(key, 'legacy-main')
  expect((await readIndexedDatabase())?.main).toBe('a')
})
it('keeps the recovery backup while publishing an explicitly restored main', async () => {
  await writeIndexedDatabase('a', 'legacy-main', false)
  await writeIndexedDatabase('restored', 'a', true)
  expect(await readIndexedDatabase()).toMatchObject({ main: 'restored', backup: 'legacy-main' })
})

it('retains the cloud merge protection snapshot when localStorage quota is exhausted', async () => {
  vi.stubGlobal('window', {})
  memory.set('novel-writer-before-import', 'legacy-protection')
  const setItem = vi.fn(() => { throw new DOMException('full', 'QuotaExceededError') })
  vi.stubGlobal('localStorage', { getItem: (name: string) => memory.get(name) ?? null, setItem })
  await retainProjectRestorePoint('synthetic-project-before-cloud-merge')
  const connection = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('mojian-browser-project-storage', 1)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    const saved = await new Promise((resolve, reject) => {
      const transaction = connection.transaction('database', 'readonly')
      const request = transaction.objectStore('database').get('before-import')
      transaction.oncomplete = () => resolve(request.result)
      transaction.onabort = () => reject(transaction.error)
    })
    expect(saved).toBe('synthetic-project-before-cloud-merge')
    expect(memory.get('novel-writer-before-import')).toBe('legacy-protection')
    expect(memory.get(key)).toBe('legacy-main')
    expect(setItem).toHaveBeenCalledOnce()
  } finally { connection.close() }
})
