import { describe, expect, it, vi } from 'vitest'
import { readSearchPayload } from './searchResponse'
import { parseSearchResponse } from './chatSearch'

const start = { type: 'message_start', message: { type: 'message', content: [], stop_reason: null, usage: { input_tokens: 10 } } }
const events = [
  start,
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'private-thinking' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: { type: 'server_tool_use', name: 'web_search', input: {} } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"query":"Vue"}' } },
  { type: 'content_block_stop', index: 1 },
  { type: 'content_block_start', index: 2, content_block: { type: 'web_search_tool_result', content: [
    { type: 'web_search_result', url: 'https://vuejs.org/', title: 'Vue' },
  ] } },
  { type: 'content_block_stop', index: 2 },
  { type: 'content_block_start', index: 3, content_block: { type: 'text', text: '', citations: [] } },
  { type: 'content_block_delta', index: 3, delta: { type: 'text_delta', text: '查证了' } },
  { type: 'content_block_delta', index: 3, delta: { type: 'text_delta', text: '官网。' } },
  { type: 'content_block_delta', index: 3, delta: { type: 'citations_delta', citation: {
    type: 'web_search_result_location', url: 'https://vuejs.org/', title: 'Vue', cited_text: '官方网站',
  } } },
  { type: 'content_block_stop', index: 3 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 25, server_tool_use: { web_search_requests: 1 } } },
  { type: 'message_stop' },
]
function sse(values: unknown[] = events): string {
  return ': keepalive\r\n\r\n' + values.map(value => `data: ${JSON.stringify(value)}\r\n\r\n`).join('')
}
function responseInChunks(text: string, chunkSize = 13, contentType = 'text/event-stream', keepOpen = false) {
  const bytes = new TextEncoder().encode(text)
  let offset = 0
  const cancelled = vi.fn()
  const response = new Response(new ReadableStream({
    pull(controller) {
      if (offset < bytes.length) {
        controller.enqueue(bytes.subarray(offset, offset + chunkSize))
        offset += chunkSize
      } else if (!keepOpen) controller.close()
    },
    cancel: cancelled,
  }), { headers: { 'content-type': contentType } })
  return { response, cancelled }
}
const signal = () => new AbortController().signal

