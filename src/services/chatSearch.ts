import { callAI, openAiV1BaseUrl, type ChatMessage } from '@/services/ai'
import type { ModelConfig } from '@/stores/config'
import type { ChatSearchProtocol, ChatSearchRecord, ChatSource } from '@/types/chat'
import { finishAiActivity, startAiActivity } from './aiActivity'
import { readSearchPayload, SearchResponseError as SearchError } from './searchResponse'

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
type ResolvedProtocol = Exclude<ChatSearchProtocol, 'auto'>
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : []

const protocolInfo: Record<ResolvedProtocol, { label: string; path: string }> = {
  responses: { label: 'Responses', path: '/responses' },
  anthropic: { label: 'Claude Messages', path: '/messages' },
  openrouter: { label: 'OpenRouter', path: '/chat/completions' },
  'chat-completions': { label: 'Chat Completions', path: '/chat/completions' },
}

export function searchProtocolDescription(model: Pick<ModelConfig, 'baseUrl' | 'modelName' | 'chatSearchProtocol'>): string {
  const { label, path } = protocolInfo[resolveChatSearchProtocol(model)]
  return `${model.chatSearchProtocol && model.chatSearchProtocol !== 'auto' ? '已选择' : '自动推测'}：${label} · ${path}`
}

function httpSearchError(status: number, protocol: ResolvedProtocol): SearchError {
  const { label, path } = protocolInfo[protocol]
  const reason = status === 401 ? '搜索接口未通过身份验证。普通对话可用也不代表此搜索接口接受同一密钥。'
    : status === 403 ? '搜索接口拒绝访问，请确认服务商的搜索权限、模型权限及访问限制。'
    : [400, 404, 405, 422].includes(status)
      ? `接口不接受 ${label} 搜索请求，请向服务商确认 ${path} 及搜索工具支持情况，在模型设置中选择对应协议。`
    : status === 429 ? '搜索请求被限流或额度不足，请检查服务商的搜索额度与频率限制。'
    : status >= 500 ? '服务商的搜索接口暂时异常，请稍后重试。'
    : '搜索接口未接受请求，请检查服务商的接口要求。'
  return new SearchError(`HTTP_${status}`, reason)
}

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
  if ((protocol === 'anthropic' || protocol === 'responses') && Array.isArray(data.choices)) {
    throw new SearchError('PROTOCOL_MISMATCH', '服务商返回了普通 Chat Completions 格式，与所选搜索协议不匹配。请确认中转接口是否转发搜索工具。')
  }
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
        const toolError = object(part.content).type === 'web_search_tool_result_error'
          ? object(part.content)
          : array(part.content).map(object).find(item => item.type === 'web_search_tool_result_error')
        if (toolError) {
          const reasons: Record<string, string> = {
            unavailable: '服务商的搜索工具当前不可用。',
            too_many_requests: '服务商的搜索工具被限流，请稍后重试。',
            max_uses_exceeded: '本次搜索次数达到上限，未自动追加付费请求。',
            invalid_tool_input: '服务商的搜索工具不接受当前搜索参数。',
            query_too_long: '搜索词过长，请缩短问题后重试。',
            request_too_large: '搜索请求过大，请缩短问题后重试。',
          }
          const code = typeof toolError.error_code === 'string' && Object.prototype.hasOwnProperty.call(reasons, toolError.error_code) ? toolError.error_code : ''
          throw new SearchError(code ? `TOOL_${code.toUpperCase()}` : 'TOOL_ERROR', code ? reasons[code] : '服务商返回搜索工具错误，请确认搜索权限及工具支持情况。')
        }
        searched ||= Array.isArray(part.content)
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

