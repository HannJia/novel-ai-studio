import { describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useNovelStore } from '@/stores/novel'
import { createProjectBackup } from '../projectBackup'
import { emptySyncState, type SyncConflict } from '../cloudSyncModel'
import { persistCloudState, readCloudConflicts, readCloudState } from './cloudSync'
import { loadAllNovelsFromDb } from './novels'
import { execute, queryAll, runTransaction } from '../database'
import { parseInspirationSession } from '../inspirationSessions'

describe('cloud synchronization database transaction', () => {
  it('commits data, bases and conflict archives together; disk failure rolls all three back', async () => {
    setActivePinia(createPinia())
    const writer = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { electronAPI: { dbRead: async () => null, dbWrite: writer } })
    vi.stubGlobal('localStorage', { getItem: () => null })
    try {
      const novels = useNovelStore()
      const book = novels.addNovel({ genre: '', subGenre: '', tags: [], targetWordCountMin: 1, targetWordCountMax: 2,
        settings: novels.defaultSettings(), writingStyle: novels.defaultWritingStyle() })
      const before = createProjectBackup([book], [])
      const state = emptySyncState()
      const conflict: SyncConflict = { id: 'conflict', key: `novel:${book.id}`, title: book.title,
        local: null, remote: null, remoteHash: null, remoteVersion: 2, createdAt: book.createdAt }
      await persistCloudState(state, [conflict], before)
      await runTransaction(() => execute("INSERT INTO ai_tasks (id,name,status) VALUES ('task','已有任务','completed')"))
      const after = createProjectBackup([book], [])
      after.inspirationSessions = [parseInspirationSession({ id: 'idea', title: '未成书的想法', updatedAt: book.updatedAt,
        messages: [{ role: 'user', content: '还没聊完' }], draft: '下一句话' })]
      after.novels[0].title = '云端的新书名'
      const next = { ...state, bases: { [conflict.key]: { version: 2, hash: null } } }
      writer.mockRejectedValueOnce(new Error('磁盘空间不足'))
      await expect(persistCloudState(next, [{ ...conflict, resolution: 'remote' }], after)).rejects.toThrow('磁盘空间不足')
      expect((await readCloudState()).bases).toEqual({})
      expect((await readCloudConflicts())[0].resolution).toBeUndefined()
      expect((await loadAllNovelsFromDb())[0].title).toBe(book.title)
      expect(queryAll('SELECT id FROM inspiration_sessions')).toEqual([])
      await persistCloudState(next, [{ ...conflict, resolution: 'remote' }], after)
      expect((await readCloudState()).bases[conflict.key].version).toBe(2)
      expect((await readCloudConflicts())[0].resolution).toBe('remote')
      expect((await loadAllNovelsFromDb())[0].title).toBe('云端的新书名')
      expect(queryAll('SELECT id FROM ai_tasks')).toEqual([{ id: 'task' }])
      expect(queryAll('SELECT id FROM inspiration_sessions')).toEqual([{ id: 'idea' }])
    } finally { vi.unstubAllGlobals() }
  })
})
