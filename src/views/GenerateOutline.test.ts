// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, shallowMount } from '@vue/test-utils'
import GenerateOutline from './GenerateOutline.vue'
import { useNovelStore } from '@/stores/novel'
import { callAI } from '@/services/ai'

const { route, push } = vi.hoisted(() => ({ route: { params: { novelId: '' }, query: {} }, push: vi.fn() }))
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ push }) }))
vi.mock('@/services/ai', () => ({ callAI: vi.fn() }))
vi.mock('naive-ui', async importOriginal => ({
  ...await importOriginal<object>(), useMessage: () => ({ success: vi.fn(), warning: vi.fn(), info: vi.fn(), error: vi.fn() }),
}))
beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks() })

describe('editable generated outline', () => {
  it('loads an existing draft without making an AI request, then plans from saved edits', async () => {
    const store = useNovelStore()
    const novel = store.addNovel({ genre: 'urban', subGenre: 'business', tags: [], targetWordCountMin: 80, targetWordCountMax: 100,
      writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() })
    store.updateOutline(novel.id, '## 第一卷：旧计划\n预估章节数：20章\n预估字数：4.4万字')
    route.params.novelId = novel.id
    const wrapper = shallowMount(GenerateOutline, { global: { renderStubDefaultSlot: true, stubs: {
      Button: { props: ['disabled'], emits: ['click'], template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>' },
    } } })
    await flushPromises()
    expect(callAI).not.toHaveBeenCalled()
    const toolbar = wrapper.get('[aria-label="大纲编辑操作"]')
    expect(toolbar.find('.output-content').exists()).toBe(false)
    expect(wrapper.get('.outline-output-scroll').find('.outline-edit-toolbar').exists()).toBe(false)
    expect(wrapper.get('.outline-output-scroll').get('.output-content').text()).toContain('旧计划')
    expect(wrapper.findAll('button').find(item => item.text() === '编辑大纲')!.attributes('disabled')).toBeUndefined()
    await wrapper.findAll('button').find(item => item.text() === '编辑大纲')!.trigger('click')
    const confirm = wrapper.findAll('button').find(item => item.text().includes('确认并规划分卷'))!
    expect(confirm.attributes('disabled')).toBeDefined()
    wrapper.findAllComponents({ name: 'Input' })[0].vm.$emit('update:value', '## 第一卷：下海\n**预估章节数：** 约97章\n**预估字数：** 约21.3万字')
    await flushPromises()
    await wrapper.findAll('button').find(item => item.text() === '保存修改')!.trigger('click')
    await confirm.trigger('click')
    await flushPromises()
    expect(novel.outline).toContain('下海')
    expect(novel.volumes[0]).toMatchObject({ estimatedChapters: 97, estimatedWordCount: 21.3 })
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ path: `/workspace/${novel.id}/planning` }))
    wrapper.unmount()
  })

  it('explains the temporary edit lock while volume planning is running', async () => {
    const store = useNovelStore()
    const novel = store.addNovel({ genre: 'urban', subGenre: 'business', tags: [], targetWordCountMin: 80, targetWordCountMax: 100,
      writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() })
    store.updateOutline(novel.id, '## 总大纲\n可以编辑的正文')
    route.params.novelId = novel.id
    // Hold the transition to exercise the accepting state without an AI call.
    let saved!: () => void
    push.mockImplementationOnce(() => new Promise<void>(resolve => { saved = resolve }))
    const wrapper = shallowMount(GenerateOutline, { global: { renderStubDefaultSlot: true, stubs: {
      Button: { props: ['disabled'], emits: ['click'], template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>' },
    } } })
    await flushPromises()
    await wrapper.findAll('button').find(item => item.text().includes('确认并规划分卷'))!.trigger('click')
    await flushPromises()
    expect(wrapper.get('.outline-edit-status').text()).toContain('正在规划分卷')
    expect(wrapper.findAll('button').find(item => item.text() === '编辑大纲')!.attributes('disabled')).toBeDefined()
    saved()
    await flushPromises()
    wrapper.unmount()
  })
})
