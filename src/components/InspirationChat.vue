<template>
  <section class="inspiration-chat">
    <div class="inspiration-search-toolbar">
      <button class="inspiration-search-toggle" :class="{ enabled: webSearch }" :aria-pressed="webSearch"
        title="开启或关闭联网搜索，下条灵感消息生效" @click="webSearch = !webSearch">🌐 联网{{ webSearch ? '开' : '关' }}</button>
      <span>{{ webSearch ? '允许按需搜索近期事件和背景；查询词可能外发并额外计费。' : '未启用网页搜索；灵感对话仍需调用已配置 API。' }}</span>
      <n-select
        class="inspiration-session-select"
        :value="selectedSessionId"
        :options="sessionOptions"
        clearable
        placeholder="历史会话（最近 5 条）"
        aria-label="历史灵感会话"
        :disabled="busy"
        @update:value="loadSession"
      />
    </div>
    <div class="inspiration-knowledge-toolbar">
      <label for="inspiration-knowledge">参考知识库</label>
      <n-select id="inspiration-knowledge" v-model:value="knowledgeIds" multiple clearable
        :options="knowledgeOptions" :max-tag-count="1" :disabled="busy" placeholder="不读取知识库"
        aria-label="灵感参考知识库" />
      <n-button size="small" :disabled="busy" @click="openKnowledgeDraft('')">
        <template #icon><n-icon><add-outline /></n-icon></template>新建知识条目
      </n-button>
    </div>
    <aside v-if="latestPrompt" class="inspiration-sticky-prompt" aria-label="本轮问题">
      <div class="inspiration-sticky-header">
        <strong>本轮问题</strong>
        <div class="inspiration-sticky-actions">
          <button type="button" :aria-expanded="promptExpanded" aria-controls="inspiration-current-prompt"
            @click="promptExpanded = !promptExpanded">{{ promptExpanded ? '收起' : '展开' }}</button>
          <button type="button" @click="jumpToLatestPrompt">回看原消息</button>
        </div>
      </div>
      <p id="inspiration-current-prompt" class="inspiration-sticky-text" :class="{ expanded: promptExpanded }">{{ latestPrompt }}</p>
    </aside>
    <div ref="historyElement" class="inspiration-history" tabindex="0" aria-live="polite" aria-label="灵感对话">
      <article v-for="(item, index) in history" :key="index" :data-message-index="index"
        class="inspiration-message" :class="item.role">
        <strong>{{ item.role === 'user' ? '我' : 'AI' }}</strong>
        <div v-html="renderMd(item.role === 'assistant' ? formatChatReply(item.content, item.search) : item.content)"></div>
        <ChatSearchEvidence :record="item.search" />
        <n-button v-if="item.role === 'assistant'" size="tiny" quaternary :disabled="busy"
          @click="openKnowledgeDraft(item.content, item.search)">
          <template #icon><n-icon><save-outline /></n-icon></template>存入知识库
        </n-button>
      </article>
      <article v-if="streamText" data-streaming-assistant class="inspiration-message assistant">
        <strong>AI</strong><div v-html="renderMd(streamText)"></div>
      </article>
      <p v-else-if="busy" class="inspiration-progress" role="status">{{ extracting
        ? extractionProgress
        : requestWebSearch ? '正在请求联网回复，完成后显示回答和来源；开关修改下条生效…' : 'AI 正在回复…' }}</p>
    </div>
    <div class="inspiration-composer">
      <n-input v-model:value="input" type="textarea" :rows="3" :maxlength="4000" :disabled="busy"
        placeholder="我想写一个怎样的故事？" aria-label="小说灵感"
        @keydown="handleInputKeydown" @compositionstart="composing = true"
        @compositionend="composing = false" @blur="composing = false" />
      <p class="inspiration-input-hint">回车发送 · 上档键＋回车换行</p>
      <div v-if="error" role="alert" class="inspiration-error">{{ error }}</div>
      <div class="inspiration-actions">
        <n-button v-if="busy" @click="stop"><template #icon><n-icon><stop-outline /></n-icon></template>停止</n-button>
        <n-button v-else :disabled="!input.trim()" type="primary" @click="send">
          <template #icon><n-icon><send-outline /></n-icon></template>发送
        </n-button>
        <n-button v-if="retryAvailable && !busy" @click="respond">重试回复</n-button>
        <n-button :loading="extracting" :disabled="busy || !history.some(item => item.role === 'user')" @click="extract">
          <template #icon><n-icon><checkmark-outline /></n-icon></template>{{ extracting ? '整理中' : '整理设定并检查' }}
        </n-button>
      </div>
    </div>
    <SaveChatKnowledge :key="selectedSessionId || 'new'" v-model:show="showKnowledgeDraft" :content="knowledgeDraft" :preferred-ids="knowledgeIds"
      @saved="knowledgeSaved" />
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { NButton, NIcon, NInput, NSelect } from 'naive-ui'
import { AddOutline, CheckmarkOutline, SaveOutline, SendOutline, StopOutline } from '@vicons/ionicons5'
import { useConfigStore } from '@/stores/config'
import { useKnowledgeStore } from '@/stores/knowledge'
import { chatInspiration, extractInspirationSettings, type InspirationMessage } from '@/services/inspiration'
import type { CreateWizardForm } from '@/types/novel'
import { renderMd } from '@/utils/markdown'
import { formatChatReply } from '@/utils/chatPresentation'
import ChatSearchEvidence from '@/components/ChatSearchEvidence.vue'
import SaveChatKnowledge from '@/components/SaveChatKnowledge.vue'
import { knowledgeDraftWithSources } from '@/services/softwareAssistantContext'
import type { ChatSearchRecord } from '@/types/chat'
import { useInspirationSessionsStore } from '@/stores/inspirationSessions'
import type { InspirationSession } from '@/services/inspirationSessions'

