<template>
  <div class="book-chat" id="ai-chat-assistant">

      <div id="ai-chat-window" class="chat-window paper-panel" role="region" aria-label="AI 对话助手">
        <div class="chat-header">
          <div class="chat-header-actions">
            <button class="chat-search-btn" :class="{ enabled: webSearch }" :aria-pressed="webSearch"
              :title="webSearch ? '关闭联网搜索（下条消息生效）' : '开启联网搜索（下条消息生效）'"
              @click="toggleSearch">联网{{ webSearch ? '开' : '关' }}</button>
            <button class="chat-icon-btn" :disabled="thinking" @click="clearHistory" :title="thinking ? '请先停止请求再清空记录' : '清空记录'">清空</button>
          </div>
        </div>

        <p class="chat-search-notice">{{ webSearch
          ? '允许按需搜索；查询词可能交给服务商的搜索服务并额外计费。不支持时会提示。'
          : '未启用网页搜索；AI 对话仍需调用已配置 API。' }}{{ thinking ? ' 开关修改下条生效，切换案头标签不会停止当前请求。' : '' }}</p>
        <div class="chat-messages" ref="messagesRef">
          <!-- 欢迎消息 -->
          <div v-if="messages.length === 0" class="chat-welcome">
            <p>我是本书的写作助手</p>
            <p class="chat-hint">这里是独立的书内对话。创建前的讨论保存在典籍的「灵感记录」，已确认设定仍会作为参考。</p>
            <p class="chat-hint">你可以问我关于小说的任何问题，比如：</p>
            <div class="quick-actions">
              <button @click="quickAsk('帮我分析一下当前的剧情走向')">分析剧情</button>
              <button @click="quickAsk('给我一些关于下一章的写作建议')">写作建议</button>
              <button @click="quickAsk('帮我检查人物性格是否一致')">角色一致性</button>
              <button @click="quickAsk('当前有哪些全书规划需要推进或收束')">全书规划</button>
              <button @click="crossChapterAnalysis">跨章节分析</button>
              <button @click="wholeBookAnalysis">全书评估</button>
            </div>
          </div>

          <!-- 消息列表 -->
          <div
            v-for="msg in messages"
            :key="msg.id"
            class="chat-msg"
            :class="msg.role"
          >
            <div class="msg-avatar">{{ msg.role === 'user' ? '我' : 'AI' }}</div>
            <div class="msg-bubble">
              <div class="msg-content" v-html="renderMd(msg.role === 'assistant' ? formatChatReply(msg.content, msg.search) : msg.content)"></div>
              <ChatSearchEvidence :record="msg.search" />
              <div v-if="msg.role === 'assistant' && !msg.failed" class="msg-actions">
                <button class="action-btn" @click="copyContent(formatChatReply(msg.content, msg.search))" title="复制内容">
                  复制
                </button>
                <n-button size="tiny" quaternary :disabled="thinking" @click="openKnowledgeDraft(msg.content, msg.search)">
                  <template #icon><n-icon><save-outline /></n-icon></template>存入知识库
                </n-button>
              </div>
            </div>
          </div>

          <!-- AI 正在思考 -->
          <div v-if="thinking" class="chat-msg assistant">
            <div class="msg-avatar">AI</div>
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
            @keydown.enter.ctrl="handleSendKeydown"
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
    <SaveChatKnowledge :key="novelId" v-model:show="showKnowledgeDraft" :content="knowledgeDraft"
      :preferred-ids="novel?.knowledgeBaseIds || []" @saved="knowledgeSaved" />
  </div>
</template>

<script setup lang="ts">
import { getCurrentChapterSummary } from '@/services/derivedSources'
import { ref, nextTick, watch } from 'vue'
import { NButton, NIcon, NInput, useDialog } from 'naive-ui'
import { SaveOutline } from '@vicons/ionicons5'
import { useAssistantChat } from '@/composables/useAssistantChat'
import { useNovelStore } from '@/stores/novel'
import SaveChatKnowledge from '@/components/SaveChatKnowledge.vue'
import { knowledgeDraftWithSources } from '@/services/softwareAssistantContext'
import type { ChatSearchRecord } from '@/types/chat'
import ChatSearchEvidence from '@/components/ChatSearchEvidence.vue'
import { renderMd } from '@/utils/markdown'
import { formatChatReply } from '@/utils/chatPresentation'

const props = defineProps<{
  novelId: string
  chapterId?: string
  prefill?: string
  prefillVersion?: number
}>()

const dialog = useDialog()
const store = useNovelStore()
const { novel, messages, webSearch, inputText, thinking, streamText, error, sendMessage, stop, toggleSearch, clear, quickAsk } = useAssistantChat(() => props.novelId, () => props.chapterId || '')

const messagesRef = ref<HTMLDivElement | null>(null)
const showKnowledgeDraft = ref(false)
const knowledgeDraft = ref('')

function openKnowledgeDraft(content: string, search?: ChatSearchRecord) {
  knowledgeDraft.value = knowledgeDraftWithSources(content, search)
  showKnowledgeDraft.value = true
}

