<template>
  <n-modal :show="show" preset="card" title="导入知识库内容" class="knowledge-import-dialog"
    style="width: min(760px, calc(100vw - 32px));" :closable="!importing && !reviewBusy" :mask-closable="!reading && !importing && !reviewBusy"
    @update:show="close">
    <div class="import-fields">
      <label>分类</label>
      <n-select v-model:value="category" :options="kbCategories" :disabled="importing || reviewBusy || Boolean(pendingIds)" />
      <label>上传文件（最多 100 MB；支持 .txt / .md / .docx / .epub / .pdf）</label>
      <div class="file-row">
        <input ref="fileInput" type="file" accept=".txt,.md,.markdown,.docx,.epub,.pdf" hidden @change="chooseFile" />
        <n-button :disabled="reading || importing || reviewBusy || Boolean(pendingIds)" @click="fileInput?.click()">
          <template #icon><n-icon><document-attach-outline /></n-icon></template>选择文件
        </n-button>
        <span class="file-name">{{ file?.name || '未选择文件' }}</span>
      </div>
      <template v-if="isPdf">
        <label>PDF 读取方式</label>
        <n-select v-model:value="mode" :options="modeOptions" :disabled="reading || importing || reviewBusy || Boolean(pendingIds)" @update:value="resetPreview" />
        <div v-if="mode === 'local-ocr'" class="file-row">
          <label>起始页<n-input-number v-model:value="pageStart" :min="1" :max="1000" :disabled="reading || reviewBusy || importing || Boolean(pendingIds)" aria-label="本地识别起始页" @update:value="resetPreview" /></label>
          <label>结束页<n-input-number v-model:value="pageEnd" :min="pageStart || 1" :max="1000" :disabled="reading || reviewBusy || importing || Boolean(pendingIds)" aria-label="本地识别结束页" @update:value="resetPreview" /></label>
        </div>
        <label>视觉识别模型</label>
        <n-select v-model:value="modelId" :options="modelOptions" :disabled="reading || importing || reviewBusy" placeholder="选择已配置的模型" />
        <n-checkbox v-if="mode !== 'local-ocr'" v-model:checked="allowVision" :disabled="reading || importing || reviewBusy"
          @update:checked="value => config.setPdfVisionEnabled(value)">允许调用视觉识别（可能消耗额度）</n-checkbox>
        <p v-if="mode === 'local-ocr'" class="import-notice">本地 OCR 不上传页面。仅在另行确认“视觉复核”后，才发送可疑区域图片给所选模型，可能产生费用。</p>
        <p v-else class="import-notice">需要识别的页面图片将发送给所选模型服务商，可能产生费用。文字识别结果可能有误，请核对数字、日期和专有名词。</p>
        <div class="file-row">
          <n-button v-if="reading" @click="pause"><template #icon><n-icon><pause-outline /></n-icon></template>暂停识别</n-button>
          <n-button v-else :disabled="importing || reviewBusy || Boolean(pendingIds) || complete" @click="readFile(false)">
            <template #icon><n-icon><play-outline /></n-icon></template>{{ attempted ? '继续识别' : '开始读取' }}
          </n-button>
          <n-button :disabled="reading || importing || reviewBusy || Boolean(pendingIds)" @click="readFile(true)">读取已识别缓存</n-button>
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
      <n-input :value="reading ? text.slice(-12000) : text" @update:value="value => text = value" type="textarea" :rows="8" :readonly="mode === 'local-ocr'" :disabled="reading || importing || reviewBusy || Boolean(pendingIds)"
        placeholder="粘贴内容或上传文件..." />
      <p v-if="progress" class="import-notice" role="status">有文字 {{ progress.textPages }} 页 · 空白结果 {{ progress.blankPages }} 页 · 无缓存 {{ progress.missingPages }} 页 · {{ progress.characters.toLocaleString('zh-CN') }} 字符</p>
      <p v-if="progress?.staleBlankPages" class="import-error" role="alert">发现 {{ progress.staleBlankPages }} 页旧版空白缓存，不能视为有效识别结果。普通读取会重新检查这些页；已有非空文字缓存保留。</p>
      <p v-if="text" class="import-notice" role="status">预计导入 {{ entryCount }} 条 · {{ text.length.toLocaleString('zh-CN') }} 字符</p>
      <p v-if="suspiciousPdf" class="import-error" role="alert">PDF 未读完、缓存缺页或文字页异常偏少，请先核对预览，当前结果可能不完整。</p>
      <n-checkbox v-if="suspiciousPdf" v-model:checked="acceptIncomplete" :disabled="importing">确认仅导入当前文字结果</n-checkbox>
      <n-button v-if="text" size="small" :disabled="reading" @click="exportText">导出已读取文本</n-button>
      <OcrReviewPanel v-if="mode === 'local-ocr' && file && ocrPages.length" ref="ocrPanel" :file="file" :pages="ocrPages"
        :model="config.models.find(model => model.id === modelId)" :disabled="reading || importing || Boolean(pendingIds)"
        @busy="value => reviewBusy = value" @changed="updateOcrPage" />
      <n-checkbox v-if="ocrUnresolved" v-model:checked="acceptUnresolved" :disabled="reading || importing || reviewBusy">保留 {{ ocrUnresolved }} 项待核实标记并导入</n-checkbox>
      <n-checkbox v-model:checked="summarize" :disabled="importing">导入后自动整理条目摘要</n-checkbox>
    </div>
    <template #action>
      <div class="import-actions">
        <n-button :disabled="importing || reviewBusy" @click="close(false)">{{ reading ? '暂停并关闭' : '取消' }}</n-button>
        <n-button type="primary" :loading="importing" :disabled="reading || reviewBusy || (!pendingIds && !text.trim()) || (suspiciousPdf && !acceptIncomplete) || (ocrUnresolved > 0 && !acceptUnresolved)" @click="importText">
          <template #icon><n-icon><save-outline /></n-icon></template>{{ pendingIds ? '重试保存' : '确认导入' }}
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { NButton, NCheckbox, NIcon, NInput, NInputNumber, NModal, NProgress, NSelect } from 'naive-ui'
import { DocumentAttachOutline, PauseOutline, PlayOutline, SaveOutline } from '@vicons/ionicons5'
import { kbCategories, useKnowledgeStore } from '@/stores/knowledge'
import { useConfigStore } from '@/stores/config'
import { KNOWLEDGE_IMPORT_LIMITS, readKnowledgeFile } from '@/services/knowledgeImport'
import type { PdfReadMode, PdfReadProgress } from '@/services/knowledgePdf'
import { finishAiActivity, startAiActivity } from '@/services/aiActivity'
import { splitKnowledgeText } from '@/services/knowledgeText'
import OcrReviewPanel from './OcrReviewPanel.vue'
import type { PdfPageText } from '@/services/knowledgePdfCache'
import { unresolvedOcr } from '@/services/ocrQuality'
import { localOcrPageText } from '@/services/localOcrPdf'