const props = defineProps<{ form: CreateWizardForm; active: boolean }>()
const emit = defineEmits<{
  apply: [form: CreateWizardForm, history: InspirationMessage[]]
  'history-change': [history: InspirationMessage[]]
}>()
const config = useConfigStore()
const knowledge = useKnowledgeStore()
const sessionsStore = useInspirationSessionsStore()
const history = ref<InspirationMessage[]>([])
const savedSessions = computed(() => sessionsStore.sessions)
const selectedSessionId = ref<string | null>(null)
const historyElement = ref<HTMLElement | null>(null)
const input = ref('')
const selectedKnowledgeIds = ref<string[] | null>(null)
const knowledgeIds = computed<string[]>({
  get: () => selectedKnowledgeIds.value === null ? knowledge.knowledgeBases.map(base => base.id)
    : selectedKnowledgeIds.value.filter(id => knowledge.getKB(id)),
  set: ids => { selectedKnowledgeIds.value = ids || []; persistCurrentHistory() },
})
const knowledgeOptions = computed(() => knowledge.knowledgeBases.map(base => ({
  label: `${base.name}（${base.entries.length} 条）`, value: base.id,
})))
const showKnowledgeDraft = ref(false)
const knowledgeDraft = ref('')
const composing = ref(false)
const streamText = ref('')
const error = ref('')
const busy = ref(false)
const extracting = ref(false)
const extractionProgress = ref('正在整理设定…')
const conversationContext = ref<InspirationSession['context']>()
const webSearch = ref(false)
const requestWebSearch = ref(false)
const retryAvailable = computed(() => history.value[history.value.length - 1]?.role === 'user')
const promptExpanded = ref(false)
const latestPromptIndex = computed(() => {
  for (let index = history.value.length - 1; index >= 0; index--) {
    if (history.value[index].role === 'user') return index
  }
  return -1
})
const latestPrompt = computed(() => history.value[latestPromptIndex.value]?.content || '')
let controller: AbortController | null = null

let restoring = false

function cloneHistory(messages: InspirationMessage[]): InspirationMessage[] {
  return JSON.parse(JSON.stringify(messages)) as InspirationMessage[]
}

