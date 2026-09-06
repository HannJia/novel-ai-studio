<template>
  <div class="ai-chat-wrapper" id="ai-chat-assistant">
    <!-- 浮动按钮 -->
    <button
      class="chat-fab"
      @click="toggleChat"
      :class="{ 'fab-active': showChat, 'fab-busy': thinking && !showChat }"
      :title="thinking && !showChat ? 'AI 对话助手：后台处理中，点击展开' : unread ? 'AI 对话助手：有新回复' : 'AI 对话助手'"
    >
      {{ showChat ? '−' : thinking ? '⏳' : unread ? '💬•' : '💬' }}
    </button>

    <!-- 聊天窗口 -->
    <transition name="chat-slide">
      <div v-if="showChat" class="chat-window paper-panel" :class="{ expanded }">
        <div class="chat-header">
          <h3>AI 对话助手</h3>
          <div class="chat-header-actions">
            <button class="chat-search-btn" :class="{ enabled: webSearch }" :aria-pressed="webSearch"
              :title="webSearch ? '关闭联网搜索（下条消息生效）' : '开启联网搜索（下条消息生效）'"
              @click="toggleSearch">🌐 联网{{ webSearch ? '开' : '关' }}</button>
            <button class="chat-icon-btn" @click="expanded = !expanded" :title="expanded ? '还原窗口' : '放大窗口'" :aria-label="expanded ? '还原窗口' : '放大窗口'">{{ expanded ? '❐' : '⛶' }}</button>
            <button class="chat-icon-btn" @click="toggleChat" title="收起窗口（继续后台运行）" aria-label="收起窗口">−</button>
            <button class="chat-icon-btn" :disabled="thinking" @click="clearHistory" :title="thinking ? '请先停止请求再清空记录' : '清空记录'">🗑️</button>
          </div>
        </div>

        <p class="chat-search-notice">{{ webSearch
          ? '允许按需搜索；查询词可能交给服务商的搜索服务并额外计费。不支持时会提示。'
          : '未启用网页搜索；AI 对话仍需调用已配置 API。' }}{{ thinking ? ' 开关修改下条生效，收起窗口不会停止当前请求。' : '' }}</p>
        <div class="chat-messages" ref="messagesRef">
          <!-- 欢迎消息 -->
          <div v-if="messages.length === 0" class="chat-welcome">
            <p>👋 我是你的 AI 写作助手</p>
            <p class="chat-hint">这里是独立的书内对话。创建前的讨论保存在侧栏「灵感记录」，已确认设定仍会作为参考。</p>
            <p class="chat-hint">你可以问我关于小说的任何问题，比如：</p>
            <div class="quick-actions">
              <button @click="quickAsk('帮我分析一下当前的剧情走向')">📊 分析剧情</button>
              <button @click="quickAsk('给我一些关于下一章的写作建议')">💡 写作建议</button>
              <button @click="quickAsk('帮我检查人物性格是否一致')">👤 角色一致性</button>
              <button @click="quickAsk('当前有哪些全书规划需要推进或收束')">🧭 全书规划</button>
              <button @click="crossChapterAnalysis">📄 跨章节分析</button>
              <button @click="wholeBookAnalysis">📖 全书评估</button>
            </div>
          </div>

          <!-- 消息列表 -->
          <div
            v-for="msg in messages"
            :key="msg.id"
            class="chat-msg"
            :class="msg.role"
          >
            <div class="msg-avatar">{{ msg.role === 'user' ? '👤' : '🤖' }}</div>
            <div class="msg-bubble">
              <div class="msg-content" v-html="renderMd(msg.role === 'assistant' ? formatChatReply(msg.content, msg.search) : msg.content)"></div>
              <ChatSearchEvidence :record="msg.search" />
              <div v-if="msg.role === 'assistant' && !msg.failed" class="msg-actions">
                <button class="action-btn" @click="copyContent(formatChatReply(msg.content, msg.search))" title="复制内容">
                  📋 复制
                </button>
              </div>
            </div>
          </div>

          <!-- AI 正在思考 -->
          <div v-if="thinking" class="chat-msg assistant">
            <div class="msg-avatar">🤖</div>
            <div v-if="streamText" class="msg-content" v-html="renderMd(streamText)"></div>
            <div v-else class="msg-content thinking-dots" :aria-label="webSearch ? '正在请求联网回复' : '正在回复'">
              <span></span><span></span><span></span>
            </div>
          </div>
        </div>

        <p v-if="error" class="chat-error" role="alert">{{ error }}</p>
        <div class="chat-input-area">
          <n-input
            v-model:value="inputText"
            type="textarea"
            :rows="2"
            placeholder="输入问题或修改建议..."
            :maxlength="12000"
            @keydown.enter.ctrl.prevent="sendMessage"
            size="small"
          />
          <n-button v-if="thinking" size="small" @click="stop">停止</n-button>
          <n-button v-else
            type="primary"
            size="small"
            @click="sendMessage"
            :loading="thinking"
            :disabled="!inputText.trim()"
          >
            发送
          </n-button>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, watch } from 'vue'
