import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatWithOptionalSearch, parseSearchResponse, resolveChatSearchProtocol, safeSourceUrl, testChatSearch, searchProtocolDescription } from './chatSearch'
import type { ModelConfig } from '@/stores/config'
import { activeAiCount } from './aiActivity'
import { appUpdateInstalling } from './appLifecycle'

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
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  appUpdateInstalling.value = false
})

describe('optional server-side chat search', () => {
  it('tracks a pending web conversation until its response is finished', async () => {
    let respond!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { respond = resolve })))
    const request = chatWithOptionalSearch({ model, messages, webSearch: true, signal: new AbortController().signal })
    expect(activeAiCount.value).toBe(1)
    respond(new Response(JSON.stringify(responsePayload)))
    await request
    expect(activeAiCount.value).toBe(0)
  })

  it('does not send a web request while preparing an update installation', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    appUpdateInstalling.value = true
    await expect(chatWithOptionalSearch({ model, messages, webSearch: true, signal: new AbortController().signal }))
      .rejects.toThrow('准备安装更新')
    expect(fetcher).not.toHaveBeenCalled()
    expect(activeAiCount.value).toBe(0)
  })

  it('matches a protocol without treating it as a capability probe', () => {
    expect(resolveChatSearchProtocol(model)).toBe('responses')
    expect(resolveChatSearchProtocol({ ...model, modelName: 'claude-sonnet-test' })).toBe('anthropic')
    expect(resolveChatSearchProtocol({ ...model, baseUrl: 'https://openrouter.ai/api/v1' })).toBe('openrouter')
    expect(resolveChatSearchProtocol({ ...model, chatSearchProtocol: 'chat-completions' })).toBe('chat-completions')
    expect(searchProtocolDescription({ ...model, modelName: 'claude-test' })).toBe('自动推测：Claude Messages · /messages')
    expect(searchProtocolDescription({ ...model, chatSearchProtocol: 'responses' })).toBe('已选择：Responses · /responses')
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

  it('accepts a relay returning Claude SSE for stream:false without retrying or changing the endpoint', async () => {
    const events = [
      { type: 'message_start', message: { content: [], stop_reason: null } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '已核对官网' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'citations_delta', citation: {
        type: 'web_search_result_location', url: 'https://vuejs.org/', title: 'Vue',
      } } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { server_tool_use: { web_search_requests: 1 } } },
      { type: 'message_stop' },
    ]
    const body = events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')
    const fetcher = vi.fn().mockResolvedValue(new Response(body, { headers: { 'content-type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', fetcher)
    const result = await testChatSearch({ ...model, modelName: 'claude-test' }, new AbortController().signal)
    expect(result.status).toBe('verified')
    expect(result.message).toContain('Claude 事件流')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][0]).toBe('https://relay.example/v1/messages')
    expect(JSON.parse(fetcher.mock.calls[0][1].body).stream).toBe(false)
  })

  it('normalizes the same base URL whether or not the user adds /v1', async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ content: [{ type: 'text', text: '回答' }] }))))
    vi.stubGlobal('fetch', fetcher)
    for (const baseUrl of ['https://relay.example', 'https://relay.example/v1', 'https://relay.example/v1/']) {
      await testChatSearch({ ...model, baseUrl, modelName: 'claude-test' }, new AbortController().signal)
    }
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(Array(3).fill('https://relay.example/v1/messages'))
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
    expect(activeAiCount.value).toBe(0)
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
    expect(activeAiCount.value).toBe(0)
  })

  it('rejects tool errors and unfinished answers', () => {
    expect(() => parseSearchResponse({ content: [{ type: 'web_search_tool_result',
      content: { type: 'web_search_tool_result_error', error_code: 'invalid_tool_input' } }] }, 'anthropic')).toThrow()
    expect(() => parseSearchResponse({ status: 'incomplete' }, 'responses')).toThrow()
    expect(() => parseSearchResponse({ stop_reason: 'pause_turn' }, 'anthropic')).toThrow()
    expect(safeSourceUrl('file:///C:/private')).toBeNull()
    expect(safeSourceUrl('https://user:secret@example.org')).toBeNull()
  })

  it('reports transport failure separately from permission errors without exposing the key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError(`Failed to fetch ${model.apiKey}`)))
    const result = await testChatSearch({ ...model, modelName: 'claude-test' }, new AbortController().signal)
    expect(result.status).toBe('failed')
    expect(result.message).toContain('SEARCH_CONNECTION_FAILED')
    expect(result.message).toContain('Claude Messages /messages')
    expect(result.message).toContain('跨域')
    expect(result.message).not.toContain(model.apiKey)
    expect(result.message).not.toContain(model.baseUrl)
  })

  it.each([
    [401, '身份验证'], [403, '搜索权限'], [404, '不接受'], [429, '限流'], [500, '暂时异常'],
  ])('reports HTTP %s with a distinct reason', async (status, detail) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(`private ${model.apiKey}`, { status: Number(status) })))
    const result = await testChatSearch(model, new AbortController().signal)
    expect(result.status).toBe('failed')
    expect(result.message).toContain(`HTTP_${status}`)
    expect(result.message).toContain(detail)
    expect(result.message).not.toContain(model.apiKey)
  })

  it('requires search evidence and sources rather than a successful ordinary answer', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output: [{ type: 'message', content: [{ type: 'output_text', text: '我能联网' }] }],
    })))
    vi.stubGlobal('fetch', fetcher)
    const result = await testChatSearch(model, new AbortController().signal)
    expect(result.status).toBe('unverified')
    expect(result.message).toContain('不能据此判定联网成功')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetcher.mock.calls[0][1].body).input).toHaveLength(1)
  })

  it('uses a bounded, separate test prompt and leaves the configuration unchanged', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(responsePayload)))
    vi.stubGlobal('fetch', fetcher)
    const config = { ...model, maxTokens: 64000 }
    const result = await testChatSearch(config, new AbortController().signal)
    expect(result).toMatchObject({ status: 'verified', sourceCount: 1 })
    expect(config.maxTokens).toBe(64000)
    const body = JSON.parse(fetcher.mock.calls[0][1].body)
    expect(body.max_output_tokens).toBe(2048)
    expect(body.input).toEqual([{ role: 'user', content: expect.stringContaining('Vue 官方网站') }])
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('does not claim complete verification when a tool runs without citations', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output: [{ type: 'web_search_call', status: 'completed' }, { type: 'message', content: [{ type: 'output_text', text: '已搜索' }] }],
    }))))
    expect(await testChatSearch(model, new AbortController().signal)).toMatchObject({ status: 'unverified', sourceCount: 0 })
  })

  it('identifies a relay returning the wrong format instead of declaring the network broken', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '普通对话' } }],
    }))))
    const result = await testChatSearch({ ...model, modelName: 'claude-test' }, new AbortController().signal)
    expect(result.message).toContain('PROTOCOL_MISMATCH')
    expect(result.message).toContain('转发搜索工具')
  })

  it.each(['unavailable', 'too_many_requests', 'max_uses_exceeded'])('reports Claude tool failure %s even under HTTP 200', async code => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: [{
      type: 'web_search_tool_result', content: { type: 'web_search_tool_result_error', error_code: code },
    }] }))))
    const result = await testChatSearch({ ...model, modelName: 'claude-test' }, new AbortController().signal)
    expect(result.status).toBe('failed')
    expect(result.message).toContain(`TOOL_${code.toUpperCase()}`)
  })

  it('keeps unknown provider error codes out of diagnostics', () => {
    expect(() => parseSearchResponse({ content: [{
      type: 'web_search_tool_result', content: { type: 'web_search_tool_result_error', error_code: model.apiKey },
    }] }, 'anthropic')).toThrow('服务商返回搜索工具错误')
  })

  it('handles invalid JSON and invalid addresses without disclosing raw content', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(model.apiKey))
    vi.stubGlobal('fetch', fetcher)
    expect((await testChatSearch(model, new AbortController().signal)).message).toContain('INVALID_SEARCH_RESPONSE')
    const invalid = await testChatSearch({ ...model, baseUrl: 'invalid' }, new AbortController().signal)
    expect(invalid.status).toBe('failed')
    expect(invalid.message).toContain('API 地址无效')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('reports timeouts and cancels without extra requests', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
    }))
    vi.stubGlobal('fetch', fetcher)
    const request = testChatSearch(model, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(120000)
    expect((await request).message).toContain('SEARCH_TIMEOUT')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(activeAiCount.value).toBe(0)
  })
})
