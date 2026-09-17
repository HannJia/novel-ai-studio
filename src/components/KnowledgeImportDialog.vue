<template>
  <n-modal :show="show" preset="card" title="导入知识库内容" class="knowledge-import-dialog"
    style="width: min(620px, calc(100vw - 32px));" :closable="!importing" :mask-closable="!reading && !importing"
    @update:show="close">
    <div class="import-fields">
      <label>分类</label>
      <n-select v-model:value="category" :options="kbCategories" :disabled="importing || Boolean(pendingIds)" />
      <label>上传文件（最多 100 MB；支持 .txt / .md / .docx / .epub / .pdf）</label>
      <div class="file-row">
        <input ref="fileInput" type="file" accept=".txt,.md,.markdown,.docx,.epub,.pdf" hidden @change="chooseFile" />
        <n-button :disabled="reading || importing || Boolean(pendingIds)" @click="fileInput?.click()">
          <template #icon><n-icon><document-attach-outline /></n-icon></template>选择文件
        </n-button>
        <span class="file-name">{{ file?.name || '未选择文件' }}</span>
      </div>
      <template v-if="isPdf">
        <label>PDF 读取方式</label>
        <n-select v-model:value="mode" :options="modeOptions" :disabled="reading || importing || Boolean(pendingIds)" @update:value="resetPreview" />
        <label>视觉识别模型</label>
        <n-select v-model:value="modelId" :options="modelOptions" :disabled="reading || importing" placeholder="选择已配置的模型" />
        <p class="import-notice">需要识别的页面图片将发送给所选模型服务商，可能产生费用。文字识别结果可能有误，请核对数字、日期和专有名词。</p>
        <div class="file-row">
          <n-button v-if="reading" @click="pause"><template #icon><n-icon><pause-outline /></n-icon></template>暂停识别</n-button>
          <n-button v-else :disabled="importing || Boolean(pendingIds) || complete" @click="readFile">
            <template #icon><n-icon><play-outline /></n-icon></template>{{ attempted ? '继续识别' : '开始读取' }}
          </n-button>
          <span v-if="progress" class="import-progress" role="status">
            {{ progressText }}{{ progress.cached ? `，复用 ${progress.cached} 页` : '' }}
          </span>
        </div>
        <n-progress v-if="progress?.total" type="line" :percentage="Math.floor(progress.completed / progress.total * 100)" :show-indicator="false" />
        <p v-if="paused" class="import-notice">已暂停，已完成页保留在本机。重新打开软件后，选择同一文件和读取方式即可继续。</p>
      </template>
      <p v-else-if="reading" role="status">正在读取文件...</p>
      <p v-if="error" class="import-error" role="alert">{{ error }}</p>
      <label>文本预览</label>
      <n-input v-model:value="text" type="textarea" :rows="8" :disabled="reading || importing || Boolean(pendingIds)"
        placeholder="粘贴内容或上传文件..." />
      <n-checkbox v-model:checked="summarize" :disabled="importing">导入后自动整理条目摘要</n-checkbox>
    </div>
    <template #action>
      <div class="import-actions">
        <n-button :disabled="importing" @click="close(false)">{{ reading ? '暂停并关闭' : '取消' }}</n-button>
        <n-button type="primary" :loading="importing" :disabled="reading || (!pendingIds && !text.trim())" @click="importText">
          <template #icon><n-icon><save-outline /></n-icon></template>{{ pendingIds ? '重试保存' : '确认导入' }}
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { NButton, NCheckbox, NIcon, NInput, NModal, NProgress, NSelect } from 'naive-ui'
import { DocumentAttachOutline, PauseOutline, PlayOutline, SaveOutline } from '@vicons/ionicons5'
import { kbCategories, useKnowledgeStore } from '@/stores/knowledge'
import { useConfigStore } from '@/stores/config'
import { KNOWLEDGE_IMPORT_LIMITS, readKnowledgeFile } from '@/services/knowledgeImport'
import type { PdfReadMode, PdfReadProgress } from '@/services/knowledgePdf'
import { finishAiActivity, startAiActivity } from '@/services/aiActivity'

const props = defineProps<{ show: boolean; kbId: string }>()
const emit = defineEmits<{ 'update:show': [value: boolean]; imported: [result: { kbId: string; entryIds: string[]; summarize: boolean }] }>()
const store = useKnowledgeStore()
const config = useConfigStore()
const fileInput = ref<HTMLInputElement | null>(null)
const file = shallowRef<File | null>(null)
const text = ref('')
const category = ref('其他')
const mode = ref<PdfReadMode>('auto')
const modelId = ref<string | null>(null)
const reading = ref(false)
const importing = ref(false)
const complete = ref(false)
const attempted = ref(false)
const paused = ref(false)
const summarize = ref(true)
const error = ref('')
const progress = ref<PdfReadProgress | null>(null)
const pendingIds = ref<string[] | null>(null)
let controller: AbortController | undefined
let active = true
const isPdf = computed(() => file.value?.name.toLowerCase().endsWith('.pdf'))
const modelOptions = computed(() => config.models.map(model => ({ label: model.name || model.modelName, value: model.id })))
const modeOptions = [{ label: '自动：优先文字层，扫描页使用视觉识别', value: 'auto' },
  { label: '全部页面使用视觉识别（适合文字层错误或不完整）', value: 'vision' }]
