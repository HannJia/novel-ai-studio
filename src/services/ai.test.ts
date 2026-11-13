// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { ModelConfig } from '@/stores/config'
import { callAI, type ChatCompletionOptions } from './ai'
import { structuredOutputDiagnostic } from './aiDiagnostics'

const model: ModelConfig = {
  id: 'structured-test', name: 'untrusted display name', baseUrl: 'https://api.deepseek.com',
  apiKey: 'synthetic-test-key', modelName: 'deepseek-flash', maxTokens: 4000, temperature: 0.7, topP: 0.9,
}
const usage = { prompt_tokens: 70, completion_tokens: 900, total_tokens: 970,
  completion_tokens_details: { reasoning_tokens: 608 } }
const content = '{"complete":true}'

function response(stream: boolean, reportedUsage: unknown = usage, finishReason = 'stop') {
  if (!stream) return new Response(JSON.stringify({
    choices: [{ message: { content, reasoning_content: 'private nonstream reasoning' }, finish_reason: finishReason }],
    usage: reportedUsage,
  }))
  const events = [
    { choices: [{ index: 0, delta: { reasoning_content: 'private stream reasoning' } }] },
    { choices: [{ index: 0, delta: { content }, finish_reason: finishReason }] },
    { choices: [], usage: reportedUsage },
  ]
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } })
}

