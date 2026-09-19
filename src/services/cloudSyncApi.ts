import { normalizeSyncEndpoint } from './cloudSyncModel'

export class CloudApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

const errors: Record<string, string> = {
  'Invalid password': '密码需要 6～256 个字符。',
  'Invalid currentPassword': '请输入当前密码。',
  'Current password is incorrect': '当前密码不正确。',
  'New password must be different': '新密码不能与当前密码相同。',
  'Please sign in again': '登录状态已变化，请重新登录。',
  'Incorrect username or password': '账号或密码不正确。',
  'Invalid or expired invitation': '邀请码无效、已用完或已过期。',
  'Username already exists': '这个账号已被注册。',
  'Session expired': '登录已过期，请重新登录。',
  'Sign in required': '请先登录同步账号。',
  'Invalid recovery details': '账号或恢复码不正确。',
  'Document changed on another device': '另一台设备更新了这份内容，稍后将重新比较版本。',
  'Account storage quota exceeded': '云端账户空间不足。本地内容已保留，请联系管理员。',
  'Server storage quota reached': '服务器空间已达上限，本地内容已保留。',
  'Document exceeds 50 MiB': '单本小说或单个知识库超过 50 MiB 同步上限。',
  'Too many requests; try later': '请求过于频繁，请稍后重试。',
  'Registration capacity reached': '当前注册名额已满。',
  'Administrator required': '只有管理员可以创建邀请码。',
  'Username must use 3-32 letters, numbers, underscores or hyphens': '账号需为 3～32 位英文字母、数字、下划线或短横线。',
}

export async function cloudRequest<T>(endpoint: string, path: string, options: {
  token?: string; body?: unknown; signal?: AbortSignal
} = {}): Promise<T> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  const timer = setTimeout(abort, 60000)
  options.signal?.addEventListener('abort', abort, { once: true })
  if (options.signal?.aborted) controller.abort()
  try {
    const response = await fetch(`${normalizeSyncEndpoint(endpoint)}/v1/${path}`, {
      method: options.body === undefined ? 'GET' : 'POST',
      headers: { ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store',
    })
    const reader = response.body?.getReader()
    let text = ''
    if (reader) {
      const decoder = new TextDecoder()
      let bytes = 0
      try {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          bytes += chunk.value.byteLength
          if (bytes > 64 * 1024 * 1024) throw new Error('同步响应过大，已停止接收。')
          text += decoder.decode(chunk.value, { stream: true })
        }
        text += decoder.decode()
      } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
    } else text = await response.text()
    let body
    try { body = JSON.parse(text) } catch { throw new CloudApiError(response.status, '同步服务器返回了无效数据，请稍后重试。') }
    if (!response.ok) {
      throw new CloudApiError(response.status, errors[body?.detail] || `同步请求失败（${response.status}）。本地内容未丢失。`)
    }
    return body as T
  } catch (error) {
    if (error instanceof CloudApiError) throw error
    if (controller.signal.aborted) throw new Error('同步已取消或连接超时，本地内容已保留。')
    if (error instanceof TypeError) throw new Error('无法连接同步服务器，请检查网络。软件仍会在本地保存。')
    throw error
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
  }
}
