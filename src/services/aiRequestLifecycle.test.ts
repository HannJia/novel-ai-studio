// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useConfigStore, type ModelConfig } from '@/stores/config'
import { callAI, type AiRequestLifecycle, type ChatCompletionOptions } from './ai'

const model: ModelConfig = {
  id: 'lifecycle-model', name: '生命周期测试', baseUrl: 'https://example.test', apiKey: 'secret-key',
  modelName: 'test', maxTokens: 100, temperature: 0.7, topP: 0.9,
}

function response(content = '完成', status = 200) {
  return new Response(JSON.stringify({
    choices: [{ message: { content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  }), { status, headers: { 'Content-Type': 'application/json' } })
}

function options(lifecycle: AiRequestLifecycle, signal?: AbortSignal): ChatCompletionOptions {
  return {
    model,
    messages: [{ role: 'user', content: 'private prompt' }],
    skillTask: 'review',
    signal,
    requestLifecycle: lifecycle,
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('AI request lifecycle', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useConfigStore().skills.push({
      id: 'lifecycle-skill', name: '测试 Skill', description: '', task: 'review',
      instructions: '保留可见的 Skill 指令。', enabled: true, builtIn: false,
      createdAt: '2026-10-28T00:00:00Z', updatedAt: '2026-10-28T00:00:00Z',
    })
  })

  it('observes the Skill-enriched request and successful usage before returning', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response())
    vi.stubGlobal('fetch', fetchMock)
    const before = vi.fn(async (request: ChatCompletionOptions) => {
      expect(request.messages[0].content).toContain('保留可见的 Skill 指令。')
      expect(request.noAutomaticRetry).toBe(true)
    })
    const after = vi.fn(async () => undefined)

    const result = await callAI(options({ beforeRequest: before, afterRequest: after }))

    expect(result.usage?.total_tokens).toBe(5)
    expect(before).toHaveBeenCalledOnce()
    expect(after).toHaveBeenCalledOnce()
    expect(after).toHaveBeenCalledWith(expect.objectContaining({
      result: expect.objectContaining({ usage: expect.objectContaining({ total_tokens: 5 }) }),
    }))
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('does not send or call after when admission is rejected', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const lifecycle: AiRequestLifecycle = {
      beforeRequest: async () => { throw new Error('admission denied') },
      afterRequest: vi.fn(async () => undefined),
    }

    await expect(callAI(options(lifecycle))).rejects.toThrow('admission denied')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(lifecycle.afterRequest).not.toHaveBeenCalled()
  })

  it('calls after exactly once for an admitted network failure and disables hidden retries', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('network down'))
    vi.stubGlobal('fetch', fetchMock)
    const after = vi.fn(async () => undefined)
    const lifecycle: AiRequestLifecycle = { beforeRequest: async () => undefined, afterRequest: after }

    await expect(callAI(options(lifecycle))).rejects.toThrow('network down')
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(after).toHaveBeenCalledOnce()
    expect(after).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(TypeError) }))
  })

  it('calls after once for cancellation after admission', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const after = vi.fn(async () => undefined)
    const lifecycle: AiRequestLifecycle = { beforeRequest: async () => undefined, afterRequest: after }
    const request = callAI(options(lifecycle, controller.signal))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    controller.abort()

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(after).toHaveBeenCalledOnce()
    expect(after).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ name: 'AbortError' }) }))
  })

  it('settles an admitted non-stream request cancelled during admission without sending HTTP', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    let releaseBefore: () => void = () => undefined
    const before = vi.fn(() => new Promise<void>(resolve => { releaseBefore = resolve }))
    const after = vi.fn(async () => undefined)
    const request = callAI(options({ beforeRequest: before, afterRequest: after }, controller.signal))

    await vi.waitFor(() => expect(before).toHaveBeenCalledOnce())
    controller.abort()
    releaseBefore()

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(after).toHaveBeenCalledOnce()
    expect(after).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ name: 'AbortError' }) }))
  })

  it('settles an admitted stream request cancelled during admission without sending HTTP', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    let releaseBefore: () => void = () => undefined
    const before = vi.fn(() => new Promise<void>(resolve => { releaseBefore = resolve }))
    const after = vi.fn(async () => undefined)
    const request = callAI({
      ...options({ beforeRequest: before, afterRequest: after }, controller.signal),
      stream: true,
      onChunk: vi.fn(),
    })

    await vi.waitFor(() => expect(before).toHaveBeenCalledOnce())
    controller.abort()
    releaseBefore()

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(after).toHaveBeenCalledOnce()
    expect(after).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ name: 'AbortError' }) }))
  })

  it('records success even when the caller signal is cancelled after the response', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()))
    const after = vi.fn(async ({ result }: { result?: { content: string } }) => {
      expect(result?.content).toBe('完成')
      controller.abort()
    })
    const result = await callAI(options({ beforeRequest: async () => undefined, afterRequest: after }, controller.signal))

    expect(result.content).toBe('完成')
    expect(after).toHaveBeenCalledWith(expect.objectContaining({
      result: expect.objectContaining({ usage: expect.objectContaining({ total_tokens: 5 }) }),
    }))
    expect(after).toHaveBeenCalledOnce()
  })

  it('propagates after persistence failure without re-entering after', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()))
    const after = vi.fn(async () => { throw new Error('ledger write failed') })

    await expect(callAI(options({ beforeRequest: async () => undefined, afterRequest: after })))
      .rejects.toThrow('ledger write failed')
    expect(after).toHaveBeenCalledOnce()
  })

  it('does not retry a lifecycle request after an HTTP failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response('temporary', 500))
    vi.stubGlobal('fetch', fetchMock)
    const after = vi.fn(async () => undefined)

    await expect(callAI(options({ beforeRequest: async () => undefined, afterRequest: after }))).rejects.toThrow('500')
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(after).toHaveBeenCalledOnce()
  })
})
