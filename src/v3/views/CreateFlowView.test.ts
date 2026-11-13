// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, shallowMount } from '@vue/test-utils'
import CreateFlowView from './CreateFlowView.vue'
import { useNovelStore } from '@/stores/novel'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { createEmptyCreationDraft } from '@/types/reconstruction'

const { route } = vi.hoisted(() => ({ route: { params: { novelId: '' } } }))
vi.mock('vue-router', () => ({ useRoute: () => route }))

describe('V3 creation flow', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    route.params.novelId = ''
  })

  it('projects the saved creation stage into the V3 progress rail', async () => {
    const novels = useNovelStore()
    const novel = novels.addNovel({
      genre: 'fantasy', subGenre: 'xuanhuan', tags: [], targetWordCountMin: 20, targetWordCountMax: 30,
      writingStyle: novels.defaultWritingStyle(), settings: novels.defaultSettings(),
    })
    route.params.novelId = novel.id
    const workspace = useReconstructionWorkspaceStore()
    const draft = createEmptyCreationDraft({ id: `creation:${novel.id}`, now: '2026-11-07T00:00:00.000Z', entry: 'blank', mode: 'author' })
    workspace.setCreationDraft(novel.id, draft)

    const wrapper = shallowMount(CreateFlowView, { global: { stubs: { Teleport: true, RouterLink: true } } })
    await flushPromises()
    expect(wrapper.get('[data-step="1"]').attributes('aria-current')).toBe('step')

    workspace.setCreationDraft(novel.id, { ...draft, stage: 'ready' })
    await flushPromises()
    expect(wrapper.get('[data-step="4"]').attributes('aria-current')).toBe('step')
    expect(wrapper.get('.flow-head p').text()).toContain(novel.title)
    wrapper.unmount()
  })
})
