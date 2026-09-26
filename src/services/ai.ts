// AI 服务层 — OpenAI 兼容 API 调用（支持流式 SSE）

import { useConfigStore, type ModelConfig } from '@/stores/config'
import type { WritingSkillTask } from '@/types/skill'
import { finishAiActivity, startAiActivity } from '@/services/aiActivity'
import { createParser } from 'eventsource-parser'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  imageDataUrls?: string[]
}

export function serializeChatMessages(messages: ChatMessage[]) {
  return messages.map(({ role, content, imageDataUrls }) => {
    if (!imageDataUrls?.length) return { role, content }
    if (role !== 'user' || imageDataUrls.length > 4
      || imageDataUrls.some(url => !/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]+=*$/.test(url) || url.length > 12 * 1024 * 1024)) {
      throw new Error('图片消息格式无效或超过大小上限')
    }
    return { role, content: [
      { type: 'text', text: content },
      ...imageDataUrls.map(url => ({ type: 'image_url', image_url: { url, detail: 'high' } })),
    ] }
  })
}

export interface ChatCompletionOptions {
  model: ModelConfig
  messages: ChatMessage[]
  taskName?: string
  stream?: boolean
  onChunk?: (chunk: string) => void // 流式回调
  signal?: AbortSignal
  maxTokens?: number // 覆盖模型默认 maxTokens
  timeoutMs?: number // 覆盖默认请求超时
  skillTask?: Exclude<WritingSkillTask, 'all'>
  activityParentId?: string
  redactErrors?: boolean
  noAutomaticRetry?: boolean
  shouldStop?: () => boolean
}

export function applySkillInstructions(messages: ChatMessage[], instructions: string): ChatMessage[] {
  const content = instructions.trim()
  if (!content) return messages
  const block = `【已启用写作 Skill】\n${content}`
  const systemIndex = messages.findIndex(message => message.role === 'system')
  if (systemIndex < 0) return [{ role: 'system', content: block }, ...messages]
  return messages.map((message, index) => index === systemIndex
    ? { ...message, content: `${message.content}\n\n${block}` }
    : message)
}

export interface ChatCompletionResult {
  content: string
  finishReason?: string
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export interface AvailableModel {
  id: string
  object?: string
  ownedBy?: string
}

const NON_STREAM_TIMEOUT = 120_000  // 非流式 120 秒
const STREAM_TIMEOUT = 300_000      // 流式 300 秒
const MAX_RETRIES = 3
const RETRY_BASE_DELAY = 1000       // 首次重试延迟 1 秒

/** Normalize both `https://provider.example` and `https://provider.example/v1`. */
export function openAiV1BaseUrl(baseUrl: string): string {
  const normalized = String(baseUrl || '').trim().replace(/\/+$/, '')
  if (!normalized) return ''
  return /\/v1$/i.test(normalized) ? normalized : `${normalized}/v1`
}

function isRetryableError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return false
  if (err instanceof TypeError) return true // 网络错误
  if (err instanceof Error) {
    const msg = err.message.toLowerCase()
    return msg.includes('socket') || msg.includes('network') || msg.includes('econnreset')
      || msg.includes('fetch') || msg.includes('502') || msg.includes('503') || msg.includes('429')
  }
  return false
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason || new DOMException('请求已取消', 'AbortError'))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason || new DOMException('请求已取消', 'AbortError'))
    }, { once: true })
  })
}

// 合并用户 signal 和超时 signal
function mergeSignals(userSignal?: AbortSignal, timeoutMs?: number) {
  const controller = new AbortController()
  const timer = timeoutMs ? setTimeout(() => controller.abort(new Error(`请求超时（${Math.round(timeoutMs / 1000)}秒）`)), timeoutMs) : null
  const abort = () => controller.abort(userSignal?.reason)
  const dispose = () => {
    if (timer) clearTimeout(timer)
    userSignal?.removeEventListener('abort', abort)
  }

  if (userSignal) {
    if (userSignal.aborted) {
      controller.abort(userSignal.reason)
    } else {
      userSignal.addEventListener('abort', abort, { once: true })
    }
  }

  controller.signal.addEventListener('abort', dispose, { once: true })
  return { signal: controller.signal, dispose }
}

