import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callAI } from '@/services/ai'
import { CHAT_KNOWLEDGE_EXTRACT_LIMIT, extractChatKnowledge } from './chatKnowledgeExtraction'
import type { ModelConfig } from '@/stores/config'

vi.mock('@/services/ai', () => ({ callAI: vi.fn() }))
const model = { id: 'test', name: 'test', modelName: 'test', apiKey: 'synthetic',
  baseUrl: 'https://example.test', maxTokens: 8000 } as ModelConfig

beforeEach(() => vi.resetAllMocks())

describe('chat knowledge extraction', () => {
  it('makes one bounded request and validates extracted fields', async () => {
    vi.mocked(callAI).mockResolvedValue({ content: '```json\n{"title":"县城税制","category":"事件","summary":"每亩缴粮三升。","tags":["税制","县城",17]}\n```' })
    const longContent = '这是一条设定。'.repeat(4000)
    const result = await extractChatKnowledge(model, longContent)
    expect(result).toEqual({ title: '县城税制', category: '事件', summary: '每亩缴粮三升。', tags: ['税制', '县城'] })
    expect(callAI).toHaveBeenCalledOnce()
    expect(vi.mocked(callAI).mock.calls[0][0]).toMatchObject({
      taskName: '提取知识条目', maxTokens: 4000, timeoutMs: 90_000, noAutomaticRetry: true, stream: true,
    })
    expect(vi.mocked(callAI).mock.calls[0][0].messages[1].content).toBe(longContent.slice(0, CHAT_KNOWLEDGE_EXTRACT_LIMIT))
  })

  it('accepts a valid summary without title and ignores unexpected categories', async () => {
    vi.mocked(callAI).mockResolvedValue({ content: '{"summary":"每亩缴粮三升。","category":"假分类","tags":[]}' })
    await expect(extractChatKnowledge(model, '## 县城税制\n原文')).resolves.toEqual({
      title: '县城税制', category: '其他', summary: '每亩缴粮三升。', tags: [],
    })
    expect(callAI).toHaveBeenCalledOnce()
  })

  it('retries invalid structured output with a simpler streamed summary', async () => {
    vi.mocked(callAI).mockResolvedValueOnce({ content: '{"title":"县城税制"}' })
      .mockResolvedValueOnce({ content: '县城每亩缴粮三升，尚待核实。' })
    const onRetry = vi.fn()
    await expect(extractChatKnowledge(model, '## 县城税制\n原文', undefined, onRetry)).resolves.toEqual({
      title: '县城税制', category: '其他', summary: '县城每亩缴粮三升，尚待核实。', tags: [],
    })
    expect(onRetry).toHaveBeenCalledOnce()
    expect(callAI).toHaveBeenCalledTimes(2)
    expect(vi.mocked(callAI).mock.calls[1][0]).toMatchObject({ stream: true, taskName: '重试提取知识摘要' })
  })

  it('reports an actionable error only after both attempts have no usable content', async () => {
    vi.mocked(callAI).mockResolvedValue({ content: '' })
    await expect(extractChatKnowledge(model, '原文')).rejects.toThrow('更换对话模型')
    expect(callAI).toHaveBeenCalledTimes(2)
  })

  it('does not retry after cancellation', async () => {
    const controller = new AbortController()
    vi.mocked(callAI).mockImplementation(async () => {
      controller.abort()
      return { content: '' }
    })
    await expect(extractChatKnowledge(model, '原文', controller.signal)).rejects.toBeTruthy()
    expect(callAI).toHaveBeenCalledOnce()
  })
})
