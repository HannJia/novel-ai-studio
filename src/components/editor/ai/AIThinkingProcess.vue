<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue'
import { useAiStore, useChapterStore, useEditorStore } from '@/stores'

const aiStore = useAiStore()
const chapterStore = useChapterStore()
const editorStore = useEditorStore()

const props = defineProps<{
  embedded?: boolean
  alwaysShowChat?: boolean
}>()

// 对话消息
interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

// 状态
const isMinimized = ref(false)
const chatMessages = ref<ChatMessage[]>([])
const chatInput = ref('')
const isChatting = ref(false)
const chatContainerRef = ref<HTMLElement | null>(null)
const reasoningContainerRef = ref<HTMLElement | null>(null)
// 是否展开推理内容
const isReasoningExpanded = ref(false)

// 计算属性
const isGenerating = computed(() => aiStore.generating)
// 当前推理内容
const currentReasoning = computed(() => aiStore.currentReasoning)
// 是否有推理内容
const hasReasoning = computed(() => !!currentReasoning.value)
// 是否应该显示浮窗（当嵌入面板不可见且正在生成或有对话消息或有推理内容时）
const shouldShowFloat = computed(() => !aiStore.embeddedPanelVisible)
// 是否有内容需要显示
const hasContent = computed(() => isGenerating.value || chatMessages.value.length > 0 || hasReasoning.value)
// 生成进度
const generatingProgress = computed(() => aiStore.generatingProgress)
// 进度百分比 (0-100)
const progressPercent = computed(() => {
  const { current, total } = generatingProgress.value
  if (total <= 0) return 0
  return Math.round((current / total) * 100)
})

// 监听推理内容变化，自动展开
watch(currentReasoning, (newVal) => {
  if (newVal) {
    isReasoningExpanded.value = true
    nextTick(() => {
      if (reasoningContainerRef.value) {
        reasoningContainerRef.value.scrollTop = 0
      }
    })
  }
})

// 滚动到底部
function scrollToBottom() {
  if (chatContainerRef.value) {
    chatContainerRef.value.scrollTop = chatContainerRef.value.scrollHeight
  }
}

// 清除推理内容
function clearReasoning() {
  aiStore.clearReasoning()
  isReasoningExpanded.value = false
}

// 发送对话消息
async function sendChatMessage() {
  if (!chatInput.value.trim() || isChatting.value) return

  const userMessage: ChatMessage = {
    id: Date.now().toString(),
    role: 'user',
    content: chatInput.value.trim(),
    timestamp: new Date()
  }
  chatMessages.value.push(userMessage)
  const userInput = chatInput.value
  chatInput.value = ''
  isChatting.value = true

  await nextTick()
  scrollToBottom()

  // 获取当前章节内容（从编辑器获取最新内容）
  const chapterContent = editorStore.content || ''

  // 判断是否是修改请求
  const isModifyRequest = /修改|改|换|删|加|增|调整|优化|重写|改写/.test(userInput)

  try {
    if (isModifyRequest && chapterContent) {
      // 如果是修改请求且有章节内容，执行实际修改
      const result = await aiStore.generate({
        prompt: `你是一位专业的小说编辑。请根据用户的修改要求，对以下小说内容进行修改。

【当前章节内容】
${chapterContent}

【用户修改要求】
${userInput}

【要求】
1. 按照用户的要求进行修改
2. 保持原文的整体风格和语气
3. 只修改需要修改的部分，其他内容保持不变
4. 直接输出修改后的完整章节内容，不要有任何解释或说明

修改后的内容：`,
        systemPrompt: '你是一位专业的小说编辑，擅长根据要求修改和优化小说内容。请直接输出修改后的内容，不要有任何额外的解释。',
        maxTokens: 4000
      })

      if (result?.content) {
        // 直接更新编辑器内容
        editorStore.content = result.content

        // 同时保存到章节（如果有当前章节）
        const currentChapter = chapterStore.currentChapter
        if (currentChapter) {
          await chapterStore.updateChapter(currentChapter.id, {
            content: result.content
          })
        }

        const assistantMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `已按照您的要求修改了章节内容，并已自动保存。`,
          timestamp: new Date()
        }
        chatMessages.value.push(assistantMessage)
      } else {
        throw new Error('修改失败')
      }
    } else {
      // 普通对话，提供建议但不直接修改
      const result = await aiStore.chat({
        messages: [
          {
            role: 'system',
            content: `你是一位小说创作助手。当前正在编辑的章节内容如下：
${chapterContent ? chapterContent.slice(0, 1000) + (chapterContent.length > 1000 ? '...' : '') : '（暂无内容）'}

请帮助用户回答问题或提供写作建议。如果用户想要修改内容，请告诉他们可以直接说"修改xxx"或"把xxx改成xxx"来让AI自动修改章节。`
          },
          { role: 'user', content: userInput }
        ],
        maxTokens: 500
      })

      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: result?.content || '抱歉，处理请求时出现问题。',
        timestamp: new Date()
      }
      chatMessages.value.push(assistantMessage)
    }
  } catch (e) {
    const errorMessage: ChatMessage = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: '抱歉，处理请求时出现问题：' + (e instanceof Error ? e.message : '未知错误'),
      timestamp: new Date()
    }
    chatMessages.value.push(errorMessage)
  }

  isChatting.value = false
  await nextTick()
  scrollToBottom()
}

