import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useNovelStore } from '@/stores/novel'
import { useKnowledgeStore } from '@/stores/knowledge'
import { createProjectBackup } from './projectBackup'
import { importProject, projectTransferBusy } from './projectTransfer'
import { replaceProjectInDb } from './db/project'
import { retainProjectRestorePoint } from './database'

vi.mock('./aiTaskQueue', () => ({ chapterBackgroundQueue: { pendingCount: 0 } }))
vi.mock('./db/project', () => ({ replaceProjectInDb: vi.fn() }))
vi.mock('./database', () => ({ retainProjectRestorePoint: vi.fn() }))
vi.mock('./db/chapterRevisions', () => ({ loadProjectChapterRevisions: vi.fn().mockResolvedValue([]) }))
vi.mock('./db/novels', () => ({ saveNovelToDb: vi.fn().mockResolvedValue(undefined) }))
vi.mock('./db/knowledge', () => ({ saveKnowledgeBaseToDb: vi.fn().mockResolvedValue(undefined) }))
beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks() })

describe('project import store boundary', () => {
  it('keeps stores unchanged on failure, retains a restore point first, and adopts only after commit', async () => {
    const novels = useNovelStore()
    const knowledge = useKnowledgeStore()
    const book = novels.addNovel({ genre: '', subGenre: '', tags: [], targetWordCountMin: 1, targetWordCountMax: 2,
      settings: novels.defaultSettings(), writingStyle: novels.defaultWritingStyle() })
    const original = novels.getNovel(book.id)
    const backup = createProjectBackup(novels.novels, [])
    backup.novels[0].title = '导入书名'
    vi.mocked(replaceProjectInDb).mockRejectedValueOnce(new Error('写盘失败'))
    await expect(importProject(backup)).rejects.toThrow('写盘失败')
    expect(novels.getNovel(book.id)).toBe(original)
    expect(projectTransferBusy.value).toBe(false)
    expect(retainProjectRestorePoint).toHaveBeenCalled()
    expect(vi.mocked(retainProjectRestorePoint).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(replaceProjectInDb).mock.invocationCallOrder[0])
    vi.mocked(replaceProjectInDb).mockResolvedValue(undefined)
    await importProject(backup)
    expect(novels.getNovel(book.id)?.title).toBe('导入书名')
    expect(novels.getNovel(book.id)).not.toBe(original)
    expect(knowledge.knowledgeBases).toEqual([])
    expect(novels.hasPendingSaves).toBe(false)
  })
})
