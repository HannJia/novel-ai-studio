import { afterEach, describe, expect, it, vi } from 'vitest'
import { callAI } from './ai'
import type { ModelConfig } from '@/stores/config'

const model: ModelConfig = {
  id: 'cancel-model', name: '取消测试', baseUrl: 'https://example.test', apiKey: 'test', modelName: 'test',
  maxTokens: 100, temperature: 0.7, topP: 0.9,
}

afterEach(() => vi.unstubAllGlobals())

describe('AI 请求取消', () => {
  it('用户取消后立即结束且不进入自动重试', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const request = callAI({ model, messages: [{ role: 'user', content: '生成正文' }], signal: controller.signal })
    controller.abort()
    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