import { NButton, NInput, useDialog } from 'naive-ui'
import { useAssistantChat } from '@/composables/useAssistantChat'
import ChatSearchEvidence from '@/components/ChatSearchEvidence.vue'
import { renderMd } from '@/utils/markdown'
import { formatChatReply } from '@/utils/chatPresentation'

const props = defineProps<{
  novelId: string
}>()

const dialog = useDialog()
const { novel, messages, webSearch, inputText, thinking, streamText, error, sendMessage, stop, toggleSearch, clear, quickAsk } = useAssistantChat(() => props.novelId)

const showChat = ref(false)
const expanded = ref(false)
const unread = ref(false)
const messagesRef = ref<HTMLDivElement | null>(null)

function toggleChat() {
  showChat.value = !showChat.value
  if (showChat.value) unread.value = false
}

// 滚动到底部
function scrollToBottom() {
  nextTick(() => {
    if (messagesRef.value) {
      messagesRef.value.scrollTop = messagesRef.value.scrollHeight
    }
  })
}

function clearHistory() {
  dialog.warning({ title: '清空对话记录', content: '只清空当前小说的书内助手对话，不影响灵感记录、正文和设定。确定继续吗？',
    positiveText: '清空', negativeText: '取消', onPositiveClick: clear })
}

async function copyContent(text: string) {
  try { await navigator.clipboard.writeText(text) }
  catch { error.value = '复制失败，请选中文本手动复制。' }
}

watch(showChat, (val) => {
  if (val) scrollToBottom()
})
watch(() => [messages.value.length, streamText.value, thinking.value], scrollToBottom)
watch(() => messages.value[messages.value.length - 1]?.id, () => {
  if (!showChat.value && messages.value[messages.value.length - 1]?.role === 'assistant') unread.value = true
})
watch(() => props.novelId, () => { unread.value = false })

// 跨章节分析
function crossChapterAnalysis() {
  if (!novel.value) return
  const chapSummaries = novel.value.chapters
    .filter(c => c.summary)
    .map(c => `第${c.chapterIndex + 1}章《${c.title}》: ${c.summary.substring(0, 100)}`)
    .join('\n')
  inputText.value = `请分析以下章节之间的连贯性和可能的问题（级类押韵、角色表现不一致、剧情漏洞等），并给出具体修改建议：\n\n${chapSummaries || '（暂无章节总结，请先完成一些章节）'}`
  sendMessage()
}

// 全书评估
function wholeBookAnalysis() {
  if (!novel.value) return
  const info = [
    `书名：${novel.value.title}`,
    `类型：${novel.value.genreLabel}/${novel.value.subGenreLabel}`,
    `进度：${novel.value.chapters.length}章 / ${novel.value.currentWordCount}字`,
    `目标：${novel.value.targetWordCountMin}~${novel.value.targetWordCountMax}万字`,
    novel.value.outline ? `大纲摘要：${novel.value.outline.substring(0, 300)}` : '',
  ].filter(Boolean).join('\n')
  inputText.value = `请对这本小说进行全面评估，包括：
1. 整体节奏评估（是否合理）
2. 角色发展弧线评估
3. 剧情张力分析
4. 待回收伏笔梳理
5. 后续写作建议\n\n${info}`
  sendMessage()
}
</script>

<style scoped>
.ai-chat-wrapper {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 1000;
}

/* 浮动按钮 */
.chat-fab {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: none;
  background: var(--color-primary);
  color: #fff;
  font-size: 24px;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(0,0,0,0.2);
  transition: all 0.3s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.chat-fab:hover {
  transform: scale(1.1);
  box-shadow: 0 6px 24px rgba(0,0,0,0.3);
}

.fab-active {
  background: var(--text-color-tertiary);
  font-size: 18px;
}

/* 聊天窗口 */
.chat-window {
  position: absolute;
  bottom: 64px;
  right: 0;
  width: min(420px, calc(100vw - 32px));
  height: min(600px, calc(100dvh - 110px));
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-lg);
  box-shadow: 0 8px 40px rgba(0,0,0,0.15);
  overflow: hidden;
}
.chat-window.expanded { width: min(900px, calc(100vw - 32px)); height: calc(100dvh - 110px); }
.fab-busy { animation: busy-pulse 1.8s ease-in-out infinite; }
@keyframes busy-pulse { 50% { box-shadow: 0 0 0 5px var(--color-primary-light); } }