// 最小化/展开
function minimize() {
  isMinimized.value = true
}

function expand() {
  isMinimized.value = false
}

// 处理按键
function handleKeydown(event: Event | KeyboardEvent) {
  const keyEvent = event as KeyboardEvent
  if (keyEvent.key === 'Enter' && !keyEvent.shiftKey) {
    event.preventDefault()
    sendChatMessage()
  }
}

// 关闭面板
function closePanel() {
  chatMessages.value = []
  clearReasoning()
}
</script>

<template>
  <!-- 嵌入模式 -->
  <div v-if="embedded && (alwaysShowChat || hasContent)" class="ai-panel embedded">
    <!-- 推理/思考过程区域 - 仅在非生成状态且有推理内容时显示 -->
    <div v-if="hasReasoning && !isGenerating" class="reasoning-section">
      <div class="reasoning-header" @click="isReasoningExpanded = !isReasoningExpanded">
        <div class="header-left">
          <el-icon class="brain-icon"><MagicStick /></el-icon>
          <span>AI 思考过程</span>
          <el-tag size="small" type="info">{{ currentReasoning?.length || 0 }} 字</el-tag>
        </div>
        <div class="header-right">
          <el-button text size="small" @click.stop="clearReasoning">
            <el-icon><Close /></el-icon>
          </el-button>
          <el-icon class="expand-icon" :class="{ expanded: isReasoningExpanded }">
            <ArrowDown />
          </el-icon>
        </div>
      </div>
      <div v-show="isReasoningExpanded" class="reasoning-content" ref="reasoningContainerRef">
        <pre>{{ currentReasoning }}</pre>
      </div>
    </div>

    <!-- 生成状态 - 步骤列表显示 -->
    <div v-if="isGenerating" class="generating-steps">
      <div
        v-for="step in generatingProgress.steps"
        :key="step.id"
        class="step-item"
        :class="step.status"
      >
        <div class="step-icon">
          <el-icon v-if="step.status === 'completed'" class="completed"><Select /></el-icon>
          <el-icon v-else-if="step.status === 'running'" class="is-loading running"><Loading /></el-icon>
          <el-icon v-else class="pending"><Clock /></el-icon>
        </div>
        <div class="step-content">
          <div class="step-name">{{ step.name }}</div>
          <div v-if="step.description" class="step-desc">{{ step.description }}</div>
        </div>
      </div>
    </div>

    <!-- AI 对话区域 -->
    <div class="chat-section">
      <div class="chat-header">
        <el-icon><ChatDotRound /></el-icon>
        <span>AI 对话</span>
      </div>

      <!-- 对话消息 -->
      <div class="chat-messages" ref="chatContainerRef">
        <div v-if="chatMessages.length === 0" class="chat-empty">
          <p>输入修改要求，如：</p>
          <p class="example">"把主角的名字改成张三"</p>
          <p class="example">"删除第二段"</p>
          <p class="example">"优化一下对话"</p>
        </div>
        <div
          v-for="msg in chatMessages"
          :key="msg.id"
          class="chat-message"
          :class="msg.role"
        >
          <div class="message-avatar">
            <el-icon v-if="msg.role === 'assistant'"><MagicStick /></el-icon>
            <el-icon v-else><User /></el-icon>
          </div>
          <div class="message-content">{{ msg.content }}</div>
        </div>
        <div v-if="isChatting" class="chat-message assistant typing">
          <div class="message-avatar">
            <el-icon><MagicStick /></el-icon>
          </div>
          <div class="message-content">
            <span class="typing-indicator">
              <span></span><span></span><span></span>
            </span>
          </div>
        </div>
      </div>

      <!-- 输入框 -->
      <div class="chat-input-area">
        <el-input
          v-model="chatInput"
          placeholder="输入修改要求..."
          :disabled="isGenerating"
          @keydown="handleKeydown"
        />
        <el-button
          type="primary"
          :loading="isChatting"
          :disabled="!chatInput.trim() || isGenerating"
          @click="sendChatMessage"
        >
          <el-icon><Promotion /></el-icon>
        </el-button>
      </div>
    </div>
  </div>

  <!-- 浮窗模式（只在嵌入面板不可见时显示） -->
  <Teleport to="body" v-else-if="!embedded && hasContent && shouldShowFloat">
    <div class="ai-float-panel" :class="{ minimized: isMinimized }">
      <!-- 最小化状态 -->
      <div v-if="isMinimized" class="minimized-btn" @click="expand">
        <el-icon v-if="isGenerating" class="is-loading"><Loading /></el-icon>
        <el-icon v-else><ChatDotRound /></el-icon>
        <span v-if="isGenerating">{{ generatingProgress.stage || '生成中...' }}</span>
        <span v-else>AI 对话</span>
      </div>

      <!-- 展开状态 -->
      <div v-else class="float-content">
        <div class="panel-header">
          <div class="header-left">
            <el-icon v-if="isGenerating" class="header-icon is-loading"><Loading /></el-icon>
            <el-icon v-else-if="hasReasoning" class="header-icon"><MagicStick /></el-icon>
            <el-icon v-else class="header-icon"><ChatDotRound /></el-icon>
            <span class="header-title">
              <template v-if="isGenerating">{{ generatingProgress.stage || '生成中...' }}</template>
              <template v-else-if="hasReasoning">AI 思考过程</template>
              <template v-else>AI 对话</template>
            </span>
          </div>
          <div class="header-actions">
            <el-button text size="small" @click="minimize">
              <el-icon><Minus /></el-icon>
            </el-button>
            <el-button v-if="!isGenerating && (chatMessages.length > 0 || hasReasoning)" text size="small" @click="closePanel">
              <el-icon><Close /></el-icon>
            </el-button>
          </div>
        </div>

        <!-- 生成步骤列表（浮窗模式） -->
        <div v-if="isGenerating" class="generating-steps-float">
          <div
            v-for="step in generatingProgress.steps"
            :key="step.id"
            class="step-item"
            :class="step.status"
          >
            <div class="step-icon">
              <el-icon v-if="step.status === 'completed'" class="completed"><Select /></el-icon>
              <el-icon v-else-if="step.status === 'running'" class="is-loading running"><Loading /></el-icon>
              <el-icon v-else class="pending"><Clock /></el-icon>
            </div>
            <div class="step-content">
              <div class="step-name">{{ step.name }}</div>
              <div v-if="step.description" class="step-desc">{{ step.description }}</div>
            </div>
          </div>
        </div>

        <!-- 推理/思考过程区域（浮窗模式）- 仅在非生成状态且有推理内容时显示 -->
        <div v-if="hasReasoning && !isGenerating" class="reasoning-section-float">
          <div class="reasoning-content" ref="reasoningContainerRef">
            <pre>{{ currentReasoning }}</pre>
          </div>
        </div>

        <!-- 对话消息 -->
        <div class="chat-messages" ref="chatContainerRef" v-if="!isGenerating">
          <div v-if="chatMessages.length === 0" class="chat-empty">
            <p>输入修改要求，如：</p>
            <p class="example">"把主角的名字改成张三"</p>
          </div>
          <div
            v-for="msg in chatMessages"
            :key="msg.id"
            class="chat-message"
            :class="msg.role"
          >
            <div class="message-avatar">
              <el-icon v-if="msg.role === 'assistant'"><MagicStick /></el-icon>
              <el-icon v-else><User /></el-icon>
            </div>
            <div class="message-content">{{ msg.content }}</div>
          </div>
          <div v-if="isChatting" class="chat-message assistant typing">
            <div class="message-avatar">
              <el-icon><MagicStick /></el-icon>
            </div>
            <div class="message-content">
              <span class="typing-indicator">
                <span></span><span></span><span></span>
              </span>
            </div>
          </div>
        </div>

        <!-- 输入框 -->
        <div class="chat-input-area">
          <el-input
            v-model="chatInput"
            placeholder="输入修改要求..."
            :disabled="isGenerating"
            @keydown="handleKeydown"
          />
          <el-button
            type="primary"
            :loading="isChatting"
            :disabled="!chatInput.trim() || isGenerating"
            @click="sendChatMessage"
          >
            <el-icon><Promotion /></el-icon>
          </el-button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
