import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useNovelStore } from '@/stores/novel'
import { useConfigStore } from '@/stores/config'
import { useWritingAdvisor } from './useWritingAdvisor'
import { requestWritingAdvice, type WritingAdviceResult } from '@/services/writingAdvisor'

vi.mock('@/services/writingAdvisor', () => ({ extractWritingFocus: vi.fn(() => ({})), requestWritingAdvice: vi.fn() }))
beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks() })

describe('advisor mode switching', () => {
  it('invalidates cached advice when an unchanged previous summary is confirmed', async () => {
    const store = useNovelStore()
    const created = store.addNovel({ genre: 'urban', subGenre: 'business', tags: [], targetWordCountMin: 20, targetWordCountMax: 30,
      writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() })
    const book = store.getNovel(created.id)!
    const previous = store.addChapter(book.id, { content: '前章正文。' })!
    store.updateChapter(book.id, previous.id, { summary: '待核对的前章总结。', summarySource: undefined })
    const chapter = store.addChapter(book.id, { content: '本章正文。' })!
    vi.spyOn(useConfigStore(), 'getModelForTask').mockReturnValue({ id: 'x', name: 'test', modelName: 'test', apiKey: '', baseUrl: '', maxTokens: 1000, temperature: 1, topP: 1 })
    vi.mocked(requestWritingAdvice).mockResolvedValue({ mode: 'scene', suggestions: [] } as unknown as WritingAdviceResult)
    const scope = effectScope()
    const advisor = scope.run(() => useWritingAdvisor({ currentNovel: ref(book), currentChapter: ref(chapter), currentContent: ref(chapter.content), textarea: ref(null) }))!
    await advisor.analyze('scene')
    expect(advisor.stale.value).toBe(false)
    store.updateChapter(book.id, previous.id, { summary: previous.summary })
    expect(advisor.stale.value).toBe(true)
    scope.stop()
  })
  it('switches tabs without sending a request and keeps each mode cached', async () => {
    const store = useNovelStore()
    const book = store.addNovel({ genre: 'urban', subGenre: 'business', tags: [], targetWordCountMin: 20, targetWordCountMax: 30, writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() })
    const chapter = store.addChapter(book.id, { content: '陈安走进厂房。' })!
    vi.spyOn(useConfigStore(), 'getModelForTask').mockReturnValue({ id: 'x', name: 'test', modelName: 'test', apiKey: 'fixture', baseUrl: 'https://example.test', maxTokens: 1000, temperature: 1, topP: 1 })
    vi.mocked(requestWritingAdvice)
      .mockResolvedValueOnce({ mode: 'paragraph', suggestions: [{ id: 'p' }] } as unknown as WritingAdviceResult)
      .mockResolvedValueOnce({ mode: 'scene', suggestions: [{ id: 's' }] } as unknown as WritingAdviceResult)
    const scope = effectScope()
    const advisor = scope.run(() => useWritingAdvisor({ currentNovel: ref(book), currentChapter: ref(chapter), currentContent: ref(chapter.content), textarea: ref(null) }))!
    advisor.selectMode('paragraph')
    advisor.selectMode('scene')
    expect(requestWritingAdvice).not.toHaveBeenCalled()
    await advisor.analyze('paragraph')
    await advisor.analyze('scene')
    advisor.selectMode('paragraph')
    expect(advisor.result.value?.mode).toBe('paragraph')
    expect(requestWritingAdvice).toHaveBeenCalledTimes(2)
    scope.stop()
  })

  it('ignores the late result of an explicitly stopped request', async () => {
    const store = useNovelStore()
    const book = store.addNovel({ genre: 'urban', subGenre: 'business', tags: [], targetWordCountMin: 20, targetWordCountMax: 30, writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() })
    const chapter = store.addChapter(book.id, { content: '陈安走进厂房。' })!
    vi.spyOn(useConfigStore(), 'getModelForTask').mockReturnValue({ id: 'x', name: 'test', modelName: 'test', apiKey: '', baseUrl: '', maxTokens: 1000, temperature: 1, topP: 1 })
    const resolvers: Array<(value: WritingAdviceResult) => void> = []
    vi.mocked(requestWritingAdvice).mockImplementation(() => new Promise(resolve => resolvers.push(resolve)))
    const scope = effectScope()
    const advisor = scope.run(() => useWritingAdvisor({ currentNovel: ref(book), currentChapter: ref(chapter), currentContent: ref(chapter.content), textarea: ref(null) }))!
    const first = advisor.analyze('scene')
    const signal = vi.mocked(requestWritingAdvice).mock.calls[0][0].signal
    advisor.stop('scene')
    const second = advisor.analyze('chapter')
    expect(signal?.aborted).toBe(true)
    resolvers[0]({ mode: 'scene', suggestions: [] } as unknown as WritingAdviceResult)
    await first
    expect(advisor.analyzing.value).toBe(true)
    expect(advisor.result.value).toBeNull()
    resolvers[1]({ mode: 'chapter', suggestions: [] } as unknown as WritingAdviceResult)
    await second
    expect(advisor.result.value?.mode).toBe('chapter')
    expect(advisor.lastMode.value).toBe('chapter')
    expect(advisor.analyzing.value).toBe(false)
    scope.stop()
  })

  it('runs different analysis modes in parallel and retains both results', async () => {
    const store = useNovelStore()
    const book = store.addNovel({ genre: 'urban', subGenre: 'business', tags: [], targetWordCountMin: 20, targetWordCountMax: 30, writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() })
    const chapter = store.addChapter(book.id, { content: '陈安走进厂房。' })!
    vi.spyOn(useConfigStore(), 'getModelForTask').mockReturnValue({ id: 'x', name: 'test', modelName: 'test', apiKey: 'fixture', baseUrl: 'https://example.test', maxTokens: 1000, temperature: 1, topP: 1 })
    const resolvers: Array<(value: WritingAdviceResult) => void> = []
    vi.mocked(requestWritingAdvice).mockImplementation(() => new Promise(resolve => resolvers.push(resolve)))
    const scope = effectScope()
    const advisor = scope.run(() => useWritingAdvisor({ currentNovel: ref(book), currentChapter: ref(chapter), currentContent: ref(chapter.content), textarea: ref(null) }))!
    const scene = advisor.analyze('scene')
    const sceneSignal = vi.mocked(requestWritingAdvice).mock.calls[0][0].signal
    const chapterAnalysis = advisor.analyze('chapter')
    expect(sceneSignal?.aborted).toBe(false)
    expect(advisor.analyzingModes.value).toEqual(['scene', 'chapter'])
    resolvers[0]({ mode: 'scene', suggestions: [] } as unknown as WritingAdviceResult)
    await scene
    expect(advisor.lastMode.value).toBe('chapter')
    expect(advisor.result.value).toBeNull()
    expect(advisor.analyzingModes.value).toEqual(['chapter'])
    resolvers[1]({ mode: 'chapter', suggestions: [] } as unknown as WritingAdviceResult)
    await chapterAnalysis
    expect(advisor.result.value?.mode).toBe('chapter')
    advisor.selectMode('scene')
    expect(advisor.result.value?.mode).toBe('scene')
    expect(advisor.analyzingModes.value).toEqual([])
    scope.stop()
  })
})
