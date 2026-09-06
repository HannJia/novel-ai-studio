// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, shallowMount } from '@vue/test-utils'
import AiChatAssistant from './AiChatAssistant.vue'
import { chatWithOptionalSearch } from '@/services/chatSearch'
import { useNovelStore } from '@/stores/novel'
import { useConfigStore } from '@/stores/config'

vi.mock('@/services/chatSearch', async original => ({
  ...await original<object>(), chatWithOptionalSearch: vi.fn(),
}))
vi.mock('naive-ui', async original => ({
  ...await original<object>(), useDialog: () => ({ warning: vi.fn() }),
}))
beforeEach(() => { setActivePinia(createPinia()); vi.mocked(chatWithOptionalSearch).mockReset() })

describe('chat window background behavior', () => {
  it('renders and copies readable citation names without changing stored replies or source links', async () => {
    const store = useNovelStore()
    const book = store.addNovel({ genre: '', subGenre: '', tags: [], targetWordCountMin: 1, targetWordCountMax: 2,
      writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() })
    const url = 'https://example.org/article?utm_source=test'
    const content = `引用 ([example.org](${url}))`
    store.addChatMessage(book.id, { id: 'answer', role: 'assistant', content, timestamp: new Date().toISOString(),
      search: { protocol: 'responses', status: 'searched', sources: [{ title: '时代背景资料', url }] } })
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    const wrapper = shallowMount(AiChatAssistant, { props: { novelId: book.id },
      global: { renderStubDefaultSlot: true, stubs: { ChatSearchEvidence: false } } })
    await wrapper.find('.chat-fab').trigger('click')
    expect(wrapper.find('.msg-content').text()).toBe('引用 (时代背景资料)')
    expect(wrapper.find('.search-sources a').text()).toBe('时代背景资料')
    expect(wrapper.find('.search-sources a').attributes('href')).toBe(url)
    await wrapper.find('[title="复制内容"]').trigger('click')
    expect(copy).toHaveBeenCalledWith('引用 (时代背景资料)')
    expect(book.chatHistory[0].content).toBe(content)
    expect(book.chatHistory[0].search?.sources[0].url).toBe(url)
    wrapper.unmount()
    copy.mockRestore()
  })

  it('minimizes and maximizes without cancelling; shows the completed reply on return', async () => {
    const store = useNovelStore()
    const book = store.addNovel({ genre: '', subGenre: '', tags: [], targetWordCountMin: 1, targetWordCountMax: 2,
      writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() })
    useConfigStore().models = [{ id: 'local', name: 'local', baseUrl: 'https://example.test', modelName: 'test',
      apiKey: 'synthetic', temperature: 0.7, topP: 0.9, maxTokens: 100 }]
    let finish!: (value: { content: string }) => void
    vi.mocked(chatWithOptionalSearch).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const wrapper = shallowMount(AiChatAssistant, { props: { novelId: book.id }, global: { renderStubDefaultSlot: true, stubs: {
      Input: { props: ['value'], emits: ['update:value'], template: '<textarea :value="value" @input="$emit(\'update:value\', $event.target.value)" />' },
      Button: { props: ['disabled'], emits: ['click'], template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>' },
    } } })
    await wrapper.find('.chat-fab').trigger('click')
    await wrapper.find('textarea').setValue('测试后台对话')
    await wrapper.find('.chat-input-area button').trigger('click')
    const signal = vi.mocked(chatWithOptionalSearch).mock.calls[0][0].signal
    await wrapper.find('[aria-label="放大窗口"]').trigger('click')
    expect(wrapper.find('.chat-window.expanded').exists()).toBe(true)
    await wrapper.find('[aria-label="收起窗口"]').trigger('click')
    expect(wrapper.find('.chat-window').exists()).toBe(false)
    expect(wrapper.find('.chat-fab').text()).toBe('⏳')
    expect(signal.aborted).toBe(false)
    finish({ content: '后台返回的建议' })
    await flushPromises()
    expect(store.getNovel(book.id)?.chatHistory.slice(-1)[0]?.content).toBe('后台返回的建议')
    expect(wrapper.find('.chat-fab').attributes('title')).toContain('有新回复')
    await wrapper.find('.chat-fab').trigger('click')
    expect(wrapper.text()).toContain('后台返回的建议')
    await wrapper.find('[aria-label="还原窗口"]').trigger('click')
    expect(wrapper.find('.chat-window.expanded').exists()).toBe(false)
    wrapper.unmount()
  })
})
