<template>
  <section class="ocr-review">
    <div class="ocr-heading">
      <strong>识别疑点</strong>
      <span role="status">待处理 {{ unresolved.length }} 项 · 已复核 {{ reviewedCount }} 项</span>
      <span>待请求 {{ pendingCalls }} 组</span>
    </div>
    <div class="ocr-controls">
      <label>本轮请求上限<n-input-number v-model:value="maxCalls" :min="1" :max="100" :disabled="busy || disabled" aria-label="视觉复核调用上限" /></label>
      <n-button v-if="busy" @click="stop"><template #icon><n-icon><stop-outline /></n-icon></template>停止复核</n-button>
      <n-button v-else :disabled="disabled || !consent || !model?.apiKey || !pendingCount" @click="review">
        <template #icon><n-icon><scan-outline /></n-icon></template>视觉复核待处理项
      </n-button>
    </div>
    <n-checkbox v-model:checked="consent" :disabled="busy || disabled">允许发送可疑区域图片给所选模型，可能产生费用</n-checkbox>
    <p class="ocr-note">置信度是筛查分数，不是准确率保证。数字改动和表格歧义保留待确认，不自动覆盖原值。</p>
    <p v-for="warning in warnings" :key="warning" class="ocr-error" role="alert">{{ warning }}</p>
    <p v-if="busy" role="status">本轮已发起 {{ calls }} / {{ maxCalls }} 次复核</p>
    <p v-if="error" class="ocr-error" role="alert">{{ error }}</p>
    <p v-if="!unresolved.length" class="ocr-note">当前没有待处理标记；这不代表全文绝对无误。</p>
    <div v-for="item in visible" :key="`${item.page.page}:${item.line.id}`" class="ocr-issue">
      <div class="ocr-issue-top">
        <strong>第 {{ item.page.page }} 页</strong>
        <span>{{ item.line.reasons.join('、') }} · 置信度 {{ Math.round(item.line.confidence) }}</span>
        <n-button quaternary circle :title="`查看第 ${item.page.page} 页原图并确认`" :aria-label="`查看第 ${item.page.page} 页原图并确认`"
          :disabled="busy || disabled" @click="inspect(item.page, item.line)">
          <template #icon><n-icon><eye-outline /></n-icon></template>
        </n-button>
      </div>
      <p>{{ item.line.original || '[未识别出文字]' }}</p>
      <p v-if="item.line.suggestion" class="ocr-suggestion">复核候选：{{ item.line.suggestion }}</p>
      <p v-if="item.line.note" class="ocr-note">{{ item.line.note }}</p>
    </div>
    <n-pagination v-if="unresolved.length > 5" v-model:page="pageIndex" :page-size="5" :item-count="unresolved.length" :page-slot="4" />
    <n-button size="small" :disabled="busy || disabled" @click="exportReport"><template #icon><n-icon><download-outline /></n-icon></template>导出复核记录</n-button>
    <n-modal v-model:show="showDetail" preset="card" title="原图与识别结果" class="ocr-detail" :mask-closable="!saving" :closable="!saving">
      <p v-if="detailBusy">正在读取原图…</p>
      <p v-if="detailError" role="alert" class="ocr-error">{{ detailError }}</p>
      <img v-if="detailImage" :src="detailImage" alt="当前疑点对应的 PDF 原图区域" />
      <p v-if="selected" class="ocr-note">原识别：{{ selected.line.original || '[未识别出文字]' }}</p>
      <p v-if="selected?.line.suggestion" class="ocr-note">视觉候选：{{ selected.line.suggestion }}</p>
      <details v-if="selected?.page.ocr?.nativeText"><summary>此页原文字层（未校对）</summary><pre class="ocr-native">{{ selected.page.ocr.nativeText }}</pre></details>
      <n-input v-model:value="editedText" type="textarea" :rows="4" :maxlength="12000" aria-label="人工确认的识别文字" :disabled="saving" />
      <template #footer>
        <div class="ocr-controls">
          <n-button :disabled="saving" @click="showDetail = false">取消</n-button>
          <n-button type="primary" :loading="saving" :disabled="detailBusy || !detailImage || !editedText.trim()" @click="confirm">确认此项文字</n-button>
        </div>
      </template>
    </n-modal>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { NButton, NCheckbox, NIcon, NInput, NInputNumber, NModal, NPagination } from 'naive-ui'
import { DownloadOutline, EyeOutline, ScanOutline, StopOutline } from '@vicons/ionicons5'
import type { ModelConfig } from '@/stores/config'
import type { PdfPageText } from '@/services/knowledgePdfCache'
import { unresolvedOcr, type OcrLine } from '@/services/ocrQuality'
import { inspectOcrLine, reviewOcrPages, saveManualOcr } from '@/services/localOcrPdf'
import { finishAiActivity, startAiActivity } from '@/services/aiActivity'

