import { describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useNovelStore } from '@/stores/novel'
import { createProjectBackup } from '../projectBackup'
import { replaceProjectInDb } from './project'
import { loadAllNovelsFromDb } from './novels'
import { loadAllKnowledgeBasesFromDb } from './knowledge'
import { loadProjectChapterRevisions } from './chapterRevisions'
import { execute, queryAll, runTransaction } from '../database'

describe('whole-project replacement', () => {
  it('atomically restores books, knowledge, versions and pending drafts; failure leaves the old project intact', async () => {
    setActivePinia(createPinia())
    const writer = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { electronAPI: { dbRead: async () => null, dbWrite: writer } })
    vi.stubGlobal('localStorage', { getItem: () => null })
    const store = useNovelStore()
    const book = store.addNovel({ genre: '', subGenre: '', tags: [], targetWordCountMin: 1, targetWordCountMax: 2,
      settings: store.defaultSettings(), writingStyle: store.defaultWritingStyle() })
    const chapter = store.addChapter(book.id, { title: '原章节', content: '原正文' })!
    store.bindKnowledgeBase(book.id, 'kb')
    const backup = createProjectBackup([store.getNovel(book.id)!], [{
      id: 'kb', name: '设定库', description: '', createdAt: book.createdAt,
      entries: [{ id: 'entry', title: '世界规则', content: '规则原文', summary: '规则', category: '世界观', tags: [], createdAt: book.createdAt, updatedAt: book.updatedAt }],
    }], [{
      id: 'revision', novelId: book.id, chapterId: chapter.id, baseContent: '原正文', proposedContent: '待确认草稿',
      diff: '+待确认草稿', reason: '创作建议', source: 'ai', status: 'pending', createdAt: book.createdAt, updatedAt: book.updatedAt,
    }])
    await replaceProjectInDb(backup)
    expect((await loadAllKnowledgeBasesFromDb())[0].entries[0].content).toBe('规则原文')
    expect((await loadProjectChapterRevisions())[0].proposedContent).toBe('待确认草稿')
    const changed = JSON.parse(JSON.stringify(backup))
    changed.novels[0].title = '导入的新书名'
    changed.knowledgeBases[0].name = '新设定库'
    writer.mockRejectedValueOnce(new Error('导入写盘失败'))
    await expect(replaceProjectInDb(changed)).rejects.toThrow('导入写盘失败')
    expect((await loadAllNovelsFromDb())[0].title).toBe(backup.novels[0].title)
    expect((await loadAllKnowledgeBasesFromDb())[0].name).toBe('设定库')
    await replaceProjectInDb(changed)
    expect((await loadAllNovelsFromDb())[0].title).toBe('导入的新书名')
    // External SQL invalidates the optional row cache; it cannot resurrect stale values.
    await runTransaction(() => execute("UPDATE novels SET title = '外部修改'"))
    const { saveNovelToDb } = await import('./novels')
    await saveNovelToDb(changed.novels[0])
    expect(queryAll<{ title: string }>('SELECT title FROM novels')[0].title).toBe('导入的新书名')
    const invalid = JSON.parse(JSON.stringify(changed))
    invalid.chapterRevisions[0].chapterId = 'missing'
    await expect(replaceProjectInDb(invalid)).rejects.toThrow('章节引用不存在')
    expect((await loadAllNovelsFromDb())[0].title).toBe('导入的新书名')
    vi.unstubAllGlobals()
  })
})
