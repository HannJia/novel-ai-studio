<template>
  <section class="autonomous-draft-panel" aria-label="自主候选稿工作区">
    <header class="panel-header">
      <div>
        <h2>自主候选稿</h2>
        <p class="panel-description">查看每次任务产生的候选稿，必要时先保存修改，再接受为正文。</p>
      </div>
      <span class="candidate-count">{{ entries.length }} 份候选稿</span>
    </header>

    <p v-if="entries.length === 0" class="empty-state">当前没有可查看的候选稿。</p>

    <div v-else class="draft-list">
      <article v-for="entry in entries" :key="entry.key" class="draft-card">
        <div class="draft-card-heading">
          <div>
            <h3>第 {{ entry.draft.chapterIndex + 1 }} 章</h3>
            <p class="task-summary">任务 {{ entry.run.id }} · {{ taskTypeLabel(entry.run.taskType) }}</p>
          </div>
          <button
            type="button"
            class="secondary-button"
            data-action="view-draft"
            :aria-label="`查看第 ${entry.draft.chapterIndex + 1} 章候选稿`"
            :disabled="busyAction !== null"
            @click="openDraft(entry)"
          >
            查看候选稿
          </button>
        </div>

        <div class="metadata" aria-label="候选稿元数据">
          <span class="metadata-item">任务状态：{{ runStatusLabel(entry.run.status) }}</span>
          <span class="metadata-item">稿件状态：{{ draftStatusLabel(entry.draft.status) }}</span>
          <span class="metadata-item">阶段：{{ stageLabel(entry.draft.stage) }}</span>
        </div>

        <p v-if="entry.draft.reviewCoverage?.checkpoint" class="panel-description">
          审核断点：已保存 {{ entry.draft.reviewCoverage.completedChunks }}/{{ entry.draft.reviewCoverage.totalChunks }} 段；
          {{ entry.draft.reviewCoverage.globalStatus === 'not-needed' ? '单段全文' : entry.draft.reviewCoverage.checkpoint.globalReport ? '全章关系复核已保存' : '全章关系复核待完成' }}。
          再次审核会复用仍符合正文、设定和模型的已保存结果。
        </p>

        <details v-if="entry.draft.report" class="readonly-history" aria-label="历史报告">
          <summary>查看历史报告</summary>
          <pre>{{ entry.draft.report }}</pre>
        </details>

        <details v-if="entry.draft.history.length" class="readonly-history" aria-label="历史正文">
          <summary>查看历史正文（{{ entry.draft.history.length }} 条）</summary>
          <ol>
            <li v-for="(historyItem, index) in entry.draft.history" :key="`${historyItem.updatedAt}-${index}`">
              <span class="history-time">{{ historyItem.updatedAt }}</span>
              <pre>{{ historyItem.content }}</pre>
            </li>
          </ol>
        </details>
      </article>
    </div>

    <section v-if="selectedEntry" class="draft-editor" aria-label="候选稿编辑区">
      <div class="editor-heading">
        <div>
          <h3>第 {{ (selectedDraft?.chapterIndex ?? 0) + 1 }} 章候选稿</h3>
          <p class="editor-description">打开后如果正文或审核上下文发生变化，请重新核对候选稿再处理。</p>
        </div>
        <span class="editor-status">{{ draftStatusLabel(selectedDraft?.status) }}</span>
      </div>

      <form class="candidate-form" @submit.prevent="saveEdit">
        <label class="content-field">
          <span>候选正文</span>
          <textarea
            v-model="formContent"
            aria-label="候选正文"
            rows="12"
            :readonly="!selectedCanWrite || busyAction !== null"
          ></textarea>
        </label>

        <p v-if="!selectedCanWrite" class="read-only-hint">{{ writeBlockedReason }}</p>
        <p class="accept-notice">接受为正文仍需事实审核与定稿，不会直接进入 Canon。</p>

        <div v-if="selectedCanWrite" class="editor-actions">
          <button
            type="submit"
            data-action="save-edit"
            aria-label="保存候选修改"
            :disabled="busyAction !== null"
          >
            {{ busyAction === 'edit' ? '正在保存…' : '保存候选修改' }}
          </button>
          <button
            type="button"
            data-action="accept"
            :disabled="busyAction !== null"
            @click="acceptDraft"
          >
            {{ busyAction === 'accept' ? '正在接受…' : '接受为正文' }}
          </button>
          <button
            type="button"
            class="secondary-button"
            data-action="reject"
            :disabled="busyAction !== null"
            @click="rejectDraft"
          >
            {{ busyAction === 'reject' ? '正在拒绝…' : '拒绝' }}
          </button>
        </div>
      </form>

      <p v-if="noticeMessage" class="notice-message" role="status">{{ noticeMessage }}</p>
      <p v-if="errorMessage" class="error-message" role="alert">{{ errorMessage }}</p>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import type { AiChapterDraft, AiRun } from '@/types/reconstruction'

