import { beforeEach, describe, expect, it, vi } from 'vitest'

const memory = new Map<string, string>()
beforeEach(() => {
  vi.resetModules()
  memory.clear()
  vi.stubGlobal('window', {})
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
    removeItem: (key: string) => memory.delete(key),
  })
})
const key = 'novel-writer-sqlite-db'

describe('database recovery without destructive fallback', () => {
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