// 非流式调用（带重试）
async function chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
  const { model, messages, signal, maxTokens } = options
  const url = `${openAiV1BaseUrl(model.baseUrl)}/chat/completions`

  let lastError: unknown
  const attempts = options.noAutomaticRetry ? 1 : MAX_RETRIES
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_BASE_DELAY * Math.pow(2, attempt - 1)
      console.warn(`API 重试 ${attempt}/${MAX_RETRIES}，等待 ${delay}ms...`)
      await sleep(delay, signal)
    }

    const request = mergeSignals(signal, options.timeoutMs ?? NON_STREAM_TIMEOUT)
    try {
      request.signal.throwIfAborted()
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${model.apiKey}`,
        },
        body: JSON.stringify({
          model: model.modelName,
          messages: serializeChatMessages(messages),
          max_tokens: maxTokens || model.maxTokens,
          temperature: model.temperature,
          top_p: model.topP,
          stream: false,
        }),
        signal: request.signal,
      })

      if (!response.ok) {
        const errorText = await response.text()
        const err = new Error(`API 请求失败 (${response.status}): ${errorText}`)
        if (response.status === 429 || response.status >= 500) {
          lastError = err
          continue
        }
        throw err
      }

      const data = await response.json()
      return {
        content: data.choices?.[0]?.message?.content || '',
        finishReason: data.choices?.[0]?.finish_reason,
        usage: data.usage,
      }
    } catch (err) {
      lastError = err
      if (!isRetryableError(err)) throw err
    } finally {
      request.dispose()
    }
  }

  throw lastError
}

// 流式调用（SSE）— 不重试，但有超时保护
async function chatCompletionStream(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
  const { model, messages, onChunk, signal, maxTokens, shouldStop } = options
  const url = `${openAiV1BaseUrl(model.baseUrl)}/chat/completions`
  const request = mergeSignals(signal, options.timeoutMs ?? STREAM_TIMEOUT)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    request.signal.throwIfAborted()
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${model.apiKey}` },
      body: JSON.stringify({
        model: model.modelName, messages: serializeChatMessages(messages),
        max_tokens: maxTokens || model.maxTokens, temperature: model.temperature,
        top_p: model.topP, stream: true,
      }),
      signal: request.signal,
    })
    if (!response.ok) throw new Error(`API 请求失败 (${response.status}): ${await response.text()}`)
    reader = response.body?.getReader()
    if (!reader) throw new Error('无法获取响应流')

    const decoder = new TextDecoder()
    let fullContent = ''
    let finishReason: string | undefined
    let usage: ChatCompletionResult['usage']
    let done = false
    const parser = createParser({
      maxBufferSize: 8 * 1024 * 1024,
      onEvent(event) {
        if (done) return
        if (event.data.trim() === '[DONE]') { done = true; return }
        let parsed
        try { parsed = JSON.parse(event.data) } catch { throw new Error('模型返回了无效的流式数据，未将部分内容视为完整结果') }
        if (parsed.error) throw new Error('模型接口在输出过程中返回错误，已停止接收')
        const choice = parsed.choices?.find((item: { index?: number }) => item.index === 0) || parsed.choices?.[0]
        if (typeof choice?.finish_reason === 'string') finishReason = choice.finish_reason
        if (parsed.usage) usage = parsed.usage
        const delta = choice?.delta?.content
        if (typeof delta === 'string' && delta) {
          fullContent += delta
          onChunk?.(delta)
          if (shouldStop?.()) { finishReason = 'client_stop'; done = true }
        }
      },
      onError() { throw new Error('模型返回的事件流格式异常，未将部分内容视为完整结果') },
    })
    while (!done) {
      request.signal.throwIfAborted()
      const chunk = await reader.read()
      if (chunk.done) {
        parser.feed(decoder.decode())
        // Some relays omit the blank line after their final data event.
        parser.feed('\n\n')
        break
      }
      parser.feed(decoder.decode(chunk.value, { stream: true }))
    }
    request.signal.throwIfAborted()
    if (!done && !finishReason) throw new Error('模型连接提前结束，未收到输出完成标记；已接收内容保留')
    return { content: fullContent, finishReason: finishReason || 'stop', ...(usage ? { usage } : {}) }
  } finally {
    request.dispose()
    if (reader) {
      try { await reader.cancel() } catch { /* The stream may already be aborted. */ }
      reader.releaseLock()
    }
  }
}