function sessionTitle(messages: InspirationMessage[]): string {
  const firstPrompt = messages.find(message => message.role === 'user')?.content.trim() || '未命名灵感会话'
  return firstPrompt.replace(/\s+/g, ' ').slice(0, 42)
}

function sessionTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const sessionOptions = computed(() => savedSessions.value.map(session => ({
  label: `${session.title}（${session.messages.length} 条消息） · ${sessionTime(session.updatedAt)}`,
  value: session.id,
})))

if (savedSessions.value[0]) {
  selectedSessionId.value = savedSessions.value[0].id
  history.value = cloneHistory(savedSessions.value[0].messages)
  selectedKnowledgeIds.value = Array.isArray(savedSessions.value[0].knowledgeIds)
    ? savedSessions.value[0].knowledgeIds!.filter(id => typeof id === 'string') : null
  input.value = savedSessions.value[0].draft
  webSearch.value = savedSessions.value[0].webSearch
  conversationContext.value = savedSessions.value[0].context
}

function persistCurrentHistory() {
  if (restoring || !sessionsStore.initialized || (!history.value.some(message => message.role === 'user') && !input.value.trim())) return
  const id = selectedSessionId.value || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  selectedSessionId.value = id
  const next: InspirationSession = {
    id,
    title: history.value.length ? sessionTitle(history.value) : input.value.trim().slice(0, 42),
    updatedAt: new Date().toISOString(),
    messages: cloneHistory(history.value),
    knowledgeIds: selectedKnowledgeIds.value === null ? null : [...selectedKnowledgeIds.value],
    draft: input.value,
    webSearch: webSearch.value,
    context: conversationContext.value,
  }
  const previous = savedSessions.value.find(session => session.id === id)
  if (previous && JSON.stringify({ ...previous, updatedAt: '' }) === JSON.stringify({ ...next, updatedAt: '' })) return
  sessionsStore.upsert(next)
}

function loadSession(id: string | null) {
  persistCurrentHistory()
  restoring = true
  try {
  stop()
  showKnowledgeDraft.value = false
  if (!id) {
    selectedSessionId.value = null
    history.value = []
    input.value = ''
    error.value = ''
    selectedKnowledgeIds.value = null
    conversationContext.value = undefined
    webSearch.value = false
    return
  }
  const session = savedSessions.value.find(item => item.id === id)
  if (!session) return
  selectedSessionId.value = session.id
  history.value = cloneHistory(session.messages)
  selectedKnowledgeIds.value = Array.isArray(session.knowledgeIds) ? session.knowledgeIds.filter(id => typeof id === 'string') : null
  input.value = session.draft
  webSearch.value = session.webSearch
  conversationContext.value = session.context
  error.value = ''
  void nextTick(() => {
    if (historyElement.value) historyElement.value.scrollTop = historyElement.value.scrollHeight
  })
  } finally { restoring = false }
}

function openKnowledgeDraft(content: string, search?: ChatSearchRecord) {
  knowledgeDraft.value = knowledgeDraftWithSources(content, search)
  showKnowledgeDraft.value = true
}

function knowledgeSaved(result: { kbId: string; kbName: string; title: string }) {
  if (selectedKnowledgeIds.value && !selectedKnowledgeIds.value.includes(result.kbId)) {
    selectedKnowledgeIds.value = [...selectedKnowledgeIds.value, result.kbId]
  }
  history.value.push({ role: 'assistant', content: `【软件保存回执】已保存到知识库“${result.kbName}”，条目“${result.title}”。` })
  persistCurrentHistory()
}

function scrollMessageToStart(target: HTMLElement | null) {
  const container = historyElement.value
  if (!container || !target) return
  // offsetTop may refer to a different positioned ancestor. Use scrollport
  // geometry; the current prompt is outside this scrollport and cannot cover it.
  container.scrollTop = Math.max(0, container.scrollTop + target.getBoundingClientRect().top
    - container.getBoundingClientRect().top - container.clientTop - 12)
}