const props = defineProps<{
  novelId: string
  runs: AiRun[]
  disabled?: boolean
}>()

type DraftEntry = { key: string; run: AiRun; draft: AiChapterDraft }
type BusyAction = 'edit' | 'accept' | 'reject' | null

const workspace = useReconstructionWorkspaceStore()
const selectedKey = ref<string | null>(null)
const expectedDraft = ref<AiChapterDraft | null>(null)
const formContent = ref('')
const busyAction = ref<BusyAction>(null)
const noticeMessage = ref('')
const errorMessage = ref('')
const localDrafts = reactive<Record<string, AiChapterDraft>>({})

function cloneDraft(draft: AiChapterDraft): AiChapterDraft {
  return JSON.parse(JSON.stringify(draft)) as AiChapterDraft
}

const entries = computed<DraftEntry[]>(() => props.runs.flatMap(run =>
  (run.chapterDrafts || []).map(draft => {
    const key = `${run.id}:${draft.id}`
    return { key, run, draft: localDrafts[key] || draft }
  }),
))

const selectedEntry = computed(() => entries.value.find(entry => entry.key === selectedKey.value))
const selectedDraft = computed(() => {
  if (selectedKey.value === null) return undefined
  if (expectedDraft.value && selectedKey.value === selectedEntry.value?.key) return expectedDraft.value
  return selectedEntry.value?.draft
})
const selectedCanWrite = computed(() => selectedEntry.value ? canWrite(selectedEntry.value, selectedDraft.value) : false)
const formIsDirty = computed(() => !!expectedDraft.value && formContent.value !== expectedDraft.value.content)

watch(() => props.runs, currentRuns => {
  const incoming = new Map<string, AiChapterDraft>()
  for (const run of currentRuns) {
    for (const draft of run.chapterDrafts || []) incoming.set(`${run.id}:${draft.id}`, draft)
  }
  for (const key of Object.keys(localDrafts)) {
    const current = incoming.get(key)
    if (!current || JSON.stringify(current) !== JSON.stringify(localDrafts[key])) delete localDrafts[key]
  }
  if (selectedKey.value && !incoming.has(selectedKey.value)) closeEditor()
}, { deep: true })

function taskTypeLabel(taskType: AiRun['taskType']): string {
  const labels: Record<AiRun['taskType'], string> = {
    brainstorm: '头脑风暴', contract: '故事契约', skeleton: '故事骨架', outline: '大纲',
    draft: '章节写作', review: '审核', memory_update: '记忆更新', export: '导出',
  }
  return labels[taskType]
}

function runStatusLabel(status: AiRun['status']): string {
  const labels: Record<AiRun['status'], string> = {
    queued: '排队中', running: '执行中', paused: '已暂停', completed: '已完成',
    failed: '失败', cancelled: '已取消', needs_author: '等待作者',
  }
  return labels[status]
}

function draftStatusLabel(status: AiChapterDraft['status'] | undefined): string {
  const labels: Record<AiChapterDraft['status'], string> = { pending: '待处理', accepted: '已接受为正文', rejected: '已拒绝' }
  return status ? labels[status] : '未知'
}

function stageLabel(stage: AiChapterDraft['stage']): string {
  const labels: Record<AiChapterDraft['stage'], string> = { generated: '已生成', reviewed: '已审核', analyzed: '已分析' }
  return labels[stage]
}

function canWrite(entry: DraftEntry, draft: AiChapterDraft | undefined): boolean {
  return !props.disabled && entry.run.status !== 'queued' && entry.run.status !== 'running' && draft?.status === 'pending'
}

const writeBlockedReason = computed(() => {
  if (props.disabled) return '当前工作区已禁用写操作。'
  if (selectedEntry.value?.run.status === 'queued' || selectedEntry.value?.run.status === 'running') return '任务正在排队或执行中，暂不能处理候选稿。'
  return '这份候选稿已经处理，只能查看历史记录。'
})

function openDraft(entry: DraftEntry) {
  const snapshot = cloneDraft(entry.draft)
  selectedKey.value = entry.key
  expectedDraft.value = snapshot
  formContent.value = snapshot.content
  busyAction.value = null
  noticeMessage.value = ''
  errorMessage.value = ''
}

function closeEditor() {
  selectedKey.value = null
  expectedDraft.value = null
  formContent.value = ''
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : '候选稿操作失败，请稍后重试。'
}

function updateExpected(entry: DraftEntry, next: AiChapterDraft) {
  const cloned = cloneDraft(next)
  expectedDraft.value = cloned
  localDrafts[entry.key] = cloned
  formContent.value = cloned.content
}

async function saveEdit(): Promise<AiChapterDraft | undefined> {
  const entry = selectedEntry.value
  const expected = expectedDraft.value
  if (!entry || !expected || !canWrite(entry, expected) || busyAction.value !== null) return undefined

  busyAction.value = 'edit'
  noticeMessage.value = ''
  errorMessage.value = ''
  try {
    const next = await workspace.decideAiDraft(props.novelId, entry.run.id, cloneDraft(expected), 'edit', formContent.value)
    updateExpected(entry, next)
    noticeMessage.value = '候选修改已保存。'
    return next
  } catch (error) {
    errorMessage.value = errorText(error)
    return undefined
  } finally {
    busyAction.value = null
  }
}

