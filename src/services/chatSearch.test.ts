import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatWithOptionalSearch, parseSearchResponse, resolveChatSearchProtocol, safeSourceUrl } from './chatSearch'
import type { ModelConfig } from '@/stores/config'

const model: ModelConfig = {
  id: 'fixture', name: 'fixture', baseUrl: 'https://relay.example/v1', apiKey: 'synthetic-key', modelName: 'gpt-test',
  temperature: 0.7, topP: 0.9, maxTokens: 1000,
}
const responsePayload = {
  status: 'completed',
  output: [{ type: 'web_search_call', status: 'completed' }, { type: 'message',
    content: [{ type: 'output_text', text: '搜索回答', annotations: [
      { type: 'url_citation', url: 'https://example.org/source', title: '资料' },
      { type: 'url_citation', url: 'javascript:alert(1)', title: '危险链接' },
    ] }],
  }],
}
const messages = [{ role: 'user' as const, content: '请查证一个历史年份' }]
afterEach(() => vi.unstubAllGlobals())

describe('optional server-side chat search', () => {
  it('matches a protocol without treating it as a capability probe', () => {
    expect(resolveChatSearchProtocol(model)).toBe('responses')
    expect(resolveChatSearchProtocol({ ...model, modelName: 'claude-sonnet-test' })).toBe('anthropic')
    expect(resolveChatSearchProtocol({ ...model, baseUrl: 'https://openrouter.ai/api/v1' })).toBe('openrouter')
    expect(resolveChatSearchProtocol({ ...model, chatSearchProtocol: 'chat-completions' })).toBe('chat-completions')
  })

  it('sends a real Responses tool only to the configured service, with storage disabled', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(responsePayload)))
    vi.stubGlobal('fetch', fetcher)
    const result = await chatWithOptionalSearch({ model, messages, webSearch: true, signal: new AbortController().signal })
    expect(fetcher.mock.calls[0][0]).toBe('https://relay.example/v1/responses')
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ tools: [{ type: 'web_search' }], store: false })
    expect(result.search).toMatchObject({ status: 'searched', sources: [{ title: '资料' }] })
  })

  it('uses Claude native tool protocol and reads both citations and tool results', async () => {
    const payload = { content: [
      { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://example.org/a', title: '来源A' }] },
      { type: 'text', text: 'Claude 回答', citations: [{ type: 'web_search_result_location', url: 'https://example.org/a', title: '来源A', cited_text: '证据' }] },
    ], stop_reason: 'end_turn' }
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload)))
    vi.stubGlobal('fetch', fetcher)
    const result = await chatWithOptionalSearch({ model: { ...model, modelName: 'claude-test' }, messages,
      webSearch: true, signal: new AbortController().signal })
    expect(fetcher.mock.calls[0][0]).toBe('https://relay.example/v1/messages')
    expect(JSON.parse(fetcher.mock.calls[0][1].body).tools).toEqual([{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }])
    expect(result.search?.sources).toHaveLength(1)
    expect(result.search?.sources[0].excerpt).toBe('证据')
  })

  it('does not infer successful search from a prose claim or HTTP 200', () => {
    const result = parseSearchResponse({ choices: [{ message: { content: '我已经联网查了' } }] }, 'openrouter')
    expect(result.search.status).toBe('unverified')
    const noTool = parseSearchResponse({ output: [{ type: 'message', content: [{ type: 'output_text', text: '普通构思' }] }] }, 'responses')
    expect(noTool.search.status).toBe('not-used')
  })

  it.each(['openrouter', 'chat-completions'] as const)('adds only the documented %s request option', async protocol => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: {
      content: '搜索回答', annotations: [{ type: 'url_citation', url_citation: { url: 'https://example.org/', title: '原始来源' } }],
    } }] })))
    vi.stubGlobal('fetch', fetcher)
    const result = await chatWithOptionalSearch({ model: { ...model, chatSearchProtocol: protocol }, messages, webSearch: true, signal: new AbortController().signal })
    const body = JSON.parse(fetcher.mock.calls[0][1].body)
    expect(protocol === 'openrouter' ? body.plugins : body.web_search_options).toBeDefined()
    expect(result.search?.status).toBe('searched')
  })

  it('offline chat keeps normal Chat Completions and sends no search fields', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '普通回答' } }] })))
    vi.stubGlobal('fetch', fetcher)
    const result = await chatWithOptionalSearch({ model, messages, webSearch: false, signal: new AbortController().signal })
    const body = JSON.parse(fetcher.mock.calls[0][1].body)
    expect(fetcher.mock.calls[0][0]).toBe('https://relay.example/v1/chat/completions')
    for (const field of ['tools', 'plugins', 'web_search_options']) expect(body[field]).toBeUndefined()
    expect(result.search).toBeUndefined()
  })

  it('refuses search-only aliases when search is switched off', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(chatWithOptionalSearch({ model: { ...model, modelName: 'openai/gpt-test:online' }, messages,
      webSearch: false, signal: new AbortController().signal })).rejects.toThrow('联网专用模型')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([400, 401, 403, 404, 429, 500])('does not retry, leak error bodies or silently degrade on %i', async status => {
    const fetcher = vi.fn().mockResolvedValue(new Response('private-provider-diagnostic', { status }))
    vi.stubGlobal('fetch', fetcher)
    await expect(chatWithOptionalSearch({ model, messages, webSearch: true, signal: new AbortController().signal }))
      .rejects.toThrow(new RegExp(`${status}`))
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('stops an in-flight search and never starts a follow-up request', async () => {
    const fetcher = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
    }))
    vi.stubGlobal('fetch', fetcher)
    const controller = new AbortController()
    const request = chatWithOptionalSearch({ model, messages, webSearch: true, signal: controller.signal })
    controller.abort()
    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('rejects tool errors and unfinished answers', () => {
    expect(() => parseSearchResponse({ content: [{ type: 'web_search_tool_result',
      content: { type: 'web_search_tool_result_error', error_code: 'invalid_tool_input' } }] }, 'anthropic')).toThrow()
    expect(() => parseSearchResponse({ status: 'incomplete' }, 'responses')).toThrow()
    expect(() => parseSearchResponse({ stop_reason: 'pause_turn' }, 'anthropic')).toThrow()
    expect(safeSourceUrl('file:///C:/private')).toBeNull()
    expect(safeSourceUrl('https://user:secret@example.org')).toBeNull()
  })
})
