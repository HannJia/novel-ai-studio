<template>
  <div class="model-search-test">
    <p class="search-protocol">{{ description }}<span v-if="!result"> · 尚未验证服务商能力</span></p>
    <div class="search-actions">
      <n-button size="small" :disabled="busy || !model.baseUrl.trim() || !model.modelName.trim() || !model.apiKey.trim()"
        :loading="busy" @click="confirmTest">
        <template #icon><n-icon><globe-outline /></n-icon></template>测试联网
      </n-button>
      <n-button v-if="busy" size="small" @click="stop">
        <template #icon><n-icon><stop-outline /></n-icon></template>停止测试
      </n-button>
      <n-button v-if="result" size="small" quaternary @click="copyDiagnostic">
        <template #icon><n-icon><copy-outline /></n-icon></template>复制诊断
      </n-button>
    </div>
    <p v-if="busy" class="search-result" role="status">正在请求搜索接口…</p>
    <div v-else-if="result" class="search-result" :class="`search-${result.status}`" role="status">
      <strong>{{ result.status === 'verified' ? '本次搜索已验证' : result.status === 'unverified' ? '搜索尚未验证' : '搜索测试失败' }}</strong>
      <p>{{ result.message }}</p>
      <time>{{ testedAt }}</time>
    </div>
    <p v-if="cancelled" class="search-result" role="status">测试已停止。</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { NButton, NIcon, useDialog, useMessage } from 'naive-ui'
import { GlobeOutline, StopOutline, CopyOutline } from '@vicons/ionicons5'
import type { ModelConfig } from '@/stores/config'
import { searchProtocolDescription, testChatSearch, type ChatSearchTestResult } from '@/services/chatSearch'

const props = defineProps<{ model: ModelConfig }>()
const dialog = useDialog()
const message = useMessage()
const busy = ref(false)
const cancelled = ref(false)
const result = ref<ChatSearchTestResult | null>(null)
const testedAt = ref('')
const description = computed(() => searchProtocolDescription(props.model))
let controller: AbortController | null = null

function stop() {
  controller?.abort()
  controller = null
  busy.value = false
  cancelled.value = true
}

function confirmTest() {
  if (busy.value) return
  const snapshot = { ...props.model }
  dialog.warning({
    title: '测试联网搜索？',
    content: '会向当前模型接口发送一次搜索测试请求，可能产生模型和搜索费用，不发送小说内容，不会自动改协议或重复测试。',
    positiveText: '开始测试', negativeText: '取消',
    onPositiveClick: () => {
      if (!busy.value && sameSettings(snapshot, props.model)) void run(snapshot)
    },
  })
}

function sameSettings(a: ModelConfig, b: ModelConfig) {
  return a.baseUrl === b.baseUrl && a.apiKey === b.apiKey && a.modelName === b.modelName
    && a.chatSearchProtocol === b.chatSearchProtocol && a.maxTokens === b.maxTokens
}

async function run(model: ModelConfig) {
  const request = new AbortController()
  controller = request
  busy.value = true
  cancelled.value = false
  result.value = null
  try {
    const response = await testChatSearch(model, request.signal)
    if (controller === request && !request.signal.aborted) {
      result.value = response
      testedAt.value = new Date().toLocaleString('zh-CN')
    }
  } catch {
    if (controller === request && !request.signal.aborted) {
      result.value = { status: 'failed', message: '测试未完成，请重试。', sourceCount: 0 }
    }
  } finally {
    if (controller === request) { controller = null; busy.value = false }
  }
}

async function copyDiagnostic() {
  if (!result.value) return
  const text = `${description.value}\n${testedAt.value}\n${result.value.message}`
  // Do not include the provider URL, key, manuscript, or raw response body.
  try { await navigator.clipboard.writeText(text); message.success('诊断已复制') }
  catch { message.error('复制失败，请选中诊断文字复制。') }
}

watch(() => ({ ...props.model }), (next, previous) => {
  if (!sameSettings(next, previous)) { stop(); result.value = null; cancelled.value = false }
})
onBeforeUnmount(stop)
</script>

<style scoped>
.model-search-test { display: grid; gap: 8px; min-width: 0; }
.search-protocol, .search-result { margin: 0; font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.search-protocol, time { color: var(--text-color-tertiary); }
.search-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.search-result { border-top: 1px solid var(--border-color-light); padding-top: 8px; }
.search-result p { margin: 4px 0; white-space: pre-wrap; }
.search-verified strong { color: var(--color-success); }
.search-failed strong { color: var(--color-error); }
.search-unverified strong { color: var(--color-warning); }
</style>
