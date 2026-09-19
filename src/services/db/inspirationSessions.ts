import { execute, initDb, queryAll, runTransaction } from '../database'
import { LEGACY_INSPIRATION_KEY, latestInspirationSessions, parseInspirationSession, type InspirationSession } from '../inspirationSessions'

export function writeInspirationSessions(sessions: InspirationSession[]) {
  const checked = sessions.map(parseInspirationSession)
  execute('DELETE FROM inspiration_sessions')
  for (const session of checked) execute('INSERT INTO inspiration_sessions(id,value) VALUES(?,?)', [session.id, JSON.stringify(session)])
}
export async function loadInspirationSessions(): Promise<InspirationSession[]> {
  await initDb()
  if (!queryAll("SELECT id FROM local_migrations WHERE id='inspiration-sessions'").length) {
    const raw = localStorage.getItem(LEGACY_INSPIRATION_KEY)
    const parsed: unknown = JSON.parse(raw || '[]')
    if (!Array.isArray(parsed)) throw new Error('旧灵感会话无法读取，原记录已保留。')
    const existing = queryAll<{ value: string }>('SELECT value FROM inspiration_sessions').map(row => parseInspirationSession(JSON.parse(row.value)))
    const sessions = new Map(parsed.map(value => { const item = parseInspirationSession(value); return [item.id, item] }))
    for (const item of existing) sessions.set(item.id, item)
    await runTransaction(() => {
      writeInspirationSessions(latestInspirationSessions([...sessions.values()]))
      execute("INSERT INTO local_migrations(id) VALUES('inspiration-sessions')")
    }, { restoreOnWriteFailure: true })
  }
  return latestInspirationSessions(queryAll<{ value: string }>('SELECT value FROM inspiration_sessions').map(row => parseInspirationSession(JSON.parse(row.value))))
}
export async function saveInspirationSessions(sessions: InspirationSession[]) {
  await initDb()
  await runTransaction(() => writeInspirationSessions(sessions), { restoreOnWriteFailure: true })
}
