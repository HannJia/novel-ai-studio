<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { useChatStore } from '@/stores/chatStore'
import { useBookStore } from '@/stores/bookStore'
import { storeToRefs } from 'pinia'
import {
  ChatDotRound,
  Plus,
  Delete,
  Edit,
  Top,
  Close,
  Loading,
  Setting,
  RefreshRight
} from '@element-plus/icons-vue'
import type { ChatSession } from '@/types/chat'

const props = defineProps<{
  bookId?: string
}>()

const emit = defineEmits<{
  close: []
}>()

const chatStore = useChatStore()
const bookStore = useBookStore()

const {
  sessions,
  currentSession,
  messages,
  loading,
  sendingMessage,
  streamingContent,
  error,
  isStreaming
} = storeToRefs(chatStore)

// 本地状态
const inputMessage = ref('')
const messagesContainer = ref<HTMLElement | null>(null)
const showSessionList = ref(true)
const editingSessionId = ref<string | null>(null)
const editingTitle = ref('')

// 上下文类型选项
const contextTypes = [
  { value: 'general', label: '通用对话' },
  { value: 'book', label: '书籍相关' },
  { value: 'chapter', label: '章节相关' },
  { value: 'character', label: '角色相关' }
]

// 新建会话的表单
const newSessionForm = ref({
  contextType: 'general' as 'general' | 'book' | 'chapter' | 'character',
  title: ''
})

// 计算属性
const currentBook = computed(() => bookStore.currentBook)

const canSend = computed(() =>
  inputMessage.value.trim().length > 0 && !sendingMessage.value
)

// 初始化
onMounted(async () => {
  await chatStore.loadSessions(props.bookId)
})

// 监听消息变化，自动滚动到底部
watch(messages, () => {
  nextTick(() => {
    scrollToBottom()
  })
}, { deep: true })

watch(streamingContent, () => {
  nextTick(() => {
    scrollToBottom()
  })
})

// 方法
function scrollToBottom() {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  }
}

async function createNewSession() {
  const session = await chatStore.createSession({
    bookId: props.bookId,
    title: newSessionForm.value.title || '新对话',
    contextType: newSessionForm.value.contextType,
    aiConfigId: undefined // 使用默认配置
  })

  if (session) {
    await chatStore.selectSession(session.id)
    newSessionForm.value.title = ''
  }
}

async function selectSession(session: ChatSession) {
  await chatStore.selectSession(session.id)
}

function startEditTitle(session: ChatSession) {
  editingSessionId.value = session.id
  editingTitle.value = session.title
}

async function saveTitle() {
  if (editingSessionId.value && editingTitle.value.trim()) {
    await chatStore.updateSessionTitle(editingSessionId.value, editingTitle.value.trim())
  }
  editingSessionId.value = null
  editingTitle.value = ''
}

async function deleteSession(session: ChatSession) {
  await chatStore.deleteSession(session.id)
}

async function togglePin(session: ChatSession) {
  await chatStore.togglePinned(session.id)
}

async function sendMessage() {
  if (!canSend.value) return

  const message = inputMessage.value.trim()
  inputMessage.value = ''

  // 使用流式发送
  await chatStore.sendMessageStream(message)
}

function cancelStream() {
  chatStore.cancelStream()
}

