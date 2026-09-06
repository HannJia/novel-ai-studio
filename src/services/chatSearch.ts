import { callAI, openAiV1BaseUrl, type ChatMessage } from '@/services/ai'
import type { ModelConfig } from '@/stores/config'
import type { ChatSearchProtocol, ChatSearchRecord, ChatSource } from '@/types/chat'

// Only these documented server-side tools are supported. A model name or /models
// response does not prove that a relay actually forwards the corresponding tool.
export const chatSearchProtocolOptions: Array<{ label: string; value: ChatSearchProtocol }> = [
  { label: '自动匹配协议（不代表接口已支持）', value: 'auto' },
  { label: 'Responses · web_search', value: 'responses' },
  { label: 'Claude Messages · web_search', value: 'anthropic' },
  { label: 'OpenRouter · web 插件', value: 'openrouter' },
  { label: 'Chat Completions · 搜索专用模型', value: 'chat-completions' },
]

type Json = Record<string, unknown>
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : []

export function safeSourceUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096) return null
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null
  } catch { return null }
}

export function resolveChatSearchProtocol(model: Pick<ModelConfig, 'baseUrl' | 'modelName' | 'chatSearchProtocol'>): Exclude<ChatSearchProtocol, 'auto'> {
  const configured = model.chatSearchProtocol
  if (configured && configured !== 'auto' && chatSearchProtocolOptions.some(item => item.value === configured)) return configured
  let hostname = ''
  try { hostname = new URL(model.baseUrl).hostname } catch { /* validated before sending */ }
  if (hostname === 'openrouter.ai' || hostname.endsWith('.openrouter.ai')) return 'openrouter'
  if (/claude/i.test(model.modelName)) return 'anthropic'
  if (/search-preview|search-api/i.test(model.modelName)) return 'chat-completions'
  return 'responses'
}

function sourcesFrom(candidates: unknown[]): ChatSource[] {
  const unique = new Map<string, ChatSource>()
  for (const candidate of candidates) {
    const row = object(candidate)
    const url = safeSourceUrl(row.url)
    if (!url) continue
    if (unique.has(url)) {
      if (typeof row.cited_text === 'string') unique.get(url)!.excerpt = row.cited_text.slice(0, 500)
      continue
    }
    unique.set(url, {
      url,
      title: typeof row.title === 'string' && row.title.trim() ? row.title.trim().slice(0, 300) : new URL(url).hostname,
      excerpt: typeof row.cited_text === 'string' ? row.cited_text.slice(0, 500) : undefined,
    })
  }
  return [...unique.values()].slice(0, 30)
}

export function parseSearchResponse(raw: unknown, protocol: Exclude<ChatSearchProtocol, 'auto'>): { content: string; search: ChatSearchRecord } {
  const data = object(raw)
  if (data.error || data.type === 'error') throw new Error('联网接口返回错误，未获得有效搜索回复。')
  let content = ''
  let searched = false
  let candidates: unknown[] = []
  let status: ChatSearchRecord['status'] = 'not-used'
  if (protocol === 'responses') {
    if (data.status === 'failed' || data.status === 'incomplete' || data.status === 'cancelled') {
      throw new Error('联网回复未完整生成，请缩短问题或提高模型输出上限后重试。')
    }
    for (const value of array(data.output)) {
      const item = object(value)
      if (item.type === 'web_search_call') {
        if (item.status === 'failed') throw new Error('搜索工具执行失败，请稍后重试。')
        searched ||= item.status === 'completed'
      }
      if (item.type === 'message') {
        for (const value of array(item.content)) {
          const part = object(value)
          if (part.type === 'output_text' && typeof part.text === 'string') content += part.text
          candidates.push(...array(part.annotations).filter(value => object(value).type === 'url_citation'))
        }
      }
    }
  } else if (protocol === 'anthropic') {
    if (data.stop_reason === 'pause_turn' || data.stop_reason === 'max_tokens') {
      throw new Error('联网任务尚未完成或回复达到输出上限；本次不自动追加计费请求，请调整后重试。')
    }
    for (const value of array(data.content)) {
      const part = object(value)
      if (part.type === 'text' && typeof part.text === 'string') {
        content += part.text
        candidates.push(...array(part.citations).filter(value => object(value).type === 'web_search_result_location'))
      }
      if (part.type === 'web_search_tool_result') {
        if (object(part.content).type === 'web_search_tool_result_error') throw new Error('接口的搜索工具执行失败，请检查服务商是否已开通搜索权限或额度。')
        searched = true
        candidates.push(...array(part.content).filter(value => object(value).type === 'web_search_result'))
      }
    }
    searched ||= Number(object(object(data.usage).server_tool_use).web_search_requests) > 0
  } else {
    const choice = object(array(data.choices)[0])
    if (choice.finish_reason === 'length') throw new Error('联网回复达到输出上限，请提高 Max Tokens 后重试。')
    const message = object(choice.message)
    content = typeof message.content === 'string' ? message.content : ''
    candidates = array(message.annotations)
      .filter(value => object(value).type === 'url_citation')
      .map(value => object(value).url_citation || value)
    // Some compatible services silently ignore unknown parameters. HTTP 200 and
    // prose such as "I searched" are not proof of an actual search.
    status = 'unverified'
  }
  const sources = sourcesFrom(candidates)
  if (!content.trim()) throw new Error('联网接口没有返回可显示的回答，可能不支持所选搜索协议。')
  if (searched || sources.length) status = 'searched'
  return { content, search: { protocol, status, sources } }
}