function knowledgeSaved(result: { kbName: string; title: string }) {
  store.addChatMessage(props.novelId, { id: crypto.randomUUID(), role: 'assistant',
    content: `【软件保存回执】已保存到知识库“${result.kbName}”，条目“${result.title}”。本书的挂载范围未改变。`,
    timestamp: new Date().toISOString() })
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
function handleSendKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return
  event.preventDefault()
  void sendMessage()
}

watch(() => [messages.value.length, streamText.value, thinking.value], scrollToBottom)
watch(() => props.novelId, () => { showKnowledgeDraft.value = false })
watch([() => props.prefill, () => props.prefillVersion], (values, previousValues) => {
  const value = values[0]
  const previous = previousValues?.[0]
  if (value) inputText.value = value
  else if (previous && inputText.value === previous) inputText.value = ''
}, { immediate: true })

// 跨章节分析
function crossChapterAnalysis() {
  if (!novel.value) return
  const chapSummaries = novel.value.chapters
    .filter(c => getCurrentChapterSummary(c))
    .map(c => `第${c.chapterIndex + 1}章《${c.title}》: ${getCurrentChapterSummary(c).substring(0, 100)}`)
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

/* 浮动按钮 */

/* 聊天窗口 */
.chat-window {
  position: absolute;
  bottom: 64px;
  right: 0;
  width: min(440px, calc(100vw - 24px));
  max-width: calc(100vw - 24px);
  height: min(640px, calc(100dvh - 110px));
  display: flex;
  flex-direction: column;
  border-radius: var(--r-l);
  box-shadow: var(--shadow-3);
  overflow: hidden;
}
@keyframes busy-pulse { 50% { box-shadow: 0 0 0 5px var(--zhu-soft); } }

.chat-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--line);
}

.chat-header h3 {
  font-size: 15px;
  font-weight: 600;
  color: var(--ink);
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
  background: var(--panel);
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
  color: var(--ink-3);
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
  border: 1px solid var(--line);
  border-radius: var(--r-s);
  background: var(--desk);
  color: var(--ink-2);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.quick-actions button:hover {
  border-color: var(--zhu);
  color: var(--zhu);
}

/* 消息气泡 */
.chat-msg {
  display: flex;
  gap: 10px;
  max-width: 88%;
}

.chat-msg.user {
  align-self: flex-end;
  flex-direction: row-reverse;
}

.msg-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  flex-shrink: 0;
  background: var(--panel);
  color: var(--ink-2);
}

.chat-msg.user .msg-avatar {
  background: var(--zhu-soft);
  color: var(--zhu);
}

.chat-msg.assistant .msg-avatar {
  background: var(--dai-soft);
  color: var(--dai);
}

.msg-content {
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.7;
  color: var(--ink);
}

.chat-msg.user .msg-content {
  background: var(--zhu);
  color: #fff;
  border-bottom-right-radius: 4px;
}

.chat-msg.assistant .msg-content {
  background: var(--paper);
  border: 1px solid var(--line);
  border-left: 3px solid var(--dai);
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
  background: var(--ink-3);
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
  border-top: 1px solid var(--line);
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

/* 动画 */

.msg-content :deep(strong) { color: var(--zhu); }
.msg-content :deep(li) { margin-left: 14px; margin-bottom: 2px; }

/* 消息气泡包装 */
.msg-bubble {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow-wrap: anywhere;
}

.chat-header-actions { display: flex; align-items: center; gap: 8px; }
.chat-search-btn { padding: 4px 7px; border: 1px solid var(--line-2); border-radius: 12px; cursor: pointer; font-size: 11px; background: var(--desk); color: var(--ink-2); }
.chat-search-btn.enabled { color: var(--zhu); border-color: var(--zhu); background: var(--zhu-soft); }
.chat-search-notice { flex-shrink: 0; margin: 0; padding: 7px 12px; color: var(--ink-3); font-size: 11px; line-height: 1.5; border-bottom: 1px solid var(--line); }
.chat-error { max-height: 70px; overflow-y: auto; flex-shrink: 0; color: var(--zhu); font-size: 12px; margin: 0; padding: 6px 12px; }
@media (max-width: 600px) {
  .book-chat { right: 16px; bottom: 16px; }
}

.msg-actions {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-top: 6px;
}

.action-btn {
  font-size: 11px;
  padding: 2px 8px;
  border: 1px solid var(--line);
  border-radius: var(--r-s);
  background: var(--desk);
  color: var(--ink-2);
  cursor: pointer;
  transition: all 0.2s;
}

.action-btn:hover {
  border-color: var(--zhu);
  color: var(--zhu);
  background: var(--zhu-soft);
}
.book-chat {
  right: 24px;
  bottom: 24px; position: static; inset: auto; z-index: auto; width: 100%; height: 100%; min-height: 0; }
.book-chat .chat-window { position: static; inset: auto; width: 100%; max-width: none; height: 100%; max-height: none; border: 0; border-radius: 0; box-shadow: none; }
.book-chat .chat-messages { min-height: 0; }
.book-chat .chat-header { justify-content: flex-end; padding: 10px 16px; }
.book-chat .chat-input-area { padding: 12px; }

</style>