beforeEach(() => setActivePinia(createPinia()))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe.each([false, true])('AI transport (stream=%s)', stream => {
  function options(overrides: Partial<ChatCompletionOptions> = {}): ChatCompletionOptions {
    return { model: { ...model }, messages: [{ role: 'user', content: 'Return a JSON object with complete: boolean.' }],
      stream, onChunk: vi.fn(), maxTokens: 900, noAutomaticRetry: true, structuredOutput: 'concise-json', ...overrides }
  }

  it.each(['deepseek-flash', 'deepseek-v4-pro'])('opts in for the exact official model %s without changing budget or sampling', async modelName => {
    const fetcher = vi.fn().mockResolvedValue(response(stream))
    vi.stubGlobal('fetch', fetcher)
    const request = options({ model: { ...model, modelName } })
    await callAI(request)
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls[0][0]).toBe('https://api.deepseek.com/v1/chat/completions')
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      model: modelName, messages: request.messages, max_tokens: 900, temperature: model.temperature, top_p: model.topP,
      stream, thinking: { type: 'disabled' }, response_format: { type: 'json_object' },
    })
    expect(request.maxTokens).toBe(900)
    expect(request.model.maxTokens).toBe(4000)
    expect(request.noAutomaticRetry).toBe(true)
  })

  it.each(['https://api.deepseek.com/', 'https://api.deepseek.com/v1', 'https://api.deepseek.com/v1/',
    'https://api.deepseek.com:443/v1', 'HTTPS://API.DEEPSEEK.COM/v1'])('accepts only an official root/v1 endpoint: %s', async baseUrl => {
    const fetcher = vi.fn().mockResolvedValue(response(stream))
    vi.stubGlobal('fetch', fetcher)
    await callAI(options({ model: { ...model, baseUrl } }))
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ thinking: { type: 'disabled' }, response_format: { type: 'json_object' } })
  })

  it.each([
    'https://unknown.example/v1', 'http://api.deepseek.com', 'https://api.deepseek.com.evil.example',
    'https://evilapi.deepseek.com', 'https://api.deepseek.com@evil.example', 'https://evil.example@api.deepseek.com',
    'https://user:password@api.deepseek.com', 'https://@api.deepseek.com', 'https://api.deepseek.com:444/v1',
    'https://api.deepseek.com./v1', 'https://api%2edeepseek.com/v1', 'https://api.deepseek.com/v1?key=x',
    'https://api.deepseek.com/v1?', 'https://api.deepseek.com/v1#', 'https://api.deepseek.com/v1#fragment',
    'https://api.deepseek.com/custom', 'https://api.deepseek.com/v1/chat/completions', 'https://api.deepseek.com/V1',
    'https://api.deepseek.com//v1', 'https://api.deepseek.com/other/../v1', 'https://api.deepseek.com/%76%31',
    'https://api.deepseek.com/other/%2e%2e/v1', 'https://api.deepseek.com\\v1', 'https://api.deepseek.com\n/v1',
    'https://api.deepseek.com/v1\n', ' https://api.deepseek.com', 'https://api.deepseek.com/v1 ',
    '//api.deepseek.com/v1', 'not a URL', '',
  ])('does not add provider fields for an unknown or noncanonical endpoint: %s', async baseUrl => {
    const fetcher = vi.fn().mockResolvedValue(response(stream))
    vi.stubGlobal('fetch', fetcher)
    await callAI(options({ model: { ...model, baseUrl } }))
    const body = JSON.parse(fetcher.mock.calls[0][1].body)
    expect(body).not.toHaveProperty('thinking')
    expect(body).not.toHaveProperty('response_format')
    expect(body.max_tokens).toBe(900)
  })

  it.each(['deepseek-chat', 'deepseek-reasoner', 'deepseek-flash-custom', 'deepseek-v4-pro-latest', 'DeepSeek-Flash', 'deepseek-flash ', 'unknown'])('does not infer capabilities for model %s', async modelName => {
    const fetcher = vi.fn().mockResolvedValue(response(stream))
    vi.stubGlobal('fetch', fetcher)
    await callAI(options({ model: { ...model, modelName, name: 'deepseek-flash' } }))
    const body = JSON.parse(fetcher.mock.calls[0][1].body)
    expect(body).not.toHaveProperty('thinking')
    expect(body).not.toHaveProperty('response_format')
  })

  it('leaves ordinary requests and model-default maxTokens unchanged', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(stream))
    vi.stubGlobal('fetch', fetcher)
    const request = options({ structuredOutput: undefined, maxTokens: undefined, noAutomaticRetry: undefined })
    await callAI(request)
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ model: model.modelName, messages: request.messages,
      max_tokens: 4000, temperature: model.temperature, top_p: model.topP, stream })
    expect(request.noAutomaticRetry).toBeUndefined()
  })

  it.each([429, 500, 503])('honors noAutomaticRetry on HTTP %s without provider fallback', async status => {
    const fetcher = vi.fn().mockImplementation(async () => new Response('synthetic failure', { status }))
    vi.stubGlobal('fetch', fetcher)
    await expect(callAI(options())).rejects.toThrow(String(status))
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls[0][0]).toBe('https://api.deepseek.com/v1/chat/completions')
  })

  it('honors noAutomaticRetry on network errors', async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetcher)
    await expect(callAI(options())).rejects.toThrow('Failed to fetch')
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('preserves length finish and usage, without retrying or raising maxTokens', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(stream, usage, 'length'))
    vi.stubGlobal('fetch', fetcher)
    const result = await callAI(options())
    expect(result.finishReason).toBe('length')
    expect(result.usage).toEqual(usage)
    expect(structuredOutputDiagnostic(result)).toContain('推理用量：608 token')
    expect(fetcher).toHaveBeenCalledOnce()
    expect(JSON.parse(fetcher.mock.calls[0][1].body).max_tokens).toBe(900)
  })

  it('passes opt-in and unmodified budget to the lifecycle and exposes only safe usage and content', async () => {
    const privateUsage = { ...usage, reasoning_content: 'private usage reasoning',
      completion_tokens_details: { reasoning_tokens: 608, reasoning_content: 'private details reasoning' } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(stream, privateUsage)))
    const beforeRequest = vi.fn(async (request: ChatCompletionOptions) => {
      expect(request.structuredOutput).toBe('concise-json')
      expect(request.maxTokens).toBe(900)
      expect(request.noAutomaticRetry).toBe(true)
    })
    const afterRequest = vi.fn(async () => undefined)
    const request = options({ requestLifecycle: { beforeRequest, afterRequest }, noAutomaticRetry: undefined })
    const result = await callAI(request)
    expect(result).toEqual({ content, finishReason: 'stop', usage })
    expect(afterRequest).toHaveBeenCalledExactlyOnceWith({ result })
    expect(beforeRequest).toHaveBeenCalledOnce()
    if (stream) expect(request.onChunk).toHaveBeenCalledExactlyOnceWith(content)
    else expect(request.onChunk).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('reasoning_content')
    expect(JSON.stringify(result)).not.toContain('private')
  })

  it.each([undefined, {}, { completion_tokens: 900 }, { completion_tokens_details: { reasoning_tokens: 0 } }])('accepts omitted/partial numeric usage: %j', async reportedUsage => {
    // Passing null represents no usage because the response helper defaults undefined.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(stream, reportedUsage ?? null)))
    const result = await callAI(options())
    expect(result.content).toBe(content)
    expect(result.usage).toEqual(reportedUsage && Object.keys(reportedUsage).length ? reportedUsage : undefined)
  })

  it('drops malformed numeric counters and unknown provider fields before lifecycle settlement', async () => {
    const reportedUsage = { prompt_tokens: 'secret', completion_tokens: -1, total_tokens: 0,
      completion_tokens_details: { reasoning_tokens: 'private reasoning' }, other: 'private data' }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(stream, reportedUsage)))
    const result = await callAI(options())
    expect(result.usage).toEqual({ total_tokens: 0 })
  })
})

it('does not even read reasoning_content on nonstream responses or usage details', async () => {
  const failOnRead = () => { throw new Error('reasoning_content was accessed') }
  const message = { content }
  const details = { reasoning_tokens: 608 }
  const reportedUsage = { ...usage, completion_tokens_details: details }
  for (const object of [message, details, reportedUsage]) Object.defineProperty(object, 'reasoning_content', { get: failOnRead, enumerable: true })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true,
    json: async () => ({ choices: [{ message, finish_reason: 'stop' }], usage: reportedUsage }) }))
  expect(await callAI({ model, messages: [{ role: 'user', content: 'JSON please' }], structuredOutput: 'concise-json' }))
    .toEqual({ content, finishReason: 'stop', usage })
})
