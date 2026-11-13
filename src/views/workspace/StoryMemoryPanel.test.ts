// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { reactive } from 'vue'
import StoryMemoryPanel from './StoryMemoryPanel.vue'

const state = vi.hoisted(() => ({
  records: [] as any[],
  runs: [] as any[],
  sourceVersion: 'v1',
  resolve: vi.fn(),
  status: vi.fn(),
  plan: vi.fn(),
  estimate: vi.fn(),
  budget: vi.fn(),
  continueTask: vi.fn(),
  save: vi.fn(),
  saveDraft: vi.fn(),
  saveRun: vi.fn(),
  hydrate: vi.fn(),
  getModel: vi.fn(),
  getSkillPrompt: vi.fn(),
}))

vi.mock('@/stores/reconstructionWorkspace', () => ({ useReconstructionWorkspaceStore: () => ({
  getStoryMemories: () => state.records,
  getAiRuns: () => state.runs,
  getAiRun: (_novelId: string, runId: string) => state.runs.find(run => run.id === runId),
  hydrateFromPersistence: state.hydrate,
  saveAuthorMemoryDraft: state.saveDraft,
  saveAiRun: state.saveRun,
  saveStoryMemory: state.save,
}) }))
vi.mock('@/stores/config', () => ({ useConfigStore: () => ({ getModelForTask: state.getModel, getSkillPrompt: state.getSkillPrompt }) }))
vi.mock('@/services/storyMemory', () => ({ getStoryMemoryStatus: state.status, resolveStoryMemorySource: state.resolve }))
vi.mock('@/services/storyMemoryGeneration', () => ({ planStoryMemorySummary: state.plan }))
vi.mock('@/services/storyMemoryTask', () => ({
  createMemoryUpdateRun: (novelId: string, draft: any, graph: any, maxTokens: number, requestLimit: number) => ({
    id: `memory-run-${novelId}`, mode: 'assist', taskType: 'memory_update', targetId: novelId,
    tokenBudget: maxTokens, requestLimit, usedTokens: 0, requests: [], status: 'queued',
    createdAt: '2026-11-07T00:00:00.000Z', updatedAt: '2026-11-07T00:00:00.000Z',
    memoryTask: {
      ...draft, stage: 'planned', graph: graph.nodes, finalNodeId: graph.finalNodeId, requests: [],
      currentInputTokens: 0, currentOutputTokens: 0, historicalInputTokens: 0, historicalOutputTokens: 0,
      usageEstimated: false, updatedAt: '2026-11-07T00:00:00.000Z',
    },
  }),
  continueStoryMemoryTask: state.continueTask,
  isResumableStoryMemoryRun: (run: any) => Boolean(run?.memoryTask),
}))
vi.mock('@/services/knowledgeSummary', () => ({
  createKnowledgeSummaryBudget: state.budget,
  estimateKnowledgeSummaryTokens: state.estimate,
}))

const chapter1 = { id: 'chapter-1', chapterIndex: 0, volumeIndex: 0, title: '渡口', content: '甲在渡口发现线索。'.repeat(30), status: 'completed' }
const chapter2 = { id: 'chapter-2', chapterIndex: 1, volumeIndex: 0, title: '夜行', content: '乙在夜里追上来。'.repeat(30), status: 'completed' }
const book = reactive({
  id: 'novel-1', title: '雾城', volumes: [{ id: 'volume-1', volumeIndex: 0, title: '第一卷', summary: '进入雾城' }], chapters: [chapter1, chapter2],
}) as any