const props = defineProps<{ show: boolean; kbId: string }>()
const emit = defineEmits<{ 'update:show': [value: boolean]; imported: [result: { kbId: string; entryIds: string[]; summarize: boolean }] }>()
const store = useKnowledgeStore()
const config = useConfigStore()
const fileInput = ref<HTMLInputElement | null>(null)
const file = shallowRef<File | null>(null)
const text = ref('')
const category = ref('其他')
const mode = ref<PdfReadMode>('auto')
const pageStart = ref<number | null>(1)
const pageEnd = ref<number | null>(15)
const ocrPages = shallowRef<PdfPageText[]>([])
const reviewBusy = ref(false)
const ocrPanel = ref<InstanceType<typeof OcrReviewPanel> | null>(null)
const acceptUnresolved = ref(false)
const ocrUnresolved = computed(() => ocrPages.value.reduce((n, page) => n + (page.ocr?.lines.filter(unresolvedOcr).length || 0), 0))
const modelId = ref<string | null>(null)
const reading = ref(false)
const importing = ref(false)
const complete = ref(false)
const attempted = ref(false)
const paused = ref(false)
const summarize = ref(true)
const allowVision = ref(config.pdfVisionEnabled)
const error = ref('')
const progress = ref<PdfReadProgress | null>(null)
const pendingIds = ref<string[] | null>(null)
const acceptIncomplete = ref(false)
const entryCount = computed(() => splitKnowledgeText(text.value).length)
const suspiciousPdf = computed(() => Boolean(isPdf.value && progress.value && !reading.value
  && (progress.value.missingPages > 0 || progress.value.completed < progress.value.total
    || (progress.value.blankPages > 0 && progress.value.staleBlankPages > 0)
    || (progress.value.total > 5 && progress.value.textPages <= 1))))
let controller: AbortController | undefined
let active = true
const isPdf = computed(() => file.value?.name.toLowerCase().endsWith('.pdf'))
const modelOptions = computed(() => config.models.map(model => ({ label: model.name || model.modelName, value: model.id })))
const modeOptions = [{ label: '自动：优先文字层，扫描页使用视觉识别', value: 'auto' },
  { label: '本地 OCR ＋ 疑点复核（忽略旧文字层重新识别）', value: 'local-ocr' },
  { label: '全部页面使用视觉识别（适合文字层错误或不完整）', value: 'vision' }]
watch(mode, value => { if (value === 'local-ocr') summarize.value = false })
watch(() => config.pdfVisionEnabled, value => { allowVision.value = value })
const progressText = computed(() => {
  const value = progress.value
  if (!value || value.phase === 'opening') return '正在检查文件和本机缓存'
  if (value.phase === 'complete') return value.missingPages
    ? `缓存读取完成，${value.completed}/${value.total} 页已有缓存`
    : `读取完成，共 ${value.total} 页${value.documentPages ? `（原文件 ${value.documentPages} 页）` : ''}`
  if (value.phase === 'local-ocr') return `本地识别第 ${value.page} 页 · ${value.pagePercent || 0}% · 已完成 ${value.completed}/${value.total} 页`
  return `${value.phase === 'recognizing' ? '正在识别' : '正在读取'}第 ${value.page} / ${value.total} 页，已完成 ${value.completed} 页`
})

