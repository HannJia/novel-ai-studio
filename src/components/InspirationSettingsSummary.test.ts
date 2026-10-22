// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { shallowMount } from '@vue/test-utils'
import { NInput, NSelect, NModal } from 'naive-ui'
import InspirationSettingsSummary from './InspirationSettingsSummary.vue'
import { useNovelStore } from '@/stores/novel'
import type { CreateWizardForm } from '@/types/novel'

beforeEach(() => setActivePinia(createPinia()))
function setup() {
  const store = useNovelStore()
  const form: CreateWizardForm = { genre: 'urban', subGenre: 'business', tags: [], targetWordCountMin: 30, targetWordCountMax: 50, writingMode: 'manual', writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() }
  form.settings.protagonist.name = '林晚'
  const wrapper = shallowMount(InspirationSettingsSummary, { props: { form, busy: false, extracting: false, canExtract: true }, global: { renderStubDefaultSlot: true, stubs: {
    Modal: { props: ['show'], template: '<section v-if="show"><slot/><slot name="footer"/></section>' },
    Button: { props: ['disabled'], template: '<button :disabled="disabled"><slot/></button>' },
  } } })
  return { form, wrapper, save: () => wrapper.findAll('button').find(button => button.text() === '保存设定')! }
}

describe('inspiration draft sidebar', () => {
  it('edits a copied draft without applying settings or mutating the parent form', async () => {
    const { form, wrapper, save } = setup()
    await wrapper.get('[aria-label="编辑主角"]').trigger('click')
    wrapper.findComponent(NInput).vm.$emit('update:value', '  苏晴  ')
    await save().trigger('click')
    const draft = wrapper.emitted('draft-change')![0][0] as CreateWizardForm
    expect(draft.settings.protagonist.name).toBe('苏晴')
    expect(draft.writingMode).toBe('manual')
    expect(form.settings.protagonist.name).toBe('林晚')
    expect(wrapper.emitted('extract')).toBeUndefined()
    wrapper.unmount()
  })
  it('clears an incompatible subgenre when the genre changes and cancels without emitting', async () => {
    const { wrapper, save } = setup()
    await wrapper.get('[aria-label="编辑类型"]').trigger('click')
    wrapper.findComponent(NSelect).vm.$emit('update:value', 'fantasy')
    await save().trigger('click')
    expect(wrapper.emitted('draft-change')![0][0]).toMatchObject({ genre: 'fantasy', subGenre: '' })
    await wrapper.get('[aria-label="编辑故事舞台"]').trigger('click')
    await wrapper.findAll('button').find(button => button.text() === '取消')!.trigger('click')
    expect(wrapper.emitted('draft-change')).toHaveLength(1)
    expect(wrapper.findComponent(NModal).props('show')).toBe(false)
    wrapper.unmount()
  })
  it('blocks draft edits during generation', async () => {
    const { wrapper } = setup()
    await wrapper.setProps({ busy: true })
    expect(wrapper.get('[aria-label="编辑主角"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
})