function savedFrom(input: any) {
  return { id: input.id, novelId: 'novel-1', title: input.title, scope: input.scope, summary: input.summary,
    source: { version: 1, sourceVersionId: input.expectedSourceVersionId, value: input.summary, origin: input.origin, confirmedAt: '2026-10-28T00:00:00.000Z', ...(input.coverage ? { coverage: input.coverage } : {}) }, history: [] }
}
function mountPanel(novel = book) { return shallowMount(StoryMemoryPanel, { props: { novel, ready: true } }) }
function generateButton(wrapper: ReturnType<typeof mountPanel>) { return wrapper.findAll('button').find(button => button.text().includes('生成 AI 候选'))! }
function confirmButton(wrapper: ReturnType<typeof mountPanel>) { return wrapper.findAll('button').find(button => button.text().includes('作者确认并保存'))! }
function completedMemoryRun(original: any, draft: any, sourceVersionId: string) {
  const coverage = { version: 1, strategy: 'full-source-hierarchical', sources: [], leafCount: 1, requestCount: 1, inputTokens: 12, outputTokens: 8, usageEstimated: true }
  return { ...original, status: 'needs_author', updatedAt: '2026-11-07T00:01:00.000Z', memoryTask: {
    ...original.memoryTask, titleDraft: draft.title, bodyDraft: draft.body, stage: 'awaiting_author', updatedAt: '2026-11-07T00:01:00.000Z',
    candidate: { title: draft.title, summary: 'AI 提取的候选回顾', sourceVersionId, coverage },
  } }
}

beforeEach(() => {
  vi.clearAllMocks()
  book.chapters = [chapter1, chapter2]
  state.records = []
  state.runs = []
  state.sourceVersion = 'v1'
  state.hydrate.mockResolvedValue(undefined)
  state.saveDraft.mockResolvedValue(undefined)
  state.saveRun.mockImplementation(async (_novelId: string, run: any) => {
    const index = state.runs.findIndex(existing => existing.id === run.id)
    if (index < 0) state.runs.push(run)
    else state.runs[index] = run
  })
  state.continueTask.mockImplementation(async (options: any, original: any, draft: any) => {
    const completed = completedMemoryRun(original, draft, options.plan.sourceVersionId)
    await options.persist(completed)
    return completed
  })
  state.getModel.mockReturnValue({ id: 'review-model', modelName: 'review', maxTokens: 8000, contextWindow: 64000, baseUrl: '', apiKey: '', temperature: 0.2, topP: 1 })
  state.getSkillPrompt.mockReturnValue('摘要技能：只保留正文事实')
  state.resolve.mockImplementation((novel: any, scope: any) => {
    const through = scope.throughChapterId ? novel.chapters.some((chapter: any) => chapter.id === scope.throughChapterId) : true
    if (!through || (scope.kind === 'scene' && !novel.chapters.some((chapter: any) => chapter.id === scope.chapterId))) throw new Error('来源不存在')
    return { versionId: state.sourceVersion, label: '当前来源', throughChapterIndex: 1, chapters: [] }
  })
  state.status.mockImplementation((novel: any, record: any) => {
    const scope = record.scope
    const sourceExists = scope.throughChapterId ? novel.chapters.some((chapter: any) => chapter.id === scope.throughChapterId) : novel.chapters.some((chapter: any) => chapter.id === scope.chapterId)
    return sourceExists && record.source.sourceVersionId === state.sourceVersion ? 'current' : 'stale'
  })
  state.plan.mockImplementation((_novel: any, scope: any, level: string) => ({ knowledgeBaseId: 'novel-1', sourceVersionId: state.sourceVersion,
    title: '雾城', description: '只处理正文', level, chunks: [{ entryId: scope.kind === 'scene' ? scope.chapterId : 'chapter-1', sourceVersionId: 'chapter-v1', title: '正文', category: '正文', tags: [], start: 0, end: 10, contentLength: 10, text: '正文片段' }], plannedRequests: 1 }))
  state.estimate.mockReturnValue(321)
  state.budget.mockImplementation((requests: number, tokens: number) => ({ maxRequests: requests, maxTokens: tokens, requests: 0, inputTokens: 0, outputTokens: 0, usageEstimated: false }))
  state.save.mockImplementation(async (_novelId: string, input: any) => { const saved = savedFrom(input); state.records = [saved]; return saved })
})