// 嵌入模式面板
.ai-panel.embedded {
  margin-top: 16px;
  border: 1px solid #e8e8e8;
  border-radius: 12px;
  background: white;
  overflow: hidden;
}

// 推理/思考过程区域
.reasoning-section {
  border-bottom: 1px solid #f0f0f0;

  .reasoning-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
    color: white;
    cursor: pointer;
    user-select: none;

    &:hover {
      background: linear-gradient(135deg, #e085e8 0%, #e54d63 100%);
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      font-weight: 500;

      .brain-icon {
        font-size: 18px;
      }

      .el-tag {
        margin-left: 4px;
        background: rgba(255,255,255,0.2);
        border: none;
        color: white;
      }
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 4px;

      .el-button {
        color: white;
        opacity: 0.8;
        &:hover { opacity: 1; }
      }

      .expand-icon {
        font-size: 16px;
        transition: transform 0.3s;

        &.expanded {
          transform: rotate(180deg);
        }
      }
    }
  }

  .reasoning-content {
    max-height: 500px;
    overflow-y: auto;
    padding: 12px 16px;
    background: #fafafa;

    pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: inherit;
      font-size: 13px;
      line-height: 1.6;
      color: #555;
    }

    &::-webkit-scrollbar {
      width: 4px;
    }
    &::-webkit-scrollbar-thumb {
      background: #ddd;
      border-radius: 2px;
    }
  }
}

