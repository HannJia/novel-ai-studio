import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const memory = new Map<string, string>()
const key = 'mojian-v3-sqlite-db'
beforeEach(() => {
  vi.resetModules(); memory.clear(); vi.stubGlobal('window', {})
  vi.stubGlobal('localStorage', { getItem: (name: string) => memory.get(name) ?? null, setItem: (name: string, value: string) => memory.set(name, value), removeItem: (name: string) => memory.delete(name) })
})
afterEach(() => vi.unstubAllGlobals())

it('persists native inspiration archives separately without moving tagged conversation rows', async () => {
  let db = await import('./database'); await db.initDb()
  const archive = [{ id: 'idea', role: 'user', content: '已保存的灵感', timestamp: '2026-11-13T00:00:00.000Z' }]
  await db.runTransaction(() => {
    db.execute('INSERT INTO novels(id,title,inspiration_history) VALUES(?,?,?)', ['book', 'V3 合成书', JSON.stringify(archive)])
    db.execute('INSERT INTO chat_messages(id,novel_id,role,content,timestamp) VALUES(?,?,?,?,?)', ['inspiration-book-0', 'book', 'user', '书内对话', archive[0].timestamp])
  })
  const original = memory.get(key)
  vi.resetModules(); db = await import('./database'); await db.initDb()
  expect(JSON.parse(db.queryAll<{ inspiration_history: string }>('SELECT inspiration_history FROM novels')[0].inspiration_history)).toEqual(archive)
  expect(db.queryAll('SELECT content FROM chat_messages')).toEqual([{ content: '书内对话' }])
  expect(memory.get(key)).toBe(original)
})

it('ignores historical database namespaces when initializing the V3 store', async () => {
  memory.set('novel-writer-sqlite-db', 'retired database bytes')
  const db = await import('./database'); await db.initDb()
  expect(db.queryAll('PRAGMA user_version')).toEqual([{ user_version: 3 }])
  expect(db.queryAll('SELECT id FROM novels')).toEqual([])
  expect(memory.get('novel-writer-sqlite-db')).toBe('retired database bytes')
})