function jumpToLatestPrompt() {
  const container = historyElement.value
  scrollMessageToStart(container?.querySelector<HTMLElement>(`[data-message-index="${latestPromptIndex.value}"]`) || null)
}

async function scrollToReplyStart(request: AbortController, replyIndex: number) {
  await nextTick()
  if (controller !== request || request.signal.aborted || !props.active) return
  const container = historyElement.value
  scrollMessageToStart(container?.querySelector<HTMLElement>(
    `[data-message-index="${replyIndex}"], [data-streaming-assistant], .inspiration-progress`,
  ) || null)
}

function stop() {
  controller?.abort()
  controller = null
  busy.value = false
  extracting.value = false
  streamText.value = ''
}
function handleInputKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
  // IME Enter confirms the selected character, not the whole chat message.
  if (event.isComposing || composing.value || event.keyCode === 229) return
  event.preventDefault()
  if (!event.repeat) send()
}
function send() {
  if (!props.active || busy.value || !input.value.trim()) return
  const content = input.value.trim()
  history.value.push({ role: 'user', content })
  persistCurrentHistory()
  promptExpanded.value = false
  input.value = ''
  void respond()
}
async function respond() {
  if (busy.value) return
  const model = config.getModelForTask('chat')
  if (!model?.apiKey.trim()) { error.value = '请先在设置中配置对话 / 联网模型（默认跟随大纲模型）及有效接口密钥，再重试回复'; return }
  const request = new AbortController()
  controller = request
  busy.value = true
  error.value = ''
  streamText.value = ''
  requestWebSearch.value = webSearch.value
  const replyIndex = history.value.length
  let startedStreaming = false
  void scrollToReplyStart(request, replyIndex)
  try {
    const snapshot = JSON.parse(JSON.stringify(history.value)) as InspirationMessage[]
    const result = await chatInspiration({ ...model }, snapshot, request.signal, chunk => {
      if (controller === request && !request.signal.aborted) {
        streamText.value += chunk
        if (!startedStreaming && streamText.value) {
          startedStreaming = true
          void scrollToReplyStart(request, replyIndex)
        }
      }
    }, requestWebSearch.value, [...knowledgeIds.value], conversationContext.value)
    if (controller === request && !request.signal.aborted && props.active) {
      history.value.push({ role: 'assistant', ...result })
      persistCurrentHistory()
      streamText.value = ''
      await scrollToReplyStart(request, replyIndex)
    }
  } catch (err) {
    if (controller === request && !request.signal.aborted) error.value = err instanceof Error ? err.message : '对话失败'
  } finally {
    if (controller === request) stop()
  }
}
async function extract() {
  if (busy.value) return
  const model = config.getModelForTask('outline')
  if (!model?.apiKey.trim()) { error.value = '请先在设置中配置大纲模型及有效接口密钥。'; return }
  const request = new AbortController()
  controller = request
  busy.value = extracting.value = true
  error.value = ''
  extractionProgress.value = '正在整理设定…'
  void scrollToReplyStart(request, history.value.length)
  try {
    const base = JSON.parse(JSON.stringify(props.form)) as CreateWizardForm
    const snapshot = JSON.parse(JSON.stringify(history.value)) as InspirationMessage[]
    const form = await extractInspirationSettings({ ...model }, snapshot, base, request.signal, (completed, total) => {
      if (controller === request) extractionProgress.value = `正在整理设定：已完成 ${completed}/${total} 批…`
    })
    if (controller === request && !request.signal.aborted && props.active) {
      conversationContext.value = { content: JSON.stringify(form), messageCount: snapshot.length }
      persistCurrentHistory()
      emit('apply', form, snapshot)
    }
  } catch (err) {
    if (controller === request && !request.signal.aborted) error.value = err instanceof Error ? err.message : '整理失败'
  } finally {
    if (controller === request) stop()
  }
}
watch(() => props.active, active => { if (!active) { stop(); showKnowledgeDraft.value = false } })
watch(history, value => emit('history-change', cloneHistory(value)), { deep: true, immediate: true })
watch([input, webSearch], persistCurrentHistory, { flush: 'sync' })
onBeforeUnmount(() => { persistCurrentHistory(); stop() })
</script>