interface AssistantChatOptions {
  model: ModelConfig
  messages: ChatMessage[]
  webSearch: boolean
  signal: AbortSignal
  onChunk?: (text: string) => void
  stream?: boolean
}

export async function chatWithOptionalSearch(options: AssistantChatOptions): Promise<{ content: string; search?: ChatSearchRecord }> {
  const { model, messages, signal } = options
  signal.throwIfAborted()
  if (!options.webSearch) {
    if (/:online(?:$|:)|search-preview|search-api|(?:^|\/)sonar(?:-|$)/i.test(model.modelName)) {
      throw new Error('当前配置是联网专用模型，无法保证关闭搜索。请在设置中切换普通模型后再使用不联网对话。')
    }
    // Search is scoped to explicit chat entry points, not writing/outline/review.
    return callAI({ model, messages, signal, stream: options.stream ?? true, onChunk: options.onChunk })
  }
  const endpoint = new URL(openAiV1BaseUrl(model.baseUrl))
  if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('API 地址必须是有效的 HTTP(S) 基地址，不能包含凭据、查询参数或片段。')
  }
  if (!model.apiKey.trim()) throw new Error('请先在设置中填写有效 API Key。')
  const protocol = resolveChatSearchProtocol(model)
  let path = '/chat/completions'
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${model.apiKey}` }
  let body: Json = { model: model.modelName, messages, max_tokens: model.maxTokens, stream: false }
  if (protocol === 'responses') {
    path = '/responses'
    body = { model: model.modelName, input: messages, max_output_tokens: model.maxTokens, stream: false, store: false,
      tools: [{ type: 'web_search' }], tool_choice: 'auto' }
  } else if (protocol === 'anthropic') {
    path = '/messages'
    headers['x-api-key'] = model.apiKey
    headers['anthropic-version'] = '2023-06-01'
    headers['anthropic-dangerous-direct-browser-access'] = 'true'
    body = { model: model.modelName, max_tokens: model.maxTokens, stream: false,
      system: messages.filter(item => item.role === 'system').map(item => item.content).join('\n\n'),
      messages: messages.filter(item => item.role !== 'system'),
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }] }
  } else if (protocol === 'openrouter') {
    body.plugins = [{ id: 'web', max_results: 3 }]
  } else {
    body.web_search_options = { search_context_size: 'medium' }
  }
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  signal.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(new Error('联网请求超时，请稍后重试。')), 120_000)
  try {
    // Never retry with a different host/protocol or silently fall back to offline.
    // That could leak a key to a different service or charge for duplicate searches.
    const response = await fetch(`${endpoint.href.replace(/\/$/, '')}${path}`, {
      method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal,
    })
    if (!response.ok) {
      if ([401, 403].includes(response.status)) throw new Error(`联网请求被拒绝（${response.status}），请检查 API Key、模型权限和搜索额度。`)
      if ([400, 404, 405, 422].includes(response.status)) throw new Error(`接口不接受 ${protocol} 联网请求（${response.status}）。请在模型设置中选择服务商支持的联网协议，或关闭联网后重试。`)
      throw new Error(`联网请求失败（${response.status}），请稍后重试；本次未自动降级或重复发送。`)
    }
    const payload: unknown = await response.json()
    controller.signal.throwIfAborted()
    return parseSearchResponse(payload, protocol)
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason
    if (error instanceof TypeError) throw new Error('无法连接联网接口，请检查地址、网络或服务商的跨域支持。')
    if (error instanceof SyntaxError) throw new Error('联网接口没有返回合法 JSON，请检查所选联网协议。')
    throw error
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
  }
}