const progressText = computed(() => {
  const value = progress.value
  if (!value || value.phase === 'opening') return '正在检查文件和本机缓存'
  if (value.phase === 'complete') return `读取完成，共 ${value.total} 页`
  return `${value.phase === 'recognizing' ? '正在识别' : '正在读取'}第 ${value.page} / ${value.total} 页，已完成 ${value.completed} 页`
})

function pause() { controller?.abort(); paused.value = reading.value }
function close(show: boolean) {
  if (importing.value) return
  if (!show) pause()
  emit('update:show', show)
}
function resetPreview() {
  text.value = ''; complete.value = false; progress.value = null; attempted.value = false; error.value = ''; paused.value = false
}
watch(() => props.show, show => {
  if (!show) pause()
  else if (!config.models.some(model => model.id === modelId.value)) modelId.value = config.getModelForTask('chat')?.id || null
}, { immediate: true })
watch(() => props.kbId, () => { pause(); file.value = null; pendingIds.value = null; resetPreview() })
onBeforeUnmount(() => { active = false; pause() })

async function chooseFile(event: Event) {
  const input = event.target as HTMLInputElement
  const selected = input.files?.[0]
  input.value = ''
  if (!selected || reading.value || importing.value) return
  resetPreview()
  file.value = null
  if (selected.size > KNOWLEDGE_IMPORT_LIMITS.fileBytes) { error.value = '文件超过 100 MB，请拆分后导入。'; return }
  file.value = selected
  if (!isPdf.value) await readFile()
}

async function readFile() {
  const source = file.value
  if (!source || reading.value || importing.value) return
  const request = new AbortController()
  controller = request
  reading.value = true
  attempted.value = true
  paused.value = false
  error.value = ''
  text.value = ''
  complete.value = false
  const selectedModel = config.models.find(model => model.id === modelId.value)
  let activity: ReturnType<typeof startAiActivity> | undefined
  try {
    activity = startAiActivity(isPdf.value ? 'PDF 资料读取与识别' : '知识库文件读取')
    const result = await readKnowledgeFile(source, {
      model: selectedModel ? { ...selectedModel } : undefined, mode: mode.value, signal: request.signal,
      activityParentId: activity.id,
      onProgress: value => { if (!request.signal.aborted) progress.value = value },
    })
    request.signal.throwIfAborted()
    if (!active || source !== file.value) return
    text.value = result
    complete.value = true
    if (!result.trim()) error.value = '文件读取完成，但没有可导入的文字。'
  } catch (cause) {
    if (activity) finishAiActivity(activity, request.signal.aborted ? new Error('已暂停，保留已完成页') : cause)
    if (!request.signal.aborted && active) error.value = cause instanceof Error ? cause.message : '文件读取失败，请重试。'
  } finally {
    if (activity?.status === 'running') finishAiActivity(activity)
    if (controller === request) { controller = undefined; reading.value = false }
  }
}

async function importText() {
  if (reading.value || importing.value || (!pendingIds.value && !text.value.trim())) return
  const kbId = props.kbId
  importing.value = true
  error.value = ''
  try {
    const kb = store.getKB(kbId)
    if (!kb) throw new Error('目标知识库已不存在，请重新选择。')
    if (!pendingIds.value) {
      if (text.value.length > KNOWLEDGE_IMPORT_LIMITS.textCharacters) throw new Error('文本超过 500 万字符，请拆分后导入。')
      const existingIds = new Set(kb.entries.map(entry => entry.id))
      store.importFromText(kbId, text.value, category.value)
      pendingIds.value = kb.entries.filter(entry => !existingIds.has(entry.id)).map(entry => entry.id)
      if (!pendingIds.value.length) { pendingIds.value = null; throw new Error('没有可导入的正文，请检查文本内容。') }
    }
    await store.flushPendingSaves()
    if (!active) return
    emit('imported', { kbId, entryIds: [...pendingIds.value], summarize: summarize.value })
    pendingIds.value = null
    file.value = null
    resetPreview()
    emit('update:show', false)
  } catch (cause) {
    error.value = pendingIds.value ? '写入本机失败，请重试保存，不会重复创建条目。'
      : cause instanceof Error ? cause.message : '导入失败，请重试。'
  } finally { importing.value = false }
}
</script>

<style scoped>
.import-fields { display: grid; gap: 8px; min-width: 0; }
.import-fields label { font-size: 13px; color: var(--text-color-secondary); }
.file-row, .import-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.import-actions { justify-content: flex-end; }
.file-name, .import-progress, .import-notice, .import-error { font-size: 12px; overflow-wrap: anywhere; }
.file-name { min-width: 0; flex: 1; }
.import-notice { color: var(--text-color-secondary); margin: 4px 0; line-height: 1.6; }
.import-error { color: var(--color-error); margin: 4px 0; }
</style>
