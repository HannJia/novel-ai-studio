// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, reactive } from 'vue'
import { flushPromises, shallowMount, enableAutoUnmount } from '@vue/test-utils'
import ChapterList from './ChapterList.vue'
import { useNovelStore } from '@/stores/novel'
import { useConfigStore, type ModelConfig } from '@/stores/config'
import { callAI, type ChatCompletionOptions } from '@/services/ai'
import { saveNovelToDb } from '@/services/db/novels'

const { route, push, messages } = vi.hoisted(() => ({
  route: { params: { novelId: '' }, query: {} },
  push: vi.fn(),
  messages: { success: vi.fn(), warning: vi.fn(), info: vi.fn(), error: vi.fn() },
}))
enableAutoUnmount(afterEach)
const reactiveRoute = reactive(route)
vi.mock('vue-router', () => ({ useRoute: () => reactiveRoute, useRouter: () => ({ push }) }))
vi.mock('naive-ui', async original => ({
  ...await original<object>(), useMessage: () => messages,
}))
vi.mock('@/services/ai', async original => ({ ...await original<object>(), callAI: vi.fn() }))
vi.mock('@/services/db/novels', () => ({
  saveNovelToDb: vi.fn().mockResolvedValue(undefined),
  loadAllNovelsFromDb: vi.fn().mockResolvedValue([]),
  deleteNovelFromDb: vi.fn().mockResolvedValue(undefined),
}))

const enqueuedTasks = vi.hoisted(() => ({ batches: [] as Array<{ name: string; tasks: Array<{ name: string; task: () => Promise<void> }> }> }))
vi.mock('@/services/aiTaskQueue', () => ({
  chapterBackgroundQueue: {
    enqueueBatch: vi.fn((name: string, tasks: Array<{ name: string; task: () => Promise<void> }>) => {
      enqueuedTasks.batches.push({ name, tasks })
    }),
  },
}))

