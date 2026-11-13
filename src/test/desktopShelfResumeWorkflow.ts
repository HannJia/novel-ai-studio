// Development-only fixture for the shelf-to-writing Electron navigation smoke.
import { useNovelStore } from '@/stores/novel'
import { readProjectLibrary } from '@/services/projectKernelClient'

export async function seedDesktopShelfResumeWorkflow() {
  await readProjectLibrary(true)
  const novels = useNovelStore()
  if (novels.novels.length !== 0) throw new Error('书架导航验收要求隔离作品库为空。')
  const novel = novels.addNovel({
    workingTitle: '书架继续写作导航验收',
    genre: 'fantasy',
    subGenre: 'xuanhuan',
    tags: ['合成验收'],
    targetWordCountMin: 1,
    targetWordCountMax: 2,
    writingStyle: novels.defaultWritingStyle(),
    settings: novels.defaultSettings(),
  })
  const chapter = novels.addChapter(novel.id, {
    title: '雨后渡口',
    content: '雨停后，沈砚收起账册，沿着石阶走向渡口。',
  })
  if (!chapter) throw new Error('书架导航夹具无法创建章节。')

  const updatedAt = '2026-11-13T00:00:00.000Z'
  chapter.updatedAt = updatedAt
  novel.updatedAt = updatedAt
  await novels.saveNovelNow(novel.id)
  await novels.flushPendingSaves()

  return { novelId: novel.id, chapterId: chapter.id }
}
