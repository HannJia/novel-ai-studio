import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useNovelStore } from '@/stores/novel'
import { useKnowledgeStore } from '@/stores/knowledge'
import { useConfigStore } from '@/stores/config'
import { useWritingAdvisor } from './useWritingAdvisor'
import { requestWritingAdvice, type WritingAdviceMode, type WritingAdviceResult } from '@/services/writingAdvisor'

vi.mock('@/services/writingAdvisor', () => ({ extractWritingFocus: vi.fn(() => '当前段落'), requestWritingAdvice: vi.fn() }))
beforeEach(() => { setActivePinia(createPinia()); vi.mocked(requestWritingAdvice).mockReset() })

function advice(mode: WritingAdviceMode, title: string = mode): WritingAdviceResult {
  return { mode, focusLabel: mode, focusExcerpt: '当前段落', contextSummary: '章节计划',
    suggestions: [{ id: 'direction-1', kind: 'scene', title, approach: '写作方向',
      storyEffect: '', nextBeat: '', risk: '', evidence: [] }],
    nextChapterPlan: null, generatedAt: '2026-09-06T00:00:00Z' }
}

function setup() {
  const store = useNovelStore()
  const form = { genre: 'urban', subGenre: 'business', tags: [], targetWordCountMin: 20, targetWordCountMax: 30,
    writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() }
  const created = store.addNovel(form)
  const book = store.getNovel(created.id)!
  const chapter = store.addChapter(book.id, { content: '陈安走进厂房。' })!
  const liveBook = store.getNovel(book.id)!
  const liveChapter = liveBook.chapters.find(item => item.id === chapter.id)!
  const currentNovel = ref(liveBook)
  const currentChapter = ref(liveChapter)
  const content = ref(liveChapter.content)
  vi.spyOn(useConfigStore(), 'getModelForTask').mockReturnValue({ id: 'x', name: 'test', modelName: 'test', apiKey: 'fixture',
    baseUrl: 'https://example.test', maxTokens: 1000, temperature: 1, topP: 1 })
  const scope = effectScope()
  const advisor = scope.run(() => useWritingAdvisor({
    currentNovel, currentChapter, currentContent: content, textarea: ref(null),
  }))!
  vi.mocked(requestWritingAdvice).mockImplementation(async request => advice(request.mode))
  return { store, book, form, currentNovel, currentChapter, content, scope, advisor }
}

