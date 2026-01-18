import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { chatApi } from '@/services/api/chatApi'
import type {
  ChatSession,
  ChatMessageItem,
  CreateSessionRequest,
  SendMessageRequest
} from '@/types/chat'

export const useChatStore = defineStore('chat', () => {
  // ==================== 状态 ====================

  // 会话列表
  const sessions = ref<ChatSession[]>([])

  // 当前会话
  const currentSession = ref<ChatSession | null>(null)

  // 当前会话的消息
  const messages = ref<ChatMessageItem[]>([])

  // 加载状态
  const loading = ref(false)
  const sendingMessage = ref(false)

  // 流式响应的当前内容
  const streamingContent = ref('')

  // 错误信息
  const error = ref<string | null>(null)

  // 流式请求的取消函数
  let streamCancelFn: (() => void) | null = null

  // ==================== 计算属性 ====================

  // 置顶的会话
  const pinnedSessions = computed(() =>
    sessions.value.filter(s => s.isPinned)
  )

  // 未置顶的会话
  const unpinnedSessions = computed(() =>
    sessions.value.filter(s => !s.isPinned)
  )

  // 当前会话的消息数
  const messageCount = computed(() => messages.value.length)

  // 是否正在流式响应
  const isStreaming = computed(() => streamingContent.value.length > 0 && sendingMessage.value)

  // ==================== 会话管理 ====================

  /**
   * 加载会话列表
   */
  async function loadSessions(bookId?: string) {
    loading.value = true
    error.value = null
    try {
      sessions.value = await chatApi.getSessions(bookId, 50)
    } catch (e: any) {
      error.value = e.message || '加载会话列表失败'
      console.error('Failed to load sessions:', e)
    } finally {
      loading.value = false
    }
  }

  /**
   * 创建新会话
   */
  async function createSession(data: CreateSessionRequest): Promise<ChatSession | null> {
    loading.value = true
    error.value = null
    try {
      const session = await chatApi.createSession(data)
      sessions.value.unshift(session)
      return session
    } catch (e: any) {
      error.value = e.message || '创建会话失败'
      console.error('Failed to create session:', e)
      return null
    } finally {
      loading.value = false
    }
  }

  /**
   * 选择会话
   */
  async function selectSession(sessionId: string) {
    loading.value = true
    error.value = null
    try {
      currentSession.value = await chatApi.getSession(sessionId)
      messages.value = await chatApi.getMessages(sessionId)
    } catch (e: any) {
      error.value = e.message || '加载会话失败'
      console.error('Failed to select session:', e)
    } finally {
      loading.value = false
    }
  }

  /**
   * 更新会话标题
   */
  async function updateSessionTitle(sessionId: string, title: string) {
    try {
      await chatApi.updateSessionTitle(sessionId, title)
      const session = sessions.value.find(s => s.id === sessionId)
      if (session) session.title = title
      if (currentSession.value?.id === sessionId) {
        currentSession.value.title = title
      }
    } catch (e: any) {
      console.error('Failed to update session title:', e)
    }
  }

  /**
   * 切换会话置顶
   */
  async function togglePinned(sessionId: string) {
    try {
      await chatApi.togglePinned(sessionId)
      const session = sessions.value.find(s => s.id === sessionId)
      if (session) session.isPinned = !session.isPinned
      if (currentSession.value?.id === sessionId) {
        currentSession.value.isPinned = !currentSession.value.isPinned
      }
    } catch (e: any) {
      console.error('Failed to toggle pinned:', e)
    }
  }

  /**
   * 删除会话
   */
  async function deleteSession(sessionId: string) {
    try {
      await chatApi.deleteSession(sessionId)
      sessions.value = sessions.value.filter(s => s.id !== sessionId)
      if (currentSession.value?.id === sessionId) {
        currentSession.value = null
        messages.value = []
      }
    } catch (e: any) {
      console.error('Failed to delete session:', e)
    }
  }

  /**
   * 清空当前会话消息
   */
  async function clearMessages() {
    if (!currentSession.value) return
    try {
      await chatApi.clearMessages(currentSession.value.id)
      messages.value = []
      currentSession.value.messageCount = 0
      currentSession.value.tokenCount = 0
    } catch (e: any) {
      console.error('Failed to clear messages:', e)
    }
  }

  // ==================== 消息功能 ====================

  /**
   * 发送消息（非流式）
   */
  async function sendMessage(content: string, options?: { maxTokens?: number; temperature?: number }) {
    if (!currentSession.value || sendingMessage.value) return

    sendingMessage.value = true
    error.value = null

    // 立即添加用户消息到列表
    const userMessage: ChatMessageItem = {
      id: 'temp-user-' + Date.now(),
      sessionId: currentSession.value.id,
      role: 'user',
      content,
      tokenCount: 0,
      isError: false,
      createdAt: new Date().toISOString()
    }
    messages.value.push(userMessage)

    try {
      const response = await chatApi.sendMessage(currentSession.value.id, {
        message: content,
        maxTokens: options?.maxTokens,
        temperature: options?.temperature
      })

      // 更新用户消息ID
      userMessage.id = 'user-' + response.message.id

      // 添加AI回复
      messages.value.push(response.message)

      // 更新会话统计
      if (currentSession.value) {
        currentSession.value.messageCount += 2
        currentSession.value.tokenCount += response.tokenUsage?.totalTokens || 0
      }
    } catch (e: any) {
      error.value = e.message || '发送消息失败'
      // 添加错误消息
      messages.value.push({
        id: 'error-' + Date.now(),
        sessionId: currentSession.value.id,
        role: 'assistant',
        content: error.value,
        tokenCount: 0,
        isError: true,
        createdAt: new Date().toISOString()
      })
    } finally {
      sendingMessage.value = false
    }
  }

  /**
   * 发送消息（流式）
   */
  async function sendMessageStream(
    content: string,
    options?: { maxTokens?: number; temperature?: number }
  ) {
    if (!currentSession.value || sendingMessage.value) return

    sendingMessage.value = true
    streamingContent.value = ''
    error.value = null

    // 立即添加用户消息到列表
    const userMessage: ChatMessageItem = {
      id: 'temp-user-' + Date.now(),
      sessionId: currentSession.value.id,
      role: 'user',
      content,
      tokenCount: 0,
      isError: false,
      createdAt: new Date().toISOString()
    }
    messages.value.push(userMessage)

    // 添加临时的AI消息用于显示流式内容
    const tempAssistantMessage: ChatMessageItem = {
      id: 'temp-assistant-' + Date.now(),
      sessionId: currentSession.value.id,
      role: 'assistant',
      content: '',
      tokenCount: 0,
      isError: false,
      createdAt: new Date().toISOString()
    }
    messages.value.push(tempAssistantMessage)

    const { cancel } = chatApi.sendMessageStream(
      currentSession.value.id,
      {
        message: content,
        maxTokens: options?.maxTokens,
        temperature: options?.temperature
      },
      {
        onChunk: (chunk) => {
          streamingContent.value += chunk
          // 更新临时消息的内容
          const lastMsg = messages.value[messages.value.length - 1]
          if (lastMsg && lastMsg.role === 'assistant') {
            lastMsg.content = streamingContent.value
          }
        },
        onDone: (data) => {
          // 更新消息ID和统计
          const lastMsg = messages.value[messages.value.length - 1]
          if (lastMsg && lastMsg.role === 'assistant') {
            lastMsg.id = data.messageId
            lastMsg.tokenCount = data.tokenUsage?.totalTokens || 0
            lastMsg.duration = data.duration
          }

          // 更新会话统计
          if (currentSession.value) {
            currentSession.value.messageCount += 2
            currentSession.value.tokenCount += data.tokenUsage?.totalTokens || 0
          }

          sendingMessage.value = false
          streamingContent.value = ''
        },
        onError: (errorMsg) => {
          error.value = errorMsg
          // 更新临时消息为错误状态
          const lastMsg = messages.value[messages.value.length - 1]
          if (lastMsg && lastMsg.role === 'assistant') {
            lastMsg.content = errorMsg
            lastMsg.isError = true
          }
          sendingMessage.value = false
          streamingContent.value = ''
        }
      }
    )

    streamCancelFn = cancel
  }

  /**
   * 取消流式响应
   */
  function cancelStream() {
    if (streamCancelFn) {
      streamCancelFn()
      streamCancelFn = null
      sendingMessage.value = false
      streamingContent.value = ''
    }
  }

  /**
   * 重置状态
   */
  function reset() {
    sessions.value = []
    currentSession.value = null
    messages.value = []
    loading.value = false
    sendingMessage.value = false
    streamingContent.value = ''
    error.value = null
    cancelStream()
  }

  return {
    // 状态
    sessions,
    currentSession,
    messages,
    loading,
    sendingMessage,
    streamingContent,
    error,

    // 计算属性
    pinnedSessions,
    unpinnedSessions,
    messageCount,
    isStreaming,

    // 方法
    loadSessions,
    createSession,
    selectSession,
    updateSessionTitle,
    togglePinned,
    deleteSession,
    clearMessages,
    sendMessage,
    sendMessageStream,
    cancelStream,
    reset
  }
})
