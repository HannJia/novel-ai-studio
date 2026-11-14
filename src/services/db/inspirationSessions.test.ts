import { afterEach, expect, it, vi } from 'vitest'
import { loadInspirationSessions, saveInspirationSessions } from './inspirationSessions'
import { parseInspirationSession } from '../inspirationSessions'
import { queryAll } from '../database'
import { inspirationSettingsSnapshot } from '../inspiration'
import { createPinia, setActivePinia } from 'pinia'
import { useNovelStore } from '@/stores/novel'
afterEach(() => vi.unstubAllGlobals())
it('saves current inspiration sessions and rolls back failed writes without reading historical storage', async () => {
  const retiredKey = 'novel-writer-inspiration-sessions'
  const writer = vi.fn().mockResolvedValue(undefined)
  const getItem = vi.fn((key: string) => key === retiredKey ? 'unread historical sessions' : null)
  vi.stubGlobal('window', { electronAPI: { dbRead: async () => null, dbWrite: writer } })
  vi.stubGlobal('localStorage', { getItem })
  expect(await loadInspirationSessions()).toEqual([])
  setActivePinia(createPinia())
  const novel = useNovelStore()
  const settingsDraft = inspirationSettingsSnapshot({ genre: '', subGenre: '', tags: [], targetWordCountMin: 10,
    targetWordCountMax: 20, settings: novel.defaultSettings(), writingStyle: novel.defaultWritingStyle() })
  const saved = parseInspirationSession({ id: 'native', title: '当前灵感', updatedAt: '2026-11-13T00:00:00Z',
    messages: [{ role: 'user', content: '修灯人的故事' }], knowledgeIds: [], draft: '未发送', webSearch: false,
    settingsDraft, settingsMessageCount: 1 })
  await saveInspirationSessions([saved])
  writer.mockRejectedValueOnce(new Error('写盘失败'))
  await expect(saveInspirationSessions([])).rejects.toThrow('写盘失败')
  expect(await loadInspirationSessions()).toEqual([saved])
  expect((await loadInspirationSessions())[0].settingsMessageCount).toBe(1)
  expect(() => parseInspirationSession({ ...saved, settingsMessageCount: 2 })).toThrow('灵感会话数据不完整')
  expect(getItem.mock.calls.some(([key]) => key === retiredKey)).toBe(false)
  expect(queryAll("SELECT name FROM sqlite_master WHERE name='local_migrations'")).toEqual([])
})