// 浮窗模式的推理区域
.reasoning-section-float {
  .reasoning-content {
    max-height: 60vh;
    overflow-y: auto;
    padding: 12px 16px;
    background: #fafafa;
    border-bottom: 1px solid #f0f0f0;

    pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: inherit;
      font-size: 12px;
      line-height: 1.5;
      color: #555;
    }

    &::-webkit-scrollbar {
      width: 4px;
    }
    &::-webkit-scrollbar-thumb {
      background: #ddd;
      border-radius: 2px;
    }
  }
}

// 生成步骤列表（嵌入模式）
.generating-steps {
  padding: 12px 16px;
  background: #f8f9fa;
  border-bottom: 1px solid #e8e8e8;
}

// 生成步骤列表（浮窗模式）
.generating-steps-float {
  padding: 12px 16px;
  background: white;
  max-height: 300px;
  overflow-y: auto;

  &::-webkit-scrollbar {
    width: 4px;
  }
  &::-webkit-scrollbar-thumb {
    background: #ddd;
    border-radius: 2px;
  }
}

// 步骤项样式
.step-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 8px 0;

  &:not(:last-child) {
    border-bottom: 1px solid #f0f0f0;
  }

  .step-icon {
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-top: 2px;

    .el-icon {
      font-size: 16px;
    }

    .completed {
      color: #52c41a;
    }

    .running {
      color: #1890ff;
    }

    .pending {
      color: #d9d9d9;
    }
  }

  .step-content {
    flex: 1;
    min-width: 0;

    .step-name {
      font-size: 14px;
      color: #333;
      font-weight: 500;
    }

    .step-desc {
      font-size: 12px;
      color: #888;
      margin-top: 2px;
      line-height: 1.4;
    }
  }

  // 不同状态的样式
  &.completed {
    .step-name {
      color: #52c41a;
    }
  }

  &.running {
    .step-name {
      color: #1890ff;
    }
  }

  &.pending {
    .step-name {
      color: #999;
    }
  }
}

// 生成状态（保留旧样式作为备用）
.generating-status {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  font-size: 14px;

  .progress-info {
    display: flex;
    align-items: center;
    gap: 8px;

    .stage-text {
      flex: 1;
      font-weight: 500;
    }

    .progress-text {
      font-size: 13px;
      opacity: 0.9;
    }
  }

  .el-icon {
    font-size: 18px;
  }

  :deep(.el-progress) {
    .el-progress-bar__outer {
      background-color: rgba(255, 255, 255, 0.3);
    }
    .el-progress-bar__inner {
      background-color: white;
    }
  }
}