const Button = defineComponent({
  props: ['disabled', 'loading'],
  template: '<button :disabled="disabled || loading"><slot /></button>',
})

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  enqueuedTasks.batches = []
  vi.mocked(saveNovelToDb).mockResolvedValue()
  const config = useConfigStore()
  vi.spyOn(config, 'getModelForTask').mockReturnValue({ id: 'test', modelName: 'test', maxTokens: 8000 } as ModelConfig)
  if (typeof Element.prototype.scrollIntoView === 'undefined') {
    Element.prototype.scrollIntoView = vi.fn()
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

function mockReviewAI() {
  vi.mocked(callAI).mockImplementation(async (options: ChatCompletionOptions) => {
    const isGlobal = options.taskName?.includes('全章关系复核')
    const report = isGlobal
      ? '总体判断：可通过\n必改数量：0\n## 全章关系复核完成\n各段事实一致。'
      : '总体判断：可通过\n必改数量：0\n## 本段事实摘要\n角色从小镇出发。'
    options.onChunk?.(report)
    return { content: report, finishReason: 'stop' }
  })
}

describe('ChapterList batch review integration', () => {
  it('reviews a 5000-character chapter with chunked coverage and global relation check', async () => {
    const store = useNovelStore()
    const book = store.addNovel({
      genre: 'fantasy', subGenre: '', tags: [], targetWordCountMin: 10, targetWordCountMax: 20,
      writingMode: 'manual', settings: store.defaultSettings(), writingStyle: store.defaultWritingStyle(),
    })
    reactiveRoute.params.novelId = book.id
    const source = '甲'.repeat(4994) + '尾部唯一证据'
    const chapter = store.addChapter(book.id, { title: '启程', content: source })!

    mockReviewAI()

    const wrapper = shallowMount(ChapterList, {
      global: { stubs: { Button }, renderStubDefaultSlot: true },
    })
    await flushPromises()

    const buttons = wrapper.findAll('button')
    const batchButton = buttons.find(b => b.text() === '批量审校')
    expect(batchButton).toBeDefined()
    await batchButton!.trigger('click')
    await flushPromises()

    expect(enqueuedTasks.batches).toHaveLength(1)
    expect(enqueuedTasks.batches[0].tasks).toHaveLength(1)

    const task = enqueuedTasks.batches[0].tasks[0].task
    await task()

    const updated = store.getNovel(book.id)!.chapters.find(c => c.id === chapter.id)!
    expect(updated.content).toBe(source)
    expect(updated.contentReview).toContain('总体判断：可通过')
    expect(updated.contentReview).toContain('全章关系复核完成')
    expect(updated.contentReviewCoverage).toMatchObject({
      totalChunks: 2,
      completedChunks: 2,
      globalStatus: 'complete',
      status: 'complete',
      coveredCharacters: source.length,
    })
    expect(updated.contentReviewSignature).toBe('batch-review-v1')
    expect(updated.status).toBe('reviewed')

    const calls = vi.mocked(callAI).mock.calls
    expect(calls.filter(([opts]) => opts.taskName?.includes('分段'))).toHaveLength(2)
    expect(calls.find(([opts]) => opts.taskName?.includes('分段 2/2'))![0].messages[1].content).toContain('尾部唯一证据')
    expect(calls.filter(([opts]) => opts.taskName?.includes('全章关系复核'))).toHaveLength(1)

    wrapper.unmount()
  })

  it('records failed coverage when later chunk fails without overwriting original', async () => {
    const store = useNovelStore()
    const book = store.addNovel({
      genre: 'fantasy', subGenre: '', tags: [], targetWordCountMin: 10, targetWordCountMax: 20,
      writingMode: 'manual', settings: store.defaultSettings(), writingStyle: store.defaultWritingStyle(),
    })
    reactiveRoute.params.novelId = book.id
    const source = '乙'.repeat(5000)
    const chapter = store.addChapter(book.id, { title: '继续', content: source })!

    vi.mocked(callAI).mockImplementation(async (options: ChatCompletionOptions) => {
      if (options.taskName?.includes('分段 2/2')) {
        throw new Error('第二段失败')
      }
      const report = '总体判断：可通过\n必改数量：0\n## 本段事实摘要\n角色出发。'
      options.onChunk?.(report)
      return { content: report, finishReason: 'stop' }
    })

    const wrapper = shallowMount(ChapterList, {
      global: { stubs: { Button }, renderStubDefaultSlot: true },
    })
    await flushPromises()

    const buttons = wrapper.findAll('button')
    const batchButton = buttons.find(b => b.text() === '批量审校')
    await batchButton!.trigger('click')
    await flushPromises()

    const task = enqueuedTasks.batches[0].tasks[0].task
    await expect(task()).rejects.toThrow()

    const updated = store.getNovel(book.id)!.chapters.find(c => c.id === chapter.id)!
    expect(updated.content).toBe(source)
    expect(updated.contentReview).toBe('')
    expect(updated.contentReviewSignature).toBe('')
    expect(updated.contentReviewCoverage).toMatchObject({
      status: 'failed',
      completedChunks: 1,
      failedChunk: 2,
      globalStatus: 'pending',
    })
    expect(updated.status).not.toBe('reviewed')

    const calls = vi.mocked(callAI).mock.calls
    expect(calls.filter(([opts]) => opts.taskName?.includes('全章关系复核'))).toHaveLength(0)

    wrapper.unmount()
  })

  it('rejects stale review when chapter content changes during pending request', async () => {
    const store = useNovelStore()
    const book = store.addNovel({
      genre: 'fantasy', subGenre: '', tags: [], targetWordCountMin: 10, targetWordCountMax: 20,
      writingMode: 'manual', settings: store.defaultSettings(), writingStyle: store.defaultWritingStyle(),
    })
    reactiveRoute.params.novelId = book.id
    const original = '丙'.repeat(5000)
    const chapter = store.addChapter(book.id, { title: '中途', content: original })!

    vi.mocked(callAI).mockImplementation(async (options: ChatCompletionOptions) => {
      if (options.taskName?.includes('分段 1/2')) {
        store.updateChapter(book.id, chapter.id, { content: '丁'.repeat(5000) })
      }
      const report = '总体判断：可通过\n必改数量：0\n## 本段事实摘要\n角色出发。'
      options.onChunk?.(report)
      return { content: report, finishReason: 'stop' }
    })

    const wrapper = shallowMount(ChapterList, {
      global: { stubs: { Button }, renderStubDefaultSlot: true },
    })
    await flushPromises()

    const buttons = wrapper.findAll('button')
    const batchButton = buttons.find(b => b.text() === '批量审校')
    await batchButton!.trigger('click')
    await flushPromises()

    const task = enqueuedTasks.batches[0].tasks[0].task
    await expect(task()).rejects.toThrow('正文或设定已变化')

    const updated = store.getNovel(book.id)!.chapters.find(c => c.id === chapter.id)!
    expect(updated.content).not.toBe(original)
    expect(updated.contentReview).toBe('')
    expect(updated.contentReviewCoverage).toMatchObject({
      status: 'failed',
      completedChunks: 0,
    })

    wrapper.unmount()
  })

  it('excludes locked chapters from batch queue and shows info when only locked', async () => {
    const store = useNovelStore()
    const book = store.addNovel({
      genre: 'fantasy', subGenre: '', tags: [], targetWordCountMin: 10, targetWordCountMax: 20,
      writingMode: 'manual', settings: store.defaultSettings(), writingStyle: store.defaultWritingStyle(),
    })
    reactiveRoute.params.novelId = book.id
    const locked = store.addChapter(book.id, { title: '锁定章', content: '戊'.repeat(5000), status: 'locked' })!
    store.updateChapter(book.id, locked.id, { status: 'locked' })
    const draft = store.addChapter(book.id, { title: '可审章', content: '己'.repeat(5000) })!

    mockReviewAI()

    const wrapper = shallowMount(ChapterList, {
      global: { stubs: { Button }, renderStubDefaultSlot: true },
    })
    await flushPromises()

    const buttons = wrapper.findAll('button')
    const batchButton = buttons.find(b => b.text() === '批量审校')
    await batchButton!.trigger('click')
    await flushPromises()

    expect(enqueuedTasks.batches).toHaveLength(1)
    expect(enqueuedTasks.batches[0].tasks).toHaveLength(1)
    expect(enqueuedTasks.batches[0].tasks[0].name).toContain('第2章')

    const task = enqueuedTasks.batches[0].tasks[0].task
    await task()

    const updatedLocked = store.getNovel(book.id)!.chapters.find(c => c.id === locked.id)!
    const updatedDraft = store.getNovel(book.id)!.chapters.find(c => c.id === draft.id)!
    expect(updatedLocked.contentReview).toBe('')
    expect(updatedDraft.contentReview).toContain('可通过')

    wrapper.unmount()

    store.deleteChapter(book.id, draft.id)
    const wrapperOnlyLocked = shallowMount(ChapterList, {
      global: { stubs: { Button }, renderStubDefaultSlot: true },
    })
    await flushPromises()

    const buttonsLocked = wrapperOnlyLocked.findAll('button')
    const batchButtonLocked = buttonsLocked.find(b => b.text() === '批量审校')
    await batchButtonLocked!.trigger('click')
    await flushPromises()

    expect(messages.info).toHaveBeenCalledWith('没有可审校的章节')
    expect(enqueuedTasks.batches).toHaveLength(1)

    wrapperOnlyLocked.unmount()
  })
})