async function clearMessages() {
  await chatStore.clearMessages()
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()

  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`

  return date.toLocaleDateString()
}

function getContextTypeLabel(type: string): string {
  return contextTypes.find(t => t.value === type)?.label || type
}
</script>

<template>
  <div class="ai-chat">
    <!-- 左侧会话列表 -->
    <div class="chat-sidebar" :class="{ collapsed: !showSessionList }">
      <div class="sidebar-header">
        <h3>对话列表</h3>
        <el-button type="primary" :icon="Plus" size="small" @click="createNewSession">
          新建
        </el-button>
      </div>

      <!-- 新建会话选项 -->
      <div class="new-session-options">
        <el-select v-model="newSessionForm.contextType" size="small" placeholder="上下文类型">
          <el-option
            v-for="opt in contextTypes"
            :key="opt.value"
            :value="opt.value"
            :label="opt.label"
          />
        </el-select>
      </div>

      <!-- 会话列表 -->
      <div class="session-list">
        <div v-if="loading && !sessions.length" class="loading-tip">
          <el-icon class="is-loading"><Loading /></el-icon>
          加载中...
        </div>

        <div
          v-for="session in sessions"
          :key="session.id"
          class="session-item"
          :class="{ active: currentSession?.id === session.id, pinned: session.isPinned }"
          @click="selectSession(session)"
        >
          <div class="session-content">
            <div class="session-icon">
              <el-icon><ChatDotRound /></el-icon>
            </div>

            <div class="session-info">
              <template v-if="editingSessionId === session.id">
                <el-input
                  v-model="editingTitle"
                  size="small"
                  @blur="saveTitle"
                  @keyup.enter="saveTitle"
                  @click.stop
                />
              </template>
              <template v-else>
                <div class="session-title">{{ session.title }}</div>
                <div class="session-meta">
                  <span class="context-type">{{ getContextTypeLabel(session.contextType) }}</span>
                  <span class="message-count">{{ session.messageCount }}条消息</span>
                </div>
              </template>
            </div>
          </div>

          <div class="session-actions" @click.stop>
            <el-tooltip content="置顶" placement="top">
              <el-button
                :icon="Top"
                size="small"
                text
                :type="session.isPinned ? 'primary' : undefined"
                @click="togglePin(session)"
              />
            </el-tooltip>
            <el-tooltip content="重命名" placement="top">
              <el-button
                :icon="Edit"
                size="small"
                text
                @click="startEditTitle(session)"
              />
            </el-tooltip>
            <el-tooltip content="删除" placement="top">
              <el-button
                :icon="Delete"
                size="small"
                text
                type="danger"
                @click="deleteSession(session)"
              />
            </el-tooltip>
          </div>
        </div>

        <div v-if="!loading && !sessions.length" class="empty-tip">
          暂无对话，点击"新建"开始
        </div>
      </div>
    </div>

    <!-- 右侧对话区 -->
    <div class="chat-main">
      <template v-if="currentSession">
        <!-- 对话头部 -->
        <div class="chat-header">
          <div class="header-left">
            <el-button
              class="toggle-sidebar"
              :icon="showSessionList ? Close : ChatDotRound"
              size="small"
              text
              @click="showSessionList = !showSessionList"
            />
            <h3>{{ currentSession.title }}</h3>
            <el-tag size="small" type="info">
              {{ getContextTypeLabel(currentSession.contextType) }}
            </el-tag>
          </div>
          <div class="header-right">
            <el-tooltip content="清空消息" placement="bottom">
              <el-button :icon="Delete" size="small" text @click="clearMessages" />
            </el-tooltip>
          </div>
        </div>

        <!-- 消息列表 -->
        <div ref="messagesContainer" class="chat-messages">
          <div v-if="loading" class="loading-tip">
            <el-icon class="is-loading"><Loading /></el-icon>
            加载消息中...
          </div>

          <div
            v-for="msg in messages"
            :key="msg.id"
            class="message-item"
            :class="[msg.role, { error: msg.isError }]"
          >
            <div class="message-avatar">
              <el-avatar v-if="msg.role === 'user'" :size="36">用户</el-avatar>
              <el-avatar v-else :size="36" style="background: var(--el-color-primary)">AI</el-avatar>
            </div>
            <div class="message-content">
              <div class="message-text" v-html="msg.content.replace(/\n/g, '<br>')"></div>
              <div v-if="msg.reasoning" class="message-reasoning">
                <details>
                  <summary>查看推理过程</summary>
                  <div v-html="msg.reasoning.replace(/\n/g, '<br>')"></div>
                </details>
              </div>
              <div class="message-meta">
                <span v-if="msg.model" class="model-name">{{ msg.model }}</span>
                <span v-if="msg.tokenCount" class="token-count">{{ msg.tokenCount }} tokens</span>
                <span v-if="msg.duration" class="duration">{{ (msg.duration / 1000).toFixed(1) }}s</span>
                <span class="time">{{ formatTime(msg.createdAt) }}</span>
              </div>
            </div>
          </div>

          <div v-if="!loading && !messages.length" class="empty-messages">
            <el-icon :size="48"><ChatDotRound /></el-icon>
            <p>开始你的对话吧</p>
          </div>
        </div>

        <!-- 输入区域 -->
        <div class="chat-input">
          <div v-if="isStreaming" class="streaming-indicator">
            <el-icon class="is-loading"><Loading /></el-icon>
            <span>AI正在回复...</span>
            <el-button size="small" type="danger" @click="cancelStream">停止</el-button>
          </div>

          <div class="input-wrapper">
            <el-input
              v-model="inputMessage"
              type="textarea"
              :rows="3"
              :disabled="sendingMessage"
              placeholder="输入消息，按Enter发送，Shift+Enter换行"
              resize="none"
              @keydown="handleKeyDown"
            />
            <el-button
              type="primary"
              :loading="sendingMessage"
              :disabled="!canSend"
              @click="sendMessage"
            >
              发送
            </el-button>
          </div>

          <div v-if="error" class="error-tip">
            <el-alert :title="error" type="error" :closable="false" show-icon />
          </div>
        </div>
      </template>

      <template v-else>
        <div class="no-session">
          <el-icon :size="64"><ChatDotRound /></el-icon>
          <h3>选择或创建一个对话</h3>
          <p>从左侧选择已有对话，或点击"新建"开始新的对话</p>
          <el-button type="primary" :icon="Plus" @click="createNewSession">
            新建对话
          </el-button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped lang="scss">
.ai-chat {
  display: flex;
  height: 100%;
  background: var(--el-bg-color);
}

.chat-sidebar {
  width: 280px;
  border-right: 1px solid var(--el-border-color-light);
  display: flex;
  flex-direction: column;
  transition: width 0.3s;

  &.collapsed {
    width: 0;
    overflow: hidden;
  }
}

.sidebar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid var(--el-border-color-light);

  h3 {
    margin: 0;
    font-size: 16px;
  }
}

.new-session-options {
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-border-color-light);

  .el-select {
    width: 100%;
  }
}

.session-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.session-item {
  display: flex;
  align-items: center;
  padding: 12px;
  border-radius: 8px;
  cursor: pointer;
  margin-bottom: 4px;
  transition: background 0.2s;

  &:hover {
    background: var(--el-fill-color-light);
  }

  &.active {
    background: var(--el-color-primary-light-9);
  }

  &.pinned {
    border-left: 3px solid var(--el-color-primary);
  }
}

.session-content {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.session-icon {
  font-size: 20px;
  color: var(--el-color-primary);
}

.session-info {
  flex: 1;
  min-width: 0;
}

.session-title {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-meta {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.session-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s;

  .session-item:hover & {
    opacity: 1;
  }
}

.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-border-color-light);

  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;

    h3 {
      margin: 0;
      font-size: 16px;
    }
  }
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.message-item {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;

  &.user {
    flex-direction: row-reverse;

    .message-content {
      align-items: flex-end;
    }

    .message-text {
      background: var(--el-color-primary);
      color: white;
    }
  }

  &.error .message-text {
    background: var(--el-color-danger-light-9);
    color: var(--el-color-danger);
    border: 1px solid var(--el-color-danger-light-5);
  }
}

.message-content {
  display: flex;
  flex-direction: column;
  max-width: 70%;
}

.message-text {
  padding: 12px 16px;
  border-radius: 12px;
  background: var(--el-fill-color-light);
  line-height: 1.6;
  word-break: break-word;
}

.message-reasoning {
  margin-top: 8px;
  font-size: 12px;

  details {
    background: var(--el-fill-color);
    padding: 8px 12px;
    border-radius: 8px;

    summary {
      cursor: pointer;
      color: var(--el-text-color-secondary);
    }

    > div {
      margin-top: 8px;
      color: var(--el-text-color-regular);
    }
  }
}

.message-meta {
  display: flex;
  gap: 8px;
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

.chat-input {
  padding: 16px;
  border-top: 1px solid var(--el-border-color-light);
}

.streaming-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  color: var(--el-color-primary);
  font-size: 14px;
}

.input-wrapper {
  display: flex;
  gap: 12px;
  align-items: flex-end;

  .el-textarea {
    flex: 1;
  }
}

.error-tip {
  margin-top: 8px;
}

.no-session,
.empty-messages {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--el-text-color-secondary);
  text-align: center;
  gap: 16px;

  h3 {
    margin: 0;
    color: var(--el-text-color-primary);
  }

  p {
    margin: 0;
  }
}

.loading-tip,
.empty-tip {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  color: var(--el-text-color-secondary);
}
</style>
