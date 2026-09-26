// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { shallowMount, flushPromises } from '@vue/test-utils'
import SaveChatKnowledge from './SaveChatKnowledge.vue'
import { useKnowledgeStore } from '@/stores/knowledge'
import { useConfigStore } from '@/stores/config'
import { extractChatKnowledge } from '@/services/chatKnowledgeExtraction'

vi.mock('@/services/chatKnowledgeExtraction', () => ({
  extractChatKnowledge: vi.fn(),
  CHAT_KNOWLEDGE_EXTRACT_LIMIT: 16_000,
}))
beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  useConfigStore().models = [{ id: 'local', name: 'local', baseUrl: 'https://example.test',
    modelName: 'test', apiKey: 'synthetic', temperature: 0.7, topP: 0.9, maxTokens: 8000 }]
  vi.mocked(extractChatKnowledge).mockResolvedValue({
    title: '县城税制', category: '事件', summary: '县城每亩缴粮三升。', tags: ['县城', '税制'],
  })
})
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
  it('extracts with the same model assigned to chat rather than the review model', async () => {
    const config = useConfigStore()
    config.models = [
      { ...config.models[0], id: 'dialog', modelName: 'chat-model' },
      { ...config.models[0], id: 'review', modelName: 'review-model' },
    ]
    config.assignments.chat = 'dialog'
    config.assignments.review = 'review'
    const { wrapper } = setup()
    await flushPromises()
    expect(vi.mocked(extractChatKnowledge).mock.calls[0][0].modelName).toBe('chat-model')
    wrapper.unmount()
  })

  it('previews editable content without writing, then saves only after confirmation', async () => {
    const { wrapper, kb, flush } = setup()
    expect(kb.entries).toHaveLength(0)
    expect(flush).not.toHaveBeenCalled()
    await flushPromises()
    expect(wrapper.get('[aria-label="条目标题"]').element.getAttribute('value')).toBe('县城税制')
    expect(wrapper.get('[aria-label="知识条目摘要"]').element.getAttribute('value')).toBe('县城每亩缴粮三升。')
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
    await flushPromises()
    await wrapper.get('[aria-label="新知识库名称"]').setValue('新书史料')
    await saveButton(wrapper).trigger('click')
    await flushPromises()
    const base = store.knowledgeBases.find(item => item.name === '新书史料')!
    expect(base.entries).toHaveLength(1)
    expect(base.entries[0].title).toBe('县城税制')
    expect(base.entries[0].summary).toBe('县城每亩缴粮三升。')
    expect(base.entries[0].category).toBe('事件')
    expect(base.entries[0].tags).toEqual(['县城', '税制'])
    expect(wrapper.emitted('saved')).toHaveLength(1)
    wrapper.unmount()
  })

  it('cancels without creating content and rejects deleted targets', async () => {
    const { wrapper, store, kb } = setup()
    await flushPromises()
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
    await flushPromises()
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
    await flushPromises()
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

  it('waits for extraction before saving, and ignores a late result after closing', async () => {
    let finish!: (value: { title: string; category: string; summary: string; tags: string[] }) => void
    vi.mocked(extractChatKnowledge).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const { wrapper, kb } = setup()
    expect(saveButton(wrapper).attributes('disabled')).toBeDefined()
    await saveButton(wrapper).trigger('click')
    expect(kb.entries).toHaveLength(0)
    await wrapper.setProps({ show: false })
    finish({ title: '晚到标题', category: '人物', summary: '晚到摘要', tags: [] })
    await flushPromises()
    expect(kb.entries).toHaveLength(0)
    await wrapper.setProps({ show: true })
    await flushPromises()
    expect(wrapper.get('[aria-label="条目标题"]').element.getAttribute('value')).not.toBe('晚到标题')
    wrapper.unmount()
  })

  it('offers retry or original-text save when extraction fails', async () => {
    vi.mocked(extractChatKnowledge).mockRejectedValueOnce(new Error('接口超时'))
    const { wrapper, kb } = setup()
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('接口超时')
    expect(kb.entries).toHaveLength(0)
    await saveButton(wrapper).trigger('click')
    await flushPromises()
    expect(kb.entries[0]).toMatchObject({ content: '## 县城税制\n每亩缴粮三升。', summary: '' })
    wrapper.unmount()
  })

  it('shows a second-attempt status while the service retries an invalid response', async () => {
    let finish!: (value: { title: string; category: string; summary: string; tags: string[] }) => void
    vi.mocked(extractChatKnowledge).mockImplementation((_model, _content, _signal, onRetry) => {
      onRetry?.()
      return new Promise(resolve => { finish = resolve })
    })
    const { wrapper } = setup()
    await flushPromises()
    expect(wrapper.get('[role="status"]').text()).toContain('简洁摘要格式')
    finish({ title: '税制', category: '事件', summary: '税制摘要。', tags: [] })
    await flushPromises()
    expect(wrapper.get('[aria-label="知识条目摘要"]').element.getAttribute('value')).toBe('税制摘要。')
    expect(wrapper.find('.knowledge-save-actions').exists()).toBe(true)
    wrapper.unmount()
  })

  it('retries extraction after a failure and saves the summary once confirmed', async () => {
    vi.mocked(extractChatKnowledge).mockRejectedValueOnce(new Error('接口超时'))
    const { wrapper, kb } = setup()
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '重试提取')!.trigger('click')
    await flushPromises()
    expect(extractChatKnowledge).toHaveBeenCalledTimes(2)
    expect(kb.entries).toHaveLength(0)
    await wrapper.get('[aria-label="知识条目摘要"]').setValue('核对后的摘要。')
    await saveButton(wrapper).trigger('click')
    await flushPromises()
    expect(kb.entries).toHaveLength(1)
    expect(kb.entries[0].summary).toBe('核对后的摘要。')
    wrapper.unmount()
  })
})
