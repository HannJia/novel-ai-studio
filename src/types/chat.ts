/**
 * AI对话相关类型定义
 */

/**
 * 对话会话
 */
export interface ChatSession {
  id: string
  bookId?: string
  title: string
  contextType: 'general' | 'book' | 'chapter' | 'character'
  contextRefId?: string
  aiConfigId?: string
  messageCount: number
  tokenCount: number
  isPinned: boolean
  createdAt: string
  updatedAt: string
}

/**
 * 对话消息
 */
export interface ChatMessageItem {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  reasoning?: string
  tokenCount: number
  model?: string
  duration?: number
  isError: boolean
  metadata?: Record<string, unknown>
  createdAt: string
}

/**
 * 创建会话请求
 */
export interface CreateSessionRequest {
  bookId?: string
  title?: string
  contextType?: 'general' | 'book' | 'chapter' | 'character'
  contextRefId?: string
  aiConfigId?: string
}

/**
 * 发送消息请求
 */
export interface SendMessageRequest {
  message: string
  maxTokens?: number
  temperature?: number
}

/**
 * 发送消息响应
 */
export interface SendMessageResponse {
  message: ChatMessageItem
  tokenUsage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  duration: number
}

/**
 * 流式消息事件类型
 */
export type StreamEventType = 'chunk' | 'done' | 'error'

/**
 * 流式完成数据
 */
export interface StreamDoneData {
  messageId: string
  tokenUsage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  duration: number
}
