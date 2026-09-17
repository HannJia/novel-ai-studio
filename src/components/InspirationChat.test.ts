// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, shallowMount } from '@vue/test-utils'
import InspirationChat from './InspirationChat.vue'
import { NSelect } from 'naive-ui'
import { chatInspiration, extractInspirationSettings } from '@/services/inspiration'
import { useConfigStore } from '@/stores/config'
import { useNovelStore } from '@/stores/novel'
import { useKnowledgeStore } from '@/stores/knowledge'
import SaveChatKnowledge from './SaveChatKnowledge.vue'
import type { CreateWizardForm } from '@/types/novel'

vi.mock('@/services/inspiration', () => ({ chatInspiration: vi.fn(), extractInspirationSettings: vi.fn() }))
beforeEach(() => { setActivePinia(createPinia()); vi.resetAllMocks(); localStorage.clear() })
afterEach(() => vi.restoreAllMocks())

function mountChat() {
  const store = useNovelStore()
  const form: CreateWizardForm = { genre: '', subGenre: '', tags: [], targetWordCountMin: 1, targetWordCountMax: 2,
    writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() }
  useConfigStore().models = [{ id: 'local', name: 'local', baseUrl: 'https://example.test', modelName: 'test',
    apiKey: 'synthetic', temperature: 0.7, topP: 0.9, maxTokens: 8000 }]
  return shallowMount(InspirationChat, { props: { form, active: true }, global: { renderStubDefaultSlot: true, stubs: {
    Input: { props: ['value', 'disabled'], emits: ['update:value'], template: '<textarea :value="value" :disabled="disabled" @input="$emit(\'update:value\', $event.target.value)" />' },
    Button: { props: ['disabled'], emits: ['click'], template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>' },
  } } })
}
type Wrapper = ReturnType<typeof mountChat>
function button(wrapper: Wrapper, text: string) {
  return wrapper.findAll('button').find(item => item.text() === text)!
}

describe('inspiration search controls', () => {
  it('defaults to available knowledge, remembers a cleared selection and opens a draft without writing', async () => {
    const knowledge = useKnowledgeStore()
    const kb = knowledge.createKB('地方志')
    const wrapper = mountChat()
    vi.mocked(chatInspiration).mockResolvedValue({ content: '## 县学资料\n这是一份待确认草稿。' })
    await wrapper.get('textarea').setValue('帮我整理县学资料')
    await button(wrapper, '发送').trigger('click')
    await flushPromises()
    expect(vi.mocked(chatInspiration).mock.calls[0][5]).toEqual([kb.id])
    await button(wrapper, '存入知识库').trigger('click')
    expect(wrapper.findComponent(SaveChatKnowledge).props('content')).toContain('待确认草稿')
    expect(kb.entries).toHaveLength(0)
    wrapper.findComponent(SaveChatKnowledge).vm.$emit('update:show', false)
    wrapper.findAllComponents(NSelect).find(select => select.attributes('aria-label') === '灵感参考知识库')!.vm.$emit('update:value', [])
    await wrapper.get('textarea').setValue('这轮不使用资料')
    await button(wrapper, '发送').trigger('click')
    await flushPromises()
    expect(vi.mocked(chatInspiration).mock.calls[1][5]).toEqual([])
    expect(JSON.parse(localStorage.getItem('novel-writer-inspiration-sessions')!)[0].knowledgeIds).toEqual([])
    wrapper.unmount()
  })
  it('keeps only the latest author prompt pinned outside the scrolling transcript', async () => {
    const wrapper = mountChat()
    expect(wrapper.find('.inspiration-sticky-prompt').exists()).toBe(false)
    vi.mocked(chatInspiration).mockResolvedValue({ content: '第一轮回答' })
    const prompt = '第一行设定\n第二行设定\n' + '需要完整保留的长问题。'.repeat(100)
    await wrapper.get('textarea').setValue(prompt)
    await button(wrapper, '发送').trigger('click')
    await flushPromises()
    const pinned = wrapper.get('.inspiration-sticky-prompt')
    expect(pinned.get('.inspiration-sticky-text').text()).toBe(prompt)
    expect(wrapper.get('.inspiration-history').find('.inspiration-sticky-prompt').exists()).toBe(false)
    expect(wrapper.get('.inspiration-message.user strong').text()).toBe('我')
    expect(wrapper.get('.inspiration-message.assistant strong').text()).toBe('AI')
    await button(wrapper, '展开').trigger('click')
    expect(button(wrapper, '收起').attributes('aria-expanded')).toBe('true')
    expect(pinned.get('.inspiration-sticky-text').classes()).toContain('expanded')
    const history = wrapper.get('.inspiration-history')
    history.element.scrollTop = 500
    await history.trigger('scroll')
    expect(pinned.get('.inspiration-sticky-text').text()).toBe(prompt)

    vi.mocked(chatInspiration).mockImplementation(() => new Promise(() => {}))
    await wrapper.get('textarea').setValue('新的问题')
    await button(wrapper, '发送').trigger('click')
    expect(wrapper.findAll('.inspiration-sticky-prompt')).toHaveLength(1)
    expect(pinned.get('.inspiration-sticky-text').text()).toBe('新的问题')
    expect(button(wrapper, '展开').attributes('aria-expanded')).toBe('false')
    history.element.scrollTop = 0
    await history.trigger('scroll')
    expect(pinned.text()).not.toContain('第一行设定')
    await button(wrapper, '停止').trigger('click')
    expect(pinned.get('.inspiration-sticky-text').text()).toBe('新的问题')
    wrapper.unmount()
  })

  it.each([false, true])('positions a completed reply at its start (search=%s), without chunk-by-chunk bottom jumps', async search => {
    let finish!: (result: { content: string }) => void
    vi.mocked(chatInspiration).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const wrapper = mountChat()
    const container = wrapper.get('.inspiration-history').element as HTMLElement
    // A positioned ancestor need not be the scrollport. offsetTop must not be
    // used; the mocked rectangles change as a real scrollport scrolls.
    vi.spyOn(container, 'getBoundingClientRect').mockImplementation(() => ({ top: 200 } as DOMRect))
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
      return { top: 200 + (this.classList.contains('user') ? 30 : 900) - container.scrollTop } as DOMRect
    })
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 10000 })
    if (search) await wrapper.get('.inspiration-search-toggle').trigger('click')
    await wrapper.get('textarea').setValue('长回复定位')
    await button(wrapper, '发送').trigger('click')
    await flushPromises()
    const onChunk = vi.mocked(chatInspiration).mock.calls[0][3]
    if (!search) {
      onChunk('开头')
      await flushPromises()
      container.scrollTop = 1200 // The author chooses where to read.
      onChunk('新增的正文'.repeat(300))
      await flushPromises()
      expect(container.scrollTop).toBe(1200)
    }
    finish({ content: '开头\n\n' + '长回复内容\n\n'.repeat(300) })
    await flushPromises()
    expect(container.scrollTop).toBe(888)
    expect(wrapper.find('[data-streaming-assistant]').exists()).toBe(false)
    expect(wrapper.findAll('.inspiration-message.assistant')).toHaveLength(1)
    container.scrollTop = 1500
    await button(wrapper, '回看原消息').trigger('click')
    expect(container.scrollTop).toBe(18)
    wrapper.unmount()
  })

  it('does not reposition the transcript for an aborted late reply', async () => {
    let finish!: (result: { content: string }) => void
    vi.mocked(chatInspiration).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const wrapper = mountChat()
    await wrapper.get('textarea').setValue('停止后保留阅读位置')
    await button(wrapper, '发送').trigger('click')
    await flushPromises()
    await button(wrapper, '停止').trigger('click')
    const container = wrapper.get('.inspiration-history').element
    container.scrollTop = 270
    finish({ content: '晚到结果' })
    await flushPromises()
    expect(container.scrollTop).toBe(270)
    expect(wrapper.find('.inspiration-message.assistant').exists()).toBe(false)
    wrapper.unmount()
  })

  it('sends with Enter and prevents repeat/blank/busy submissions', async () => {
    const wrapper = mountChat()
    vi.mocked(chatInspiration).mockImplementation(() => new Promise(() => {}))
    const textarea = wrapper.get('textarea')
    await textarea.setValue('第一条灵感')
    await textarea.trigger('keydown', { key: 'Enter', repeat: true })
    expect(chatInspiration).not.toHaveBeenCalled()
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    textarea.element.dispatchEvent(enter)
    await flushPromises()
    expect(enter.defaultPrevented).toBe(true)
    expect(chatInspiration).toHaveBeenCalledTimes(1)
    expect(vi.mocked(chatInspiration).mock.calls[0][1]).toEqual([{ role: 'user', content: '第一条灵感' }])
    await textarea.trigger('keydown', { key: 'Enter' })
    expect(chatInspiration).toHaveBeenCalledTimes(1)
    await button(wrapper, '停止').trigger('click')
    await textarea.setValue('   ')
    await textarea.trigger('keydown', { key: 'Enter' })
    expect(chatInspiration).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('keeps Shift+Enter as native newline instead of sending', async () => {
    const wrapper = mountChat()
    const textarea = wrapper.get('textarea')
    await textarea.setValue('两行灵感')
    const newline = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true })
    textarea.element.dispatchEvent(newline)
    await flushPromises()
    expect(newline.defaultPrevented).toBe(false)
    expect(chatInspiration).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('回车发送 · 上档键＋回车换行')
    wrapper.unmount()
  })

  it('does not send while choosing Chinese input characters, including IME fallback events', async () => {
    const wrapper = mountChat()
    vi.mocked(chatInspiration).mockResolvedValue({ content: '收到' })
    const textarea = wrapper.get('textarea')
    await textarea.setValue('中文灵感')
    await textarea.trigger('compositionstart')
    await textarea.trigger('keydown', { key: 'Enter' })
    await textarea.trigger('compositionend')
    await textarea.trigger('keydown', { key: 'Enter', isComposing: true })
    await textarea.trigger('keydown', { key: 'Enter', keyCode: 229 })
    expect(chatInspiration).not.toHaveBeenCalled()
    await textarea.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(chatInspiration).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.inspiration-message.user').text()).toContain('中文灵感')
    wrapper.unmount()
  })

  it('does not send from an inactive inspiration view', async () => {
    const wrapper = mountChat()
    await wrapper.get('textarea').setValue('暂未发送')
    await wrapper.setProps({ active: false })
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter' })
    expect(chatInspiration).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('uses the chat model with search on/off, but keeps settings extraction on the outline model', async () => {
    const wrapper = mountChat()
    const config = useConfigStore()
    config.models.push({ ...config.models[0], id: 'outline', modelName: 'outline-model' },
      { ...config.models[0], id: 'chat', modelName: 'chat-model', chatSearchProtocol: 'responses' })
    config.assignments.outline = 'outline'
    vi.mocked(chatInspiration).mockResolvedValue({ content: '构思建议' })
    await wrapper.find('textarea').setValue('聊想法')
    await button(wrapper, '发送').trigger('click')
    await flushPromises()
    expect(vi.mocked(chatInspiration).mock.calls[0][0].id).toBe('outline')

    config.assignments.chat = 'chat'
    await wrapper.find('.inspiration-search-toggle').trigger('click')
    await wrapper.find('textarea').setValue('查询背景')
    await button(wrapper, '发送').trigger('click')
    await flushPromises()
    expect(vi.mocked(chatInspiration).mock.calls[1][0]).toMatchObject({ id: 'chat', chatSearchProtocol: 'responses' })
    expect(vi.mocked(chatInspiration).mock.calls[1][4]).toBe(true)
    await wrapper.find('.inspiration-search-toggle').trigger('click')
    await wrapper.find('textarea').setValue('继续构思')
    await button(wrapper, '发送').trigger('click')
    await flushPromises()
    expect(vi.mocked(chatInspiration).mock.calls[2][0].id).toBe('chat')
    expect(vi.mocked(chatInspiration).mock.calls[2][4]).toBe(false)

    vi.mocked(extractInspirationSettings).mockResolvedValue(wrapper.props('form'))
    await button(wrapper, '整理设定并检查').trigger('click')
    await flushPromises()
    expect(vi.mocked(extractInspirationSettings).mock.calls[0][0].id).toBe('outline')
    wrapper.unmount()
  })

  it('hides citation URLs only in assistant presentation and keeps the original conversation for extraction', async () => {
    const wrapper = mountChat()
    const url = 'https://example.test/article?utm_source=test'
    const content = `构思依据：([example.test](${url}))`
    const search = { protocol: 'responses' as const, status: 'searched' as const, sources: [{ url, title: '背景资料' }] }
    vi.mocked(chatInspiration).mockResolvedValue({ content, search })
    await wrapper.find('textarea').setValue(`我提供的链接：${url}`)
    await button(wrapper, '发送').trigger('click')
    await flushPromises()
    expect(wrapper.find('.inspiration-message.assistant').text()).toContain('构思依据：(背景资料)')
    expect(wrapper.find('.inspiration-message.assistant').text()).not.toContain(url)
    expect(wrapper.find('.inspiration-message.user').text()).toContain(url)
    vi.mocked(extractInspirationSettings).mockResolvedValue(wrapper.props('form'))
    await button(wrapper, '整理设定并检查').trigger('click')
    await flushPromises()
    expect(vi.mocked(extractInspirationSettings).mock.calls[0][1][1]).toEqual({ role: 'assistant', content, search })
    wrapper.unmount()
  })

  it('defaults off; toggling during a request affects the next message only, and extraction carries evidence for confirmation', async () => {
    let finish!: (result: Awaited<ReturnType<typeof chatInspiration>>) => void
    vi.mocked(chatInspiration).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const wrapper = mountChat()
    expect(wrapper.find('.inspiration-search-toggle').attributes('aria-pressed')).toBe('false')
    await wrapper.find('.inspiration-search-toggle').trigger('click')
    await wrapper.find('textarea').setValue('查近期事件给我一点灵感')
    await button(wrapper, '发送').trigger('click')
    const args = vi.mocked(chatInspiration).mock.calls[0]
    expect(args[4]).toBe(true)
    await wrapper.find('.inspiration-search-toggle').trigger('click')
    expect(args[2].aborted).toBe(false)
    expect(wrapper.text()).toContain('正在请求联网回复')
    const search = { protocol: 'responses' as const, status: 'searched' as const,
      sources: [{ title: '参考资料', url: 'https://example.org/event' }] }
    finish({ content: '先区分真实事件和虚构设定。', search })
    await flushPromises()
    expect(wrapper.findAllComponents({ name: 'ChatSearchEvidence' }).slice(-1)[0].props('record')).toEqual(search)
    vi.mocked(extractInspirationSettings).mockResolvedValue(wrapper.props('form'))
    await button(wrapper, '整理设定并检查').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('apply')?.[0]?.[1]).toEqual([
      { role: 'user', content: '查近期事件给我一点灵感' }, { role: 'assistant', content: '先区分真实事件和虚构设定。', search },
    ])
    expect(wrapper.emitted('apply')).toHaveLength(1)
    // Applying is only a confirmation form event, not creating or changing a book.
    expect(useNovelStore().novels).toHaveLength(0)
    vi.mocked(chatInspiration).mockResolvedValue({ content: '纯构思回复' })
    await wrapper.find('textarea').setValue('接着想人物冲突')
    await button(wrapper, '发送').trigger('click')
    await flushPromises()
    expect(vi.mocked(chatInspiration).mock.calls[1][4]).toBe(false)
    wrapper.unmount()
  })

  it.each(['停止', '退出灵感', '卸载'] as const)('%s cancels and rejects a late search reply', async action => {
    let finish!: (result: { content: string }) => void
    vi.mocked(chatInspiration).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const wrapper = mountChat()
    await wrapper.find('.inspiration-search-toggle').trigger('click')
    await wrapper.find('textarea').setValue('查背景')
    await button(wrapper, '发送').trigger('click')
    const signal = vi.mocked(chatInspiration).mock.calls[0][2]
    if (action === '停止') await button(wrapper, '停止').trigger('click')
    else if (action === '退出灵感') await wrapper.setProps({ active: false })
    else wrapper.unmount()
    expect(signal.aborted).toBe(true)
    finish({ content: '不应出现的旧回复' })
    await flushPromises()
    expect(wrapper.emitted('apply')).toBeUndefined()
    if (action !== '卸载') {
      expect(wrapper.text()).not.toContain('不应出现的旧回复')
      wrapper.unmount()
    }
  })

  it('surfaces unsupported search errors without changing the switch or silently retrying', async () => {
    vi.mocked(chatInspiration).mockRejectedValue(new Error('接口不接受 responses 联网请求（400）'))
    const wrapper = mountChat()
    await wrapper.find('.inspiration-search-toggle').trigger('click')
    await wrapper.find('textarea').setValue('查近期背景')
    await button(wrapper, '发送').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('400')
    expect(wrapper.find('.inspiration-search-toggle').attributes('aria-pressed')).toBe('true')
    expect(chatInspiration).toHaveBeenCalledTimes(1)
    expect(button(wrapper, '重试回复').exists()).toBe(true)
    wrapper.unmount()
  })

  it('persists inspiration sessions and keeps only the latest five', async () => {
    vi.mocked(chatInspiration).mockResolvedValue({ content: '回复' })
    for (let index = 0; index < 6; index++) {
      const wrapper = mountChat()
      wrapper.findComponent(NSelect).vm.$emit('update:value', null)
      await wrapper.get('textarea').setValue(`第 ${index + 1} 个灵感会话`)
      await button(wrapper, '发送').trigger('click')
      await flushPromises()
      wrapper.unmount()
    }

    const sessions = JSON.parse(localStorage.getItem('novel-writer-inspiration-sessions') || '[]') as Array<{ messages: Array<{ content: string }> }>
    expect(sessions).toHaveLength(5)
    expect(sessions[0].messages[0].content).toBe('第 6 个灵感会话')
  })

  it('restores the latest complete conversation after refresh and continues the same session', async () => {
    localStorage.setItem('novel-writer-inspiration-sessions', JSON.stringify([{
      id: 'saved-session',
      title: '已有想法',
      updatedAt: '2026-09-06T10:00:00.000Z',
      messages: [
        { role: 'user', content: '已有第一句' },
        { role: 'assistant', content: '已有第一句的回复' },
      ],
    }]))
    vi.mocked(chatInspiration).mockResolvedValue({ content: '继续回复' })
    const wrapper = mountChat()

    expect(wrapper.findAll('.inspiration-message')).toHaveLength(2)
    expect(wrapper.find('.inspiration-session-select').exists()).toBe(true)
    await wrapper.get('textarea').setValue('继续聊第二句')
    await button(wrapper, '发送').trigger('click')
    await flushPromises()

    const sessions = JSON.parse(localStorage.getItem('novel-writer-inspiration-sessions') || '[]') as Array<{ id: string; messages: Array<{ content: string }> }>
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe('saved-session')
    expect(sessions[0].messages.map(message => message.content)).toEqual([
      '已有第一句', '已有第一句的回复', '继续聊第二句', '继续回复',
    ])
    wrapper.unmount()
  })
})
