// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, shallowMount } from '@vue/test-utils'
import CreateWizard from './CreateWizard.vue'
import InspirationChat from '@/components/InspirationChat.vue'
import { useNovelStore } from '@/stores/novel'
import type { CreateWizardForm } from '@/types/novel'

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push }), onBeforeRouteLeave: vi.fn() }))
vi.mock('naive-ui', async importOriginal => ({
  ...await importOriginal<object>(), useMessage: () => ({ success: vi.fn(), error: vi.fn() }),
  useDialog: () => ({ warning: vi.fn() }),
}))
beforeEach(() => { setActivePinia(createPinia()); push.mockReset() })
const options = { global: { renderStubDefaultSlot: true, stubs: {
  CreationModePicker: false,
  Button: { props: ['disabled'], emits: ['click'], template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>' },
} } }

type WizardWrapper = ReturnType<typeof shallowMount>
async function choose(wrapper: WizardWrapper, writing: 'ai' | 'manual', setup: 'inspiration' | 'custom') {
  await wrapper.get(`input[name="creation-writing-mode"][value="${writing}"]`).setValue(true)
  await wrapper.get(`input[name="creation-setup-method"][value="${setup}"]`).setValue(true)
  await wrapper.get('#start-creation-btn').trigger('click')
}
function proposal(writingMode: 'ai' | 'manual'): CreateWizardForm {
  const store = useNovelStore()
  const settings = store.defaultSettings()
  settings.protagonist.name = '陈安'
  return { genre: 'urban', subGenre: 'business', tags: ['经商'],
    targetWordCountMin: 80, targetWordCountMax: 100, writingMode,
    writingStyle: store.defaultWritingStyle(), settings }
}

describe('independent writing and settings choices', () => {
  it('offers two independent single-choice groups and waits for an explicit continue', async () => {
    const wrapper = shallowMount(CreateWizard, options)
    expect(wrapper.findAll('.choice-group legend').map(item => item.text())).toEqual(['1. 正文创作方式', '2. 设定准备方式'])
    expect(wrapper.get('#start-creation-btn').attributes('disabled')).toBeDefined()
    await wrapper.get('input[name="creation-writing-mode"][value="ai"]').setValue(true)
    await wrapper.get('input[name="creation-setup-method"][value="custom"]').setValue(true)
    await wrapper.get('input[name="creation-setup-method"][value="inspiration"]').setValue(true)
    expect(wrapper.findComponent(InspirationChat).props('form').writingMode).toBe('ai')
    expect(wrapper.findComponent(InspirationChat).props('active')).toBe(false)
    expect(wrapper.get('#start-creation-btn').attributes('disabled')).toBeUndefined()
    expect(useNovelStore().novels).toHaveLength(0)
    wrapper.unmount()
  })

  it.each([
    ['ai', 'inspiration'], ['manual', 'inspiration'], ['ai', 'custom'], ['manual', 'custom'],
  ] as const)('creates %s + %s and keeps the chosen writing mode through outline creation', async (writing, setup) => {
    const store = useNovelStore()
    const save = vi.spyOn(store, 'saveNovelNow').mockResolvedValue()
    const wrapper = shallowMount(CreateWizard, options)
    await choose(wrapper, writing, setup)
    const chat = wrapper.findComponent(InspirationChat)
    expect(chat.props('form').writingMode).toBe(writing)
    expect(chat.props('active')).toBe(setup === 'inspiration')
    if (setup === 'inspiration') {
      // A stale or model-produced mode must never override the author's choice.
      chat.vm.$emit('apply', proposal(writing === 'ai' ? 'manual' : 'ai'), [{ role: 'user', content: '九十年代创业' }])
    } else {
      await wrapper.findAll('.genre-btn').find(button => button.text() === '都市')!.trigger('click')
      await wrapper.findAll('.sub-genre-btn').find(button => button.text() === '商战职场')!.trigger('click')
    }
    await flushPromises()
    expect(store.novels).toHaveLength(0)
    expect(chat.props('active')).toBe(false)
    expect(chat.props('form').writingMode).toBe(writing)
    await wrapper.find('#wizard-next-btn').trigger('click')
    await wrapper.find('#wizard-create-btn').trigger('click')
    await flushPromises()
    expect(store.novels).toHaveLength(1)
    expect(store.novels[0].writingMode).toBe(writing)
    if (setup === 'inspiration') {
      expect(store.novels[0].settings.protagonist.name).toBe('陈安')
      expect(store.novels[0].inspirationHistory?.[0].content).toBe('九十年代创业')
    } else expect(store.novels[0].inspirationHistory).toHaveLength(0)
    expect(store.novels[0].chatHistory).toHaveLength(0)
    expect(save).toHaveBeenCalledWith(store.novels[0].id)
    expect(push).toHaveBeenCalledWith(`/generate/${store.novels[0].id}`)
    wrapper.unmount()
  })

  it('preserves checked settings/history when switching the combination and ignores inactive results', async () => {
    const store = useNovelStore()
    vi.spyOn(store, 'saveNovelNow').mockResolvedValue()
    const wrapper = shallowMount(CreateWizard, options)
    await choose(wrapper, 'ai', 'inspiration')
    const chat = wrapper.findComponent(InspirationChat)
    chat.vm.$emit('apply', proposal('ai'), [{ role: 'user', content: '已经确认的灵感' }])
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '更换搭配')!.trigger('click')
    chat.vm.$emit('apply', { ...proposal('manual'), genre: '不应采纳的旧回复' }, [])
    await choose(wrapper, 'manual', 'custom')
    expect(chat.props('form')).toMatchObject({ genre: 'urban', writingMode: 'manual', settings: { protagonist: { name: '陈安' } } })
    await wrapper.find('#wizard-next-btn').trigger('click')
    await wrapper.find('#wizard-create-btn').trigger('click')
    await flushPromises()
    expect(store.novels[0].writingMode).toBe('manual')
    expect(store.novels[0].inspirationHistory?.[0].content).toBe('已经确认的灵感')
    expect(store.novels[0].chatHistory).toHaveLength(0)
    wrapper.unmount()
  })

  it('defaults new books to manual mode independently of other books and the setup method', async () => {
    const existing = useNovelStore().addNovel(proposal('ai'))
    const wrapper = shallowMount(CreateWizard, options)
    expect(wrapper.findComponent(InspirationChat).props('form').writingMode).toBe('manual')
    await wrapper.get('input[name="creation-setup-method"][value="custom"]').setValue(true)
    await wrapper.get('#start-creation-btn').trigger('click')
    expect(wrapper.findComponent(InspirationChat).props('form').writingMode).toBe('manual')
    expect(existing.writingMode).toBe('ai')
    wrapper.unmount()
  })
})