describe('StoryMemoryPanel acceptance flow', () => {
  it('defaults to written chapters and keeps the scope list bounded when a blank next chapter exists', async () => {
    const wrapper = mountPanel({ ...book, chapters: [...book.chapters, { ...chapter2, id: 'blank', chapterIndex: 2, content: '' }] })
    await flushPromises()
    expect(wrapper.findAll('.scope-option')).toHaveLength(2)
    await generateButton(wrapper).trigger('click'); await flushPromises()
    expect(state.plan.mock.calls[0][1]).toEqual({ kind: 'book', throughChapterId: 'chapter-2' })
  })

  it('offers source reload for a new draft after prose changes and preserves the draft for confirmation', async () => {
    const wrapper = mountPanel(); await flushPromises()
    await wrapper.get('textarea[aria-label="回顾内容"]').setValue('核对前草稿')
    state.sourceVersion = 'v2'
    await wrapper.setProps({ novel: { ...book, chapters: book.chapters.map((chapter: any) => ({ ...chapter, content: chapter.content + '变化' })) } })
    await wrapper.findAll('button').find(button => button.text() === '重新载入当前来源')!.trigger('click')
    expect(wrapper.get('textarea[aria-label="回顾内容"]').element).toHaveProperty('value', '核对前草稿')
    await confirmButton(wrapper).trigger('click'); await flushPromises()
    expect(state.save).toHaveBeenCalledWith('novel-1', expect.objectContaining({ expectedSourceVersionId: 'v2', summary: '核对前草稿' }))
  })

  it('does not replace a new novel form when a prior save returns late', async () => {
    let finishSave!: (saved: any) => void
    state.save.mockReturnValue(new Promise(resolve => { finishSave = resolve }))
    const wrapper = mountPanel(); await flushPromises()
    await wrapper.get('textarea[aria-label="回顾内容"]').setValue('旧作品草稿')
    await confirmButton(wrapper).trigger('click'); await flushPromises()
    const input = state.save.mock.calls[0][1]
    expect(wrapper.findAll('.scope-option').every(button => button.attributes('disabled') !== undefined)).toBe(true)
    await wrapper.setProps({ novel: { ...book, id: 'other' } }); await flushPromises()
    await wrapper.get('textarea[aria-label="回顾内容"]').setValue('新作品草稿')
    finishSave(savedFrom(input)); await flushPromises()
    expect(wrapper.get('textarea[aria-label="回顾内容"]').element).toHaveProperty('value', '新作品草稿')
    expect(wrapper.text()).not.toContain('故事回顾已保存')
  })

  it('ignores a late result after cancellation and permits generation after the task settles', async () => {
    let finishFirst!: () => void
    state.continueTask.mockImplementationOnce((options: any, original: any, draft: any) => new Promise(resolve => {
      finishFirst = () => resolve(completedMemoryRun(original, draft, options.plan.sourceVersionId))
    }))
    const wrapper = mountPanel(); await flushPromises()
    await generateButton(wrapper).trigger('click'); await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '取消生成')!.trigger('click')
    expect(wrapper.findAll('button').find(button => button.text() === '正在生成…')!.attributes('disabled')).toBeDefined()
    finishFirst(); await flushPromises()
    expect(wrapper.text()).not.toContain('AI 候选尚未保存')
    await generateButton(wrapper).trigger('click'); await flushPromises()
    expect(state.continueTask).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('AI 候选尚未保存')
    expect(state.save).not.toHaveBeenCalled()
  })

  it('keeps AI output as an unsaved candidate, then preserves coverage when author confirms unchanged text', async () => {
    const wrapper = mountPanel()
    await flushPromises()
    await generateButton(wrapper).trigger('click')
    await flushPromises()
    expect(state.save).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('AI 候选尚未保存')
    expect(state.getModel).toHaveBeenCalledWith('review')
    expect(state.getSkillPrompt).toHaveBeenCalledWith('analysis')
    expect(wrapper.text()).toContain('保守估算')
    await confirmButton(wrapper).trigger('click')
    await flushPromises()
    expect(state.save).toHaveBeenCalledWith('novel-1', expect.objectContaining({ origin: 'ai', coverage: expect.objectContaining({ leafCount: 1 }) }))
  })

  it('shows a persisted stopped-task reason on reopen while keeping the draft and requiring explicit continuation', async () => {
    state.runs = [{ id: 'paused-memory-run', taskType: 'memory_update', status: 'paused', error: '本地接口暂不可用（503）',
      requestLimit: 6, tokenBudget: 500000, requests: [], memoryTask: {
        scope: { kind: 'book', throughChapterId: 'chapter-2' }, sourceVersionId: 'v1', stage: 'paused',
        titleDraft: '作者待核对回顾', bodyDraft: '尚未保存的作者输入', level: 'brief', requests: [],
        currentInputTokens: 0, currentOutputTokens: 0, historicalInputTokens: 0, historicalOutputTokens: 0,
      } }]
    const wrapper = mountPanel()
    try {
      await flushPromises()
      expect(wrapper.get('[role="alert"]').text()).toContain('本地接口暂不可用（503）')
      expect(wrapper.get('textarea[aria-label="回顾内容"]').element).toHaveProperty('value', '尚未保存的作者输入')
      expect(wrapper.findAll('button').some(button => button.text() === '继续生成未完成节点')).toBe(true)
      expect(state.continueTask).not.toHaveBeenCalled()
      expect(state.save).not.toHaveBeenCalled()
    } finally { wrapper.unmount() }
  })

  it('changes an edited candidate into an author source and never sends AI coverage', async () => {
    const wrapper = mountPanel()
    await flushPromises()
    await generateButton(wrapper).trigger('click'); await flushPromises()
    await wrapper.get('textarea[aria-label="回顾内容"]').setValue('作者改过的回顾')
    await wrapper.get('input[aria-label="回顾标题"]').setValue('作者标题')
    await confirmButton(wrapper).trigger('click'); await flushPromises()
    expect(state.save).toHaveBeenCalledWith('novel-1', expect.objectContaining({ origin: 'author', title: '作者标题' }))
    expect(state.save.mock.calls[0][1]).not.toHaveProperty('coverage')
  })

  it('refuses zero request or token budget before generateKnowledgeSummary is called', async () => {
    const wrapper = mountPanel(); await flushPromises()
    await wrapper.get('input[aria-label="最大请求数"]').setValue('0')
    await generateButton(wrapper).trigger('click'); await flushPromises()
    expect(state.continueTask).not.toHaveBeenCalled()
    expect(state.save).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toContain('尚未发送请求')
  })

  it('cancels on scope switch and ignores a late generation result', async () => {
    let resolveGeneration!: (value: any) => void
    state.continueTask.mockReturnValue(new Promise(resolve => { resolveGeneration = value => resolve(value) }))
    const wrapper = mountPanel(); await flushPromises()
    await generateButton(wrapper).trigger('click'); await flushPromises()
    const scopeButtons = wrapper.findAll('.scope-option')
    await scopeButtons[1].trigger('click')
    const call = state.continueTask.mock.calls[0]
    resolveGeneration(completedMemoryRun(call[1], call[2], call[0].plan.sourceVersionId))
    await flushPromises()
    expect(wrapper.text()).not.toContain('迟到候选')
    expect(state.save).not.toHaveBeenCalled()
  })

  it('rejects confirmation after the opened source changes and keeps the draft', async () => {
    const wrapper = mountPanel(); await flushPromises()
    await wrapper.get('textarea[aria-label="回顾内容"]').setValue('需要保留的草稿')
    state.sourceVersion = 'v2'
    await confirmButton(wrapper).trigger('click'); await flushPromises()
    expect(state.save).not.toHaveBeenCalled()
    expect(wrapper.get('textarea[aria-label="回顾内容"]').element).toHaveProperty('value', '需要保留的草稿')
    expect(wrapper.get('[role="alert"]').text()).toContain('重新载入当前来源')
  })

  it('keeps the form after a save failure and permits retry', async () => {
    const wrapper = mountPanel(); await flushPromises()
    await wrapper.get('textarea[aria-label="回顾内容"]').setValue('保存失败后仍要保留')
    state.save.mockRejectedValueOnce(new Error('磁盘暂不可用')).mockImplementationOnce(async (_id: string, input: any) => savedFrom(input))
    await confirmButton(wrapper).trigger('click'); await flushPromises()
    expect(wrapper.get('textarea[aria-label="回顾内容"]').element).toHaveProperty('value', '保存失败后仍要保留')
    expect(wrapper.get('[role="alert"]').text()).toContain('磁盘暂不可用')
    await confirmButton(wrapper).trigger('click'); await flushPromises()
    expect(state.save).toHaveBeenCalledTimes(2)
    expect(wrapper.get('textarea[aria-label="回顾内容"]').element).toHaveProperty('value', '保存失败后仍要保留')
  })

  it('keeps an old cutoff scope visible after the current chapter list advances', async () => {
    const old = savedFrom({ id: 'memory-old', title: '截至第一章的旧回顾', scope: { kind: 'book', throughChapterId: 'chapter-1' }, summary: '旧内容', expectedSourceVersionId: 'v1', origin: 'author' })
    state.records = [old]
    const wrapper = mountPanel(); await flushPromises()
    book.chapters = [chapter2]
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('截至第一章的旧回顾')
    await wrapper.findAll('.scope-option').find(button => button.text().includes('截至第一章的旧回顾'))!.trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('过期')
    expect(wrapper.text()).toContain('重新载入当前来源')
  })

  it('uses an exact scene range instead of creating a second chapter summary', async () => {
    const sceneBook = { ...book, chapters: [{ ...chapter1, content: '开场。唯一场景事实。收束。' }] }
    const wrapper = mountPanel(sceneBook); await flushPromises()
    await wrapper.get('select[aria-label="范围类型"]').setValue('scene')
    await wrapper.get('select[aria-label="场景所在章节"]').setValue('chapter-1')
    await wrapper.get('textarea[aria-label="场景原文片段"]').setValue('唯一场景事实。')
    await wrapper.findAll('button').find(button => button.text() === '打开此范围')!.trigger('click')
    await generateButton(wrapper).trigger('click'); await flushPromises()
    expect(state.plan).toHaveBeenLastCalledWith(sceneBook, { kind: 'scene', chapterId: 'chapter-1', startOffset: 3, endOffset: 10 }, 'brief')
    expect(wrapper.text()).toContain('章节总结请在对应章节编辑器中核对')
    expect(wrapper.get('a[href="#/write/novel-1/chapter-1"]').text()).toContain('打开编辑器')
  })

  it('rejects a repeated scene quote and asks for a longer unique fragment', async () => {
    const wrapper = mountPanel(); await flushPromises()
    await wrapper.get('select[aria-label="范围类型"]').setValue('scene')
    await wrapper.get('textarea[aria-label="场景原文片段"]').setValue('甲在渡口发现线索。')
    await wrapper.findAll('button').find(button => button.text() === '打开此范围')!.trigger('click')
    expect(wrapper.get('[role="alert"]').text()).toContain('请粘贴更长的片段')
    expect(state.plan).not.toHaveBeenCalled()
  })

  it('cancels and resets when switching novels even if the new novel reuses the same scope key', async () => {
    let resolveGeneration!: (value: any) => void
    state.continueTask.mockReturnValue(new Promise(resolve => { resolveGeneration = value => resolve(value) }))
    const wrapper = mountPanel(); await flushPromises()
    await generateButton(wrapper).trigger('click'); await flushPromises()
    const otherBook = { ...book, id: 'novel-2', title: '另一部书', chapters: [{ ...chapter1, id: 'chapter-1' }] }
    await wrapper.setProps({ novel: otherBook })
    const call = state.continueTask.mock.calls[0]
    resolveGeneration(completedMemoryRun(call[1], call[2], call[0].plan.sourceVersionId))
    await flushPromises()
    expect(wrapper.text()).not.toContain('旧作品迟到结果')
    expect((wrapper.get('textarea[aria-label="回顾内容"]').element as HTMLTextAreaElement).value).toBe('')
    expect(state.hydrate).toHaveBeenLastCalledWith('novel-2')
    expect(state.save).not.toHaveBeenCalled()
  })
})
