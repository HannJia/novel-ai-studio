import { afterEach, beforeEach, expect, it, vi } from 'vitest'
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
afterEach(() => vi.unstubAllGlobals())

it('adds optional columns to an old in-memory database and preserves original counts and drafts', async () => {
  let database = await import('./database')
  await database.initDb()
  await database.runTransaction(() => {
    database.execute('ALTER TABLE novels DROP COLUMN chapter_length_policy')
    database.execute('ALTER TABLE chapters DROP COLUMN content_review_coverage')
    database.execute("INSERT INTO novels(id,title,current_word_count) VALUES ('book','合成旧书',777)")
    database.execute("INSERT INTO chapters(id,novel_id,content,word_count,status) VALUES ('chapter','book','原稿，AI！',777,'writing')")
  })
  const original = memory.get('novel-writer-sqlite-db')
  vi.resetModules()
  database = await import('./database')
  await database.initDb()
  expect(database.queryAll('SELECT current_word_count,chapter_length_policy FROM novels')).toEqual([{ current_word_count: 777, chapter_length_policy: null }])
  expect(database.queryAll('SELECT content,word_count,status,content_review_coverage FROM chapters')).toEqual([{ content: '原稿，AI！', word_count: 777, status: 'writing', content_review_coverage: null }])
  expect(memory.get('novel-writer-sqlite-db.bak')).toBe(original)
  const migrated = memory.get('novel-writer-sqlite-db')
  vi.resetModules()
  database = await import('./database')
  await database.initDb()
  expect(memory.get('novel-writer-sqlite-db')).toBe(migrated)
})
