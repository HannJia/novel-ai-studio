import { afterEach, expect, it, vi } from 'vitest'
import { loadInspirationSessions, saveInspirationSessions } from './inspirationSessions'
import { parseInspirationSession } from '../inspirationSessions'
import { queryAll } from '../database'
afterEach(() => vi.unstubAllGlobals())
it('saves current inspiration sessions and rolls back failed writes without reading historical storage', async () => {
  const retiredKey = 'novel-writer-inspiration-sessions'
  const writer = vi.fn().mockResolvedValue(undefined)
  const getItem = vi.fn((key: string) => key === retiredKey ? 'unread historical sessions' : null)
  vi.stubGlobal('window', { electronAPI: { dbRead: async () => null, dbWrite: writer } })
  vi.stubGlobal('localStorage', { getItem })
  expect(await loadInspirationSessions()).toEqual([])
  const saved = parseInspirationSession({ id: 'native', title: '当前灵感', updatedAt: '2026-11-13T00:00:00Z', messages: [], knowledgeIds: [], draft: '未发送', webSearch: false })
  await saveInspirationSessions([saved])
  writer.mockRejectedValueOnce(new Error('写盘失败'))
  await expect(saveInspirationSessions([])).rejects.toThrow('写盘失败')
  expect(await loadInspirationSessions()).toEqual([saved])
  expect(getItem.mock.calls.some(([key]) => key === retiredKey)).toBe(false)
  expect(queryAll("SELECT name FROM sqlite_master WHERE name='local_migrations'")).toEqual([])
})