// 对话区域
.chat-section {
  .chat-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    border-bottom: 1px solid #f0f0f0;
    font-size: 14px;
    font-weight: 500;
    color: #333;

    .el-icon {
      color: #667eea;
    }
  }
}

.chat-messages {
  max-height: 200px;
  min-height: 80px;
  overflow-y: auto;
  padding: 12px 16px;

  &::-webkit-scrollbar {
    width: 4px;
  }
  &::-webkit-scrollbar-thumb {
    background: #ddd;
    border-radius: 2px;
  }
}

.chat-empty {
  text-align: center;
  color: #999;
  font-size: 13px;
  padding: 16px 0;

  p {
    margin: 4px 0;
  }

  .example {
    color: #667eea;
    font-size: 12px;
  }
}

.generating-hint {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px 20px;
  color: #667eea;
  font-size: 13px;

  .progress-info {
    display: flex;
    align-items: center;
    gap: 8px;

    .stage-text {
      flex: 1;
      font-weight: 500;
    }

    .progress-text {
      font-size: 12px;
      color: #999;
    }
  }

  :deep(.el-progress) {
    .el-progress-bar__outer {
      background-color: #f0f0f0;
    }
  }
}

.chat-message {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;

  &:last-child {
    margin-bottom: 0;
  }

  .message-avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    font-size: 14px;
  }

  .message-content {
    flex: 1;
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 13px;
    line-height: 1.6;
    word-break: break-word;
  }

  &.user {
    .message-avatar {
      background: #e6f7ff;
      color: #1890ff;
    }
    .message-content {
      background: #e6f7ff;
      color: #333;
    }
  }

  &.assistant {
    .message-avatar {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    .message-content {
      background: #f5f5f5;
      color: #333;
    }
  }
}

.typing-indicator {
  display: flex;
  gap: 4px;

  span {
    width: 6px;
    height: 6px;
    background: #667eea;
    border-radius: 50%;
    animation: typing 1.4s infinite;

    &:nth-child(2) { animation-delay: 0.2s; }
    &:nth-child(3) { animation-delay: 0.4s; }
  }
}

@keyframes typing {
  0%, 60%, 100% {
    transform: translateY(0);
    opacity: 0.6;
  }
  30% {
    transform: translateY(-4px);
    opacity: 1;
  }
}

.chat-input-area {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid #f0f0f0;

  .el-input {
    flex: 1;
  }

  .el-button {
    flex-shrink: 0;
    height: 32px;
  }
}

// 浮窗模式
.ai-float-panel {
  position: fixed;
  bottom: 80px;
  right: 340px;
  z-index: 1000;
  width: 360px;

  &.minimized {
    width: auto;
  }

  .minimized-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    background: white;
    border: 1px solid #e8e8e8;
    border-radius: 24px;
    cursor: pointer;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
    font-size: 13px;
    color: #666;

    .el-icon {
      font-size: 18px;
      color: #667eea;
    }

    &:hover {
      background: #fafafa;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
    }
  }

  .float-content {
    background: white;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
    overflow: hidden;

    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;

      .header-left {
        display: flex;
        align-items: center;
        gap: 8px;

        .header-icon {
          font-size: 18px;
        }

        .header-title {
          font-size: 14px;
          font-weight: 500;
        }
      }

      .header-actions {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .el-button {
        color: white;
        opacity: 0.8;
        &:hover { opacity: 1; }
      }
    }

    .chat-messages {
      max-height: 250px;
    }
  }
}

// 深色主题适配
:global(html.dark) {
  .ai-panel.embedded,
  .ai-float-panel .float-content {
    background: #1f1f1f;
    border-color: #333;
  }

  .reasoning-section {
    border-color: #333;

    .reasoning-content {
      background: #2a2a2a;

      pre {
        color: #c0c0c0;
      }
    }
  }

  .reasoning-section-float .reasoning-content {
    background: #2a2a2a;
    border-color: #333;

    pre {
      color: #c0c0c0;
    }
  }

  .chat-section .chat-header {
    border-color: #333;
    color: #e0e0e0;
  }

  .chat-empty {
    color: #888;

    .example {
      color: #7c8ae6;
    }
  }

  .chat-message {
    &.user {
      .message-avatar {
        background: #1a3a5c;
      }
      .message-content {
        background: #1a3a5c;
        color: #e0e0e0;
      }
    }

    &.assistant {
      .message-content {
        background: #2a2a2a;
        color: #e0e0e0;
      }
    }
  }

  .chat-input-area {
    border-color: #333;
  }
}
</style>
