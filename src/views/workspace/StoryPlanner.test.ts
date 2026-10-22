// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, shallowMount } from '@vue/test-utils'
import StoryPlanner from './StoryPlanner.vue'
import { useNovelStore } from '@/stores/novel'
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

beforeEach(() => {
  setActivePinia(createPinia())
  dialogInfo.mockReset().mockReturnValue({ destroy: dialogDestroy })
  dialogDestroy.mockReset()
  push.mockReset()
})

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
  it('groups initial memory by source and discards a search arriving after a category change', async () => {
    const book = readyBook(true)
    useNovelStore().addCharacter(book.id, { name: '测试角色', identity: '调查员' })
    const wrapper = shallowMount(StoryPlanner, { global: { renderStubDefaultSlot: true, stubs: {
      Button: { template: '<button><slot /></button>' },
    } } })
    await flushPromises()
    expect(wrapper.find('details.planner-summary-details').exists()).toBe(false)
    expect(wrapper.findAll('.planner-overview strong')).toHaveLength(8)
    expect(wrapper.find('.memory-results p').exists()).toBe(false)
    const categories = wrapper.findAll('.memory-categories button')
    expect(categories.map(tab => tab.text().replace(/\d+/g, ''))).toEqual(['全部', '章节', '角色', '事件', '故事弧线', '章节计划', '知识库', '数据面板'])
    await categories[2].trigger('click')
    expect(wrapper.findAll('.memory-result')).toHaveLength(1)
    expect(wrapper.get('.memory-result').text()).toContain('测试角色')
    let resolveSearch!: (value: Awaited<ReturnType<typeof queryPersistedSemanticEvidence>>) => void
    vi.mocked(queryPersistedSemanticEvidence).mockImplementationOnce(() => new Promise(resolve => { resolveSearch = resolve }))
    wrapper.get('.memory-search').findComponent({ name: 'Input' }).vm.$emit('update:value', '测试')
    await flushPromises()
    await wrapper.get('.memory-search button').trigger('click')
    await flushPromises()
    expect(queryPersistedSemanticEvidence).toHaveBeenLastCalledWith(book.id, '测试', 12, expect.any(Object), 'character')
    await categories[3].trigger('click')
    resolveSearch([{ id: 'late', novelId: book.id, sourceType: 'character', sourceId: 'late', title: '迟到的角色结果', content: '过期', score: 1, citation: '过期' }])
    await flushPromises()
    expect(wrapper.get('.memory-categories button[aria-pressed="true"]').text()).toContain('事件')
    expect(wrapper.get('.memory-results').text()).not.toContain('迟到的角色结果')
    expect(wrapper.get('.memory-results').text()).toContain('线索')
    wrapper.unmount()
  })
  it('incrementally refreshes an existing index before searching current content', async () => {
    const book = readyBook(true)
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
    expect(syncSemanticIndexForNovel).toHaveBeenCalledWith(expect.objectContaining({ id: book.id }), expect.any(Array), expect.any(Object), false)
    expect(queryPersistedSemanticEvidence).toHaveBeenCalledWith(book.id, '新线索', 12, expect.any(Object), undefined)
    expect(vi.mocked(syncSemanticIndexForNovel).mock.invocationCallOrder.slice(-1)[0]).toBeLessThan(vi.mocked(queryPersistedSemanticEvidence).mock.invocationCallOrder.slice(-1)[0])
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
})
