// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { callAI } from './ai'
import type { ModelConfig } from '@/stores/config'
afterEach(() => vi.unstubAllGlobals())
describe('paid OCR request budgets', () => {
  it('disables automatic retry for budgeted calls even when the endpoint returns 500', async () => {
    setActivePinia(createPinia())
    const fetcher = vi.fn().mockResolvedValue(new Response('temporary error', { status: 500 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(callAI({ model: { name: 'test', modelName: 'test', apiKey: 'test', baseUrl: 'https://example.test' } as ModelConfig,
      messages: [{ role: 'user', content: 'review' }], noAutomaticRetry: true, redactErrors: true })).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledOnce()
  })
})
