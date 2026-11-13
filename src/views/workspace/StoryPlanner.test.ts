// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as storyAggregate from '@/services/storyAggregate'
import * as workspacePersistence from '@/services/db/reconstruction'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, shallowMount } from '@vue/test-utils'
import StoryPlanner from './StoryPlanner.vue'
import { useNovelStore } from '@/stores/novel'
import { useConfigStore } from '@/stores/config'
import { generateStoryArcDrafts, generateChapterPlanDrafts, generateStoryStateProposalDrafts, normalizeStoryPromiseDrafts, type ChapterPlanDraft } from '@/services/storyPlanning'
import { useStoryStateScansStore } from '@/stores/storyStateScans'
import { buildAnalysisSourceVersionId } from '@/services/reconstructionCandidates'
import { appendEntityRevision, captureEntityRevision } from '@/services/entityProvenance'
import { getSemanticIndexInfo, queryPersistedSemanticEvidence, syncSemanticIndexForNovel } from '@/services/semanticIndex'

const { route, dialogInfo, dialogDestroy, push } = vi.hoisted(() => ({
  route: { params: { novelId: '' }, query: {} },
  dialogInfo: vi.fn(),
  dialogDestroy: vi.fn(),
  push: vi.fn(),
}))
vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => ({ push }),
}))
vi.mock('naive-ui', async original => ({
  ...await original<object>(),
  useMessage: () => ({ success: vi.fn(), warning: vi.fn(), info: vi.fn(), error: vi.fn() }),
  useDialog: () => ({ info: dialogInfo }),
}))
vi.mock('@/services/semanticIndex', async original => ({
  ...await original<object>(),
  syncSemanticIndexForNovel: vi.fn().mockResolvedValue({ recordCount: 1 }),
  queryPersistedSemanticEvidence: vi.fn().mockResolvedValue([]),
  getSemanticIndexInfo: vi.fn().mockResolvedValue({
    recordCount: 0, provider: 'local', model: 'local-hash-v1', dimensions: 0, updatedAt: '',
  }),
}))
vi.mock('@/services/storyPlanning', async original => ({ ...await original<object>(), generateStoryArcDrafts: vi.fn(), generateChapterPlanDrafts: vi.fn(), generateStoryStateProposalDrafts: vi.fn() }))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.spyOn(storyAggregate, 'readStoryAggregate').mockResolvedValue({ novel: null, workspace: { candidates: [], reviewFindings: [], canonMutations: [], chapterReviews: [], aiRuns: [] } })
  vi.spyOn(storyAggregate, 'saveStoryAggregate').mockResolvedValue()
  vi.spyOn(workspacePersistence, 'loadReconstructionWorkspace').mockResolvedValue({ candidates: [], reviewFindings: [], canonMutations: [], chapterReviews: [], aiRuns: [] })

  dialogInfo.mockReset().mockReturnValue({ destroy: dialogDestroy })
  dialogDestroy.mockReset()
  push.mockReset()
  route.query = {}
  vi.mocked(generateStoryStateProposalDrafts).mockReset()
})

afterEach(() => vi.restoreAllMocks())

function readyBook(withChapter: boolean) {
  const store = useNovelStore()
  const book = store.addNovel({
    genre: 'fantasy', subGenre: 'xuanhuan', tags: [],
    targetWordCountMin: 20, targetWordCountMax: 30,
    writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings(),
  })
  route.params.novelId = book.id
  const now = book.createdAt
  book.volumes = [{
    id: 'volume-1', volumeIndex: 0, title: '第一卷', theme: '',
    summary: '', keyTurningPoints: '', characterChanges: '',
    estimatedChapters: 10, estimatedWordCount: 3,
  }]
  book.chapterPlans = [{
    id: 'plan-1', horizon: 'next', title: '开始调查', objective: '发现线索', summary: '',
    beats: [], targetChapterStart: 0, targetChapterEnd: 0,
    relatedArcIds: [], relatedEventIds: [], status: 'planned', source: 'user',
    createdAt: now, updatedAt: now,
  }]
  book.storyArcs = [{
    id: 'arc-1', title: '调查', description: '', type: 'main',
    importance: 5, status: 'active', reactivateAt: '', characterIds: [],
    nodes: [], createdAt: now, updatedAt: now,
  }]
  book.eventLog = [{
    id: 'event-1', chapterIndex: -1, title: '线索', description: '',
    characters: [], type: '伏笔', status: 'planted', timestamp: now,
  }]
  if (withChapter) store.addChapter(book.id, { title: '第一章', volumeIndex: 0 })
  return book
}

