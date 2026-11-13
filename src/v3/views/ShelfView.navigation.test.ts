// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { useNovelStore } from '@/stores/novel'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import ShelfView from './ShelfView.vue'

describe('书架继续写作导航', () => {
  let pinia: ReturnType<typeof createPinia>
  let router: ReturnType<typeof createRouter>
  let wrapper: ReturnType<typeof mount>

  beforeEach(async () => {
    pinia = createPinia()
    setActivePinia(pinia)
    vi.spyOn(useReconstructionWorkspaceStore(), 'hydrateFromPersistence').mockResolvedValue({
      candidates: [], reviewFindings: [], canonMutations: [], chapterReviews: [], aiRuns: [],
    })

    const novels = useNovelStore()
    const novel = novels.addNovel({
      workingTitle: '书架导航合成作品',
      genre: 'fantasy',
      subGenre: 'xuanhuan',
      tags: [],
      targetWordCountMin: 1,
      targetWordCountMax: 2,
      writingStyle: novels.defaultWritingStyle(),
      settings: novels.defaultSettings(),
    })
    const chapter = novels.addChapter(novel.id, { title: '渡口', content: '雨停后，沈砚收起账册。' })!
    chapter.updatedAt = '2026-11-13T00:00:00.000Z'
    novel.updatedAt = chapter.updatedAt

    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: ShelfView },
        { path: '/write/:novelId/:chapterId?', component: { template: '<p data-test="writing-destination">写作台</p>' } },
      ],
    })
    await router.push('/')
    await router.isReady()
    wrapper = mount(RouterView, {
      global: {
        plugins: [pinia, router],
        stubs: { Teleport: true, V3Icon: true, WritingHeatmap: true },
      },
    })
    await flushPromises()
  })

  afterEach(() => {
    wrapper?.unmount()
    disposePinia(pinia)
    vi.restoreAllMocks()
  })

  it('opens the most recently updated chapter from the shelf action', async () => {
    const button = wrapper.get('.hero-acts button.pri.lg')
    expect(button.text()).toContain('回到第1章')

    await button.trigger('click')
    await flushPromises()

    const novel = useNovelStore().activeNovels[0]
    const chapter = novel.chapters[0]
    expect(router.currentRoute.value.fullPath).toBe(`/write/${novel.id}/${chapter.id}`)
    expect(wrapper.get('[data-test="writing-destination"]').text()).toBe('写作台')
  })
})
