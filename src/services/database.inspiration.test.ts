import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const memory = new Map<string, string>()
const key = 'novel-writer-sqlite-db'
beforeEach(() => {
  vi.resetModules()
  memory.clear()
  vi.stubGlobal('window', {})
  vi.stubGlobal('localStorage', {
    getItem: (name: string) => memory.get(name) ?? null,
    setItem: (name: string, value: string) => memory.set(name, value),
    removeItem: (name: string) => memory.delete(name),
  })
})
afterEach(() => vi.unstubAllGlobals())

it('moves only explicitly tagged inspiration once, retaining order, source evidence and ordinary chats', async () => {
  let database = await import('./database')
  await database.initDb()
  const now = '2026-09-05T00:00:00.000Z'
  const search = { protocol: 'responses', status: 'searched', sources: [{ title: '来源', url: 'https://example.org' }] }
  await database.runTransaction(() => {
    // Simulate the exact pre-separation schema, using only an in-memory test DB.
    database.execute('ALTER TABLE novels DROP COLUMN inspiration_history')
    database.execute("INSERT INTO novels(id,title) VALUES ('book','测试书'), ('other','其他书')")
    for (let index = 0; index < 12; index++) {
      database.execute('INSERT INTO chat_messages(id,novel_id,role,content,timestamp,search_record) VALUES (?,?,?,?,?,?)',
        [`inspiration-book-${index}`, 'book', index % 2 ? 'assistant' : 'user', `旧灵感${index}`, now, JSON.stringify(search)])
    }
    database.execute('INSERT INTO chat_messages(id,novel_id,role,content,timestamp) VALUES (?,?,?,?,?)',
      ['ordinary', 'book', 'user', '普通书内对话', now])
    database.execute('INSERT INTO chat_messages(id,novel_id,role,content,timestamp) VALUES (?,?,?,?,?)',
      ['inspiration-other-0', 'book', 'user', '前缀不属于该书，不猜测归属', now])
  })
  const original = memory.get(key)
  vi.resetModules()
  database = await import('./database')
  await database.initDb()
  const rows = database.queryAll<{ id: string; inspiration_history: string }>('SELECT id,inspiration_history FROM novels')
  const archive = JSON.parse(rows.find(row => row.id === 'book')!.inspiration_history)
  expect(archive).toHaveLength(12)
  expect(archive.map((message: { content: string }) => message.content)).toEqual(Array.from({ length: 12 }, (_, index) => `旧灵感${index}`))
  expect(archive[0].search).toEqual(search)
  expect(JSON.parse(rows.find(row => row.id === 'other')!.inspiration_history)).toEqual([])
  expect(database.queryAll('SELECT id FROM chat_messages ORDER BY id')).toEqual([{ id: 'inspiration-other-0' }, { id: 'ordinary' }])
  expect(memory.get(`${key}.bak`)).toBe(original)
  const saved = memory.get(key)
  vi.resetModules()
  database = await import('./database')
  await database.initDb()
  expect(memory.get(key)).toBe(saved)
  expect(memory.get(`${key}.bak`)).toBe(original)
})