<style scoped>
.inspiration-chat { display: flex; flex-direction: column; flex: 1; min-height: 0; max-width: 960px; width: 100%; margin: 0 auto; }
.inspiration-search-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 8px 0; flex-shrink: 0; color: var(--text-color-tertiary); font-size: 12px; }
.inspiration-session-select { margin-left: auto; width: min(300px, 100%); }
.inspiration-knowledge-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding-bottom: 8px; flex-shrink: 0; }
.inspiration-knowledge-toolbar label { font-size: 12px; color: var(--text-color-secondary); }
.inspiration-knowledge-toolbar :deep(.n-select) { flex: 1 1 220px; min-width: 0; }
.inspiration-search-toggle { cursor: pointer; flex-shrink: 0; border: 1px solid var(--border-color); border-radius: 12px; padding: 4px 10px; background: var(--bg-color); color: var(--text-color-secondary); }
.inspiration-search-toggle.enabled { color: var(--color-primary); border-color: var(--color-primary); background: var(--color-primary-light); }
.inspiration-progress { color: var(--text-color-tertiary); font-size: 12px; line-height: 1.6; }
.inspiration-history { flex: 1; min-height: 80px; overflow-y: auto; padding: 12px 4px; overscroll-behavior: contain; overflow-anchor: none; }
.inspiration-sticky-prompt { flex: 0 0 auto; margin-bottom: 8px; padding: 8px 12px;
  border: 1px solid var(--border-color); border-left: 3px solid var(--color-primary); border-radius: 10px;
  background: var(--bg-color-card); color: var(--text-color-primary); }
.inspiration-sticky-header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 4px; font-size: 12px; }
.inspiration-sticky-header strong { color: var(--color-primary); }
.inspiration-sticky-actions { display: flex; gap: 10px; }
.inspiration-sticky-actions button { border: 0; background: transparent; color: var(--color-primary); cursor: pointer; font: inherit; padding: 2px; }
.inspiration-sticky-text { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;
  overflow: hidden; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; line-height: 1.6; }
.inspiration-sticky-text.expanded { display: block; max-height: min(100px, 12vh); overflow-y: auto; overscroll-behavior: contain; }
.inspiration-message { width: fit-content; min-width: 0; max-width: 88%; padding: 14px 16px; margin: 10px 0;
  border: 1px solid var(--border-color-light); border-radius: 14px; overflow-wrap: anywhere; }
.inspiration-message > strong { display: block; margin-bottom: 4px; color: var(--text-color-secondary); font-size: 12px; }
.inspiration-message > div { line-height: 1.8; font-size: 14px; overflow-x: auto; }
.inspiration-message.user { margin-left: auto; background: var(--color-primary-light); border-color: color-mix(in srgb, var(--color-primary) 35%, var(--border-color-light)); }
.inspiration-message.user > strong { color: var(--color-primary); text-align: right; }
.inspiration-message.user > div { text-align: left; }
.inspiration-message.assistant { margin-right: auto; max-width: 94%; background: var(--bg-color-card); }
.inspiration-message :deep(p + p) { margin-top: 10px; }
.inspiration-message :deep(ul), .inspiration-message :deep(ol) { padding-left: 22px; }
.inspiration-composer { flex: 0 0 auto; padding: 12px 0; border-top: 1px solid var(--border-color-light); }
.inspiration-input-hint { margin: 6px 0 0; color: var(--text-color-tertiary); font-size: 12px; line-height: 1.5; }
.inspiration-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.inspiration-error { color: var(--color-error); margin-top: 8px; overflow-wrap: anywhere; }
@media (max-width: 600px) {
  .inspiration-message { padding: 10px 12px; }
  .inspiration-sticky-prompt { padding: 6px 10px; }
}
</style>