describe('advisor cache lifecycle', () => {
  it('keeps an in-flight request on its original tab and never restarts it on return', async () => {
    const { advisor, scope } = setup()
    await advisor.analyze('scene')
    let finish!: (value: WritingAdviceResult) => void
    vi.mocked(requestWritingAdvice).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = advisor.analyze('paragraph')
    const signal = vi.mocked(requestWritingAdvice).mock.calls[1][0].signal!
    advisor.selectMode('scene')
    expect(advisor.analyzing.value).toBe(false)
    expect(advisor.analyzingModes.value).toEqual(['paragraph'])
    expect(advisor.result.value?.mode).toBe('scene')
    expect(signal.aborted).toBe(false)
    advisor.selectMode('paragraph')
    await advisor.analyze('paragraph')
    expect(advisor.analyzing.value).toBe(true)
    expect(requestWritingAdvice).toHaveBeenCalledTimes(2)
    advisor.selectMode('scene')
    finish(advice('paragraph'))
    await pending
    expect(advisor.lastMode.value).toBe('scene')
    expect(advisor.result.value?.mode).toBe('scene')
    advisor.selectMode('paragraph')
    expect(advisor.result.value?.mode).toBe('paragraph')
    expect(advisor.analyzingModes.value).toEqual([])
    scope.stop()
  })

  it('only explicit analysis refreshes stale caches and clearing one tab retains the others', async () => {
    const { advisor, content, scope } = setup()
    for (const mode of ['paragraph', 'scene', 'chapter'] as const) await advisor.analyze(mode)
    content.value += '他发现了新线索。'
    for (const mode of ['paragraph', 'scene', 'chapter'] as const) {
      advisor.selectMode(mode)
      expect(advisor.stale.value).toBe(true)
      expect(advisor.result.value?.mode).toBe(mode)
    }
    expect(requestWritingAdvice).toHaveBeenCalledTimes(3)
    await advisor.analyze('scene')
    expect(advisor.stale.value).toBe(false)
    advisor.clear()
    expect(advisor.result.value).toBeNull()
    advisor.selectMode('paragraph')
    expect(advisor.result.value?.mode).toBe('paragraph')
    expect(advisor.stale.value).toBe(true)
    expect(requestWritingAdvice).toHaveBeenCalledTimes(4)
    scope.stop()
  })

  it.each(['settings', 'outline', 'plans', 'knowledge'] as const)('detects %s changes without starting an automatic analysis', async target => {
    const { advisor, book, scope } = setup()
    const knowledge = useKnowledgeStore()
    const base = knowledge.createKB('资料', '')
    book.knowledgeBaseIds.push(base.id)
    await advisor.analyze('paragraph')
    if (target === 'settings') book.settings.protagonist.background = '新背景'
    if (target === 'outline') book.outline = '新大纲'
    if (target === 'plans') book.chapterPlans = [{ id: 'new-plan' } as any]
    if (target === 'knowledge') knowledge.knowledgeBases[0].description = '新资料'
    advisor.selectMode('scene')
    advisor.selectMode('paragraph')
    expect(advisor.stale.value).toBe(true)
    expect(requestWritingAdvice).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('ignores unrelated save timestamps and book conversations', async () => {
    const { advisor, book, store, scope } = setup()
    await advisor.analyze('scene')
    book.updatedAt = '2026-09-06T01:00:00Z'
    store.addChatMessage(book.id, { id: 'chat', role: 'user', content: '书内讨论', timestamp: book.updatedAt })
    expect(advisor.stale.value).toBe(false)
    expect(requestWritingAdvice).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it.each(['stop', 'clear', 'chapter', 'book', 'dispose'] as const)('rejects late responses after %s', async action => {
    const { advisor, currentChapter, currentNovel, book, store, form, scope } = setup()
    let finish!: (value: WritingAdviceResult) => void
    vi.mocked(requestWritingAdvice).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = advisor.analyze('paragraph')
    const signal = vi.mocked(requestWritingAdvice).mock.calls[0][0].signal!
    if (action === 'stop') advisor.stop()
    if (action === 'clear') advisor.clear()
    if (action === 'chapter') currentChapter.value = store.addChapter(book.id, { content: '下一章' })!
    if (action === 'book') currentNovel.value = store.addNovel(form)
    if (action === 'dispose') scope.stop()
    expect(signal.aborted).toBe(true)
    finish(advice('paragraph'))
    await pending
    advisor.selectMode('paragraph')
    expect(advisor.result.value).toBeNull()
    expect(advisor.analyzingModes.value).toEqual([])
    scope.stop()
  })

  it('rejects stale completion without erasing a previously generated direction', async () => {
    const { advisor, content, scope } = setup()
    await advisor.analyze('paragraph')
    let finish!: (value: WritingAdviceResult) => void
    vi.mocked(requestWritingAdvice).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = advisor.analyze('paragraph')
    content.value += '新正文'
    finish(advice('paragraph', '不应采纳'))
    await pending
    expect(advisor.result.value?.suggestions[0].title).toBe('paragraph')
    expect(advisor.stale.value).toBe(true)
    expect(advisor.error.value).toContain('已过期')
    scope.stop()
  })

  it('isolates errors and retains the last good result when manual reanalysis fails', async () => {
    const { advisor, scope } = setup()
    await advisor.analyze('paragraph')
    vi.mocked(requestWritingAdvice).mockRejectedValueOnce(new Error('模拟接口失败'))
    await advisor.analyze('paragraph')
    expect(advisor.result.value?.mode).toBe('paragraph')
    expect(advisor.error.value).toBe('模拟接口失败')
    advisor.selectMode('scene')
    expect(advisor.error.value).toBe('')
    expect(advisor.result.value).toBeNull()
    advisor.selectMode('paragraph')
    expect(advisor.error.value).toBe('模拟接口失败')
    expect(requestWritingAdvice).toHaveBeenCalledTimes(2)
    scope.stop()
  })
})
