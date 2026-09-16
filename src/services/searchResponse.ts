import { createParser } from 'eventsource-parser'
import type { ChatSearchProtocol } from '@/types/chat'

type Json = Record<string, unknown>
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024

export class SearchResponseError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}

function streamError(): SearchResponseError {
  return new SearchResponseError('INVALID_SEARCH_STREAM', '搜索接口返回了无法识别或顺序异常的 Claude 事件流，未把部分回答当作完整结果。')
}

function createClaudeAccumulator() {
  let message: Json | null = null
  const blocks = new Map<number, Json>()
  const openBlocks = new Set<number>()
  let done = false
  const parser = createParser({
    maxBufferSize: MAX_RESPONSE_BYTES,
    onEvent(event) {
      if (done) return
      if (event.data === '[DONE]') return // Claude requires its own message_stop event.
      let value: Json
      try { value = object(JSON.parse(event.data)) } catch { throw streamError() }
      const type = value.type || event.event
      if (type === 'ping') return
      if (type === 'error' || value.error) {
        throw new SearchResponseError('SEARCH_STREAM_ERROR', '服务商在 Claude 搜索事件流中返回错误，请检查模型、搜索权限和输出限制；未自动重试。')
      }
      if (type === 'message_start') {
        const initial = object(value.message)
        if (message || !Array.isArray(initial.content)) throw streamError()
        message = { ...initial }
        initial.content.forEach((block, index) => blocks.set(index, { ...object(block) }))
        return
      }
      const known = ['content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop']
      if (!known.includes(String(type))) throw streamError()
      if (!message) throw streamError()
      if (type === 'message_delta') {
        const delta = object(value.delta)
        if (delta.stop_reason != null) message.stop_reason = delta.stop_reason
        message.usage = { ...object(message.usage), ...object(value.usage) }
        return
      }
      if (type === 'message_stop') {
        if (openBlocks.size || typeof message.stop_reason !== 'string') throw streamError()
        done = true
        return
      }
      const index = value.index
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > 4096) throw streamError()
      if (type === 'content_block_start') {
        const block = object(value.content_block)
        if (index !== blocks.size || typeof block.type !== 'string') throw streamError()
        blocks.set(index, { ...block })
        openBlocks.add(index)
        return
      }
      const block = blocks.get(index)
      if (!block || !openBlocks.has(index)) throw streamError()
      if (type === 'content_block_stop') { openBlocks.delete(index); return }
      const delta = object(value.delta)
      if (delta.type === 'text_delta') {
        if (block.type !== 'text' || typeof delta.text !== 'string') throw streamError()
        block.text = `${typeof block.text === 'string' ? block.text : ''}${delta.text}`
      } else if (delta.type === 'citations_delta') {
        if (block.type !== 'text' || !delta.citation || typeof delta.citation !== 'object') throw streamError()
        block.citations = [...(Array.isArray(block.citations) ? block.citations : []), delta.citation]
      }
      // Thinking/signature and tool-input deltas are not answer text or search evidence.
    },
    onError() { throw streamError() },
  })
  return {
    feed: (text: string) => parser.feed(text),
    get done() { return done },
    result(): Json {
      if (!done || !message) {
        throw new SearchResponseError('INCOMPLETE_SEARCH_STREAM', 'Claude 搜索事件流提前结束，未收到完整结束事件；未把部分回答当作成功结果。')
      }
      return { ...message, content: [...blocks.values()] }
    },
  }
}

export async function readSearchPayload(
  response: Response,
  protocol: Exclude<ChatSearchProtocol, 'auto'>,
  signal: AbortSignal,
): Promise<{ data: unknown; format: 'json' | 'claude-sse' }> {
  signal.throwIfAborted()
  const reader = response.body?.getReader()
  if (!reader) throw new SearchResponseError('EMPTY_SEARCH_RESPONSE', '搜索接口返回了空响应，请检查中转站状态。')
  const decoder = new TextDecoder()
  const contentType = (response.headers.get('content-type') || '').toLowerCase()
  let bytes = 0
  let buffered = ''
  let mode: 'unknown' | 'json' | 'sse' = 'unknown'
  let stream: ReturnType<typeof createClaudeAccumulator> | undefined
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })

  function accept(text: string) {
    if (mode === 'sse') { stream!.feed(text); return }
    buffered += text
    if (mode === 'json') return
    const start = buffered.trimStart()
    if (!start) return
    if (start.startsWith('<')) {
      throw new SearchResponseError('SEARCH_RETURNED_HTML', '搜索接口返回了网页或 XML，不是模型数据。请确认使用的是 API 基地址，并检查中转站登录跳转、验证页或接口路由。')
    }
    // Some relays mislabel SSE as JSON; inspect the body before trusting the MIME type.
    if (start.startsWith('{') || start.startsWith('[')) { mode = 'json'; return }
    if (/^(?:event|data|id|retry):|^:/.test(start) || contentType.includes('text/event-stream')) {
      if (protocol !== 'anthropic') {
        throw new SearchResponseError('UNEXPECTED_SEARCH_STREAM', '所选接口返回了事件流而不是请求的 JSON。当前兼容读取仅适用于 Claude Messages，请确认服务商的响应协议。')
      }
      mode = 'sse'
      stream = createClaudeAccumulator()
      stream.feed(buffered)
      buffered = ''
    }
  }

  try {
    while (!stream?.done) {
      const { done, value } = await reader.read()
      signal.throwIfAborted()
      if (done) { accept(decoder.decode()); break }
      bytes += value.byteLength
      if (bytes > MAX_RESPONSE_BYTES) {
        throw new SearchResponseError('SEARCH_RESPONSE_TOO_LARGE', '搜索回复超过 8 MB，已停止读取。请缩短问题或减少输出。')
      }
      accept(decoder.decode(value, { stream: true }))
    }
    if (stream) return { data: stream.result(), format: 'claude-sse' }
    if (!buffered.trim()) throw new SearchResponseError('EMPTY_SEARCH_RESPONSE', '搜索接口返回了空响应，请检查中转站状态。')
    try { return { data: JSON.parse(buffered), format: 'json' } }
    catch { throw new SearchResponseError('INVALID_SEARCH_RESPONSE', '搜索接口返回了无法识别的数据，既不是合法 JSON，也不是 Claude 事件流。请联系中转站确认该接口的返回格式。') }
  } finally {
    signal.removeEventListener('abort', cancel)
    cancel()
    reader.releaseLock()
  }
}
