import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

const memory = new Map<string, string>()
beforeEach(() => {
  vi.resetModules()
  memory.clear()
  vi.stubGlobal('indexedDB', undefined)
  vi.stubGlobal('window', {})
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
    removeItem: (key: string) => memory.delete(key),
  })
})
const key = 'mojian-v3-sqlite-db'

describe('database recovery without destructive fallback', () => {
  it('recovers an IndexedDB database from its backup without falling back to stale localStorage', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    let database = await import('./database'); await database.initDb()
    await database.runTransaction(() => database.execute("INSERT INTO novels(id,title) VALUES ('kept','最新正文')"))
    const current = memory.get(key)!
    const storage = await import('./browserDatabaseStorage')
    await storage.writeIndexedDatabase(btoa('damaged-indexed-main'), current, false)
    vi.resetModules(); database = await import('./database')
    await expect(database.initDb()).rejects.toMatchObject({ name: 'DatabaseRecoveryError', backupAvailable: true })
    await database.recoverDatabase('backup')
    expect(database.queryAll('SELECT title FROM novels')).toEqual([{ title: '最新正文' }])
    vi.resetModules(); database = await import('./database'); await database.initDb()
    expect(database.queryAll('SELECT title FROM novels')).toEqual([{ title: '最新正文' }])
  })

  it('saves and reopens through IndexedDB when localStorage is full, retaining the original blobs', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    let database = await import('./database'); await database.initDb()
    await database.runTransaction(() => database.execute("INSERT INTO novels(id,title) VALUES ('kept','原稿')"))
    const primary = memory.get(key), backup = memory.get(key + '.bak')
    localStorage.setItem = () => { throw new DOMException('quota', 'QuotaExceededError') }
    await database.runTransaction(() => database.execute("UPDATE novels SET title = '迁移后正文'"), { restoreOnWriteFailure: true })
    expect(memory.get(key)).toBe(primary); expect(memory.get(key + '.bak')).toBe(backup)
    vi.resetModules(); database = await import('./database'); await database.initDb()
    expect(database.queryAll('SELECT title FROM novels')).toEqual([{ title: '迁移后正文' }])
    await database.runTransaction(() => database.execute("UPDATE novels SET title = '继续保存'"), { restoreOnWriteFailure: true })
    vi.resetModules(); database = await import('./database'); await database.initDb()
    expect(database.queryAll('SELECT title FROM novels')).toEqual([{ title: '继续保存' }])
  })

  it('reclaims unused SQLite pages on quota failure while retaining the previous database as backup', async () => {
    const database = await import('./database')
    await database.initDb()
    await database.runTransaction(() => {
      database.execute("INSERT INTO novels(id,title) VALUES ('kept','重要正文')")
      database.execute('CREATE TABLE compaction_fixture(value TEXT)')
      database.execute('INSERT INTO compaction_fixture(value) VALUES (?)', ['x'.repeat(500000)])
    })
    const original = memory.get(key)!
    const quota = [...memory.values()].reduce((sum, value) => sum + value.length, 0) + 16384
    let quotaFailures = 0
    localStorage.setItem = (name: string, value: string) => {
      const total = [...memory.entries()].reduce((sum, [item, text]) => sum + (item === name ? 0 : text.length), 0) + value.length
      if (total > quota) { quotaFailures++; throw new DOMException('quota', 'QuotaExceededError') }
      memory.set(name, value)
    }
    await database.runTransaction(() => database.execute('DELETE FROM compaction_fixture'), { restoreOnWriteFailure: true })
    expect(quotaFailures).toBeGreaterThan(0)
    expect(memory.get(key)!.length).toBeLessThan(original.length / 2)
    expect(memory.get(key + '.bak')).toBe(original)
    expect(database.queryAll('SELECT title FROM novels')).toEqual([{ title: '重要正文' }])
    vi.resetModules()
    const reopened = await import('./database'); await reopened.initDb()
    expect(reopened.queryAll('SELECT title FROM novels')).toEqual([{ title: '重要正文' }])
  })

  it('retains durable and in-memory data when quota remains exhausted without free pages', async () => {
    const database = await import('./database'); await database.initDb()
    await database.runTransaction(() => database.execute("INSERT INTO novels(id,title) VALUES ('kept','原稿')"))
    const original = memory.get(key)
    localStorage.setItem = () => { throw new DOMException('quota', 'QuotaExceededError') }
    await expect(database.runTransaction(() => database.execute("UPDATE novels SET title = '未保存稿'"), { restoreOnWriteFailure: true })).rejects.toMatchObject({ name: 'QuotaExceededError' })
    expect(memory.get(key)).toBe(original)
    expect(database.queryAll('SELECT title FROM novels')).toEqual([{ title: '原稿' }])
  })

  it('serializes simultaneous initialization and retains corrupt browser data until explicit recovery', async () => {
    let database = await import('./database')
    const [a, b] = await Promise.all([database.initDb(), database.initDb()])
    expect(a).toBe(b)
    await database.runTransaction(() => database.execute("INSERT INTO novels (id, title) VALUES ('saved', '恢复前书稿')"))
    const valid = memory.get(key)!
    memory.set(`${key}.bak`, valid)
    memory.set(key, btoa('damaged-original'))
    vi.resetModules()
    database = await import('./database')
    const error = await database.initDb().catch(error => error)
    expect(error.backupAvailable).toBe(true)
    expect(memory.get(key)).toBe(btoa('damaged-original'))
    await database.recoverDatabase('backup')
    expect(database.queryAll<{ title: string }>('SELECT title FROM novels')[0].title).toBe('恢复前书稿')
    expect([...memory.entries()].some(([name, value]) => name.includes('.recovery-') && value === btoa('damaged-original'))).toBe(true)
  })

  it('does not fall back to browser storage or write anything after a desktop read failure', async () => {
    const write = vi.fn()
    vi.stubGlobal('window', { electronAPI: { dbRead: vi.fn().mockRejectedValue(new Error('磁盘读取失败')), dbWrite: write, dbReadBackup: vi.fn().mockResolvedValue(null) } })
    memory.set(key, 'stale-browser-data')
    const database = await import('./database')
    await expect(database.initDb()).rejects.toMatchObject({ name: 'DatabaseRecoveryError', backupAvailable: false })
    expect(write).not.toHaveBeenCalled()
    expect(memory.get(key)).toBe('stale-browser-data')
  })

  it('does not rotate a healthy backup merely by opening an up-to-date database', async () => {
    let database = await import('./database')
    await database.initDb()
    await database.runTransaction(() => database.execute("INSERT INTO novels(id,title) VALUES ('a','已保存书稿')"))
    const primary = memory.get(key)!
    const backup = memory.get(`${key}.bak`)!
    vi.resetModules()
    database = await import('./database')
    await database.initDb()
    expect(memory.get(key)).toBe(primary)
    expect(memory.get(`${key}.bak`)).toBe(backup)
  })

  it('rejects an internally corrupt SQLite file even if its header is valid', async () => {
    let database = await import('./database')
    await database.initDb()
    await database.runTransaction(() => database.execute("INSERT INTO novels(id,title) VALUES ('a','重要书稿')"))
    const bytes = Uint8Array.from(atob(memory.get(key)!), value => value.charCodeAt(0))
    bytes[100] = 0xff // B-tree header, not the SQLite file magic.
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    const damaged = btoa(binary)
    memory.set(key, damaged)
    vi.resetModules()
    database = await import('./database')
    await expect(database.initDb()).rejects.toMatchObject({ name: 'DatabaseRecoveryError' })
    expect(memory.get(key)).toBe(damaged)
  })

  it('restores in-memory SQL after a failed atomic import write, and later saves can proceed', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { electronAPI: { dbRead: vi.fn().mockResolvedValue(null), dbWrite: write } })
    const database = await import('./database')
    await database.initDb()
    await database.runTransaction(() => database.execute("INSERT INTO novels(id,title) VALUES ('a','原书')"))
    write.mockRejectedValueOnce(new Error('模拟写盘失败'))
    await expect(database.runTransaction(() => {
      database.execute('DELETE FROM novels')
      database.execute("INSERT INTO novels(id,title) VALUES ('b','不应保留的新书')")
    }, { restoreOnWriteFailure: true })).rejects.toThrow('模拟写盘失败')
    expect(database.queryAll<{ title: string }>('SELECT title FROM novels')).toEqual([{ title: '原书' }])
    await database.runTransaction(() => database.execute("UPDATE novels SET title = '重试成功'"))
    expect(database.queryAll<{ title: string }>('SELECT title FROM novels')[0].title).toBe('重试成功')
  })
})
