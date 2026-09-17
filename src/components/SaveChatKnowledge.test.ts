// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { shallowMount, flushPromises } from '@vue/test-utils'
import SaveChatKnowledge from './SaveChatKnowledge.vue'
import { useKnowledgeStore } from '@/stores/knowledge'

beforeEach(() => { setActivePinia(createPinia()) })
afterEach(() => vi.restoreAllMocks())
function setup(preferred = true) {
  const store = useKnowledgeStore()
  const kb = store.createKB('历史资料')
  const flush = vi.spyOn(store, 'flushPendingSaves').mockResolvedValue()
  const wrapper = shallowMount(SaveChatKnowledge, {
    props: { show: true, content: '## 县城税制\n每亩缴粮三升。', preferredIds: preferred ? [kb.id] : [] },
    global: { renderStubDefaultSlot: true, stubs: {
      Modal: { template: '<section><slot /><slot name="action" /></section>' },
      Input: { props: ['value', 'disabled'], emits: ['update:value'], template: '<input :value="value" :disabled="disabled" @input="$emit(\'update:value\', $event.target.value)" />' },
      Button: { props: ['disabled'], emits: ['click'], template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>' },
    } },
  })
  return { wrapper, store, kb, flush }
}
type Wrapper = ReturnType<typeof setup>['wrapper']
const saveButton = (wrapper: Wrapper) => wrapper.findAll('button').find(button => /确认保存|重试保存/.test(button.text()))!

describe('explicit chat knowledge writes', () => {
  it('previews editable content without writing, then saves only after confirmation', async () => {
    const { wrapper, kb, flush } = setup()
    expect(kb.entries).toHaveLength(0)
    expect(flush).not.toHaveBeenCalled()
    await wrapper.get('[aria-label="条目标题"]').setValue('核实后的县城税制')
    await wrapper.get('[aria-label="知识条目内容"]').setValue('经作者核实，每亩缴粮两升。')
    await saveButton(wrapper).trigger('click')
    await flushPromises()
    expect(kb.entries).toHaveLength(1)
    expect(kb.entries[0]).toMatchObject({ title: '核实后的县城税制', content: '经作者核实，每亩缴粮两升。', summary: '' })
    expect(flush).toHaveBeenCalledOnce()
    expect(wrapper.emitted('saved')?.[0]?.[0]).toMatchObject({ kbId: kb.id, title: '核实后的县城税制' })
    wrapper.unmount()
  })

  it('creates a named library and its first entry in one confirmation', async () => {
    const { wrapper, store } = setup(false)
    await wrapper.get('[aria-label="新知识库名称"]').setValue('新书史料')
    await saveButton(wrapper).trigger('click')
    await flushPromises()
    const base = store.knowledgeBases.find(item => item.name === '新书史料')!
    expect(base.entries).toHaveLength(1)
    expect(base.entries[0].title).toBe('县城税制')
    expect(wrapper.emitted('saved')).toHaveLength(1)
    wrapper.unmount()
  })

  it('cancels without creating content and rejects deleted targets', async () => {
    const { wrapper, store, kb } = setup()
    await wrapper.findAll('button').find(button => button.text() === '取消')!.trigger('click')
    expect(kb.entries).toHaveLength(0)
    expect(wrapper.emitted('saved')).toBeUndefined()
    store.knowledgeBases = []
    await saveButton(wrapper).trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('已不存在')
    expect(store.knowledgeBases).toHaveLength(0)
    wrapper.unmount()
  })

  it('does not report success before persistence or duplicate a failed write on retry', async () => {
    const { wrapper, kb, flush } = setup()
    flush.mockRejectedValueOnce(new Error('写盘失败'))
    await saveButton(wrapper).trigger('click')
    await flushPromises()
    expect(wrapper.emitted('saved')).toBeUndefined()
    expect(wrapper.get('[role="alert"]').text()).toContain('不会重复创建')
    expect(kb.entries).toHaveLength(1)
    await saveButton(wrapper).trigger('click')
    await flushPromises()
    expect(kb.entries).toHaveLength(1)
    expect(wrapper.emitted('saved')).toHaveLength(1)
    wrapper.unmount()
  })

  it('suppresses duplicate confirmation and late receipts after leaving the conversation', async () => {
    const { wrapper, kb, flush } = setup()
    let complete!: () => void
    flush.mockImplementation(() => new Promise(resolve => { complete = resolve }))
    await saveButton(wrapper).trigger('click')
    await saveButton(wrapper).trigger('click')
    expect(kb.entries).toHaveLength(1)
    expect(wrapper.emitted('saved')).toBeUndefined()
    wrapper.unmount()
    complete()
    await flushPromises()
    expect(wrapper.emitted('saved')).toBeUndefined()
  })
})
