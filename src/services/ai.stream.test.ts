import { afterEach, describe, expect, it, vi } from 'vitest'
import { callAI } from './ai'
import { acknowledgeAiActivity, useAiActivities } from './aiActivity'
import type { ModelConfig } from '@/stores/config'

const model = { baseUrl: 'https://example.test', apiKey: 'test', modelName: 'test', maxTokens: 100 } as ModelConfig
const event = (text: string) => `data:${JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] })}\r\n\r\n`
function response(text: string, chunkSize = 1024, close = true) {
  const bytes = new TextEncoder().encode(text)
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize))
      if (close) controller.close()
    },
  }))
}
afterEach(() => {
  for (const task of useAiActivities().activities.value) acknowledgeAiActivity(task.id)
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
describe('AI stream completion', () => {
  it.each([1, 7, 1024])('parses Chinese split across %i-byte chunks and preserves finish reason and usage', async size => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(event('结局。') +
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"length"}],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}\n\ndata: [DONE]', size)))
    const onChunk = vi.fn()
    const result = await callAI({ model, messages: [], stream: true, onChunk })
    expect(result).toMatchObject({ content: '结局。', finishReason: 'length', usage: { total_tokens: 5 } })
    expect(onChunk.mock.calls.flat().join('')).toBe('结局。')
  })
  it('finishes at DONE even if the relay keeps the connection open and disposes the timeout', async () => {
    vi.useFakeTimers()
    let requestSignal: AbortSignal
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      requestSignal = init.signal
      return response(event('完整输出') + 'data: [DONE]\n\n', 1024, false)
    }))
    expect((await callAI({ model, messages: [], stream: true, onChunk: vi.fn(), timeoutMs: 1000 })).finishReason).toBe('stop')
    await vi.advanceTimersByTimeAsync(2000)
    expect(requestSignal!.aborted).toBe(false)
  })
  it('does not treat an unmarked EOF as a successful generation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(event('半截'))))
    const onChunk = vi.fn()
    await expect(callAI({ model, messages: [], stream: true, onChunk })).rejects.toThrow('提前结束')
    expect(onChunk).toHaveBeenCalledWith('半截')
  })
  it('accepts a terminal finish reason without a DONE marker', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(event('结尾') +
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}')))
    expect((await callAI({ model, messages: [], stream: true, onChunk: vi.fn() })).content).toBe('结尾')
  })
  it.each(['data: not-json\n\n', 'data: {"error":{"message":"private provider detail"}}\n\n'])('fails on corrupt or error events without exposing their raw body', async body => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(body)))
    await expect(callAI({ model, messages: [], stream: true, onChunk: vi.fn() })).rejects.toThrow(/无效|返回错误/)
  })
  it('does not swallow errors raised by the consumer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(event('数据') + 'data: [DONE]\n\n')))
    await expect(callAI({ model, messages: [], stream: true, onChunk: () => { throw new Error('consumer failed') } })).rejects.toThrow('consumer failed')
  })
})
