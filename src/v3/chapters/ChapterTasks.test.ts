// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, reactive } from 'vue'
import { flushPromises, shallowMount, enableAutoUnmount } from '@vue/test-utils'
import { NInputNumber, NModal, NPopconfirm } from 'naive-ui'
import ChapterList from '@/v3/chapters/ChapterTasks.vue'
import AutonomousDraftPanel from '@/components/AutonomousDraftPanel.vue'
import { useNovelStore } from '@/stores/novel'
import { useConfigStore, type ModelConfig } from '@/stores/config'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { callAI, type ChatCompletionOptions } from '@/services/ai'
import { saveNovelToDb } from '@/services/db/novels'
import { createStoryMemoryBinding } from '@/services/storyMemory'
import { createAiRun } from '@/services/reconstructionAiRun'
import { saveReconstructionRun } from '@/services/db/reconstructionRuns'
import { buildChapterReviewInput } from '@/services/chapterReviewInput'
import { saveStoryAggregate } from '@/services/storyAggregate'

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
const autonomous = vi.hoisted(() => ({
  execute: vi.fn(),
  processor: vi.fn(),
}))
vi.mock('@/services/aiTaskQueue', () => ({
  chapterBackgroundQueue: {
    enqueueBatch: vi.fn((name: string, tasks: Array<{ name: string; task: () => Promise<void> }>) => {
      enqueuedTasks.batches.push({ name, tasks })
    }),
  },
}))
vi.mock('@/services/reconstructionAutonomous', async original => ({
  ...await original<object>(),
  executeAutonomousRun: autonomous.execute,
}))
vi.mock('@/services/reconstructionAutonomousChapter', () => ({
  createAutonomousEmptyChapterProcessor: autonomous.processor,
}))
vi.mock('@/services/db/reconstruction', () => ({
  loadReconstructionWorkspace: vi.fn().mockResolvedValue({ candidates: [], reviewFindings: [], chapterReviews: [], aiRuns: [], canonMutations: [] }),
  saveReconstructionWorkspace: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/services/db/reconstructionRuns', () => ({
  saveReconstructionRun: vi.fn().mockResolvedValue(undefined),
}))
// Component storage is replaceable; real SQL/kernel rollback is tested separately.
vi.mock('@/services/storyAggregate', () => ({
  readStoryAggregate: vi.fn(async () => ({ novel: null, workspace: {
    candidates: [], reviewFindings: [], chapterReviews: [], aiRuns: [], canonMutations: [], storyMemories: [], impactReports: [],
  } })),
  saveStoryAggregate: vi.fn().mockResolvedValue(undefined),
}))

const Button = defineComponent({
  props: ['disabled', 'loading'],
  template: '<button :disabled="disabled || loading"><slot /></button>',
})

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  enqueuedTasks.batches = []
  autonomous.execute.mockImplementation(async (input: { run: import('@/types/reconstruction').AiRun; persist: (run: import('@/types/reconstruction').AiRun) => Promise<void> }) => {
    const result = {
      ...input.run,
      status: 'completed' as const,
      usedTokens: 321,
      requests: [{ id: input.run.id + ':request:1', chapterIndex: input.run.chapterStart!,
        phase: 'writing' as const, modelId: 'test', status: 'completed' as const, reservedTokens: 500,
        inputTokens: 300, outputTokens: 21, usageSource: 'reported' as const,
        startedAt: input.run.createdAt, completedAt: input.run.createdAt }],
      checkpoint: `chapter-${input.run.chapterEnd}:completed`,
      updatedAt: input.run.createdAt,
    }
    await input.persist(result)
    return result
  })
  autonomous.processor.mockReturnValue(vi.fn())
  vi.mocked(saveNovelToDb).mockResolvedValue()
  vi.mocked(saveStoryAggregate).mockResolvedValue()
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

