import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const memory = new Map<string, string>()
beforeEach(() => {
  vi.resetModules(); memory.clear(); vi.stubGlobal('window', {})
  vi.stubGlobal('localStorage', { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value), removeItem: (key: string) => memory.delete(key) })
})
afterEach(() => vi.unstubAllGlobals())

it('creates the complete current schema once and reopens without rewriting it', async () => {
  let db = await import('./database'); await db.initDb()
  expect(db.queryAll('PRAGMA user_version')).toEqual([{ user_version: 3 }])
  expect(db.queryAll<{ name: string }>('PRAGMA table_info(novels)').map(row => row.name)).toEqual(expect.arrayContaining(['cover_id', 'chapter_length_policy', 'inspiration_history']))
  expect(db.queryAll<{ name: string }>('PRAGMA table_info(chapters)').map(row => row.name)).toContain('content_review_coverage')
  const original = memory.get('mojian-v3-sqlite-db')
  vi.resetModules(); db = await import('./database'); await db.initDb()
  expect(memory.get('mojian-v3-sqlite-db')).toBe(original)
})

it('rejects a database with missing required columns without altering or replacing it', async () => {
  let db = await import('./database'); await db.initDb()
  await db.runTransaction(() => {
    db.execute('ALTER TABLE novels DROP COLUMN cover_id')
    db.execute("INSERT INTO novels(id,title) VALUES('book','原始合成记录')")
  })
  const original = memory.get('mojian-v3-sqlite-db')
  vi.resetModules(); db = await import('./database')
  await expect(db.initDb()).rejects.toThrow('仅支持 V3')
  expect(memory.get('mojian-v3-sqlite-db')).toBe(original)
})
