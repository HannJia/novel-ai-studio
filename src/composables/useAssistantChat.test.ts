// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { effectScope, ref } from 'vue'
import { useAssistantChat } from './useAssistantChat'
import { useNovelStore } from '@/stores/novel'
import { useConfigStore } from '@/stores/config'
import { chatWithOptionalSearch } from '@/services/chatSearch'

vi.mock('@/services/chatSearch', () => ({ chatWithOptionalSearch: vi.fn() }))
beforeEach(() => { setActivePinia(createPinia()); vi.mocked(chatWithOptionalSearch).mockReset() })

function setup() {
  const store = useNovelStore()
  const config = useConfigStore()
  config.models = [{ id: 'model', name: 'model', modelName: 'model', apiKey: 'test-only', baseUrl: 'https://example.test', maxTokens: 100, temperature: 0.7, topP: 0.9 }]
  const form = { genre: '', subGenre: '', tags: [], targetWordCountMin: 10, targetWordCountMax: 20, writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() }
  const first = store.addNovel(form)
  const second = store.addNovel(form)
  const id = ref(first.id)
  const scope = effectScope()
  const chat = scope.run(() => useAssistantChat(() => id.value))!
  return { chat, id, first, second, scope, store, config }
}

describe('chat lifecycle and book isolation', () => {
  it('does not show or resend raw inspiration but still uses confirmed settings', async () => {
    const { chat, first, store, scope } = setup()
    store.setInspirationHistory(first.id, [{
      id: 'idea-only', role: 'user', content: '讨论过但已否定的旧方案', timestamp: first.createdAt,
    }])
    first.settings.protagonist.background = '已确认的主角背景'
    expect(chat.messages.value).toHaveLength(0)
    vi.mocked(chatWithOptionalSearch).mockResolvedValue({ content: '本次建议' })
    chat.inputText.value = '现在该怎么写'
    await chat.sendMessage()
    const prompt = vi.mocked(chatWithOptionalSearch).mock.calls[0][0].messages
    expect(JSON.stringify(prompt)).not.toContain('已否定的旧方案')
    expect(JSON.stringify(prompt)).toContain('已确认的主角背景')
    chat.clear()
    expect(first.chatHistory).toHaveLength(0)
    expect(first.inspirationHistory).toHaveLength(1)
    scope.stop()
  })

  it('routes chat to outline by default and an explicit chat model with search either on or off', async () => {
    const { chat, config, scope } = setup()
    config.models.push({ ...config.models[0], id: 'outline' },
      { ...config.models[0], id: 'chat', chatSearchProtocol: 'responses' })
    config.assignments.outline = 'outline'
    config.assignments.writing = 'model'
    vi.mocked(chatWithOptionalSearch).mockResolvedValue({ content: '构思建议' })
    chat.inputText.value = '普通构思'
    await chat.sendMessage()
    expect(vi.mocked(chatWithOptionalSearch).mock.calls[0][0]).toMatchObject({ model: { id: 'outline' }, webSearch: false })
    config.assignments.chat = 'chat'
    chat.toggleSearch()
    chat.inputText.value = '查询背景'
    await chat.sendMessage()
    expect(vi.mocked(chatWithOptionalSearch).mock.calls[1][0]).toMatchObject({
      model: { id: 'chat', chatSearchProtocol: 'responses' }, webSearch: true,
    })
    chat.toggleSearch()
    chat.inputText.value = '不搜索继续构思'
    await chat.sendMessage()
    expect(vi.mocked(chatWithOptionalSearch).mock.calls[2][0]).toMatchObject({ model: { id: 'chat' }, webSearch: false })
    expect(config.getModelForTask('outline')?.id).toBe('outline')
    expect(config.getModelForTask('writing')?.id).toBe('model')
    scope.stop()
  })

  it('keeps the search switch per book, off by default', () => {
    const { chat, id, first, second, scope } = setup()
    expect(chat.webSearch.value).toBe(false)
    chat.toggleSearch()
    expect(first.chatWebSearchEnabled).toBe(true)
    id.value = second.id
    expect(chat.webSearch.value).toBe(false)
    scope.stop()
  })

  it.each(['switch-book', 'clear', 'stop', 'dispose'] as const)('rejects late responses after %s', async action => {
    const { chat, id, first, second, scope } = setup()
    let finish!: (value: { content: string }) => void
    vi.mocked(chatWithOptionalSearch).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    chat.toggleSearch()
    chat.inputText.value = '测试问题'
    const pending = chat.sendMessage()
    const signal = vi.mocked(chatWithOptionalSearch).mock.calls[0][0].signal
    if (action === 'switch-book') id.value = second.id
    else if (action === 'clear') chat.clear()
    else if (action === 'dispose') scope.stop()
    else chat.stop()
    expect(signal.aborted).toBe(true)
    finish({ content: '不应该写入的旧回复' })
    await pending
    expect(first.chatHistory.some(item => item.role === 'assistant')).toBe(false)
    expect(second.chatHistory).toHaveLength(0)
    scope.stop()
  })

  it('lets the current request finish when the next-message search preference changes', async () => {
    const { chat, first, scope } = setup()
    let finish!: (value: { content: string }) => void
    vi.mocked(chatWithOptionalSearch).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    chat.toggleSearch()
    chat.inputText.value = '正在联网的问题'
    const pending = chat.sendMessage()
    chat.toggleSearch()
    expect(chat.webSearch.value).toBe(false)
    expect(chat.thinking.value).toBe(true)
    expect(vi.mocked(chatWithOptionalSearch).mock.calls[0][0]).toMatchObject({ webSearch: true })
    expect(vi.mocked(chatWithOptionalSearch).mock.calls[0][0].signal.aborted).toBe(false)
    finish({ content: '后台执行完成' })
    await pending
    expect(first.chatHistory.slice(-1)[0]?.content).toBe('后台执行完成')
    scope.stop()
  })

  it('persists search evidence with the message, without changing manuscript', async () => {
    const { chat, first, scope } = setup()
    vi.mocked(chatWithOptionalSearch).mockResolvedValue({ content: '建议', search: { protocol: 'responses', status: 'searched', sources: [{ url: 'https://example.org', title: '来源' }] } })
    chat.toggleSearch()
    chat.inputText.value = '我的问题'
    await chat.sendMessage()
    expect(first.chatHistory[1].search?.sources).toHaveLength(1)
    expect(first.chapters).toHaveLength(0)
    scope.stop()
  })

  it('shows missing-key errors without dropping the unsent text', async () => {
    const { chat, config, scope } = setup()
    config.models[0].apiKey = ''
    chat.inputText.value = '保留这个问题'
    await chat.sendMessage()
    expect(chat.error.value).toContain('API Key')
    expect(chat.inputText.value).toBe('保留这个问题')
    expect(chatWithOptionalSearch).not.toHaveBeenCalled()
    scope.stop()
  })
})