async function useRealAutonomousPipeline() {
  const executor = await vi.importActual<typeof import('@/services/reconstructionAutonomous')>('@/services/reconstructionAutonomous')
  const processor = await vi.importActual<typeof import('@/services/reconstructionAutonomousChapter')>('@/services/reconstructionAutonomousChapter')
  autonomous.execute.mockImplementation(executor.executeAutonomousRun)
  autonomous.processor.mockImplementation((runtime: Parameters<typeof processor.createAutonomousEmptyChapterProcessor>[0]) =>
    processor.createAutonomousEmptyChapterProcessor({ ...runtime, extractCandidates: async () => ({ candidates: [] }) }))
}

describe('chapter list summary confirmation', () => {
  async function summaryEditor() {
    const store = useNovelStore()
    const book = store.addNovel({ genre: 'fantasy', subGenre: '', tags: [], targetWordCountMin: 10, targetWordCountMax: 20,
      settings: store.defaultSettings(), writingStyle: store.defaultWritingStyle() })
    const chapter = store.addChapter(book.id, { content: '作者正文。', summary: '旧总结。' })!
    store.updateChapter(book.id, chapter.id, { summarySource: undefined })
    reactiveRoute.params.novelId = book.id
    const Input = defineComponent({ props: ['value', 'disabled'], emits: ['update:value'],
      template: `<textarea :value="value" :disabled="disabled" @input="$emit('update:value', $event.target.value)" />` })
    const wrapper = shallowMount(ChapterList, { global: { stubs: { Button, Input }, renderStubDefaultSlot: true } })
    await flushPromises()
    await wrapper.get('.summary-toggle').trigger('click')
    expect(wrapper.get('.summary-indicator').text()).toBe('总结待核对')
    await wrapper.findAll('button').find(button => button.text() === '编辑并核对')!.trigger('click')
    return { wrapper, store, book, chapter }
  }

  it('saves the edited summary with its original body baseline and updates the status', async () => {
    const { wrapper, store, book, chapter } = await summaryEditor()
    const save = vi.spyOn(store, 'saveChapterSummary').mockImplementation(async (_book, _chapter, _content, _summary, summary) => {
      store.updateChapter(book.id, chapter.id, { summary })
    })
    await wrapper.get('.summary-panel textarea').setValue('作者核对后的总结。')
    await wrapper.findAll('button').find(button => button.text() === '保存并确认')!.trigger('click')
    await flushPromises()
    expect(save).toHaveBeenCalledWith(book.id, chapter.id, '作者正文。', '旧总结。', '作者核对后的总结。')
    expect(wrapper.get('.summary-indicator').text()).toBe('总结有效')
    expect(wrapper.find('.summary-panel textarea').exists()).toBe(false)
  })

  it('keeps edits available for retry after a failed save', async () => {
    const { wrapper, store } = await summaryEditor()
    vi.spyOn(store, 'saveChapterSummary').mockRejectedValue(new Error('正文或总结已变化，请重新核对后保存。'))
    await wrapper.get('.summary-panel textarea').setValue('作者尚未保存的总结。')
    await wrapper.findAll('button').find(button => button.text() === '保存并确认')!.trigger('click')
    await flushPromises()
    expect(wrapper.get<HTMLTextAreaElement>('.summary-panel textarea').element.value).toBe('作者尚未保存的总结。')
    expect(messages.error).toHaveBeenCalledWith(expect.stringContaining('已变化'))
    expect(wrapper.get('.summary-indicator').text()).toBe('总结待核对')
  })

  it('warns when prose changed during a successful save instead of declaring the summary current', async () => {
    const { wrapper, store, book, chapter } = await summaryEditor()
    vi.spyOn(store, 'saveChapterSummary').mockImplementation(async (_book, _chapter, _content, _summary, summary) => {
      store.updateChapter(book.id, chapter.id, { summary })
      store.updateChapter(book.id, chapter.id, { content: '保存时作者改了正文。' })
    })
    await wrapper.findAll('button').find(button => button.text() === '保存并确认')!.trigger('click')
    await flushPromises()
    expect(wrapper.get('.summary-indicator').text()).toBe('总结待核对')
    expect(messages.warning).toHaveBeenCalledWith(expect.stringContaining('保存期间'))
    expect(messages.success).not.toHaveBeenCalled()
  })
})