export async function chatWithOptionalSearch(options: AssistantChatOptions): Promise<{ content: string; search?: ChatSearchRecord; responseFormat?: 'json' | 'claude-sse' }> {
  const { model, messages, signal } = options
  signal.throwIfAborted()
  if (!options.webSearch) {
    if (/:online(?:$|:)|search-preview|search-api|(?:^|\/)sonar(?:-|$)/i.test(model.modelName)) {
      throw new Error('当前配置是联网专用模型，无法保证关闭搜索。请在设置中切换普通模型后再使用不联网对话。')
    }
    // Search is scoped to explicit chat entry points, not writing/outline/review.
    return callAI({ model, messages, signal, stream: options.stream ?? true, onChunk: options.onChunk })
  }
  let endpoint: URL
  try { endpoint = new URL(openAiV1BaseUrl(model.baseUrl)) }
  catch { throw new SearchError('INVALID_URL', 'API 地址无效，请检查模型设置中的 API Base URL。') }
  if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('API 地址必须是有效的 HTTP(S) 基地址，不能包含凭据、查询参数或片段。')
  }
  if (!model.apiKey.trim()) throw new Error('请先在设置中填写有效 API Key。')
  if (model.apiKey.startsWith('enc:') || model.apiKey.includes('***')) throw new Error('API Key 是密文或遮蔽文本，请填写当前服务商的有效密钥。')
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
  const activity = startAiActivity('AI 联网对话')
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  signal.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(new SearchError('SEARCH_TIMEOUT', '搜索接口在 120 秒内未完成回复，请检查服务商状态或当前网络。')), 120_000)
  try {
    // Never retry with a different host/protocol or silently fall back to offline.
    // That could leak a key to a different service or charge for duplicate searches.
    const response = await fetch(`${endpoint.href.replace(/\/$/, '')}${path}`, {
      method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal,
    })
    if (!response.ok) {
      void response.body?.cancel().catch(() => {})
      throw httpSearchError(response.status, protocol)
    }
    const payload = await readSearchPayload(response, protocol, controller.signal)
    controller.signal.throwIfAborted()
    return { ...parseSearchResponse(payload.data, protocol), responseFormat: payload.format }
  } catch (error) {
    if (signal.aborted) {
      finishAiActivity(activity, signal.reason)
      throw signal.reason
    }
    const cause = controller.signal.aborted ? controller.signal.reason
      : error instanceof TypeError
        ? new SearchError('SEARCH_CONNECTION_FAILED', '搜索请求未取得可读取的响应。普通对话正常时，请检查搜索路径、服务商的跨域支持及公司网络策略；仅凭此错误不能认定密钥失效或电脑断网。')
        : error
    const { label, path } = protocolInfo[protocol]
    const detail = cause instanceof Error ? cause.message : '搜索请求未完成。'
    const failure = new SearchError(cause instanceof SearchError ? cause.code : 'SEARCH_FAILED',
      `[${cause instanceof SearchError ? cause.code : 'SEARCH_FAILED'}] ${label} ${path}：${detail}`)
    finishAiActivity(activity, failure)
    throw failure
  } finally {
    if (activity.status === 'running') finishAiActivity(activity)
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
  }
}

export interface ChatSearchTestResult {
  status: 'verified' | 'unverified' | 'failed'
  message: string
  sourceCount: number
}

export async function testChatSearch(model: ModelConfig, signal: AbortSignal): Promise<ChatSearchTestResult> {
  try {
    const result = await chatWithOptionalSearch({
      model: { ...model, maxTokens: Math.min(model.maxTokens, 2048) }, signal, webSearch: true,
      messages: [{ role: 'user', content: '请实际调用网页搜索，查询 Vue 官方网站，返回官网链接和一句概述。不要只根据已有知识回答。' }],
    })
    const count = result.search?.sources.length || 0
    const formatNote = result.responseFormat === 'claude-sse' ? '已兼容读取中转站返回的 Claude 事件流。' : ''
    if (result.search?.status === 'searched' && count > 0) {
      return { status: 'verified', sourceCount: count, message: `${formatNote}本次测试收到搜索证据和 ${count} 个来源。` }
    }
    return { status: 'unverified', sourceCount: count, message: formatNote + (result.search?.status === 'searched'
      ? '接口报告搜索已执行，但未返回可引用来源，本次未完整验证。'
      : '接口有回复，但没有可验证的搜索证据。可能未调用搜索，或服务商忽略了搜索参数，不能据此判定联网成功。') }
  } catch (error) {
    signal.throwIfAborted()
    return { status: 'failed', sourceCount: 0, message: error instanceof Error ? error.message : '搜索测试失败。' }
  }
}