describe('planning completion prompt', () => {
  function readyStateScan() {
    const book = readyBook(true), chapter = book.chapters[0]
    chapter.content = '林澈找到了失踪的铜钥匙。'; chapter.status = 'completed'
    vi.spyOn(useConfigStore(), 'getModelForTask').mockReturnValue({ id: 'test-model' } as any)
    const drafts = normalizeStoryPromiseDrafts(book, chapter, [{ title: '钥匙来历', description: '以后解释这把钥匙的来历', evidence: chapter.content }])
    return { book, chapter, drafts }
  }

  it('keeps a failed state-scan batch visible and saves both proposals and ignore decisions before publishing', async () => {
    const { book, drafts } = readyStateScan()
    vi.mocked(generateStoryStateProposalDrafts).mockResolvedValue(drafts)
    const wrapper = shallowMount(StoryPlanner, { global: { renderStubDefaultSlot: true } }), vm = wrapper.vm as any
    await flushPromises()
    vi.mocked(storyAggregate.saveStoryAggregate).mockRejectedValueOnce(new Error('状态提案保存失败'))
    await vm.scanChapterState()
    expect(book.storyStateProposals || []).toHaveLength(0)
    expect(wrapper.get('[aria-label="状态扫描待保存结果"]').text()).toContain('状态提案保存失败')
    await vm.scanChapterState()
    expect(generateStoryStateProposalDrafts).toHaveBeenCalledTimes(1)
    expect(book.storyStateProposals).toHaveLength(1)
    expect(wrapper.find('[aria-label="状态扫描待保存结果"]').exists()).toBe(false)
    const proposal = book.storyStateProposals![0]
    vi.mocked(storyAggregate.saveStoryAggregate).mockRejectedValueOnce(new Error('忽略保存失败'))
    await vm.rejectProposal(proposal.id)
    expect(proposal.status).toBe('pending')
    await vm.rejectProposal(proposal.id)
    expect(proposal.status).toBe('rejected')
    expect(book.eventLog).toHaveLength(1)
    wrapper.unmount()
  })

  it('does not save a state-scan response after the planner unmounts', async () => {
    const { book, chapter, drafts } = readyStateScan()
    let finish!: (value: typeof drafts) => void
    vi.mocked(generateStoryStateProposalDrafts).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const wrapper = shallowMount(StoryPlanner), vm = wrapper.vm as any
    await flushPromises(); vi.mocked(storyAggregate.saveStoryAggregate).mockClear()
    const scanning = vm.scanChapterState()
    await flushPromises(); wrapper.unmount(); finish(drafts); await scanning
    expect(storyAggregate.saveStoryAggregate).not.toHaveBeenCalled()
    expect(useStoryStateScansStore().getPending(book.id)).toHaveLength(0)
    expect(useStoryStateScansStore().isRunning(book.id, chapter.id)).toBe(false)
  })

  it('retains stale state output for inspection without rebasing it after a plan changes', async () => {
    const { book, drafts } = readyStateScan()
    vi.mocked(generateStoryStateProposalDrafts).mockImplementation(async () => {
      book.chapterPlans![0].objective = '作者已经改为寻找另一件信物'
      return drafts
    })
    const wrapper = shallowMount(StoryPlanner, { global: { renderStubDefaultSlot: true } }), vm = wrapper.vm as any
    await flushPromises(); vi.mocked(storyAggregate.saveStoryAggregate).mockClear()
    await vm.scanChapterState(); await vm.scanChapterState()
    expect(generateStoryStateProposalDrafts).toHaveBeenCalledTimes(1)
    expect(storyAggregate.saveStoryAggregate).not.toHaveBeenCalled()
    expect(wrapper.get('[aria-label="状态扫描待保存结果"]').text()).toContain('依据已变化')
    expect(book.storyStateProposals || []).toHaveLength(0)
    wrapper.unmount()
  })

  const suggestedPlan = (): ChapterPlanDraft => ({ horizon: 'next', title: '查验铜印', objective: '找出铜印来源', summary: '询问守夜人',
    beats: ['比对登记册'], targetChapterStart: 0, targetChapterEnd: 0, relatedArcIds: ['arc-1'], relatedEventIds: ['event-1'], status: 'planned', source: 'ai' })

  it('keeps generated plans as editable suggestions and publishes only after explicit batch confirmation', async () => {
    const book = readyBook(true); book.outline = '调查铜印'; book.chapterPlanConfirmed = true
    vi.spyOn(useConfigStore(), 'getModelForTask').mockReturnValue({ id: 'test-model' } as any)
    vi.mocked(generateChapterPlanDrafts).mockResolvedValueOnce([suggestedPlan()])
    const wrapper = shallowMount(StoryPlanner, { global: { renderStubDefaultSlot: true } }), vm = wrapper.vm as any
    await flushPromises(); vi.mocked(storyAggregate.saveStoryAggregate).mockClear()
    await vm.generatePlans()
    expect(book.chapterPlans).toHaveLength(1); expect(book.chapterPlanConfirmed).toBe(true)
    expect(storyAggregate.saveStoryAggregate).not.toHaveBeenCalled()
    expect(wrapper.get('[aria-label="待确认章节计划建议"]').text()).toContain('查验铜印')
    vm.openPlanSuggestion(vm.planSuggestions[0].id); vm.planForm.objective = '作者改为先找登记员'
    await vm.submitPlan()
    expect(book.chapterPlans).toHaveLength(1); expect(storyAggregate.saveStoryAggregate).not.toHaveBeenCalled()
    vi.mocked(storyAggregate.saveStoryAggregate).mockRejectedValueOnce(new Error('写盘失败'))
    await vm.acceptPlanSuggestions()
    expect(book.chapterPlans).toHaveLength(1); expect(vm.planSuggestions).toHaveLength(1)
    await vm.acceptPlanSuggestions()
    expect(book.chapterPlans).toHaveLength(2); expect(vm.planSuggestions).toHaveLength(0)
    expect(book.chapterPlans![1]).toMatchObject({ objective: '作者改为先找登记员', relatedArcIds: ['arc-1'], relatedEventIds: ['event-1'] })
    wrapper.unmount()
  })

  it('refuses late plan results and later acceptance after their source changes', async () => {
    const book = readyBook(true); book.outline = '旧大纲'
    vi.spyOn(useConfigStore(), 'getModelForTask').mockReturnValue({ id: 'test-model' } as any)
    let finish!: (plans: ChapterPlanDraft[]) => void
    vi.mocked(generateChapterPlanDrafts).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const wrapper = shallowMount(StoryPlanner), vm = wrapper.vm as any
    await flushPromises()
    const pending = vm.generatePlans(); book.outline = '另一窗口的新大纲'; finish([suggestedPlan()]); await pending
    expect(vm.planSuggestions).toHaveLength(0); expect(book.chapterPlans).toHaveLength(1)
    vi.mocked(generateChapterPlanDrafts).mockResolvedValueOnce([suggestedPlan()]); await vm.generatePlans()
    book.chapters[0].content = '作者后来补写的新线索'
    await vm.acceptPlanSuggestions()
    expect(vm.planSuggestions).toHaveLength(1); expect(book.chapterPlans).toHaveLength(1)
    wrapper.unmount()
  })

  it('rejects an old chapter plan form and retains its author input and opening version', async () => {
    const book = readyBook(true), wrapper = shallowMount(StoryPlanner), vm = wrapper.vm as any
    await flushPromises()
    vm.openPlanModal(book.chapterPlans![0]); vm.planForm.objective = '尚未保存的作者修改'
    book.chapterPlans![0].objective = '另外一个窗口的新目标'
    await vm.submitPlan()
    expect(vm.showPlanModal).toBe(true); expect(vm.planSaveError).toContain('编辑期间发生变化')
    expect(vm.planForm.objective).toBe('尚未保存的作者修改')
    expect(book.chapterPlans![0].objective).toBe('另外一个窗口的新目标')
    wrapper.unmount()
  })

  it('does not publish planning confirmation when its transaction fails', async () => {
    const book = readyBook(false), wrapper = shallowMount(StoryPlanner), vm = wrapper.vm as any
    await flushPromises()
    vi.mocked(storyAggregate.saveStoryAggregate).mockRejectedValueOnce(new Error('确认写盘失败'))
    await vm.confirmVolumesAndGeneratePlans()
    expect(book.chapterPlanConfirmed).not.toBe(true); expect(dialogInfo).not.toHaveBeenCalled()
    await vm.confirmVolumesAndGeneratePlans()
    expect(book.chapterPlanConfirmed).toBe(true); expect(dialogInfo).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('retains a failed new event form and saves all displayed tracking fields on retry', async () => {
    const book = readyBook(true)
    const wrapper = shallowMount(StoryPlanner, { global: { renderStubDefaultSlot: true } }), vm = wrapper.vm as any
    vm.openEventModal(); Object.assign(vm.eventForm, { title: '信物', description: '追踪信物', chapter: 0, scope: 'global', hintCount: 4,
      lastProgressChapter: 1, resolvedChapter: 1, status: 'resolved' })
    vi.mocked(storyAggregate.saveStoryAggregate).mockRejectedValueOnce(new Error('新增事件失败'))
    await vm.submitEvent()
    expect(vm.showEventModal).toBe(true); expect(vm.eventSaveError).toBe('新增事件失败')
    expect(vm.eventForm.hintCount).toBe(4); expect(book.eventLog).toHaveLength(1)
    await vm.submitEvent()
    expect(vm.showEventModal).toBe(false)
    expect(book.eventLog[1]).toMatchObject({ title: '信物', scope: 'global', hintCount: 4, chapterIndex: -1, lastProgressChapterIndex: 0, resolvedChapterIndex: 0 })
    vm.openEventModal(book.eventLog[1]); vm.eventForm.lastProgressChapter = null; vm.eventForm.resolvedChapter = null
    await vm.submitEvent()
    expect(book.eventLog[1].lastProgressChapterIndex).toBeUndefined()
    expect(book.eventLog[1].resolvedChapterIndex).toBeUndefined()
    wrapper.unmount()
  })

  it('keeps an event in the timeline on failed deletion and removes it after commit', async () => {
    const book = readyBook(true), wrapper = shallowMount(StoryPlanner), vm = wrapper.vm as any
    vi.mocked(storyAggregate.saveStoryAggregate).mockRejectedValueOnce(new Error('删除事件失败'))
    expect(await vm.removeEvent(book.eventLog[0].id)).toBe(false)
    expect(book.eventLog).toHaveLength(1)
    expect(await vm.removeEvent(book.eventLog[0].id)).toBe(true)
    expect(book.eventLog).toHaveLength(0)
    wrapper.unmount()
  })

  it('keeps author arc edits and the opening baseline when persistence fails', async () => {
    const book = readyBook(true), store = useNovelStore()
    const save = vi.spyOn(store, 'commitStoryArcEdit').mockRejectedValue(new Error('模拟剧情写入失败'))
    const wrapper = shallowMount(StoryPlanner, { global: { renderStubDefaultSlot: true, stubs: {
      Modal: { props: ['show'], template: '<section v-if="show" role="dialog"><slot/><slot name="footer"/></section>' },
    } } })
    const vm = wrapper.vm as any, baseline = JSON.stringify(book.storyArcs![0])
    vm.openArcModal(book.storyArcs![0]); vm.arcForm.goal = '作者修改的目标'
    book.storyArcs![0].description = '另外一次编辑'
    await vm.submitArc(); await flushPromises()
    expect(vm.showArcModal).toBe(true)
    expect(vm.arcForm.goal).toBe('作者修改的目标')
    expect(wrapper.get('[role="dialog"] [role="alert"]').text()).toContain('模拟剧情写入失败')
    expect(save).toHaveBeenCalledWith(book.id, expect.objectContaining({ action: 'update', expectedArc: baseline, definition: expect.objectContaining({ goal: '作者修改的目标' }) }))
    expect(book.storyArcs![0].description).toBe('另外一次编辑')
    wrapper.unmount(); save.mockRestore()
  })

  it('leaves AI arcs as suggestions until the author edits and confirms them', async () => {
    const book = readyBook(true), store = useNovelStore()
    book.outline = '调查书信'; book.storyArcs = []
    const model = vi.spyOn(useConfigStore(), 'getModelForTask').mockReturnValue({ id: 'test-model' } as any)
    vi.mocked(generateStoryArcDrafts).mockResolvedValueOnce([{ title: '信任的代价', description: '成长', type: 'character', importance: 4, characterNames: [],
      falseBelief: '所有人都可信', nodes: [{ title: '揭开骗局', description: '看到证据', targetChapter: 4 }] }])
    const save = vi.spyOn(store, 'commitStoryArcEdit').mockResolvedValue({ arcIds: [], nodeIds: [], chapterIds: [], reasons: {}, reviewChapterIds: [] })
    const wrapper = shallowMount(StoryPlanner, { global: { renderStubDefaultSlot: true } })
    const vm = wrapper.vm as any
    await vm.handleExtractArcs(); await flushPromises()
    expect(save).not.toHaveBeenCalled(); expect(book.storyArcs).toHaveLength(0)
    expect(wrapper.get('[aria-label="待确认弧线建议"]').text()).toContain('信任的代价')
    vm.openArcSuggestion(vm.arcSuggestions[0].id)
    vm.arcForm.falseBelief = '只有家人可信'
    vm.arcSuggestedNodes[0].targetChapter = 5
    await vm.submitArc()
    expect(save).toHaveBeenCalledWith(book.id, expect.objectContaining({ action: 'create', planningSourceVersion: expect.any(String),
      definition: expect.objectContaining({ falseBelief: '只有家人可信' }), nodes: [expect.objectContaining({ targetChapter: 4 })] }))
    expect(vm.arcSuggestions).toHaveLength(0)
    wrapper.unmount(); save.mockRestore(); model.mockRestore()
  })

  it('requires an explicit actual chapter and retains the captured source version on failed completion', async () => {
    const book = readyBook(true), store = useNovelStore(), arc = book.storyArcs![0]
    book.chapters[0].content = '主角取得铜钥匙。'
    arc.nodes = [{ id: 'milestone', title: '取得钥匙', description: '', status: 'pending', targetChapter: 5, createdAt: book.createdAt, updatedAt: book.updatedAt }]
    const save = vi.spyOn(store, 'commitStoryArcEdit').mockRejectedValue(new Error('正文已经变化'))
    const wrapper = shallowMount(StoryPlanner, { global: { renderStubDefaultSlot: true } })
    const vm = wrapper.vm as any
    vm.toggleNode(arc, arc.nodes[0])
    expect(vm.sourceChapterId).toBeNull()
    await vm.submitNodeStatus(); expect(save).not.toHaveBeenCalled()
    vm.selectSourceChapter(book.chapters[0].id); vm.nodeEvidence = '主角取得铜钥匙。'
    const originalVersion = buildAnalysisSourceVersionId(book.chapters[0].content)
    book.chapters[0].content += '随后补写。'
    await vm.submitNodeStatus()
    expect(save).toHaveBeenCalledWith(book.id, expect.objectContaining({ source: expect.objectContaining({ chapterIndex: 0, sourceVersionId: originalVersion }) }))
    expect(vm.showNodeStatusModal).toBe(true); expect(vm.nodeEvidence).toBe('主角取得铜钥匙。')
    expect(arc.nodes[0].status).toBe('pending')
    wrapper.unmount(); save.mockRestore()
  })

  it('shows an event save failure in the event dialog and retains the editable values', async () => {
    const book = readyBook(true), store = useNovelStore()
    const save = vi.spyOn(store, 'saveEntityDefinition').mockRejectedValue(new Error('模拟写入失败'))
    const wrapper = shallowMount(StoryPlanner, { global: { renderStubDefaultSlot: true, stubs: {
      Modal: { props: ['show'], template: '<section v-if="show" role="dialog"><slot/><slot name="footer"/></section>' },
    } } })
    const vm = wrapper.vm as any
    vm.openEventModal(book.eventLog[0]); vm.eventForm.description = '保留这份修改'
    await vm.submitEvent(); await flushPromises()
    expect(wrapper.get('[role="dialog"] [role="alert"]').text()).toBe('模拟写入失败')
    expect(vm.showEventModal).toBe(true)
    expect(vm.eventForm.description).toBe('保留这份修改')
    expect(vm.eventSaving).toBe(false)
    const updates = save.mock.calls[0][4]
    expect(updates).not.toHaveProperty('source')
    expect(updates).toMatchObject({ scope: 'chapter', hintCount: 0 })
    wrapper.unmount(); save.mockRestore()
  })
  it('rejects a stale event form and leaves the newer definition intact', async () => {
    const book = readyBook(true), store = useNovelStore()
    const wrapper = shallowMount(StoryPlanner, { global: { renderStubDefaultSlot: true } })
    const vm = wrapper.vm as any
    vm.openEventModal(book.eventLog[0])
    await store.updateEvent(book.id, book.eventLog[0].id, { description: '其他操作已经确认' })
    await vm.submitEvent()
    expect(vm.eventSaveError).toContain('编辑期间发生变化')
    expect(vm.showEventModal).toBe(true)
    expect(store.getNovel(book.id)!.eventLog[0].description).toBe('其他操作已经确认')
    wrapper.unmount()
  })
  it('groups initial memory by source and discards a search arriving after a category change', async () => {
    const book = readyBook(true)
    await useNovelStore().addCharacter(book.id, { name: '测试角色', identity: '调查员' })
    const wrapper = shallowMount(StoryPlanner, { global: { renderStubDefaultSlot: true, stubs: {
      Button: { template: '<button><slot /></button>' },
    } } })
    await flushPromises()
    expect(wrapper.find('details.planner-summary-details').exists()).toBe(false)
    expect(wrapper.findAll('.planner-overview strong')).toHaveLength(8)
    expect(wrapper.find('.memory-results p').exists()).toBe(false)
    const categories = wrapper.findAll('.memory-categories button')
    expect(categories.map(tab => tab.text().replace(/\d+/g, ''))).toEqual(['全部', '章节', '角色', '事件', '故事弧线', '章节计划', '知识库', '数据面板', '已写故事回顾'])
    await categories[2].trigger('click')
    expect(wrapper.findAll('.memory-result')).toHaveLength(1)
    expect(wrapper.get('.memory-result').text()).toContain('测试角色')
    let resolveSearch!: (value: Awaited<ReturnType<typeof queryPersistedSemanticEvidence>>) => void
    vi.mocked(queryPersistedSemanticEvidence).mockImplementationOnce(() => new Promise(resolve => { resolveSearch = resolve }))
    wrapper.get('.memory-search').findComponent({ name: 'Input' }).vm.$emit('update:value', '测试')
    await flushPromises()
    await wrapper.get('.memory-search button').trigger('click')
    await flushPromises()
    expect(queryPersistedSemanticEvidence).toHaveBeenLastCalledWith(expect.any(Function), '测试', 12, expect.any(Object), 'character')
    await categories[3].trigger('click')
    resolveSearch([{ id: 'late', novelId: book.id, sourceType: 'character', sourceId: 'late', title: '迟到的角色结果', content: '过期', score: 1, citation: '过期' }])
    await flushPromises()
    expect(wrapper.get('.memory-categories button[aria-pressed="true"]').text()).toContain('事件')
    expect(wrapper.get('.memory-results').text()).not.toContain('迟到的角色结果')
    expect(wrapper.get('.memory-results').text()).toContain('线索')
    wrapper.unmount()
  })
  it('queries current source without re-embedding the manuscript for every search', async () => {
    const book = readyBook(true)
    vi.mocked(syncSemanticIndexForNovel).mockClear()
    vi.mocked(getSemanticIndexInfo).mockResolvedValue({ recordCount: 8, provider: 'local', model: 'local-hash-v1', dimensions: 192, updatedAt: book.createdAt })
    const wrapper = shallowMount(StoryPlanner, { global: { renderStubDefaultSlot: true, stubs: {
      Button: { template: '<button><slot /></button>' },
    } } })
    await flushPromises()
    wrapper.find('.memory-search').findComponent({ name: 'Input' }).vm.$emit('update:value', '新线索')
    await flushPromises()
    const search = wrapper.find('.memory-search').findAll('button').find(button => button.text() === '检索')!
    await search.trigger('click')
    await flushPromises()
    expect(syncSemanticIndexForNovel).not.toHaveBeenCalled()
    expect(queryPersistedSemanticEvidence).toHaveBeenCalledWith(expect.any(Function), '新线索', 12, expect.any(Object), undefined)
    const readSource = vi.mocked(queryPersistedSemanticEvidence).mock.calls.slice(-1)[0][0]
    expect(readSource().novel.id).toBe(book.id)
    book.chapters[0].content = '检索期间作者的新文字'
    expect(readSource().novel.chapters[0].content).toBe('检索期间作者的新文字')
    wrapper.unmount()
  })

  it('discards visible and pending search results when the manuscript changes', async () => {
    const book = readyBook(true)
    const wrapper = shallowMount(StoryPlanner, { global: { renderStubDefaultSlot: true, stubs: {
      Button: { template: '<button><slot /></button>' },
    } } })
    await flushPromises()
    let resolveSearch!: (value: Awaited<ReturnType<typeof queryPersistedSemanticEvidence>>) => void
    vi.mocked(queryPersistedSemanticEvidence).mockImplementationOnce(() => new Promise(resolve => { resolveSearch = resolve }))
    wrapper.get('.memory-search').findComponent({ name: 'Input' }).vm.$emit('update:value', '铜盒')
    await flushPromises()
    await wrapper.get('.memory-search button').trigger('click')
    await flushPromises()
    useNovelStore().updateChapter(book.id, book.chapters[0].id, { content: '铜盒的新线索' })
    await flushPromises()
    resolveSearch([{ id: 'old', novelId: book.id, sourceType: 'chapter', sourceId: book.chapters[0].id, title: '铜盒过期结果', content: '旧线索', score: 1, citation: '旧章节' }])
    await flushPromises()
    expect(wrapper.get('.memory-results').text()).not.toContain('铜盒过期结果')
    expect(wrapper.find('.memory-results p').exists()).toBe(false)
    vi.mocked(queryPersistedSemanticEvidence).mockResolvedValueOnce([{ id: 'current', novelId: book.id, sourceType: 'chapter', sourceId: book.chapters[0].id, title: '铜盒检索结果', content: '新线索', score: 1, citation: '当前章节' }])
    await wrapper.get('.memory-search button').trigger('click')
    await flushPromises()
    expect(wrapper.get('.memory-results').text()).toContain('铜盒检索结果')
    useNovelStore().updateChapter(book.id, book.chapters[0].id, { content: '又一次修改铜盒线索' })
    await flushPromises()
    expect(wrapper.get('.memory-results').text()).not.toContain('铜盒检索结果')
    wrapper.unmount()
  })

  it('does not show a dialog merely by entering or re-entering a ready book', async () => {
    readyBook(true)
    const first = shallowMount(StoryPlanner, { global: { renderStubDefaultSlot: true } })
    await flushPromises()
    expect(dialogInfo).not.toHaveBeenCalled()
    first.unmount()

    const second = shallowMount(StoryPlanner, { global: { renderStubDefaultSlot: true } })
    await flushPromises()
    expect(dialogInfo).not.toHaveBeenCalled()
    second.unmount()
  })

  it('offers chapter creation once after explicit confirmation and destroys it on leave', async () => {
    readyBook(false)
    const wrapper = shallowMount(StoryPlanner, { global: { renderStubDefaultSlot: true } })
    await flushPromises()
    expect(dialogInfo).not.toHaveBeenCalled()

    wrapper.getComponent({ name: 'VolumeOutline' }).vm.$emit('confirmed')
    await flushPromises()
    expect(dialogInfo).toHaveBeenCalledTimes(1)
    wrapper.getComponent({ name: 'VolumeOutline' }).vm.$emit('confirmed')
    await flushPromises()
    expect(dialogInfo).toHaveBeenCalledTimes(1)
    wrapper.unmount()
    expect(dialogDestroy).toHaveBeenCalledTimes(1)
  })

  it('keeps new-plan and AI actions reachable on a full embedded board without the legacy heading or overview', async () => {
    const book = useNovelStore().getNovel(readyBook(true).id)!
    book.chapterPlans!.push(
      { ...book.chapterPlans![0], id: 'plan-2', status: 'active' },
      { ...book.chapterPlans![0], id: 'plan-3', status: 'awaiting_review' },
    )
    vi.spyOn(useConfigStore(), 'getModelForTask').mockReturnValue({ id: 'test-model' } as any)
    vi.mocked(generateChapterPlanDrafts).mockReset().mockResolvedValueOnce([])
    const wrapper = shallowMount(StoryPlanner, {
      props: { embedded: true, initialTab: 'plans' },
      global: { renderStubDefaultSlot: true, stubs: {
        Button: { props: ['disabled'], template: '<button :disabled="disabled"><slot /></button>' },
      } },
    })
    const header = wrapper.get('.planner-header-compact'), planner = wrapper.vm as any
    const actions = header.findAll('button')
    expect(actions.map(button => button.text())).toEqual(['AI 生成计划', '新建计划'])
    expect(actions[0].attributes('disabled')).toBeDefined()
    await flushPromises()
    expect(wrapper.find('.page-title').exists()).toBe(false)
    expect(wrapper.find('.page-subtitle').exists()).toBe(false)
    expect(wrapper.find('.planner-overview').exists()).toBe(false)
    expect(wrapper.findAll('.empty-plan')).toHaveLength(0)
    expect(actions[0].attributes('disabled')).toBeDefined()
    book.outline = '调查铜印'
    await flushPromises()
    expect(actions[0].attributes('disabled')).toBeUndefined()
    await actions[1].trigger('click')
    expect(planner.showPlanModal).toBe(true)
    expect(actions[0].attributes('disabled')).toBeDefined()
    planner.showPlanModal = false
    await flushPromises()
    await actions[0].trigger('click'); await flushPromises()
    expect(generateChapterPlanDrafts).toHaveBeenCalledTimes(1)
    expect(book.chapterPlans).toHaveLength(3)
    wrapper.unmount()
  })

  it('keeps future relay promises separate from occurred chapters and opens manual review without a scan', async () => {
    const book = useNovelStore().getNovel(readyBook(true).id)!
    book.chapterPlans![0].status = 'awaiting_review'
    book.eventLog.push({ ...book.eventLog[0], id: 'occurred-event', title: '已写入的线索', chapterIndex: 0, lastProgressChapterIndex: 0 })
    const before = JSON.stringify(book)
    const wrapper = shallowMount(StoryPlanner, {
      props: { embedded: true, initialTab: 'relay' },
      global: { renderStubDefaultSlot: true, stubs: {
        Button: { props: ['disabled'], template: '<button :disabled="disabled"><slot /></button>' },
      } },
    })
    try {
      await flushPromises()
      const promises = wrapper.get('.relay-context .relay-section')
      const future = promises.findAll('.relay-row').find(row => row.text().includes('线索') && !row.text().includes('已写入'))!
      expect(future.text()).toContain('全书规划 · 尚未记录后续推进')
      expect(promises.text()).not.toContain('第 0 章')
      expect(promises.text()).toContain('第 1 章提出 · 最近第 1 章推进')
      const detail = wrapper.get('.relay-selection')
      await detail.findAll('button').find(button => button.text() === '查看章节')!.trigger('click')
      expect(push).toHaveBeenCalledWith(`/workspace/${book.id}/editor/${book.chapters[0].id}`)
      await detail.findAll('button').find(button => button.text() === '手动核对')!.trigger('click')
      expect((wrapper.vm as any).showPlanModal).toBe(true)
      expect((wrapper.vm as any).editingPlanId).toBe(book.chapterPlans![0].id)
      expect(generateStoryStateProposalDrafts).not.toHaveBeenCalled()
      expect(JSON.stringify(book)).toBe(before)
    } finally { wrapper.unmount() }
  })

  it.each([
    ['arcs', '新建弧线', 'showArcModal'],
    ['timeline', '添加事件', 'showEventModal'],
  ])('keeps the embedded %s creation action wired to its existing dialog', async (tab, label, modal) => {
    const book = useNovelStore().getNovel(readyBook(true).id)!
    const wrapper = shallowMount(StoryPlanner, {
      props: { embedded: true, initialTab: tab },
      global: { renderStubDefaultSlot: true, stubs: {
        Button: { props: ['disabled'], template: '<button :disabled="disabled"><slot /></button>' },
      } },
    })
    await flushPromises()
    const header = wrapper.get('.planner-header-compact')
    if (tab === 'arcs') {
      const extract = header.findAll('button').find(button => button.text() === 'AI 提取')!
      expect(extract.attributes('disabled')).toBeDefined()
      book.outline = '调查书信'
      vi.spyOn(useConfigStore(), 'getModelForTask').mockReturnValue({ id: 'test-model' } as any)
      vi.mocked(generateStoryArcDrafts).mockReset().mockResolvedValueOnce([])
      await flushPromises()
      expect(extract.attributes('disabled')).toBeUndefined()
      await extract.trigger('click'); await flushPromises()
      expect(generateStoryArcDrafts).toHaveBeenCalledTimes(1)
    }
    await header.findAll('button').find(button => button.text() === label)!.trigger('click')
    expect((wrapper.vm as any)[modal]).toBe(true)
    expect(wrapper.find('.planner-overview').exists()).toBe(false)
    wrapper.unmount()
  })

  it('keeps the embedded latest-chapter check disabled until a completed chapter exists and uses the existing scan', async () => {
    const book = useNovelStore().getNovel(readyBook(true).id)!, chapter = book.chapters[0]
    const wrapper = shallowMount(StoryPlanner, {
      props: { embedded: true, initialTab: 'proposals' },
      global: { renderStubDefaultSlot: true, stubs: {
        Button: { props: ['disabled'], template: '<button :disabled="disabled"><slot /></button>' },
      } },
    })
    await flushPromises()
    const scan = wrapper.get('.planner-header-compact button')
    expect(scan.text()).toBe('检查最新章节')
    expect(scan.attributes('disabled')).toBeDefined()
    chapter.content = '林澈找到了失踪的铜钥匙。'; chapter.status = 'completed'
    vi.spyOn(useConfigStore(), 'getModelForTask').mockReturnValue({ id: 'test-model' } as any)
    vi.mocked(generateStoryStateProposalDrafts).mockResolvedValueOnce([])
    await flushPromises()
    expect(scan.attributes('disabled')).toBeUndefined()
    await scan.trigger('click'); await flushPromises()
    expect(generateStoryStateProposalDrafts).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('forwards only scene selections and updates the retained scene planner instead of remounting it', async () => {
    readyBook(true)
    const wrapper = shallowMount(StoryPlanner, {
      props: { embedded: true, initialTab: 'scenes', initialSelection: 'scene-plan-1' },
      global: { renderStubDefaultSlot: true },
    })
    await flushPromises()
    const scenes = wrapper.getComponent({ name: 'ScenePlanner' }), instance = scenes.vm.$
    expect(scenes.props('initialPlanId')).toBe('scene-plan-1')
    await wrapper.setProps({ initialSelection: 'scene-plan-2' })
    expect(scenes.props('initialPlanId')).toBe('scene-plan-2')
    expect(wrapper.getComponent({ name: 'ScenePlanner' }).vm.$).toBe(instance)
    await wrapper.setProps({ initialTab: 'arcs', initialSelection: 'arc-1' })
    expect(scenes.props('initialPlanId')).toBeUndefined()
    expect(wrapper.getComponent({ name: 'ScenePlanner' }).vm.$).toBe(instance)
    wrapper.unmount()
  })

  it('leaves legacy scene-route selection to ScenePlanner when no scene prop was supplied', async () => {
    readyBook(true)
    route.query = { tab: 'scenes', plan: 'legacy-plan' }
    const wrapper = shallowMount(StoryPlanner, { global: { renderStubDefaultSlot: true } })
    await flushPromises()
    expect((wrapper.vm as any).activeTab).toBe('scenes')
    expect(wrapper.getComponent({ name: 'ScenePlanner' }).props('initialPlanId')).toBeUndefined()
    wrapper.unmount()
  })

  it('keeps an excluded selected arc available for author review without falling back to another arc', async () => {
    const book = useNovelStore().getNovel(readyBook(true).id)!, chapter = book.chapters[0]
    chapter.content = '雨夜守灯，线索尚未核实。'
    const excluded: NonNullable<typeof book.storyArcs>[number] = { ...book.storyArcs![0], id: 'excluded-arc', title: '旧来源弧线', description: '保留供作者核对的旧说明', status: 'completed' }
    appendEntityRevision(excluded, captureEntityRevision('arc', undefined, excluded, { kind: 'chapter', chapterId: chapter.id, chapterIndex: 0,
      sourceVersionId: buildAnalysisSourceVersionId(chapter.content), evidence: [{ quote: chapter.content, startOffset: 0, endOffset: chapter.content.length }] }, book.createdAt, 'excluded-arc-source'))
    book.storyArcs!.push(excluded)
    chapter.content = chapter.content.replace('雨夜', '晴夜')
    const before = JSON.stringify(book)
    const wrapper = shallowMount(StoryPlanner, { props: { embedded: true, initialTab: 'arcs', initialSelection: excluded.id },
      global: { renderStubDefaultSlot: true, stubs: { Button: { template: '<button><slot /></button>' } } } })
    try {
      await flushPromises()
      const recovery = wrapper.get('.arc-source-recovery')
      expect(recovery.text()).toContain('旧来源弧线')
      expect(recovery.text()).toContain('来源待核对')
      expect((wrapper.vm as any).selectedArc).toBeUndefined()
      await recovery.findAll('button').find(item => item.text() === '核对原弧线')!.trigger('click')
      expect((wrapper.vm as any).editingArcId).toBe(excluded.id)
      expect((wrapper.vm as any).arcForm.description).toBe(excluded.description)
      expect(JSON.stringify(book)).toBe(before)
      expect(generateStoryStateProposalDrafts).not.toHaveBeenCalled()
    } finally { wrapper.unmount() }
  })

  it('keeps entity navigation inside the embedded V3 planner', async () => {
    readyBook(true)
    const wrapper = shallowMount(StoryPlanner, {
      props: { embedded: true, initialTab: 'plans' },
      global: { renderStubDefaultSlot: true },
    })
    await flushPromises()

    const planner = wrapper.vm as any
    planner.openPlanningTab('arcs', 'arc-1')

    expect(wrapper.emitted('navigate')).toEqual([[{ tab: 'arcs', selection: 'arc-1' }]])
    expect(push).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