describe('ChapterList deletion confirmation', () => {
  it('lets the author inspect deleted text without making it a live chapter or requesting AI', async () => {
    const store = useNovelStore()
    const book = store.addNovel({ genre: 'fantasy', subGenre: '', tags: [], targetWordCountMin: 10, targetWordCountMax: 20,
      settings: store.defaultSettings(), writingStyle: store.defaultWritingStyle() })
    const chapter = store.addChapter(book.id, { title: '归档合成章', content: '已删除的合成正文。', contentReview: '历史审核报告。' })!
    book.archivedChapters = [{ ...chapter, archivedAt: book.updatedAt }]
    book.chapters = []; book.currentWordCount = 0
    reactiveRoute.params.novelId = book.id
    const wrapper = shallowMount(ChapterList, { global: { stubs: { Button }, renderStubDefaultSlot: true } })
    await flushPromises()
    expect(wrapper.find('.chapter-card').exists()).toBe(false)
    await wrapper.get('[aria-label="已删除章节"] button').trigger('click')
    expect(wrapper.get('[aria-label="已删除章节"]').text()).toContain('已删除的合成正文。')
    expect(wrapper.get('[aria-label="已删除章节"]').text()).toContain('历史审核报告。')
    expect(book.chapters).toEqual([])
    expect(callAI).not.toHaveBeenCalled()
  })

  it.each([false, true])('retains the opening baseline and waits for storage before success (all: %s)', async all => {
    const store = useNovelStore()
    const book = store.addNovel({ genre: 'fantasy', subGenre: '', tags: [], targetWordCountMin: 10, targetWordCountMax: 20,
      settings: store.defaultSettings(), writingStyle: store.defaultWritingStyle() })
    const chapter = store.addChapter(book.id, { title: '合成删除目标', content: '合成正文。' })!
    reactiveRoute.params.novelId = book.id
    let finish!: (value: boolean) => void
    const deleting = vi.spyOn(store, 'deleteChapter').mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const clearing = vi.spyOn(store, 'clearChapters').mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const capture = vi.spyOn(store, 'captureChapterDeletionBaseline')
    const wrapper = shallowMount(ChapterList, { global: { stubs: { Button }, renderStubDefaultSlot: true } })
    await flushPromises()
    const popup = wrapper.findAllComponents(NPopconfirm).find(node => node.text().includes(all ? '确定清空所有章节' : '确定删除此章节'))!
    popup.vm.$emit('update:show', true)
    const opening = capture.mock.results.slice(-1)[0].value
    // A later edit must not be silently substituted for the snapshot the author saw.
    store.updateChapter(book.id, chapter.id, { title: '确认期间的作者编辑' })
    const result = (popup.props('onPositiveClick') as () => Promise<boolean>)()
    if (all) expect(clearing).toHaveBeenCalledWith(book.id, opening)
    else expect(deleting).toHaveBeenCalledWith(book.id, chapter.id, opening)
    expect(messages.success).not.toHaveBeenCalled()
    finish(true)
    expect(await result).toBe(true)
    expect(messages.success).toHaveBeenCalledWith(all ? '已清空全部章节' : '章节已删除')
  })

  it.each([false, true])('shows a deletion error without claiming success and permits a save retry (all: %s)', async all => {
    const store = useNovelStore()
    const book = store.addNovel({ genre: 'fantasy', subGenre: '', tags: [], targetWordCountMin: 10, targetWordCountMax: 20,
      settings: store.defaultSettings(), writingStyle: store.defaultWritingStyle() })
    store.addChapter(book.id, { title: '合成目标', content: '保留正文。' })
    reactiveRoute.params.novelId = book.id
    const action = all ? vi.spyOn(store, 'clearChapters') : vi.spyOn(store, 'deleteChapter')
    action.mockRejectedValueOnce(new Error('合成删除保存失败')).mockResolvedValue(true)
    const before = JSON.stringify(book)
    const wrapper = shallowMount(ChapterList, { global: { stubs: { Button }, renderStubDefaultSlot: true } })
    await flushPromises()
    const popup = wrapper.findAllComponents(NPopconfirm).find(node => node.text().includes(all ? '确定清空所有章节' : '确定删除此章节'))!
    popup.vm.$emit('update:show', true)
    const confirm = popup.props('onPositiveClick') as () => Promise<boolean>
    expect(await confirm()).toBe(false)
    expect(JSON.stringify(book)).toBe(before)
    expect(messages.success).not.toHaveBeenCalled()
    expect(messages.error).toHaveBeenCalledWith('合成删除保存失败')
    expect(await confirm()).toBe(true)
    expect(action).toHaveBeenCalledTimes(2)
    expect(action.mock.calls[0]).toEqual(action.mock.calls[1])
  })
})