describe('relay search response compatibility', () => {
  it('keeps normal JSON unchanged and accepts optional leading whitespace', async () => {
    const data = { content: [{ type: 'text', text: '普通回答' }], stop_reason: 'end_turn' }
    const { response } = responseInChunks(` \n${JSON.stringify(data)}`, 1, 'application/json')
    expect(await readSearchPayload(response, 'anthropic', signal())).toEqual({ data, format: 'json' })
  })

  it.each([1, 7, 1024])('assembles Claude SSE in %s-byte chunks with citations and usage', async chunkSize => {
    const { response } = responseInChunks(sse(), chunkSize)
    const result = await readSearchPayload(response, 'anthropic', signal())
    expect(result.format).toBe('claude-sse')
    expect(result.data).toMatchObject({ stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 25, server_tool_use: { web_search_requests: 1 } } })
    const parsed = parseSearchResponse(result.data, 'anthropic')
    expect(parsed.content).toBe('查证了官网。')
    expect(parsed.content).not.toContain('private-thinking')
    expect(parsed.search).toMatchObject({ status: 'searched', sources: [{ url: 'https://vuejs.org/', excerpt: '官方网站' }] })
  })

  it('detects an event stream even when the relay labels it application/json', async () => {
    const { response } = responseInChunks(sse(), 2, 'application/json')
    expect((await readSearchPayload(response, 'anthropic', signal())).format).toBe('claude-sse')
  })

  it('does not treat valid JSON as an event stream solely due to a wrong header', async () => {
    const { response } = responseInChunks('{"content":[]}', 1, 'text/event-stream')
    expect((await readSearchPayload(response, 'anthropic', signal())).format).toBe('json')
  })

  it('finishes at message_stop without waiting for a proxy to close its connection', async () => {
    const { response, cancelled } = responseInChunks(sse(), 17, 'text/event-stream', true)
    expect((await readSearchPayload(response, 'anthropic', signal())).format).toBe('claude-sse')
    expect(cancelled).toHaveBeenCalledOnce()
  })

  it('keeps HTTP 200 tool errors visible for the search result validator', async () => {
    const { response } = responseInChunks(sse([
      start,
      { type: 'content_block_start', index: 0, content_block: { type: 'web_search_tool_result',
        content: { type: 'web_search_tool_result_error', error_code: 'unavailable' } } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
      { type: 'message_stop' },
    ]))
    const result = await readSearchPayload(response, 'anthropic', signal())
    expect(() => parseSearchResponse(result.data, 'anthropic')).toThrow('搜索工具当前不可用')
  })

  it('reports HTML rather than blaming an API key and never echoes page contents', async () => {
    const page = '<!doctype html><html>private-provider-content</html>'
    await expect(readSearchPayload(new Response(page), 'anthropic', signal()))
      .rejects.toMatchObject({ code: 'SEARCH_RETURNED_HTML' })
  })

  it.each(['', '   \n'])('distinguishes an empty reply: %s', async body => {
    await expect(readSearchPayload(new Response(body), 'anthropic', signal()))
      .rejects.toMatchObject({ code: 'EMPTY_SEARCH_RESPONSE' })
  })

  it('rejects incomplete or wrong-protocol streams without manufacturing search evidence', async () => {
    await expect(readSearchPayload(new Response(sse(events.slice(0, -1))), 'anthropic', signal()))
      .rejects.toMatchObject({ code: 'INCOMPLETE_SEARCH_STREAM' })
    await expect(readSearchPayload(new Response(sse()), 'responses', signal()))
      .rejects.toMatchObject({ code: 'UNEXPECTED_SEARCH_STREAM' })
  })

  it('rejects invalid event ordering and malformed event JSON', async () => {
    await expect(readSearchPayload(new Response(sse([events[1]])), 'anthropic', signal()))
      .rejects.toMatchObject({ code: 'INVALID_SEARCH_STREAM' })
    await expect(readSearchPayload(new Response('data: not-json\n\n'), 'anthropic', signal()))
      .rejects.toMatchObject({ code: 'INVALID_SEARCH_STREAM' })
    await expect(readSearchPayload(new Response(sse([start, events[1], events[events.length - 2], events[events.length - 1]])), 'anthropic', signal()))
      .rejects.toMatchObject({ code: 'INVALID_SEARCH_STREAM' })
  })

  it('preserves output-limit and continuation-required stop reasons', async () => {
    for (const reason of ['max_tokens', 'pause_turn']) {
      const { response } = responseInChunks(sse([...events.slice(0, -2),
        { type: 'message_delta', delta: { stop_reason: reason } }, { type: 'message_stop' },
      ]))
      const result = await readSearchPayload(response, 'anthropic', signal())
      expect(() => parseSearchResponse(result.data, 'anthropic')).toThrow('未完成')
    }
  })

  it('redacts raw stream errors', async () => {
    const { response } = responseInChunks(sse([{ type: 'error', error: { message: 'private-token' } }]))
    await expect(readSearchPayload(response, 'anthropic', signal()))
      .rejects.toMatchObject({ code: 'SEARCH_STREAM_ERROR', message: expect.not.stringContaining('private-token') })
  })

  it('cancels reading when the user stops, including while awaiting a body chunk', async () => {
    const cancel = vi.fn()
    const response = new Response(new ReadableStream({ cancel }))
    const controller = new AbortController()
    const request = readSearchPayload(response, 'anthropic', controller.signal)
    controller.abort()
    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('bounds the response size before exposing anything as a result', async () => {
    const { response, cancelled } = responseInChunks(' '.repeat(8 * 1024 * 1024 + 1), 65536, 'text/plain', true)
    await expect(readSearchPayload(response, 'anthropic', signal()))
      .rejects.toMatchObject({ code: 'SEARCH_RESPONSE_TOO_LARGE' })
    expect(cancelled).toHaveBeenCalledOnce()
  })
})