async function acceptDraft() {
  const entry = selectedEntry.value
  let expected = expectedDraft.value
  if (!entry || !expected || !canWrite(entry, expected) || busyAction.value !== null) return

  errorMessage.value = ''
  if (formIsDirty.value) {
    errorMessage.value = '请先保存候选修改，再接受为正文'
    return
  }
  if (!canWrite(entry, expected) || busyAction.value !== null) return

  busyAction.value = 'accept'
  noticeMessage.value = ''
  try {
    const next = await workspace.decideAiDraft(props.novelId, entry.run.id, cloneDraft(expected), 'accept')
    updateExpected(entry, next)
    noticeMessage.value = '已接受为正文；仍需完成事实审核与定稿，当前不会直接进入 Canon。'
  } catch (error) {
    errorMessage.value = errorText(error)
  } finally {
    busyAction.value = null
  }
}

async function rejectDraft() {
  const entry = selectedEntry.value
  const expected = expectedDraft.value
  if (!entry || !expected || !canWrite(entry, expected) || busyAction.value !== null) return

  busyAction.value = 'reject'
  noticeMessage.value = ''
  errorMessage.value = ''
  try {
    const next = await workspace.decideAiDraft(props.novelId, entry.run.id, cloneDraft(expected), 'reject')
    updateExpected(entry, next)
    noticeMessage.value = '候选稿已拒绝。'
  } catch (error) {
    errorMessage.value = errorText(error)
  } finally {
    busyAction.value = null
  }
}
</script>

<style scoped>
.autonomous-draft-panel { display: grid; gap: 16px; min-width: 0; color: var(--ink); }
.panel-header, .draft-card-heading, .editor-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; min-width: 0; }
.panel-header h2, .draft-card h3, .draft-editor h3 { margin: 0; overflow-wrap: anywhere; }
.panel-description, .task-summary, .editor-description, .empty-state, .read-only-hint, .accept-notice, .notice-message, .error-message { margin: 5px 0 0; overflow-wrap: anywhere; }
.panel-description, .task-summary, .editor-description, .empty-state, .read-only-hint { color: var(--ink-2); }
.candidate-count, .editor-status { flex: 0 0 auto; color: var(--ink-2); font-size: 13px; }
.draft-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 330px), 1fr)); gap: 12px; }
.draft-card, .draft-editor { min-width: 0; padding: 14px; border: 1px solid var(--line-2); border-radius: 8px; background: var(--paper); }
.metadata { display: flex; flex-wrap: wrap; gap: 6px 12px; margin-top: 12px; font-size: 13px; color: var(--ink-2); }
.metadata-item { overflow-wrap: anywhere; }
.readonly-history { margin-top: 12px; min-width: 0; }
.readonly-history summary { cursor: pointer; color: var(--ink-2); overflow-wrap: anywhere; }
.readonly-history pre { max-width: 100%; margin: 8px 0 0; padding: 9px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; background: var(--panel-2); border-radius: 5px; font: inherit; font-size: 12px; }
.readonly-history ol { margin: 8px 0 0; padding-left: 22px; }
.readonly-history li { min-width: 0; margin-bottom: 10px; }
.history-time { color: var(--ink-2); font-size: 12px; }
.candidate-form { display: grid; gap: 12px; margin-top: 14px; }
.content-field { display: grid; gap: 6px; min-width: 0; font-weight: 600; }
.content-field textarea { box-sizing: border-box; width: 100%; min-width: 0; resize: vertical; padding: 9px; border: 1px solid var(--line-2); border-radius: 5px; color: inherit; background: var(--paper); font: inherit; line-height: 1.55; }
.content-field textarea[readonly] { background: var(--panel-2); }
.editor-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.editor-actions button, .secondary-button { min-height: 34px; padding: 6px 11px; border: 1px solid var(--line-2); border-radius: 5px; color: inherit; background: var(--panel); cursor: pointer; }
.editor-actions button:first-child { border-color: var(--zhu); color: #fff; background: var(--zhu); }
.editor-actions button:nth-child(2) { border-color: var(--qing); color: #fff; background: var(--qing); }
button:disabled { opacity: .55; cursor: default; }
.accept-notice { color: var(--ink-2); font-size: 13px; }
.notice-message { color: var(--qing); }
.error-message { color: var(--zhu); }
@media (max-width: 520px) {
  .panel-header, .draft-card-heading, .editor-heading { display: grid; }
  .candidate-count, .editor-status { justify-self: start; }
  .draft-card, .draft-editor { padding: 11px; }
  .editor-actions button, .secondary-button { width: 100%; }
}
</style>