const props = defineProps<{ file: File; pages: PdfPageText[]; model?: ModelConfig; disabled: boolean }>()
const emit = defineEmits<{ busy: [value: boolean]; changed: [page: PdfPageText] }>()
const busy = ref(false)
const consent = ref(false)
watch(() => `${props.model?.id}:${props.model?.baseUrl}:${props.model?.modelName}`, () => { consent.value = false })
const maxCalls = ref<number | null>(20)
const calls = ref(0)
const error = ref('')
const pageIndex = ref(1)
let controller: AbortController | undefined
let detailController: AbortController | undefined
let active = true
const unresolved = computed(() => props.pages.flatMap(page => (page.ocr?.lines || []).filter(unresolvedOcr).map(line => ({ page, line }))))
const pendingCount = computed(() => unresolved.value.filter(item => item.line.status === 'pending').length)
const pendingCalls = computed(() => props.pages.reduce((n, page) => n + Math.ceil((page.ocr?.lines.filter(line => line.status === 'pending' && unresolvedOcr(line)).length || 0) / 8), 0))
const reviewedCount = computed(() => props.pages.reduce((n, page) => n + (page.ocr?.lines.filter(line => line.reviewedBy || line.status === 'manual').length || 0), 0))
const warnings = computed(() => props.pages.flatMap(page => (page.ocr?.warnings || []).map(warning => `第 ${page.page} 页：${warning}`)))
const visible = computed(() => unresolved.value.slice((pageIndex.value - 1) * 5, pageIndex.value * 5))
watch(() => unresolved.value.length, total => { pageIndex.value = Math.min(pageIndex.value, Math.max(1, Math.ceil(total / 5))) })
function stop() { controller?.abort(); detailController?.abort() }
async function review() {
  if (busy.value || props.disabled || !props.model || !consent.value) return
  const request = new AbortController()
  controller = request
  busy.value = true; emit('busy', true); error.value = ''; calls.value = 0
  let activity: ReturnType<typeof startAiActivity> | undefined
  try {
    activity = startAiActivity('PDF 识别疑点视觉复核')
    await reviewOcrPages(props.file, JSON.parse(JSON.stringify(props.pages)), {
      model: { ...props.model }, maxCalls: maxCalls.value || 20, consent: consent.value, signal: request.signal,
      activityParentId: activity.id,
      onPage: page => { if (active && !request.signal.aborted) emit('changed', page) },
      onProgress: value => { calls.value = value },
    })
  } catch (cause) {
    if (!request.signal.aborted && active) error.value = '本轮复核未完成，原始文字和已完成结果已保留。请检查接口后重试。'
    if (activity) finishAiActivity(activity, cause)
  } finally {
    if (activity?.status === 'running') finishAiActivity(activity)
    if (controller === request) controller = undefined
    busy.value = false; emit('busy', false)
  }
}
const showDetail = ref(false)
const detailBusy = ref(false)
const detailError = ref('')
const detailImage = ref('')
const editedText = ref('')
const saving = ref(false)
const selected = ref<{ page: PdfPageText; line: OcrLine }>()
async function inspect(page: PdfPageText, line: OcrLine) {
  detailController?.abort()
  const request = new AbortController()
  detailController = request
  selected.value = { page, line }
  editedText.value = line.text
  detailImage.value = ''; detailError.value = ''; detailBusy.value = true; showDetail.value = true
  try {
    const image = await inspectOcrLine(props.file, page.page, line, request.signal)
    if (!request.signal.aborted && active) detailImage.value = image
  } catch (cause) { if (!request.signal.aborted) detailError.value = cause instanceof Error ? cause.message : '原图读取失败' }
  finally { if (detailController === request) detailBusy.value = false }
}
async function confirm() {
  if (!selected.value || saving.value) return
  saving.value = true; emit('busy', true)
  try {
    const record = await saveManualOcr(props.file, JSON.parse(JSON.stringify(selected.value.page)), selected.value.line.id, editedText.value)
    if (active) { emit('changed', record); showDetail.value = false }
  } catch (cause) { detailError.value = cause instanceof Error ? cause.message : '保存失败' }
  finally { saving.value = false; emit('busy', false) }
}
watch(showDetail, value => { if (!value) detailController?.abort() })
function exportReport() {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'novel-ocr-review', version: 1,
    sourceName: props.file.name, exportedAt: new Date().toISOString(), pages: props.pages }, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url; link.download = 'PDF-识别复核记录.json'; link.click(); URL.revokeObjectURL(url)
}
onBeforeUnmount(() => { active = false; stop() })
defineExpose({ stop })
</script>

<style scoped>
.ocr-review { display:grid; gap:12px; border-top:1px solid var(--border-color-light); padding-top:14px; min-width:0; }
.ocr-heading,.ocr-controls,.ocr-issue-top { display:flex; gap:8px; align-items:center; flex-wrap:wrap; min-width:0; }
.ocr-heading > span,.ocr-issue-top > span,.ocr-note { font-size:12px; color:var(--text-color-secondary); }
.ocr-controls label { display:flex; gap:8px; align-items:center; font-size:12px; }
.ocr-controls :deep(.n-input-number) { width:100px; }
.ocr-issue { border-top:1px solid var(--border-color-light); padding-top:10px; }
.ocr-issue p,.ocr-note { overflow-wrap:anywhere; white-space:pre-wrap; margin:6px 0; }
.ocr-issue p { font-size:13px; }
.ocr-issue-top strong { font-size:13px; }
.ocr-suggestion { color:var(--text-color-secondary); }
.ocr-error { color:var(--color-error); font-size:13px; overflow-wrap:anywhere; }
.ocr-native { max-height:180px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; font:inherit; font-size:12px; }
:global(.ocr-detail) { width:min(900px,calc(100vw - 32px)); }
.ocr-detail img { display:block; width:100%; max-height:50vh; object-fit:contain; background:white; margin-bottom:12px; }
</style>