/** Fetch the models exposed by an OpenAI-compatible provider. */
export async function listAvailableModels(
  model: Pick<ModelConfig, 'baseUrl' | 'apiKey'>,
  signal?: AbortSignal,
): Promise<AvailableModel[]> {
  const baseUrl = openAiV1BaseUrl(model.baseUrl)
  if (!baseUrl) throw new Error('请先填写 API Base URL')
  if (!model.apiKey.trim()) throw new Error('请先填写 API Key')

  let payload: unknown
  const request = mergeSignals(signal, 30_000)
  try {
    request.signal.throwIfAborted()
    const response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${model.apiKey.trim()}` },
      signal: request.signal,
    })
    if (!response.ok) {
      const detail = (await response.text()).trim().slice(0, 300)
      throw new Error(`获取模型失败（${response.status}）${detail ? `：${detail}` : ''}`)
    }
    try { payload = await response.json() } catch { throw new Error('获取模型失败：服务返回的内容不是合法 JSON') }
  } finally {
    request.dispose()
  }
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : []
  const models = rows
    .map(item => {
      if (typeof item === 'string') return { id: item }
      if (!item || typeof item !== 'object') return null
      const value = item as Record<string, unknown>
      const id = typeof value.id === 'string' ? value.id.trim() : ''
      if (!id) return null
      return {
        id,
        object: typeof value.object === 'string' ? value.object : undefined,
        ownedBy: typeof value.owned_by === 'string' ? value.owned_by : undefined,
      }
    })
    .filter((item): item is AvailableModel => Boolean(item))
  const unique = new Map<string, AvailableModel>()
  for (const model of models) {
    // Keep the richest first response when a provider accidentally repeats an id.
    if (!unique.has(model.id)) unique.set(model.id, model)
  }
  return [...unique.values()].sort((a, b) => a.id.localeCompare(b.id))
}

// 统一入口
export async function callAI(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
  const activity = startAiActivity(options.taskName || ({
    planning: 'AI 规划任务',
    writing: 'AI 写作任务',
    review: 'AI 审查任务',
    analysis: 'AI 分析任务',
  }[options.skillTask || 'planning'] || 'AI 任务'), options.activityParentId)
  let enrichedOptions = options
  try {
    if (options.skillTask) {
      try {
        const skillPrompt = useConfigStore().getSkillPrompt(options.skillTask)
        enrichedOptions = { ...options, messages: applySkillInstructions(options.messages, skillPrompt) }
      } catch {
        // Pinia 尚未初始化的独立调用不注入 Skill。
      }
    }
    if (enrichedOptions.stream && enrichedOptions.onChunk) {
      return await chatCompletionStream(enrichedOptions)
    }
    return await chatCompletion(enrichedOptions)
  } catch (error) {
    const visibleError = options.redactErrors && !options.signal?.aborted
      ? new Error('图片识别接口请求失败，请检查模型、额度和连接。') : error
    finishAiActivity(activity, visibleError)
    throw visibleError
  } finally {
    if (activity.status === 'running') finishAiActivity(activity)
  }
}

// 测试 API 连接
export async function testConnection(model: ModelConfig): Promise<{ ok: boolean; message: string; latency?: number }> {
  const start = Date.now()
  try {
    const result = await callAI({
      model,
      messages: [
        { role: 'user', content: '请回复"连接成功"四个字。' },
      ],
    })
    const latency = Date.now() - start
    return {
      ok: true,
      message: `连接成功！模型响应：${result.content.substring(0, 50)}（延迟 ${latency}ms）`,
      latency,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      message: `连接失败：${message}`,
    }
  }
}