describe('ChapterList batch review integration', () => {
  it('rejects shortcut task generation after its prior story memory is re-confirmed', async () => {
    await useRealAutonomousPipeline()
    const store = useNovelStore(), workspace = useReconstructionWorkspaceStore()
    const created = store.addNovel({ genre: 'fantasy', subGenre: '', tags: [], targetWordCountMin: 10, targetWordCountMax: 20,
      writingMode: 'ai', settings: store.defaultSettings(), writingStyle: store.defaultWritingStyle() })
    const prior = store.addChapter(created.id, { title: '渡口', content: '林澈留在渡口。' })!
    const target = store.addChapter(created.id, { title: '下一章', content: '' })!
    const novel = store.getNovel(created.id)!, scope = { kind: 'book' as const, throughChapterId: prior.id }
    const memory = { id: 'memory', novelId: novel.id, title: '前情', scope, summary: '林澈在渡口。',
      source: createStoryMemoryBinding(novel, scope, '林澈在渡口。', 'author', '2026-10-28T00:00:00.000Z'), history: [] }
    vi.spyOn(workspace, 'getStoryMemories').mockImplementation(() => [memory])
    reactiveRoute.params.novelId = novel.id
    const wrapper = shallowMount(ChapterList, { global: { stubs: { Button }, renderStubDefaultSlot: true } })
    await flushPromises()
    vi.mocked(callAI).mockImplementation(async options => {
      memory.summary = '林澈仍在渡口等船。'
      memory.source = createStoryMemoryBinding(novel, scope, memory.summary, 'author', '2026-10-28T00:01:00.000Z')
      options.onChunk?.('不应接受的旧上下文结果。')
      return { content: '不应接受的旧上下文结果。', finishReason: 'stop' }
    })
    await wrapper.findAll('button').find(button => button.text() === '批量生成空章')!.trigger('click')
    await flushPromises()
    expect(wrapper.getComponent(NModal).props('show')).toBe(true)
    expect(callAI).not.toHaveBeenCalled()
    await wrapper.findAll('button').find(button => button.text() === '开始自动写作')!.trigger('click')
    await flushPromises()
    expect(autonomous.execute).toHaveBeenCalledTimes(1)
    expect(callAI).toHaveBeenCalledTimes(1)
    expect(workspace.getAiRuns(novel.id)[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('设定、人物状态或前文已变化') })
    expect(workspace.getAiRuns(novel.id)[0].chapterDrafts || []).toHaveLength(0)
    expect(enqueuedTasks.batches).toHaveLength(0)
    expect(novel.chapters.find(chapter => chapter.id === target.id)!.content).toBe('')
  })

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
    expect(updated.contentReviewSignature).toBe(buildChapterReviewInput(book, chapter).signature)
    expect(useReconstructionWorkspaceStore().getLatestChapterReview(book.id, chapter.id)?.status).toBe('ready_to_finalize')
    expect(['completed', 'finalized']).not.toContain(updated.status)

    const calls = vi.mocked(callAI).mock.calls
    expect(calls.filter(([opts]) => opts.taskName?.includes('分段'))).toHaveLength(2)
    expect(calls.find(([opts]) => opts.taskName?.includes('分段 2/2'))![0].messages[1].content).toContain('尾部唯一证据')
    expect(calls.filter(([opts]) => opts.taskName?.includes('全章关系复核'))).toHaveLength(1)

    wrapper.unmount()
  })

  it.each([false, true])('keeps a failed batch report and retries only persistence (source changes: %s)', async changed => {
    const store = useNovelStore(), workspace = useReconstructionWorkspaceStore()
    const book = store.addNovel({ genre: 'fantasy', subGenre: '', tags: [], targetWordCountMin: 10, targetWordCountMax: 20,
      settings: store.defaultSettings(), writingStyle: store.defaultWritingStyle() })
    reactiveRoute.params.novelId = book.id
    const chapter = store.addChapter(book.id, { title: '待审章', content: '合成正文。'.repeat(50) })!
    mockReviewAI()
    const wrapper = shallowMount(ChapterList, { global: { stubs: { Button }, renderStubDefaultSlot: true } })
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '批量审校')!.trigger('click')
    await flushPromises()
    vi.mocked(saveStoryAggregate).mockRejectedValueOnce(new Error('模拟审核保存失败'))
    await expect(enqueuedTasks.batches[0].tasks[0].task()).rejects.toThrow('模拟审核保存失败')
    await flushPromises()
    expect(chapter.contentReview).toBe('')
    expect(workspace.getChapterReviews(book.id)).toEqual([])
    expect(wrapper.get('[aria-label="待保存的批量审核报告"]').text()).toContain('模拟审核保存失败')
    const requests = vi.mocked(callAI).mock.calls.length
    if (changed) store.updateChapter(book.id, chapter.id, { title: '作者改变了标题' })
    await wrapper.findAll('button').find(button => button.text() === '重试保存审核报告')!.trigger('click')
    await flushPromises()
    expect(vi.mocked(callAI).mock.calls).toHaveLength(requests)
    if (changed) {
      expect(chapter.contentReview).toBe('')
      expect(wrapper.get('[aria-label="待保存的批量审核报告"]').text()).toContain('审核依据已变化')
    } else {
      expect(chapter.contentReview).toContain('总体判断：可通过')
      expect(workspace.getLatestChapterReview(book.id, chapter.id)?.status).toBe('ready_to_finalize')
      expect(wrapper.find('[aria-label="待保存的批量审核报告"]').exists()).toBe(false)
    }
  })

  it('runs the same local time checks for a batch report even when the model says passed', async () => {
    const store = useNovelStore()
    const book = store.addNovel({ genre: 'fantasy', subGenre: '', tags: [], targetWordCountMin: 10, targetWordCountMax: 20,
      settings: store.defaultSettings(), writingStyle: store.defaultWritingStyle() })
    reactiveRoute.params.novelId = book.id
    const source = '距月底还有三天。次日，离月底还有三天。' + '合成情节。'.repeat(30)
    const chapter = store.addChapter(book.id, { title: '时间矛盾', content: source })!
    store.updateChapter(book.id, chapter.id, { status: 'finalized' })
    mockReviewAI()
    const wrapper = shallowMount(ChapterList, { global: { stubs: { Button }, renderStubDefaultSlot: true } })
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '批量审校')!.trigger('click')
    await flushPromises()
    await enqueuedTasks.batches[0].tasks[0].task()
    expect(chapter.content).toBe(source)
    expect(chapter.contentReview).toContain('本地硬伤预检')
    expect(chapter.status).toBe('writing')
    expect(useReconstructionWorkspaceStore().getLatestChapterReview(book.id, chapter.id)).toMatchObject({
      deterministicChecksPassed: false, status: 'needs_revision',
    })
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

    // The second queue scenario contains only a locked chapter; deletion has its own transaction tests.
    book.chapters = book.chapters.filter(row => row.id !== draft.id)
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

describe('ChapterList autonomous run integration', () => {
  function shortcutBook() {
    const store = useNovelStore()
    const created = store.addNovel({ genre: 'fantasy', subGenre: '', tags: [], targetWordCountMin: 10, targetWordCountMax: 20,
      writingMode: 'ai', settings: store.defaultSettings(), writingStyle: store.defaultWritingStyle() })
    const book = store.getNovel(created.id)!
    store.addChapter(book.id, { title: '作者已写', content: '林澈留在渡口。' })
    const locked = store.addChapter(book.id, { title: '锁定空章' })!
    store.updateChapter(book.id, locked.id, { status: 'locked' })
    store.addChapter(book.id, { title: '候选第一章' })
    store.addChapter(book.id, { title: '候选第二章' })
    store.addChapter(book.id, { title: '后续作者正文', content: '守夜人合上铜盒。' })
    store.addChapter(book.id, { title: '范围外空章' })
    reactiveRoute.params.novelId = book.id
    return { store, book }
  }
  const mountList = () => shallowMount(ChapterList, { global: { stubs: { Button }, renderStubDefaultSlot: true } })

  it('opens the candidate task with a contiguous empty range and visible budgets without dispatching on open or remount', async () => {
    const { book } = shortcutBook()
    const wrapper = mountList()
    await flushPromises()
    const original = JSON.stringify(book)
    expect(callAI).not.toHaveBeenCalled()
    expect(autonomous.execute).not.toHaveBeenCalled()
    await wrapper.findAll('button').find(button => button.text() === '批量生成空章')!.trigger('click')
    await flushPromises()

    expect(wrapper.getComponent(NModal).props('show')).toBe(true)
    expect(wrapper.getComponent(AutonomousDraftPanel).props()).toMatchObject({ novelId: book.id, runs: [] })
    expect(wrapper.text()).toContain('由你接受后才写入正文')
    expect(wrapper.text()).toContain('当前范围：第 3 至第 4 章')
    expect(wrapper.text()).toContain('Token 预算')
    expect(wrapper.text()).toContain('请求次数上限')
    expect(wrapper.findAllComponents(NInputNumber).map(input => input.props('value'))).toEqual([3, 4, 120000, 200, 0])
    expect(enqueuedTasks.batches).toHaveLength(0)
    expect(autonomous.processor).not.toHaveBeenCalled()
    expect(autonomous.execute).not.toHaveBeenCalled()
    expect(callAI).not.toHaveBeenCalled()
    expect(saveReconstructionRun).not.toHaveBeenCalled()
    expect(JSON.stringify(book)).toBe(original)

    wrapper.unmount()
    const reopened = mountList()
    await flushPromises()
    expect(reopened.getComponent(NModal).props('show')).toBe(false)
    expect(autonomous.execute).not.toHaveBeenCalled()
    expect(callAI).not.toHaveBeenCalled()
  })

  it('uses the existing processor and persistence only after confirmation and keeps generated candidates out of prose and Canon', async () => {
    await useRealAutonomousPipeline()
    const { book } = shortcutBook(), workspace = useReconstructionWorkspaceStore()
    const wrapper = mountList()
    await flushPromises()
    const original = JSON.stringify(book), canon = JSON.stringify(workspace.getCanonMutations(book.id))
    const generated = '甲'.repeat(2100) + '。'
    mockReviewAI()
    const reviewReply = vi.mocked(callAI).getMockImplementation()!
    vi.mocked(callAI).mockImplementation(options => options.skillTask === 'writing'
      ? Promise.resolve({ content: generated, finishReason: 'stop' }) : reviewReply(options))
    await wrapper.findAll('button').find(button => button.text() === '批量生成空章')!.trigger('click')
    await flushPromises()
    expect(callAI).not.toHaveBeenCalled()
    const inputs = wrapper.findAllComponents(NInputNumber)
    inputs[1].vm.$emit('update:value', 3)
    inputs[2].vm.$emit('update:value', 50000)
    inputs[3].vm.$emit('update:value', 12)
    await flushPromises()
    expect(wrapper.text()).toContain('当前范围：第 3 至第 3 章')
    await wrapper.findAll('button').find(button => button.text() === '开始自动写作')!.trigger('click')
    await flushPromises()

    expect(autonomous.execute).toHaveBeenCalledTimes(1)
    const input = autonomous.execute.mock.calls[0][0] as { run: import('@/types/reconstruction').AiRun }
    expect(input.run).toMatchObject({ mode: 'autonomous', chapterStart: 2, chapterEnd: 2, tokenBudget: 50000, requestLimit: 12 })
    expect(autonomous.processor).toHaveBeenCalledTimes(1)
    expect(callAI).toHaveBeenCalled()
    expect(enqueuedTasks.batches).toHaveLength(0)
    const run = workspace.getAiRuns(book.id)[0]
    expect(run.status).toBe('completed')
    expect(run.chapterDrafts).toHaveLength(1)
    expect(run.chapterDrafts![0]).toMatchObject({ chapterId: book.chapters[2].id, chapterIndex: 2, content: generated, status: 'pending', stage: 'analyzed' })
    expect(wrapper.getComponent(AutonomousDraftPanel).props('runs')[0]).toEqual(run)
    expect(saveReconstructionRun).toHaveBeenLastCalledWith(book.id, run)
    expect(JSON.stringify(book)).toBe(original)
    expect(JSON.stringify(workspace.getCanonMutations(book.id))).toBe(canon)

    wrapper.unmount()
    mountList()
    await flushPromises()
    expect(autonomous.execute).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(book)).toBe(original)
  })

  it.each(['running', 'paused', 'needs_author'] as const)('opens an existing %s task without dispatching a second task', async status => {
    const { book } = shortcutBook(), workspace = useReconstructionWorkspaceStore()
    const wrapper = mountList()
    await flushPromises()
    const run = { ...createAiRun({ id: 'existing', mode: 'autonomous', taskType: 'draft', targetId: book.id,
      chapterStart: 5, chapterEnd: 5, tokenBudget: 7000, requestLimit: 9, now: '2026-10-31T00:00:00.000Z' }), status }
    workspace.replaceAiRun(book.id, run)
    await wrapper.findAll('button').find(button => button.text() === '批量生成空章')!.trigger('click')
    await flushPromises()
    expect(wrapper.getComponent(NModal).props('show')).toBe(true)
    expect(wrapper.find('.autonomous-run-form').exists()).toBe(false)
    expect(wrapper.getComponent(AutonomousDraftPanel).props('runs')).toEqual([run])
    expect(workspace.getAiRun(book.id, run.id)).toEqual(run)
    expect(enqueuedTasks.batches).toHaveLength(0)
    expect(autonomous.execute).not.toHaveBeenCalled()
    expect(callAI).not.toHaveBeenCalled()
    expect(saveReconstructionRun).not.toHaveBeenCalled()
  })

  it('does not offer a generation range when all chapters are written or locked', async () => {
    const { store, book } = shortcutBook()
    for (const chapter of book.chapters) if (!chapter.content && chapter.status !== 'locked') store.updateChapter(book.id, chapter.id, { status: 'locked' })
    const wrapper = mountList()
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '批量生成空章')!.trigger('click')
    await flushPromises()
    expect(wrapper.getComponent(NModal).props('show')).toBe(false)
    expect(messages.info).toHaveBeenCalledWith('没有需要批量生成的空白章节')
    expect(enqueuedTasks.batches).toHaveLength(0)
    expect(autonomous.execute).not.toHaveBeenCalled()
    expect(callAI).not.toHaveBeenCalled()
  })

  it('recovers interrupted usage without automatically sending another request', async () => {
    const store = useNovelStore()
    const book = store.addNovel({ genre: 'fantasy', subGenre: '', tags: [], targetWordCountMin: 10, targetWordCountMax: 20,
      writingMode: 'manual', settings: store.defaultSettings(), writingStyle: store.defaultWritingStyle() })
    reactiveRoute.params.novelId = book.id
    store.addChapter(book.id, { title: '第一章' })
    const wrapper = shallowMount(ChapterList, { global: { stubs: { Button }, renderStubDefaultSlot: true } })
    await flushPromises()
    const now = '2026-10-28T00:00:00.000Z'
    const run = { ...createAiRun({ id: 'interrupted', mode: 'autonomous', taskType: 'draft', targetId: book.id,
      chapterStart: 0, chapterEnd: 0, tokenBudget: 1000, now }), status: 'running' as const, usedTokens: 500,
      checkpoint: 'chapter-0:started', requests: [{ id: 'request-1', chapterIndex: 0, phase: 'writing' as const, modelId: 'test',
        status: 'pending' as const, reservedTokens: 500, inputTokens: 300, outputTokens: 200, usageSource: 'reservation' as const, startedAt: now }] }
    useReconstructionWorkspaceStore().replaceAiRun(book.id, run)
    await wrapper.findAll('button').find(button => button.text() === '自动写作任务')!.trigger('click')
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '恢复中断任务')!.trigger('click')
    await flushPromises()
    const recovered = useReconstructionWorkspaceStore().getAiRun(book.id, run.id)!
    expect(recovered).toMatchObject({ status: 'paused', checkpoint: 'chapter-0:started', usedTokens: 500 })
    expect(recovered.requests?.[0]).toMatchObject({ status: 'interrupted', usageSource: 'estimated' })
    expect(autonomous.execute).not.toHaveBeenCalled()
    expect(callAI).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('1 次含预留或估算')
  })

  it('keeps an interrupted task unchanged when recovery cannot be saved', async () => {
    const store = useNovelStore()
    const book = store.addNovel({ genre: 'fantasy', subGenre: '', tags: [], targetWordCountMin: 10, targetWordCountMax: 20,
      writingMode: 'manual', settings: store.defaultSettings(), writingStyle: store.defaultWritingStyle() })
    reactiveRoute.params.novelId = book.id
    store.addChapter(book.id, { title: '第一章' })
    const wrapper = shallowMount(ChapterList, { global: { stubs: { Button }, renderStubDefaultSlot: true } })
    await flushPromises()
    const run = { ...createAiRun({ id: 'interrupted', mode: 'autonomous', taskType: 'draft', targetId: book.id,
      chapterStart: 0, chapterEnd: 0, tokenBudget: 1000, now: '2026-10-28T00:00:00.000Z' }), status: 'running' as const }
    useReconstructionWorkspaceStore().replaceAiRun(book.id, run)
    vi.mocked(saveReconstructionRun).mockRejectedValueOnce(new Error('磁盘不可写'))
    await wrapper.findAll('button').find(button => button.text() === '自动写作任务')!.trigger('click')
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '恢复中断任务')!.trigger('click')
    await flushPromises()
    expect(useReconstructionWorkspaceStore().getAiRun(book.id, run.id)?.status).toBe('running')
    expect(messages.error).toHaveBeenCalledWith('磁盘不可写')
    expect(autonomous.execute).not.toHaveBeenCalled()
  })

  it('creates a bounded autonomous run from the chapter list and persists its completion', async () => {
    const store = useNovelStore()
    const book = store.addNovel({
      genre: 'fantasy', subGenre: '', tags: [], targetWordCountMin: 10, targetWordCountMax: 20,
      writingMode: 'manual', settings: store.defaultSettings(), writingStyle: store.defaultWritingStyle(),
    })
    reactiveRoute.params.novelId = book.id
    store.addChapter(book.id, { title: '第一章' })
    store.addChapter(book.id, { title: '第二章' })

    const wrapper = shallowMount(ChapterList, {
      global: { stubs: { Button }, renderStubDefaultSlot: true },
    })
    await flushPromises()

    const openButton = wrapper.findAll('button').find(button => button.text() === '自动写作任务')
    expect(openButton).toBeDefined()
    await openButton!.trigger('click')
    await flushPromises()

    const startButton = wrapper.findAll('button').find(button => button.text() === '开始自动写作')
    expect(startButton).toBeDefined()
    await startButton!.trigger('click')
    await flushPromises()

    expect(autonomous.execute).toHaveBeenCalledTimes(1)
    const input = autonomous.execute.mock.calls[0][0] as { run: import('@/types/reconstruction').AiRun }
    expect(input.run.mode).toBe('autonomous')
    expect(input.run.chapterStart).toBe(0)
    expect(input.run.chapterEnd).toBe(0)
    expect(input.run.tokenBudget).toBe(120000)
    expect(useReconstructionWorkspaceStore().getAiRuns(book.id)[0]).toMatchObject({
      status: 'completed',
      checkpoint: 'chapter-0:completed',
      usedTokens: 321,
    })

    wrapper.unmount()
  })
})
