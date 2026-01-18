import request from '@/utils/request'
import type {
  ChatSession,
  ChatMessageItem,
  CreateSessionRequest,
  SendMessageRequest,
  SendMessageResponse
} from '@/types/chat'

const BASE_URL = '/api/chat'

/**
 * AI对话API服务
 */
export const chatApi = {
  // ==================== 会话管理 ====================

  /**
   * 创建新会话
   */
  createSession(data: CreateSessionRequest): Promise<ChatSession> {
    return request.post(`${BASE_URL}/sessions`, data)
  },

  /**
   * 获取会话详情
   */
  getSession(sessionId: string): Promise<ChatSession> {
    return request.get(`${BASE_URL}/sessions/${sessionId}`)
  },

  /**
   * 获取会话列表
   */
  getSessions(bookId?: string, limit?: number): Promise<ChatSession[]> {
    const params = new URLSearchParams()
    if (bookId) params.append('bookId', bookId)
    if (limit) params.append('limit', String(limit))
    const query = params.toString()
    return request.get(`${BASE_URL}/sessions${query ? '?' + query : ''}`)
  },

  /**
   * 更新会话标题
   */
  updateSessionTitle(sessionId: string, title: string): Promise<void> {
    return request.put(`${BASE_URL}/sessions/${sessionId}/title`, { title })
  },

  /**
   * 切换会话置顶
   */
  togglePinned(sessionId: string): Promise<void> {
    return request.post(`${BASE_URL}/sessions/${sessionId}/toggle-pin`)
  },

  /**
   * 删除会话
   */
  deleteSession(sessionId: string): Promise<void> {
    return request.delete(`${BASE_URL}/sessions/${sessionId}`)
  },

  // ==================== 消息管理 ====================

  /**
   * 获取会话消息
   */
  getMessages(sessionId: string, limit?: number): Promise<ChatMessageItem[]> {
    const params = limit ? `?limit=${limit}` : ''
    return request.get(`${BASE_URL}/sessions/${sessionId}/messages${params}`)
  },

  /**
   * 清空会话消息
   */
  clearMessages(sessionId: string): Promise<void> {
    return request.delete(`${BASE_URL}/sessions/${sessionId}/messages`)
  },

  // ==================== 对话功能 ====================

  /**
   * 发送消息（非流式）
   */
  sendMessage(sessionId: string, data: SendMessageRequest): Promise<SendMessageResponse> {
    return request.post(`${BASE_URL}/sessions/${sessionId}/send`, data)
  },

  /**
   * 发送消息（流式）
   * 返回一个可取消的流式请求
   */
  sendMessageStream(
    sessionId: string,
    data: SendMessageRequest,
    callbacks: {
      onChunk: (chunk: string) => void
      onDone: (data: { messageId: string; tokenUsage: any; duration: number }) => void
      onError: (error: string) => void
    }
  ): { cancel: () => void } {
    const controller = new AbortController()

    const fetchStream = async () => {
      try {
        const response = await fetch(`/api/chat/sessions/${sessionId}/stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(data),
          signal: controller.signal
        })

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }

        const reader = response.body?.getReader()
        if (!reader) {
          throw new Error('No response body')
        }

        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (line.startsWith('event:')) {
              const eventType = line.slice(6).trim()
              continue
            }
            if (line.startsWith('data:')) {
              const data = line.slice(5).trim()
              if (!data) continue

              // 解析事件类型（从前一行获取）
              const prevLine = lines[lines.indexOf(line) - 1]
              let eventType = 'chunk'
              if (prevLine?.startsWith('event:')) {
                eventType = prevLine.slice(6).trim()
              }

              try {
                if (eventType === 'chunk') {
                  callbacks.onChunk(data)
                } else if (eventType === 'done') {
                  const doneData = JSON.parse(data)
                  callbacks.onDone(doneData)
                } else if (eventType === 'error') {
                  callbacks.onError(data)
                }
              } catch (e) {
                // 如果不是JSON，直接作为chunk处理
                callbacks.onChunk(data)
              }
            }
          }
        }
      } catch (error: any) {
        if (error.name !== 'AbortError') {
          callbacks.onError(error.message || 'Stream error')
        }
      }
    }

    fetchStream()

    return {
      cancel: () => controller.abort()
    }
  },

  /**
   * 使用EventSource进行流式对话（备用方案）
   */
  sendMessageStreamSSE(
    sessionId: string,
    data: SendMessageRequest,
    callbacks: {
      onChunk: (chunk: string) => void
      onDone: (data: { messageId: string; tokenUsage: any; duration: number }) => void
      onError: (error: string) => void
    }
  ): { cancel: () => void } {
    // 先发送POST请求，然后使用EventSource接收
    // 注意：标准EventSource不支持POST，这里使用fetch + SSE解析
    return this.sendMessageStream(sessionId, data, callbacks)
  }
}

export default chatApi
