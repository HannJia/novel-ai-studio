<template>
  <aside class="explore" aria-label="探索对话">
    <header><h3>探索对话</h3><span>第 {{ turnCount }} 轮</span></header>
    <div class="messages" aria-live="polite">
      <p v-if="!state.messages.length" class="empty">补充你的想法，或让 AI 从类型、主角和冲突开始追问。建议可以逐卡采用，再由你确认。</p>
      <article v-for="item in state.messages" :key="item.id" :class="item.role">
        <b>{{ item.role === 'user' ? '你' : '策划搭档' }}</b>
        <p>{{ item.reply || (item.status === 'running' ? '正在整理建议…' : item.content || '本轮没有返回可用内容') }}</p>
        <small v-if="!['completed', 'running'].includes(item.status)">本轮{{ item.status === 'failed' ? '失败' : item.status === 'interrupted' ? '中断' : '未完整完成' }}，输出已保留</small>
        <div v-if="item.status === 'completed'" class="suggestions">
          <details v-for="(suggestion, index) in item.suggestions || []" :key="index">
            <summary>{{ cardTitle(suggestion.cardId) }}草案</summary>
            <p v-for="(value, key) in suggestion.values" :key="key">{{ Array.isArray(value) ? value.join('、') : value }}</p>
            <button type="button" :disabled="disabled || busy" @click="emit('adopt', suggestion)">采用到卡片，等待确认</button>
          </details>
        </div>
      </article>
    </div>
    <p v-if="errorText" class="error" role="alert">{{ errorText }}</p>
    <form @submit.prevent="send">
      <textarea aria-label="探索对话输入" :value="state.input" :disabled="disabled || busy" rows="3" placeholder="继续补充，或让 AI 追问……" @input="setInput(($event.target as HTMLTextAreaElement).value)"></textarea>
      <button v-if="busy" type="button" @click="controller?.abort()">停止并保留输出</button>
      <button v-else type="submit" :disabled="disabled || !state.input.trim()">发送</button>
    </form>
  </aside>
</template>
<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useConfigStore } from '@/stores/config'
import { callAI } from '@/services/ai'
import { safeAiErrorMessage } from '@/services/aiDiagnostics'
import { contractCards, contractExplorationMessages, parseContractExploration } from '@/services/storyContract'
import type { ContractExploration, ContractSuggestion, StoryContract } from '@/types/reconstruction'

const props = defineProps<{ contract: StoryContract; exploration?: ContractExploration; disabled?: boolean; flush?: () => Promise<void> }>()
const emit = defineEmits<{ change: [value: ContractExploration]; busy: [value: boolean]; adopt: [suggestion: ContractSuggestion] }>()
const copy = (value: ContractExploration): ContractExploration => JSON.parse(JSON.stringify(value))
const state = ref(copy(props.exploration || { input: '', messages: [] }))
watch(() => props.exploration, value => {
  if (value && JSON.stringify(value) !== JSON.stringify(state.value)) state.value = copy(value)
})
const config = useConfigStore()
const busy = ref(false)
const errorText = ref('')
const turnCount = computed(() => state.value.messages.filter(item => item.role === 'user').length)
const cardTitle = (id: string) => contractCards.find(card => card.id === id)?.title || '契约'
let controller: AbortController | undefined
let disposed = false
function publish() { emit('change', copy(state.value)) }
function setInput(value: string) { state.value.input = value; publish() }
async function send() {
  if (busy.value || props.disabled || !state.value.input.trim()) return
  const model = config.getModelForTask('chat')
  if (!model) { errorText.value = '请先在设置中配置对话模型'; return }
  const baseline: StoryContract = JSON.parse(JSON.stringify(props.contract))
  const previous = copy(state.value)
  state.value.messages.push({ id: crypto.randomUUID(), role: 'user', content: state.value.input.trim(), status: 'completed' })
  let messages
  try { messages = contractExplorationMessages(baseline, state.value) }
  catch (error) { state.value = previous; errorText.value = safeAiErrorMessage(error); return }
  const assistant: ContractExploration['messages'][number] = { id: crypto.randomUUID(), role: 'assistant', content: '', status: 'running' }
  state.value.messages.push(assistant)
  const output = () => state.value.messages.find(item => item.id === assistant.id)!
  state.value.input = ''
  busy.value = true; emit('busy', true); errorText.value = ''
  const requestController = new AbortController()
  controller = requestController
  let lastCheckpoint = 0
  publish()
  try {
    await props.flush?.()
    requestController.signal.throwIfAborted()
    const response = await callAI({ model: { ...model }, messages, signal: requestController.signal, taskName: '作品契约探索', noAutomaticRetry: true,
      onChunk: chunk => {
        output().content += chunk
        if (Date.now() - lastCheckpoint > 600) { publish(); lastCheckpoint = Date.now() }
      } })
    requestController.signal.throwIfAborted()
    output().content = response.content
    if (response.finishReason && response.finishReason !== 'stop') throw new Error('探索输出未完整结束，请检查已保留的内容后重试')
    const parsed = parseContractExploration(response.content, baseline)
    Object.assign(output(), parsed, { status: 'completed' })
  } catch (error) {
    output().status = requestController.signal.aborted ? 'interrupted' : output().content ? 'partial' : 'failed'
    errorText.value = safeAiErrorMessage(error, [model.apiKey])
  } finally {
    publish()
    try { await props.flush?.() } catch { errorText.value = '探索记录尚未保存，请使用页面的重试保存操作' }
    busy.value = false
    emit('busy', false)
    if (disposed) controller = undefined
  }
}
onUnmounted(() => { disposed = true; controller?.abort() })
</script>
<style scoped>
.explore { display: flex; flex-direction: column; min-width: 0; height: 560px; overflow: hidden; border: 1px solid var(--line); border-radius: 10px; background: var(--paper); }
header { display: flex; align-items: center; justify-content: space-between; padding: 16px; border-bottom: 1px solid var(--line); }
h3 { margin: 0; font: 600 15px var(--f-serif); }
header span { color: var(--ink-3); font-size: 11px; }
.messages { flex: 1; min-height: 0; padding: 16px; overflow: auto; }
.empty { color: var(--ink-3); font-size: 12px; line-height: 1.8; }
article { margin-bottom: 14px; padding: 10px 12px; border-radius: 8px; background: var(--panel); font-size: 12px; line-height: 1.8; overflow-wrap: anywhere; }
article.user { margin-left: 24px; background: color-mix(in srgb, var(--zhu) 6%, var(--paper)); }
article b { color: var(--ink-3); font-size: 10px; font-weight: 500; }
article p { margin: 4px 0; white-space: pre-wrap; }
small, .error { color: var(--jin); font-size: 11px; }
.error { padding: 0 16px; }
details { margin-top: 8px; padding-top: 6px; border-top: 1px solid var(--line); }
summary { color: var(--zhu); cursor: pointer; }
form { display: flex; align-items: flex-end; gap: 8px; padding: 12px; border-top: 1px solid var(--line); }
textarea { flex: 1; min-width: 0; resize: vertical; box-sizing: border-box; padding: 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--ink); font-family: inherit; font-size: 12px; line-height: 1.7; }
button { flex-shrink: 0; padding: 6px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--zhu); font-family: inherit; font-size: 11px; cursor: pointer; }
button:disabled { opacity: .5; cursor: not-allowed; }
@media (max-width: 1100px) { .explore { height: 360px; } }
</style>
