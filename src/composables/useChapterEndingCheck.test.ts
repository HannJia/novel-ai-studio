import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChapterEndingCheck } from './useChapterEndingCheck'
import { callAI } from '@/services/ai'
import type { ModelConfig } from '@/stores/config'

vi.mock('@/services/ai', () => ({ callAI: vi.fn() }))
const model = { id: 'test' } as ModelConfig
beforeEach(() => vi.resetAllMocks())

describe('chapter ending response validation', () => {
  it('preserves a valid explanation containing Chinese quotation marks', async () => {
    vi.mocked(callAI).mockResolvedValue({ content: JSON.stringify({ isComplete: true, isValidCliffhanger: false, reason: '“锁好房门”完成当前动作。' }), finishReason: 'stop' })
    const check = await useChapterEndingCheck().requestChapterEndingCheck(model, '合成正文')
    expect(check.isComplete).toBe(true)
    expect(check.reason).toBe('“锁好房门”完成当前动作。')
    expect(callAI).toHaveBeenCalledOnce()
  })

  it('keeps a genuine incomplete chapter result distinct from invalid output', async () => {
    vi.mocked(callAI).mockResolvedValue({ content: '{"isComplete":false,"reason":"动作被截断"}', finishReason: 'stop' })
    expect((await useChapterEndingCheck().requestChapterEndingCheck(model, '他正要')).isComplete).toBe(false)
    vi.mocked(callAI).mockResolvedValue({ content: '{"isComplete":"true"}', finishReason: 'stop' })
    await expect(useChapterEndingCheck().requestChapterEndingCheck(model, '正文')).rejects.toThrow('返回格式无效')
  })

  it('reports truncation and usage without silently retrying or increasing the request limit', async () => {
    vi.mocked(callAI).mockResolvedValue({ content: '', finishReason: 'length', usage: { prompt_tokens: 10, completion_tokens: 900, total_tokens: 910 } })
    await expect(useChapterEndingCheck().requestChapterEndingCheck(model, '正文')).rejects.toThrow('输出用量：900 token')
    expect(callAI).toHaveBeenCalledOnce()
    expect(vi.mocked(callAI).mock.calls[0][0]).toMatchObject({ maxTokens: 900, noAutomaticRetry: true, structuredOutput: 'concise-json' })
  })
})
