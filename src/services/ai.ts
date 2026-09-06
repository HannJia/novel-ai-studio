// AI 服务层 — OpenAI 兼容 API 调用（支持流式 SSE）

import { useConfigStore, type ModelConfig } from '@/stores/config'
import type { WritingSkillTask } from '@/types/skill'
import { finishAiActivity, startAiActivity } from '@/services/aiActivity'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatCompletionOptions {
  model: ModelConfig
  messages: ChatMessage[]
  taskName?: string
  stream?: boolean
  onChunk?: (chunk: string) => void // 流式回调
  signal?: AbortSignal
  maxTokens?: number // 覆盖模型默认 maxTokens
  skillTask?: Exclude<WritingSkillTask, 'all'>
  activityParentId?: string
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
function mergeSignals(userSignal?: AbortSignal, timeoutMs?: number): AbortSignal {
  const controller = new AbortController()
  const timer = timeoutMs ? setTimeout(() => controller.abort(new Error(`请求超时（${Math.round(timeoutMs / 1000)}秒）`)), timeoutMs) : null

  if (userSignal) {
    if (userSignal.aborted) {
      controller.abort(userSignal.reason)
    } else {
      userSignal.addEventListener('abort', () => controller.abort(userSignal.reason), { once: true })
    }
  }

  controller.signal.addEventListener('abort', () => { if (timer) clearTimeout(timer) }, { once: true })
  return controller.signal
}

// 非流式调用（带重试）
async function chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
  const { model, messages, signal, maxTokens } = options
  const url = `${openAiV1BaseUrl(model.baseUrl)}/chat/completions`

  let lastError: unknown
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_BASE_DELAY * Math.pow(2, attempt - 1)
      console.warn(`API 重试 ${attempt}/${MAX_RETRIES}，等待 ${delay}ms...`)
      await sleep(delay, signal)
    }

    try {
      const mergedSignal = mergeSignals(signal, NON_STREAM_TIMEOUT)

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${model.apiKey}`,
        },
        body: JSON.stringify({
          model: model.modelName,
          messages,
          max_tokens: maxTokens || model.maxTokens,
          temperature: model.temperature,
          top_p: model.topP,
          stream: false,
        }),
        signal: mergedSignal,
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
        usage: data.usage,
      }
    } catch (err) {
      lastError = err
      if (!isRetryableError(err)) throw err
    }
  }

  throw lastError
}

// 流式调用（SSE）— 不重试，但有超时保护
async function chatCompletionStream(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
  const { model, messages, onChunk, signal, maxTokens } = options
  const url = `${openAiV1BaseUrl(model.baseUrl)}/chat/completions`

  const mergedSignal = mergeSignals(signal, STREAM_TIMEOUT)

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${model.apiKey}`,
    },
    body: JSON.stringify({
      model: model.modelName,
      messages,
      max_tokens: maxTokens || model.maxTokens,
      temperature: model.temperature,
      top_p: model.topP,
      stream: true,
    }),
    signal: mergedSignal,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`API 请求失败 (${response.status}): ${errorText}`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('无法获取响应流')

  const decoder = new TextDecoder()
  let fullContent = ''
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data: ')) continue
      const data = trimmed.slice(6)
      if (data === '[DONE]') continue

      try {
        const parsed = JSON.parse(data)
        const delta = parsed.choices?.[0]?.delta?.content
        if (delta) {
          fullContent += delta
          onChunk?.(delta)
        }
      } catch (parseErr) {
        console.warn('SSE 解析失败:', data, parseErr)
      }
    }
  }

  return { content: fullContent }
}

/** Fetch the models exposed by an OpenAI-compatible provider. */
export async function listAvailableModels(
  model: Pick<ModelConfig, 'baseUrl' | 'apiKey'>,
  signal?: AbortSignal,
): Promise<AvailableModel[]> {
  const baseUrl = openAiV1BaseUrl(model.baseUrl)
  if (!baseUrl) throw new Error('请先填写 API Base URL')
  if (!model.apiKey.trim()) throw new Error('请先填写 API Key')

  const response = await fetch(`${baseUrl}/models`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${model.apiKey.trim()}` },
    signal: mergeSignals(signal, 30_000),
  })
  if (!response.ok) {
    const detail = (await response.text()).trim().slice(0, 300)
    throw new Error(`获取模型失败（${response.status}）${detail ? `：${detail}` : ''}`)
  }
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error('获取模型失败：服务返回的内容不是合法 JSON')
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
    finishAiActivity(activity, error)
    throw error
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