.chat-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color-light);
}

.chat-header h3 {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color-primary);
}

.chat-icon-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 16px;
  padding: 4px;
  border-radius: 4px;
  transition: background 0.2s;
}

.chat-icon-btn:hover {
  background: var(--bg-color-secondary);
}

/* 消息区 */
.chat-messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.chat-welcome {
  text-align: center;
  padding: 20px 0;
  color: var(--text-color-tertiary);
  font-size: 13px;
}

.chat-welcome p { margin-bottom: 8px; }
.chat-hint { font-size: 12px; }

.quick-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
  margin-top: 12px;
}

.quick-actions button {
  padding: 6px 10px;
  border: 1px solid var(--border-color-light);
  border-radius: var(--radius-sm);
  background: var(--bg-color);
  color: var(--text-color-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.quick-actions button:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

/* 消息气泡 */
.chat-msg {
  display: flex;
  gap: 8px;
  max-width: 85%;
}

.chat-msg.user {
  align-self: flex-end;
  flex-direction: row-reverse;
}

.msg-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  flex-shrink: 0;
  background: var(--bg-color-secondary);
}

.msg-content {
  padding: 8px 12px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-color-primary);
}

.chat-msg.user .msg-content {
  background: var(--color-primary);
  color: #fff;
  border-bottom-right-radius: 4px;
}

.chat-msg.assistant .msg-content {
  background: var(--bg-color-secondary);
  border-bottom-left-radius: 4px;
}

/* 思考动画 */
.thinking-dots {
  display: flex;
  gap: 4px;
  align-items: center;
  padding: 12px 16px;
}

.thinking-dots span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-color-tertiary);
  animation: dot-bounce 1.4s ease-in-out infinite;
}

.thinking-dots span:nth-child(2) { animation-delay: 0.2s; }
.thinking-dots span:nth-child(3) { animation-delay: 0.4s; }

@keyframes dot-bounce {
  0%, 80%, 100% { transform: scale(0.6); }
  40% { transform: scale(1); }
}

/* 输入区 */
.chat-input-area {
  flex-shrink: 0;
  padding: 10px 12px;
  border-top: 1px solid var(--border-color-light);
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

/* 动画 */
.chat-slide-enter-active { transition: all 0.3s ease; }
.chat-slide-leave-active { transition: all 0.2s ease; }
.chat-slide-enter-from { opacity: 0; transform: translateY(20px) scale(0.95); }
.chat-slide-leave-to { opacity: 0; transform: translateY(10px) scale(0.98); }

.msg-content :deep(strong) { color: var(--color-primary); }
.msg-content :deep(li) { margin-left: 14px; margin-bottom: 2px; }

/* 消息气泡包装 */
.msg-bubble {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow-wrap: anywhere;
}

.chat-header-actions { display: flex; align-items: center; gap: 8px; }
.chat-search-btn { padding: 4px 7px; border: 1px solid var(--border-color); border-radius: 12px; cursor: pointer; font-size: 11px; background: var(--bg-color); color: var(--text-color-secondary); }
.chat-search-btn.enabled { color: var(--color-primary); border-color: var(--color-primary); background: var(--color-primary-light); }
.chat-search-notice { flex-shrink: 0; margin: 0; padding: 7px 12px; color: var(--text-color-tertiary); font-size: 11px; line-height: 1.5; border-bottom: 1px solid var(--border-color-light); }
.chat-error { max-height: 70px; overflow-y: auto; flex-shrink: 0; color: var(--color-error); font-size: 12px; margin: 0; padding: 6px 12px; }
@media (max-width: 600px) {
  .ai-chat-wrapper { right: 16px; bottom: 16px; }
}

.msg-actions {
  display: flex;
  gap: 4px;
  margin-top: 6px;
}

.action-btn {
  font-size: 11px;
  padding: 2px 8px;
  border: 1px solid var(--border-color-light);
  border-radius: var(--radius-sm);
  background: var(--bg-color);
  color: var(--text-color-secondary);
  cursor: pointer;
  transition: all 0.2s;
}

.action-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--color-primary-light);
}
</style>