function pause() { controller?.abort(); ocrPanel.value?.stop(); paused.value = reading.value }
function close(show: boolean) {
  if (importing.value) return
  if (!show) pause()
  emit('update:show', show)
}
function resetPreview() {
  text.value = ''; complete.value = false; progress.value = null; attempted.value = false; error.value = ''; paused.value = false
  acceptIncomplete.value = false
  ocrPages.value = []; acceptUnresolved.value = false
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

async function readFile(cacheOnly = false) {
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
  acceptIncomplete.value = false
  ocrPages.value = []; acceptUnresolved.value = false
  const selectedModel = config.models.find(model => model.id === modelId.value)
  let activity: ReturnType<typeof startAiActivity> | undefined
  try {
    activity = startAiActivity(isPdf.value ? 'PDF 资料读取与识别' : '知识库文件读取')
    const result = await readKnowledgeFile(source, {
      model: selectedModel ? { ...selectedModel } : undefined, mode: mode.value, signal: request.signal,
      activityParentId: activity.id,
      cacheOnly,
      allowVision: mode.value === 'local-ocr' || allowVision.value,
      pageStart: pageStart.value || 1, pageEnd: pageEnd.value || undefined,
      onPage: page => {
        if (request.signal.aborted || !active || source !== file.value) return
        if (page.ocr) updateOcrPage(page)
        else if (page.text.trim()) text.value += `${text.value ? '\n\n---\n\n' : ''}## 第 ${page.page} 页\n${page.text}`
      },
      onProgress: value => { if (!request.signal.aborted) progress.value = value },
    })
    request.signal.throwIfAborted()
    if (!active || source !== file.value) return
    text.value = result
    complete.value = !cacheOnly
    if (!result.trim()) error.value = '文件读取完成，但没有可导入的文字。'
  } catch (cause) {
    if (activity) finishAiActivity(activity, request.signal.aborted ? new Error('已暂停，保留已完成页') : cause)
    if (!request.signal.aborted && active) error.value = cause instanceof Error ? cause.message : '文件读取失败，请重试。'
  } finally {
    if (activity?.status === 'running') finishAiActivity(activity)
    if (controller === request) { controller = undefined; reading.value = false }
  }
}
function updateOcrPage(page: PdfPageText) {
  ocrPages.value = [...ocrPages.value.filter(item => item.page !== page.page), page].sort((a, b) => a.page - b.page)
  text.value = ocrPages.value.map(localOcrPageText).join('\n\n---\n\n')
  acceptUnresolved.value = false
}
function exportText() {
  const url = URL.createObjectURL(new Blob([text.value], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${file.value?.name.replace(/\.[^.]+$/, '') || '知识库资料'}-已读取.md`
  link.click()
  URL.revokeObjectURL(url)
}

async function importText() {
  if (reading.value || importing.value || reviewBusy.value || (!pendingIds.value && !text.value.trim())) return
  if (ocrUnresolved.value && !acceptUnresolved.value) { error.value = '请先处理疑点，或确认保留待核实标记。'; return }
  if (suspiciousPdf.value && !acceptIncomplete.value) { error.value = '请先核对并确认不完整的文字结果。'; return }
  const kbId = props.kbId
  importing.value = true
  error.value = ''
  try {
    const kb = store.getKB(kbId)
    if (!kb) throw new Error('目标知识库已不存在，请重新选择。')
    if (!pendingIds.value) {
      if (text.value.length > KNOWLEDGE_IMPORT_LIMITS.textCharacters) throw new Error('文本超过 500 万字符，请拆分后导入。')
      const existingIds = new Set(kb.entries.map(entry => entry.id))
      const expected = entryCount.value
      const added = store.importFromText(kbId, text.value, category.value)
      pendingIds.value = kb.entries.filter(entry => !existingIds.has(entry.id)).map(entry => entry.id)
      if (!pendingIds.value.length) { pendingIds.value = null; throw new Error('没有可导入的正文，请检查文本内容。') }
      if (added !== expected || pendingIds.value.length !== expected) throw new Error('导入条目数量不一致，请保留文本并重试。')
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
.import-fields { display: grid; grid-template-columns:minmax(0,1fr); gap: 8px; min-width: 0; }
.import-fields > * { min-width:0; max-width:100%; }
.import-fields :deep(.n-select),.import-fields :deep(.n-base-selection) { min-width:0; max-width:100%; }
.import-fields label { font-size: 13px; color: var(--text-color-secondary); }
.file-row, .import-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.import-actions { justify-content: flex-end; }
.file-name, .import-progress, .import-notice, .import-error { font-size: 12px; overflow-wrap: anywhere; }
.file-name { min-width: 0; flex: 1; }
.file-row :deep(.n-input-number) { width:130px; }
.import-notice { color: var(--text-color-secondary); margin: 4px 0; line-height: 1.6; }
.import-error { color: var(--color-error); margin: 4px 0; }
</style>
