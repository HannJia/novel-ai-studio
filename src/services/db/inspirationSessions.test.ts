import { describe, expect, it, vi } from 'vitest'
import { loadInspirationSessions, saveInspirationSessions } from './inspirationSessions'
import { LEGACY_INSPIRATION_KEY, parseInspirationSession } from '../inspirationSessions'
import { queryAll } from '../database'

describe('durable inspiration migration', () => {
  it('migrates legacy chats once, preserves drafts, and rolls back disk failures without resurrecting pruned sessions', async () => {
    const legacy = JSON.stringify([{ id: 'legacy', title: '旧想法', updatedAt: '2026-09-18T00:00:00Z',
      messages: [{ role: 'user', content: '以前的构思' }], knowledgeIds: ['kb'] }])
    const writer = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { electronAPI: { dbRead: async () => null, dbWrite: writer } })
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === LEGACY_INSPIRATION_KEY ? legacy : null })
    try {
      expect((await loadInspirationSessions())[0]).toMatchObject({ id: 'legacy', draft: '', webSearch: false })
      const next = parseInspirationSession({ id: 'new', title: '新想法', updatedAt: '2026-09-19T00:00:00Z',
        messages: [], draft: '未发送', webSearch: true, context: undefined })
      writer.mockRejectedValueOnce(new Error('写盘失败'))
      await expect(saveInspirationSessions([next])).rejects.toThrow('写盘失败')
      expect((await loadInspirationSessions())[0].id).toBe('legacy')
      await saveInspirationSessions([next])
      expect(await loadInspirationSessions()).toEqual([next])
      expect(queryAll('SELECT id FROM local_migrations')).toEqual([{ id: 'inspiration-sessions' }])
    } finally { vi.unstubAllGlobals() }
  })
})
