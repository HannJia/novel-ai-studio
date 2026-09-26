// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, shallowMount } from '@vue/test-utils'
import StoryPlanner from './StoryPlanner.vue'
import { useNovelStore } from '@/stores/novel'

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
