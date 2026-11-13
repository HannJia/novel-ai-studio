// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, shallowMount } from '@vue/test-utils'
import AiChatAssistant from './BookChat.vue'
import { chatWithOptionalSearch } from '@/services/chatSearch'
import { useNovelStore } from '@/stores/novel'

vi.mock('@/services/chatSearch', async original => ({
  ...await original<object>(), chatWithOptionalSearch: vi.fn(),
}))
vi.mock('naive-ui', async original => ({
  ...await original<object>(), useDialog: () => ({ warning: vi.fn() }),
}))
beforeEach(() => { setActivePinia(createPinia()); vi.mocked(chatWithOptionalSearch).mockReset() })

describe('chat window background behavior', () => {
  it('clears an unchanged selection prefill when reset and preserves later manual edits', async () => {
    const store = useNovelStore()
    const book = store.addNovel({ genre: '', subGenre: '', tags: [], targetWordCountMin: 1, targetWordCountMax: 2,
      writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() })
    const wrapper = shallowMount(AiChatAssistant, { props: { novelId: book.id, prefill: '旧章节选区正文' }, global: { renderStubDefaultSlot: true, stubs: {
      Input: { props: ['value'], emits: ['update:value'], template: '<textarea :value="value" @input="$emit(\'update:value\', $event.target.value)" />' },
    } } })
    expect(wrapper.get('textarea').element.value).toBe('旧章节选区正文')
    await wrapper.setProps({ prefill: '', prefillVersion: 1 })
    await flushPromises()
    expect(wrapper.get('textarea').element.value).toBe('')
    await wrapper.setProps({ prefill: '新的选区正文', prefillVersion: 2 })
    await flushPromises()
    await wrapper.setProps({ prefill: '新的选区正文', prefillVersion: 3 })
    await flushPromises()
    expect(wrapper.get('textarea').element.value).toBe('新的选区正文')
    await wrapper.get('textarea').setValue('作者手动补充的问题')
    await wrapper.setProps({ prefill: '', prefillVersion: 4 })
    await flushPromises()
    expect(wrapper.get('textarea').element.value).toBe('作者手动补充的问题')
    wrapper.unmount()
  })

  it('keeps an IME composition in the input when Ctrl+Enter is pressed', async () => {
    const store = useNovelStore()
    const book = store.addNovel({ genre: '', subGenre: '', tags: [], targetWordCountMin: 1, targetWordCountMax: 2,
      writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() })
    const wrapper = shallowMount(AiChatAssistant, { props: { novelId: book.id }, global: { renderStubDefaultSlot: true, stubs: {
      Input: { props: ['value'], emits: ['update:value'], template: '<textarea :value="value" @input="$emit(\'update:value\', $event.target.value)" />' },
    } } })
    await wrapper.get('textarea').setValue('尚在输入的灵感')
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter', ctrlKey: true, isComposing: true })
    expect(chatWithOptionalSearch).not.toHaveBeenCalled()
    expect(wrapper.get('textarea').element.value).toBe('尚在输入的灵感')
    expect(book.chatHistory).toHaveLength(0)
    wrapper.unmount()
  })
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
})
