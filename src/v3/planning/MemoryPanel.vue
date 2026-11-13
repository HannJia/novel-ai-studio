<template>
  <section class="story-memory-panel" aria-label="故事记忆">
    <header class="panel-header">
      <div>
        <h2>故事回顾</h2>
        <p>回顾只读取已写正文，AI 结果先留在候选编辑区；作者明确确认后，才会保存为可供写作和检索使用的故事记忆。</p>
      </div>
      <span class="memory-principle">默认简要回顾 · 800 字符</span>
    </header>

    <p v-if="error || (!busy && persistedTaskError)" class="message error" role="alert">{{ error || persistedTaskError }}</p>
    <p v-if="notice" class="message notice" role="status" aria-live="polite">{{ notice }}</p>
    <p v-if="!ready" class="loading" role="status">正在读取故事工作区…</p>

    <template v-else>
      <section class="scope-builder" aria-label="创建回顾范围">
        <div class="scope-builder-heading">
          <div><h3>选择新的回顾范围</h3><p>选择回顾到哪一章；场景回顾可粘贴章内原文来定位。</p></div>
          <button type="button" :disabled="busy" @click="openBuilderScope">打开此范围</button>
        </div>
        <div class="builder-fields">
          <label>范围类型<select v-model="builderKind" :disabled="busy" aria-label="范围类型"><option value="book">全书</option><option v-if="novel.volumes.length" value="volume">分卷</option><option value="scene">场景片段</option></select></label>
          <label v-if="builderKind === 'volume'">分卷<select v-model="builderVolumeId" :disabled="busy" aria-label="选择分卷"><option v-for="volume in novel.volumes" :key="volume.id" :value="volume.id">第{{ volume.volumeIndex + 1 }}卷 · {{ volume.title }}</option></select></label>
          <label v-if="builderKind !== 'scene'">截止章节<select v-model="builderThroughChapterId" :disabled="busy" aria-label="截止章节"><option v-for="chapter in builderThroughChapters" :key="chapter.id" :value="chapter.id">第{{ chapter.chapterIndex + 1 }}章 · {{ chapter.title || '未命名章节' }}</option></select></label>
          <template v-else>
            <label>场景所在章节<select v-model="builderSceneChapterId" :disabled="busy" aria-label="场景所在章节"><option v-for="chapter in novel.chapters" :key="chapter.id" :value="chapter.id">第{{ chapter.chapterIndex + 1 }}章 · {{ chapter.title || '未命名章节' }}</option></select></label>
            <label class="scene-quote-field">粘贴章内准确原文片段<textarea v-model="builderSceneText" rows="3" :disabled="busy" aria-label="场景原文片段" placeholder="从章节正文复制一段唯一出现的原文"></textarea></label>
            <p v-if="sceneMatchMessage" class="scene-match" :class="{ valid: sceneMatchCount === 1 }" role="status">{{ sceneMatchMessage }}</p>
            <details class="advanced-offsets"><summary>高级：直接填写 UTF-16 偏移</summary><p>仅在无法粘贴唯一原文时使用；偏移按 JavaScript 字符串的 UTF-16 计数。</p><label>开始偏移<input v-model.number="builderSceneStart" type="number" min="0" :max="builderSceneChapter?.content.length || 0" :disabled="busy" aria-label="开始偏移" /></label><label>结束偏移<input v-model.number="builderSceneEnd" type="number" min="1" :max="builderSceneChapter?.content.length || 0" :disabled="busy" aria-label="结束偏移" /></label></details>
          </template>
        </div>
        <p v-if="builderError" class="builder-error" role="alert">{{ builderError }}</p>
      </section>

      <div class="memory-layout">
        <aside class="memory-scopes" aria-label="已保存和当前范围">
          <div class="scope-heading"><h3>回顾范围</h3><span>{{ scopeOptions.length }} 个范围</span></div>
          <button v-for="option in scopeOptions" :key="option.key" type="button" class="scope-option" :disabled="saving" :class="{ selected: option.key === selectedScopeKey }" :aria-pressed="option.key === selectedScopeKey" @click="selectScope(option.key)">
            <span class="scope-option-main"><strong>{{ option.title }}</strong><small>{{ option.description }}</small></span>
            <span v-if="memoryFor(option.scope)" class="scope-status" :class="statusClass(memoryFor(option.scope)!)">{{ statusLabel(memoryFor(option.scope)!) }}</span>
          </button>
          <p v-if="!scopeOptions.length" class="empty">请先添加可回顾的正文。</p>
          <details class="chapter-links" aria-label="章节总结">
            <summary>查看章节总结</summary>
            <p>章节总结请在对应章节编辑器中核对。</p>
            <a v-for="chapter in novel.chapters" :key="chapter.id" :href="`#/write/${novel.id}/${chapter.id}`">第{{ chapter.chapterIndex + 1 }}章 · {{ chapterTitleForDisplay(chapter.title, chapter.chapterIndex) }} · 打开编辑器</a>
          </details>
        </aside>

        <main v-if="selectedScope" class="memory-editor">
          <div class="editor-heading">
            <div><span class="eyebrow">{{ selectedScope.kindLabel }}</span><h3>{{ selectedScope.title }}</h3><p>{{ selectedScope.description }}</p></div>
            <span v-if="selectedRecord" class="record-origin" :class="selectedRecord.source.origin === 'author' ? 'author' : 'ai'">{{ selectedRecord.source.origin === 'author' ? '作者核对' : 'AI 已保存' }}</span>
          </div>

          <div v-if="selectedRecord && selectedStatus !== 'current'" class="stale-warning" role="status">
            <strong>{{ selectedStatus === 'stale' ? '来源正文已经变化或范围已删除' : '这份回顾的来源未验证' }}</strong>
            <span>旧回顾仍可查看，不能当作当前故事事实使用。可以重新载入当前来源，草稿内容会保留。</span>
          </div>

          <div v-if="candidate" class="candidate-banner" role="status"><strong>AI 候选尚未保存</strong><span>请检查标题和回顾内容，再点击“作者确认并保存”。离开或取消不会把候选写入故事记忆。</span></div>

          <details v-if="candidate" class="source-preview"><summary>查看完整 AI 候选</summary><p style="white-space: pre-wrap">{{ candidate.summary }}</p><button type="button" :disabled="busy" @click="useCandidate">将候选载入编辑区</button></details>
          <details v-if="requestOutputs.length" class="source-preview"><summary>已保存的节点输出与中断片段（不能直接确认为正式记忆）</summary><article v-for="row in requestOutputs" :key="row.id"><strong>请求 {{ row.number }} · {{ requestStatusLabels[row.status] }}</strong><p>{{ row.partialOutput }}</p></article></details>
          <div class="editor-tools">
            <label>回顾详细程度<select v-model="level" :disabled="busy" aria-label="回顾详细程度"><option value="brief">简要 · 800 字符</option><option value="standard">标准 · 2500 字符</option><option value="detailed">详细 · 6000 字符</option></select></label>
            <label>最大请求数<input v-model.number="maxRequests" type="number" min="0" max="4096" :disabled="busy" aria-label="最大请求数" /></label>
            <label>Token 预算<input v-model.number="maxTokens" type="number" min="0" max="50000000" :disabled="busy" aria-label="Token 预算" /></label>
          </div>
          <p class="level-hint">简要回顾默认用于完整写作上下文；标准和详细回顾更适合检索。预算为 0 时会在发送请求前拒绝。</p>
          <p v-if="estimateText" class="estimate" role="status">{{ estimateText }}</p>
          <p v-if="taskUsage" class="estimate" role="status">{{ taskUsage }}；成功节点会复用，未完成请求不会自动继续。</p>

          <label class="title-field">回顾标题<input v-model="titleDraft" :disabled="busy" aria-label="回顾标题" /></label>
          <label class="summary-field"><span>{{ candidate ? 'AI 候选回顾' : '回顾内容' }}</span><textarea v-model="summaryDraft" rows="14" :disabled="busy" placeholder="生成后在这里检查，或填写作者核对后的回顾。" aria-label="回顾内容"></textarea><small>{{ summaryDraft.length }} 字符</small></label>

          <details v-if="sourcePreview.length" class="source-preview"><summary>来源预览（{{ sourcePreview.length }} 章）</summary><p class="preview-disclaimer">这里只显示每章首段提示，帮助确认范围；它不是完整正文预览，生成仍由服务读取当前范围的完整正文。</p><article v-for="item in sourcePreview" :key="item.chapter.id"><div><strong>第{{ item.chapter.chapterIndex + 1 }}章 · {{ chapterTitleForDisplay(item.chapter.title, item.chapter.chapterIndex) }}</strong><a :href="`#/write/${novel.id}/${item.chapter.id}`">打开原章</a></div><p>{{ item.excerpt }}</p></article></details>

          <div v-if="progress" class="progress-panel" role="status" aria-live="polite"><div class="progress-header"><strong>{{ progressLabel }}</strong><span>{{ progressPercent }}%</span></div><progress :value="progressPercent" max="100"></progress><small>请求 {{ progress.completedRequests }}/{{ progress.plannedRequests }} · 输入 {{ progress.inputTokens }} · 输出 {{ progress.outputTokens }} tokens</small></div>

          <div class="editor-actions">
            <button type="button" :disabled="busy || !selectedScope || (taskRun?.status === 'needs_author' && taskRun?.memoryTask?.sourceVersionId === openedBinding?.sourceVersionId)" @click="generate">{{ busy && !saving ? '正在生成…' : taskCanContinue ? '继续生成未完成节点' : '生成 AI 候选' }}</button>
            <button type="button" :disabled="busy || !openedBinding" @click="saveDraft">暂存草稿</button>
            <button type="button" class="primary" :disabled="busy || !summaryDraft.trim() || !openedBinding" @click="confirmAuthor">作者确认并保存</button>
            <button v-if="openedBinding && (!bindingCurrent || selectedStatus !== 'current')" type="button" :disabled="busy" @click="reloadCurrentSource">重新载入当前来源</button>
            <button v-if="busy && !saving" type="button" class="cancel" @click="cancel">取消生成</button>
          </div>

          <details v-if="selectedRecord?.history?.length" class="history"><summary>历史回顾（{{ selectedRecord.history.length }}）</summary><article v-for="item in selectedRecord.history.slice().reverse()" :key="item.id"><div><strong>{{ item.title }}</strong><time>{{ formatDate(item.replacedAt) }}</time></div><p>{{ item.summary }}</p></article></details>
          <dl v-if="selectedRecord || candidate" class="source-details">
            <div><dt>打开时来源版本</dt><dd>{{ candidate?.sourceVersionId || openedBinding?.sourceVersionId || '未验证' }}</dd></div>
            <div v-if="selectedRecord"><dt>已保存来源</dt><dd>{{ selectedRecord.source.sourceVersionId }}</dd></div>
            <div v-if="candidate?.coverage"><dt>候选覆盖</dt><dd>{{ candidate.coverage.leafCount }} 个正文分段 · {{ candidate.coverage.requestCount }} 次本轮请求（复用沿用原请求证据）</dd></div>
          </dl>
        </main>
        <div v-else class="memory-empty"><strong>选择一个回顾范围</strong><span>全书和分卷回顾可以选择截止章节；章节总结请从已有编辑器进入。</span></div>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { registerDraftSaver, type DraftFlushToken } from '@/services/appLifecycle'
import { useConfigStore } from '@/stores/config'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { chapterTitleForDisplay } from '@/v3/write/chapterNumber'
import { type KnowledgeSummaryPlan, type KnowledgeSummaryProgress } from '@/services/knowledgeSummary'
import { planStoryMemorySummary } from '@/services/storyMemoryGeneration'
import { buildStoryMemorySummaryGraph } from '@/services/summaryGraph'
import { continueStoryMemoryTask, createMemoryUpdateRun, isResumableStoryMemoryRun } from '@/services/storyMemoryTask'
import { getStoryMemoryStatus, resolveStoryMemorySource } from '@/services/storyMemory'
import type { Novel } from '@/types/novel'
import type { KnowledgeSummaryCoverage } from '@/types/knowledge'
import type { StoryMemoryRecord, StoryMemoryScope, StoryMemoryRequestLedgerEntry } from '@/types/storyMemory'

const props = withDefaults(defineProps<{ novel: Novel; ready?: boolean }>(), { ready: true })
const workspace = useReconstructionWorkspaceStore()
const config = useConfigStore()
type ScopeOption = { key: string; scope: StoryMemoryScope; title: string; description: string; kindLabel: string; current: boolean }
type FormBinding = { novelId: string; scope: StoryMemoryScope; sourceVersionId: string | null; recordSnapshot: string | null }
type Candidate = { summary: string; coverage: KnowledgeSummaryCoverage; sourceVersionId: string; scopeKey: string; title: string; taskRunId?: string; taskUpdatedAt?: string }

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
const scopeKey = (scope: StoryMemoryScope) => JSON.stringify(scope.kind === 'scene'
  ? ['scene', scope.chapterId, scope.startOffset, scope.endOffset]
  : scope.kind === 'volume' ? ['volume', scope.volumeId, scope.throughChapterId] : ['book', scope.throughChapterId])
const selectedScopeKey = ref('')
const openedBinding = ref<FormBinding | null>(null)
const summaryDraft = ref('')
const titleDraft = ref('')
const candidate = ref<Candidate | null>(null)
const level = ref<'brief' | 'standard' | 'detailed'>('brief')
const maxRequests = ref(64)
const maxTokens = ref(500000)
const estimateText = ref('')
const busy = ref(false), error = ref(''), notice = ref('')
const saving = ref(false)
let saveEpoch = 0
const progress = ref<KnowledgeSummaryProgress | null>(null)
const builderError = ref('')
const builderKind = ref<'book' | 'volume' | 'scene'>('book')
const builderVolumeId = ref('')
const builderThroughChapterId = ref('')
const builderSceneChapterId = ref('')
const builderSceneText = ref('')
const builderSceneStart = ref(0)
const builderSceneEnd = ref(0)
let controller: AbortController | undefined
let disposed = false
let openingDraft = false
let draftWrite: Promise<unknown> = Promise.resolve()
type PendingAuthorDraft = { novelId: string; draft: ReturnType<typeof authorDraftInput> }
const pendingAuthorDrafts = new Map<string, PendingAuthorDraft>()
function queueAuthorDraft(input: PendingAuthorDraft, token?: DraftFlushToken) {
  const key = JSON.stringify([input.novelId, input.draft.scope])
  pendingAuthorDrafts.set(key, input)
  // Enter the workspace queue immediately, including during component teardown.
  draftWrite = workspace.saveAuthorMemoryDraft(input.novelId, input.draft, token).then(() => {
    if (pendingAuthorDrafts.get(key) === input) pendingAuthorDrafts.delete(key)
    if (disposed && !pendingAuthorDrafts.size) unregisterDraftSaver()
  }).catch(cause => {
    if (!disposed && props.novel.id === input.novelId) error.value = '草稿保存失败，请暂存重试：' + String(cause)
    throw cause
  })
  void draftWrite.catch(() => undefined)
  return draftWrite
}
const unregisterDraftSaver = registerDraftSaver(async token => {
  do {
    await draftWrite.catch(() => undefined)
    let failure: unknown
    for (const [key, input] of [...pendingAuthorDrafts]) {
      if (pendingAuthorDrafts.get(key) === input) {
        try { await queueAuthorDraft(input, token) } catch (cause) { failure ||= cause }
      }
    }
    if (failure) throw failure
  } while (pendingAuthorDrafts.size)
  if (disposed) unregisterDraftSaver()
})

const ready = computed(() => props.ready)
const novel = computed(() => props.novel)
const records = computed(() => workspace.getStoryMemories(props.novel.id))
const selectedRecord = computed(() => selectedScopeKey.value ? records.value.find(record => scopeKey(record.scope) === selectedScopeKey.value) : undefined)
const selectedScope = computed(() => scopeOptions.value.find(option => option.key === selectedScopeKey.value))
const selectedStatus = computed(() => selectedRecord.value ? getStoryMemoryStatus(props.novel, selectedRecord.value) : 'current')
const taskRun = computed(() => openedBinding.value ? workspace.getAiRuns(props.novel.id).slice().reverse().find(run => run.taskType === 'memory_update' && run.memoryTask && scopeKey(run.memoryTask.scope) === scopeKey(openedBinding.value!.scope)) : undefined)
const persistedTaskError = computed(() => {
  const run = taskRun.value
  return run?.error && run.memoryTask && ['paused', 'failed', 'cancelled', 'interrupted'].includes(run.memoryTask.stage)
    ? '上次回顾任务已停止：' + run.error : ''
})
const requestOutputs = computed(() => taskRun.value?.memoryTask?.requests.flatMap((row, index) => row.partialOutput ? [{ ...row, number: index + 1 }] : []) || [])
const requestStatusLabels: Record<StoryMemoryRequestLedgerEntry['status'], string> = { pending: '请求中', completed: '已完成', failed: '失败', unknown: '结果未确认', interrupted: '已中断', not_sent: '未发送' }
const taskCanContinue = computed(() => taskRun.value?.memoryTask && !['draft', 'committed'].includes(taskRun.value.memoryTask.stage) && isResumableStoryMemoryRun(taskRun.value) && taskRun.value?.status !== 'needs_author')
const taskUsage = computed(() => taskRun.value?.memoryTask && taskRun.value.memoryTask.stage !== 'draft' ? '本轮继续用量：输入 ' + taskRun.value.memoryTask.currentInputTokens.toLocaleString() + ' / 输出 ' + taskRun.value.memoryTask.currentOutputTokens.toLocaleString() + ' tokens；任务累计输入 ' + taskRun.value.memoryTask.historicalInputTokens.toLocaleString() + ' / 输出 ' + taskRun.value.memoryTask.historicalOutputTokens.toLocaleString() + (taskRun.value.memoryTask.usageEstimated ? '（含估算）' : '') : '')
const bindingCurrent = computed(() => openedBinding.value ? sourceStillCurrent(openedBinding.value) : false)
const builderSceneChapter = computed(() => props.novel.chapters.find(chapter => chapter.id === builderSceneChapterId.value))
const sceneMatchOffsets = computed(() => {
  const text = builderSceneText.value
  const content = builderSceneChapter.value?.content || ''
  if (!text) return [] as number[]
  const offsets: number[] = []
  let from = 0
  while (from <= content.length - text.length) {
    const index = content.indexOf(text, from)
    if (index < 0) break
    offsets.push(index)
    from = index + 1
  }
  return offsets
})
const sceneMatchCount = computed(() => sceneMatchOffsets.value.length)
const sceneMatchMessage = computed(() => {
  if (!builderSceneText.value) return '请粘贴一段正文；若填写高级偏移，将在打开时按偏移定位。'
  if (sceneMatchCount.value === 0) return '未找到这段原文，请从当前章节复制准确片段。'
  if (sceneMatchCount.value > 1) return `这段原文出现 ${sceneMatchCount.value} 次，请粘贴更长的片段以唯一定位。`
  return `已唯一定位：${sceneMatchOffsets.value[0]}–${sceneMatchOffsets.value[0] + builderSceneText.value.length}`
})
const builderThroughChapters = computed(() => {
  const chapters = props.novel.chapters.slice().sort((a, b) => a.chapterIndex - b.chapterIndex)
  return builderKind.value === 'volume' ? chapters.filter(chapter => chapter.volumeIndex === props.novel.volumes.find(volume => volume.id === builderVolumeId.value)?.volumeIndex) : chapters
})

function optionFor(scope: StoryMemoryScope, title: string, description: string, current: boolean, kindLabel: string): ScopeOption { return { key: scopeKey(scope), scope, title, description, current, kindLabel } }
const currentScopeOptions = computed(() => {
  const result: ScopeOption[] = []
  const chapters = props.novel.chapters.slice().sort((a, b) => a.chapterIndex - b.chapterIndex)
  const latest = chapters.filter(chapter => chapter.content.trim()).slice(-1)[0]
  if (latest) result.push(optionFor({ kind: 'book', throughChapterId: latest.id }, `全书回顾 · 截至第${latest.chapterIndex + 1}章`, '截止章节由上方范围选择器调整', true, '全书'))
  for (const volume of props.novel.volumes) {
    const volumeChapters = chapters.filter(item => item.volumeIndex === volume.volumeIndex && item.content.trim())
    const chapter = volumeChapters[volumeChapters.length - 1]
    if (chapter) result.push(optionFor({ kind: 'volume', volumeId: volume.id, throughChapterId: chapter.id }, `第${volume.volumeIndex + 1}卷 · 截至第${chapter.chapterIndex + 1}章`, volume.title + ' · 已写正文回顾', true, '分卷'))
  }
  return result
})
function kindLabel(scope: StoryMemoryScope) { return scope.kind === 'book' ? '全书' : scope.kind === 'volume' ? '分卷' : '场景' }
function scopeDescription(scope: StoryMemoryScope) {
  try { return resolveStoryMemorySource(props.novel, scope).label }
  catch { return '来源范围已变化，请核对原章' }
}
const storedScopeOptions = computed(() => records.value.map(record => optionFor(record.scope, record.title, scopeDescription(record.scope), false, kindLabel(record.scope))))
const scopeOptions = computed(() => {
  const merged = new Map<string, ScopeOption>()
  for (const run of workspace.getAiRuns(props.novel.id)) if (run.memoryTask) { const scope = run.memoryTask.scope; merged.set(scopeKey(scope), optionFor(scope, run.memoryTask.titleDraft || '未完成回顾', scopeDescription(scope), false, kindLabel(scope))) }
  for (const item of storedScopeOptions.value) merged.set(item.key, item)
  for (const item of currentScopeOptions.value) if (!merged.has(item.key)) merged.set(item.key, item)
  if (openedBinding.value && !merged.has(scopeKey(openedBinding.value.scope))) merged.set(scopeKey(openedBinding.value.scope), optionFor(openedBinding.value.scope, titleDraft.value || '当前回顾', scopeDescription(openedBinding.value.scope), false, kindLabel(openedBinding.value.scope)))
  return [...merged.values()]
})
const sourcePreview = computed(() => {
  const scope = openedBinding.value?.scope
  if (!scope) return []
  const chapters = props.novel.chapters.slice().sort((a, b) => a.chapterIndex - b.chapterIndex)
  let selected = chapters
  if (scope.kind === 'scene') selected = chapters.filter(chapter => chapter.id === scope.chapterId)
  else if (scope.kind === 'volume') {
    const through = chapters.find(item => item.id === scope.throughChapterId)
    const volumeIndex = props.novel.volumes.find(volume => volume.id === scope.volumeId)?.volumeIndex
    selected = through === undefined || volumeIndex === undefined ? [] : chapters.filter(chapter => chapter.volumeIndex === volumeIndex && chapter.chapterIndex <= through.chapterIndex)
  } else {
    const through = chapters.find(item => item.id === scope.throughChapterId)
    selected = through === undefined ? [] : chapters.filter(chapter => chapter.chapterIndex <= through.chapterIndex)
  }
  return selected.map(chapter => {
    const start = scope.kind === 'scene' ? scope.startOffset : 0
    const end = scope.kind === 'scene' ? scope.endOffset : chapter.content.length
    const content = chapter.content.slice(start, end)
    return { chapter, excerpt: content.length > 160 ? content.slice(0, 160) + '…' : content }
  })
})
const progressLabel = computed(() => progress.value?.phase === 'merge' ? '正在合并分层回顾' : progress.value?.phase === 'complete' ? '回顾生成完成' : '正在阅读正文')
const progressPercent = computed(() => !progress.value ? 0 : progress.value.phase === 'complete' ? 100 : Math.min(99, Math.round(progress.value.completedRequests / Math.max(1, progress.value.plannedRequests) * 100)))

function memoryFor(scope: StoryMemoryScope) { return records.value.find(record => scopeKey(record.scope) === scopeKey(scope)) }
function statusLabel(record: StoryMemoryRecord) { const status = getStoryMemoryStatus(props.novel, record); return status === 'current' ? '有效' : status === 'stale' ? '过期' : '未验证' }
function statusClass(record: StoryMemoryRecord) { return getStoryMemoryStatus(props.novel, record) }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN') }
function currentRecordSnapshot() { return selectedRecord.value ? JSON.stringify(clone(selectedRecord.value)) : null }
function captureBinding(scope: StoryMemoryScope): FormBinding {
  let sourceVersionId: string | null = null
  try { sourceVersionId = resolveStoryMemorySource(props.novel, scope).versionId } catch { /* keep old records viewable */ }
  return { novelId: props.novel.id, scope: clone(scope), sourceVersionId, recordSnapshot: currentRecordSnapshot() }
}
function syncBuilderDefaults() {
  const chapters = props.novel.chapters.slice().sort((a, b) => a.chapterIndex - b.chapterIndex)
  builderThroughChapterId.value ||= chapters.filter(chapter => chapter.content.trim()).slice(-1)[0]?.id || chapters[0]?.id || ''
  builderSceneChapterId.value ||= chapters[0]?.id || ''
  builderSceneEnd.value ||= builderSceneChapter.value?.content.length || 0
  builderVolumeId.value ||= props.novel.volumes[0]?.id || ''
}
function openScope(option: ScopeOption) {
  openingDraft = true
  selectedScopeKey.value = option.key
  openedBinding.value = captureBinding(option.scope)
  summaryDraft.value = selectedRecord.value?.summary || ''
  titleDraft.value = selectedRecord.value?.title || option.title
  const savedTask = workspace.getAiRuns(props.novel.id).slice().reverse().find(run => run.taskType === 'memory_update' && run.memoryTask && scopeKey(run.memoryTask.scope) === scopeKey(option.scope))
  const savedCandidate = savedTask?.memoryTask?.stage === 'awaiting_author' && savedTask.memoryTask.sourceVersionId === openedBinding.value?.sourceVersionId ? savedTask.memoryTask.candidate : undefined
  candidate.value = savedCandidate ? { summary: savedCandidate.summary, coverage: clone(savedCandidate.coverage), sourceVersionId: savedCandidate.sourceVersionId, scopeKey: scopeKey(option.scope), title: savedCandidate.title, taskRunId: savedTask?.id, taskUpdatedAt: savedTask?.memoryTask?.updatedAt } : null
  if (savedTask?.memoryTask && savedTask.memoryTask.stage !== 'committed') { summaryDraft.value = savedTask.memoryTask.bodyDraft; titleDraft.value = savedTask.memoryTask.titleDraft; level.value = savedTask.memoryTask.level }
  if (savedTask) { maxRequests.value = savedTask.requestLimit || 64; maxTokens.value = savedTask.tokenBudget || 500000 }
  openingDraft = false
  estimateText.value = ''
  error.value = ''; notice.value = ''; progress.value = null
}
function selectScope(key: string) {
  if (saving.value) return
  if (busy.value) cancel()
  const option = scopeOptions.value.find(item => item.key === key)
  if (option) openScope(option)
}
function openBuilderScope() {
  if (busy.value) return
  builderError.value = ''
  let scope: StoryMemoryScope
  if (builderKind.value === 'scene') {
    const chapter = builderSceneChapter.value
    if (builderSceneText.value && sceneMatchCount.value !== 1) { builderError.value = sceneMatchMessage.value; return }
    if (!chapter) { builderError.value = '请选择场景所在章节。'; return }
    if (sceneMatchCount.value === 1) {
      builderSceneStart.value = sceneMatchOffsets.value[0]
      builderSceneEnd.value = builderSceneStart.value + builderSceneText.value.length
    }
    if (!Number.isSafeInteger(builderSceneStart.value) || !Number.isSafeInteger(builderSceneEnd.value) || builderSceneStart.value < 0 || builderSceneEnd.value <= builderSceneStart.value || builderSceneEnd.value > chapter.content.length) { builderError.value = '场景必须是正文中的有效非空区间；请粘贴唯一片段或填写高级偏移。'; return }
    scope = { kind: 'scene', chapterId: chapter.id, startOffset: builderSceneStart.value, endOffset: builderSceneEnd.value }
  } else if (builderKind.value === 'volume') {
    if (!builderVolumeId.value || !builderThroughChapterId.value) { builderError.value = '请选择分卷和截止章节。'; return }
    scope = { kind: 'volume', volumeId: builderVolumeId.value, throughChapterId: builderThroughChapterId.value }
  } else {
    if (!builderThroughChapterId.value) { builderError.value = '请选择截止章节。'; return }
    scope = { kind: 'book', throughChapterId: builderThroughChapterId.value }
  }
  try { resolveStoryMemorySource(props.novel, scope) }
  catch (cause) { builderError.value = cause instanceof Error ? cause.message : String(cause); return }
  const option = optionFor(scope, scope.kind === 'scene' ? `场景片段 · 第${builderSceneChapter.value!.chapterIndex + 1}章` : scope.kind === 'volume' ? `分卷回顾 · 截至${builderThroughChapterChaptersLabel(scope.throughChapterId)}` : `全书回顾 · 截至${builderThroughChapterChaptersLabel(scope.throughChapterId)}`, '新建范围', true, kindLabel(scope))
  openScope(option)
}
function builderThroughChapterChaptersLabel(id: string) { const chapter = props.novel.chapters.find(item => item.id === id); return chapter ? `第${chapter.chapterIndex + 1}章` : '当前章节' }
function reloadCurrentSource() {
  if (!openedBinding.value) return
  try {
    const source = resolveStoryMemorySource(props.novel, openedBinding.value.scope)
    openedBinding.value = { ...openedBinding.value, novelId: props.novel.id, sourceVersionId: source.versionId, recordSnapshot: currentRecordSnapshot() }
    candidate.value = null
    notice.value = '已重新载入当前来源，标题和回顾草稿已保留。'
    error.value = ''
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
}
function sourceStillCurrent(binding: FormBinding) {
  if (binding.novelId !== props.novel.id || !binding.sourceVersionId) return false
  try { return resolveStoryMemorySource(props.novel, binding.scope).versionId === binding.sourceVersionId && currentRecordSnapshot() === binding.recordSnapshot } catch { return false }
}
function assertBudget() {
  if (!Number.isSafeInteger(maxRequests.value) || maxRequests.value < 1 || !Number.isSafeInteger(maxTokens.value) || maxTokens.value < 1) throw new Error('预算必须至少允许 1 次请求和 1 token；尚未发送请求。')
}
function preparePlan(model: Parameters<typeof buildStoryMemorySummaryGraph>[1]): { plan: KnowledgeSummaryPlan; instructions: string; estimate: number; graph: ReturnType<typeof buildStoryMemorySummaryGraph> } {
  if (!openedBinding.value) throw new Error('请先打开一个回顾范围。')
  if (!sourceStillCurrent(openedBinding.value)) throw new Error('打开回顾后正文、范围或已保存记录发生变化，请重新载入当前来源。')
  const plan = planStoryMemorySummary(props.novel, openedBinding.value.scope, level.value)
  const instructions = config.getSkillPrompt('analysis')
  const graph = buildStoryMemorySummaryGraph(plan, model, instructions)
  const estimate = graph.estimatedTokens
  estimateText.value = '当前计划 ' + graph.nodes.filter(node => node.kind === 'leaf').length + ' 个叶子、' + graph.nodes.length + ' 个依赖节点、' + graph.plannedRequests + ' 次请求；保守估算 ' + estimate.toLocaleString() + ' token。预算：' + maxRequests.value.toLocaleString() + ' 次 / ' + maxTokens.value.toLocaleString() + ' token。'
  // Each missing node is admitted against the cumulative ledger; reused nodes cost zero.
  return { plan, instructions, estimate, graph }
}
function useCandidate() {
  if (busy.value || !candidate.value) return
  titleDraft.value = candidate.value.title; summaryDraft.value = candidate.value.summary
}
function authorDraftInput() {
  const binding = openedBinding.value
  if (!binding?.sourceVersionId) throw new Error('请先选择有效回顾范围')
  return { scope: clone(binding.scope), sourceVersionId: binding.sourceVersionId, openBaseline: binding.recordSnapshot || 'null', title: titleDraft.value, body: summaryDraft.value, level: level.value, tokenBudget: Number.isSafeInteger(maxTokens.value) && maxTokens.value > 0 ? maxTokens.value : undefined, requestLimit: Number.isSafeInteger(maxRequests.value) && maxRequests.value > 0 && maxRequests.value <= 4096 ? maxRequests.value : undefined }
}
async function saveDraft() {
  if (busy.value || !openedBinding.value) return
  const novelId = props.novel.id, draft = authorDraftInput()
  busy.value = true
  try {
    await draftWrite.catch(() => undefined)
    await queueAuthorDraft({ novelId, draft })
    draftWrite = Promise.resolve(); error.value = ''; notice.value = '作者草稿已保存；点击生成才会检查模型并发起请求。'
  } catch (cause) { error.value = String(cause) }
  finally { busy.value = false }
}
async function generate() {
  if (busy.value || !openedBinding.value) return
  const model = config.getModelForTask('review')
  if (!model) { error.value = '请先配置章节审查模型，用于生成故事回顾。'; return }
  try { assertBudget() } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); return }
  let prepared: ReturnType<typeof preparePlan>
  try { prepared = preparePlan(model) } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); return }
  const binding = clone(openedBinding.value), jobKey = selectedScopeKey.value, jobNovelId = props.novel.id
  busy.value = true
  try { await draftWrite } catch (cause) { busy.value = false; error.value = String(cause); return }
  const existing = workspace.getAiRuns(jobNovelId).slice().reverse().find(run => run.taskType === 'memory_update' && run.memoryTask && scopeKey(run.memoryTask.scope) === jobKey)
  if (existing && !isResumableStoryMemoryRun(existing)) { busy.value = false; error.value = '上一任务仍在停止或保存，请稍后继续。'; return }
  const run = existing || createMemoryUpdateRun(jobNovelId, { scope: binding.scope, sourceVersionId: binding.sourceVersionId!, openBaseline: binding.recordSnapshot || 'null', title: titleDraft.value, body: summaryDraft.value, level: level.value }, prepared.graph, maxTokens.value, maxRequests.value)
  busy.value = true; error.value = ''; notice.value = ''; progress.value = null; controller = new AbortController()
  const signal = controller.signal
  const isCurrent = () => !signal.aborted && controller?.signal === signal && !disposed && props.novel.id === jobNovelId && binding.novelId === jobNovelId && selectedScopeKey.value === jobKey && openedBinding.value?.sourceVersionId === binding.sourceVersionId && sourceStillCurrent(binding)
  try {
    const result = await continueStoryMemoryTask({ model, plan: prepared.plan, instructions: prepared.instructions, maxRequests: maxRequests.value, maxTokens: maxTokens.value, signal, isCurrent, persist: value => workspace.saveAiRun(jobNovelId, value), onProgress: value => { if (isCurrent()) progress.value = value } }, run, { title: titleDraft.value, body: summaryDraft.value, scope: binding.scope, sourceVersionId: binding.sourceVersionId!, openBaseline: binding.recordSnapshot || 'null', level: level.value })
    if (!isCurrent()) throw new Error('正文、范围或已保存回顾发生变化，旧候选未采用。')
    const saved = result.memoryTask?.candidate
    if (!saved) throw new Error('任务完成但没有完整候选，未保存。')
    candidate.value = { summary: saved.summary, coverage: clone(saved.coverage), sourceVersionId: saved.sourceVersionId, scopeKey: jobKey, title: saved.title, taskRunId: result.id, taskUpdatedAt: result.memoryTask?.updatedAt }
    summaryDraft.value = result.memoryTask?.bodyDraft || saved.summary
    titleDraft.value = result.memoryTask?.titleDraft || saved.title
    notice.value = 'AI 候选已生成，尚未保存；请检查后由作者确认。'
  } catch (cause) {
    if (!disposed && controller?.signal === signal && props.novel.id === jobNovelId) error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    if (controller?.signal === signal) { controller = undefined; busy.value = false; progress.value = null }
  }
}
async function confirmAuthor() {
  const binding = openedBinding.value
  if (busy.value || !binding || !summaryDraft.value.trim()) return
  if (!sourceStillCurrent(binding)) { error.value = '来源正文或已保存回顾已变化，未保存旧草稿；请重新载入当前来源后再确认。'; return }
  const unchangedCandidate = Boolean(candidate.value && candidate.value.scopeKey === scopeKey(binding.scope) && candidate.value.sourceVersionId === binding.sourceVersionId && candidate.value.summary === summaryDraft.value && candidate.value.title === titleDraft.value)
  const epoch = ++saveEpoch, jobNovelId = props.novel.id, jobKey = selectedScopeKey.value
  const isCurrent = () => !disposed && epoch === saveEpoch && props.novel.id === jobNovelId && selectedScopeKey.value === jobKey
  saving.value = true; busy.value = true; error.value = ''; notice.value = ''
  try {
    await draftWrite
    const currentTask = candidate.value?.taskRunId ? workspace.getAiRun(jobNovelId, candidate.value.taskRunId) : undefined
    const saved = await workspace.saveStoryMemory(jobNovelId, { id: selectedRecord.value?.id || crypto.randomUUID(), title: titleDraft.value.trim(), scope: clone(binding.scope), summary: summaryDraft.value.trim(), expectedSourceVersionId: binding.sourceVersionId!, expectedRecord: binding.recordSnapshot, origin: unchangedCandidate ? 'ai' : 'author', ...(unchangedCandidate ? { coverage: clone(candidate.value!.coverage) } : {}), ...(candidate.value?.taskRunId ? { taskRunId: candidate.value.taskRunId, expectedTaskUpdatedAt: currentTask?.memoryTask?.updatedAt } : {}) })
    if (!isCurrent()) return
    openedBinding.value = { novelId: jobNovelId, scope: clone(saved.scope), sourceVersionId: saved.source.sourceVersionId, recordSnapshot: JSON.stringify(clone(saved)) }
    selectedScopeKey.value = scopeKey(saved.scope); candidate.value = null; titleDraft.value = saved.title; summaryDraft.value = saved.summary
    notice.value = getStoryMemoryStatus(props.novel, saved) === 'current'
      ? unchangedCandidate ? 'AI 候选已由作者确认并保存，原文覆盖记录已保留。' : '作者核对后的故事回顾已保存。'
      : '回顾已保存，但保存期间来源发生变化；请重新核对。'
  } catch (cause) { if (isCurrent()) error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { if (epoch === saveEpoch) { saving.value = false; busy.value = false } }
}
function cancel() {
  if (!controller) return
  controller.abort(new DOMException('作者取消故事回顾生成', 'AbortError'))
  notice.value = '正在取消并保存请求账本，已完成节点和草稿会保留。'
}

function resetForNovel() {
  selectedScopeKey.value = ''; openedBinding.value = null; summaryDraft.value = ''; titleDraft.value = ''; candidate.value = null; estimateText.value = ''; builderError.value = ''; builderKind.value = 'book'; builderVolumeId.value = ''; builderThroughChapterId.value = ''; builderSceneChapterId.value = ''; builderSceneText.value = ''; builderSceneStart.value = 0; builderSceneEnd.value = 0
}
watch([() => props.novel.id, () => props.ready], async () => {
  const novelId = props.novel.id
  if (controller) { controller.abort(new DOMException('切换作品，取消故事回顾生成', 'AbortError')); controller = undefined }
  saveEpoch++; saving.value = false; busy.value = false; progress.value = null; error.value = ''; notice.value = ''; resetForNovel()
  if (!ready.value) return
  syncBuilderDefaults()
  try { await workspace.hydrateFromPersistence(novelId) }
  catch (cause) {
    if (!disposed && props.novel.id === novelId) error.value = '故事记忆读取失败：' + (cause instanceof Error ? cause.message : String(cause))
    return
  }
  if (disposed || props.novel.id !== novelId) return
  if (!selectedScopeKey.value && scopeOptions.value[0]) openScope(scopeOptions.value[0])
}, { immediate: true })
watch([titleDraft, summaryDraft], () => {
  if (openingDraft || busy.value || disposed || !openedBinding.value?.sourceVersionId) return
  const novelId = props.novel.id, draft = authorDraftInput()
  void queueAuthorDraft({ novelId, draft }).catch(() => undefined)
}, { flush: 'sync' })
watch(builderThroughChapters, chapters => {
  if (!chapters.some(chapter => chapter.id === builderThroughChapterId.value)) builderThroughChapterId.value = chapters.filter(chapter => chapter.content.trim()).slice(-1)[0]?.id || chapters[0]?.id || ''
})
watch(builderSceneChapter, chapter => { if (chapter && !builderSceneEnd.value) builderSceneEnd.value = chapter.content.length })
onBeforeUnmount(() => { disposed = true; if (!pendingAuthorDrafts.size) unregisterDraftSaver(); controller?.abort(new DOMException('离开故事回顾页面', 'AbortError')) })
</script>

<style scoped>
.story-memory-panel { display: grid; gap: 18px; max-width: 1220px; }
.panel-header, .scope-builder-heading, .editor-heading, .scope-heading, .progress-header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
h2, h3, h4, p { margin-top: 0; } .panel-header h2, .editor-heading h3, .scope-heading h3 { margin-bottom: 0; }
.panel-header p, .editor-heading p, .scope-builder p, .level-hint, .loading, .empty, .chapter-links p, .memory-empty span { color: var(--ink-2); line-height: 1.7; }
.panel-header p { max-width: 800px; margin: 8px 0 0; } .memory-principle, .eyebrow, .scope-status, .record-origin { white-space: nowrap; font-size: 12px; }
.memory-principle { color: var(--zhu); padding: 6px 10px; border-radius: 999px; background: var(--zhu-soft); }
.scope-builder, .memory-scopes, .memory-editor, .memory-empty { border: 1px solid var(--line-2); border-radius: 10px; background: var(--paper); padding: 18px; }
.scope-builder { display: grid; gap: 14px; } .scope-builder-heading { align-items: center; } .scope-builder-heading h3 { margin-bottom: 5px; } .scope-builder-heading p { margin-bottom: 0; }
.builder-fields, .editor-tools { display: flex; gap: 12px; align-items: end; flex-wrap: wrap; } label { display: grid; gap: 6px; } select, input, textarea, button { font: inherit; color: var(--ink); } select, input, textarea { padding: 9px; border: 1px solid var(--line-2); border-radius: 6px; background: var(--desk); }
button { padding: 9px 14px; border: 1px solid var(--line-2); border-radius: 6px; background: var(--desk); cursor: pointer; } button.primary { color: white; background: var(--zhu); border-color: var(--zhu); } button.cancel { color: var(--zhu); } button:disabled { opacity: .5; cursor: default; }
.builder-error, .message.error { color: var(--zhu); } .message { margin: 0; padding: 10px 12px; border-radius: 6px; } .message.error { background: color-mix(in srgb, var(--zhu) 10%, transparent); } .message.notice { color: var(--qing); background: color-mix(in srgb, var(--qing) 10%, transparent); }
.memory-layout { display: grid; grid-template-columns: minmax(250px, 310px) minmax(0, 1fr); gap: 18px; align-items: start; } .scope-heading { align-items: baseline; margin-bottom: 10px; } .scope-heading span { color: var(--ink-2); font-size: 12px; }
.scope-option { width: 100%; display: flex; justify-content: space-between; gap: 8px; text-align: left; padding: 11px; margin: 4px 0; color: var(--ink); background: transparent; border-color: transparent; } .scope-option:hover, .scope-option.selected { background: var(--desk); border-color: var(--zhu); }
.scope-option-main { display: grid; min-width: 0; gap: 4px; } .scope-option-main strong, .scope-option-main small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .scope-option-main small { color: var(--ink-2); } .scope-status { align-self: center; } .scope-status.current { color: var(--qing); } .scope-status.stale { color: var(--jin); } .scope-status.unverified { color: var(--zhu); }
.chapter-links { margin-top: 20px; padding-top: 15px; border-top: 1px solid var(--line-2); } .chapter-links h4 { margin-bottom: 6px; } .chapter-links p { font-size: 12px; } .chapter-links a { display: block; margin: 7px 0; color: var(--zhu); font-size: 13px; }
.memory-editor { display: grid; gap: 16px; min-width: 0; } .eyebrow { color: var(--ink-2); } .editor-heading p { margin: 7px 0 0; } .record-origin { width: fit-content; justify-self: start; padding: 5px 9px; border-radius: 999px; background: var(--zhu-soft); color: var(--zhu); } .record-origin.author { color: var(--qing); }
.stale-warning, .candidate-banner { display: grid; gap: 4px; padding: 11px 13px; border-left: 3px solid var(--jin); background: color-mix(in srgb, var(--jin) 10%, transparent); } .candidate-banner { border-left-color: var(--zhu); background: var(--zhu-soft); } .stale-warning span, .candidate-banner span { color: var(--ink-2); font-size: 13px; }
.level-hint, .estimate { margin: -8px 0 0; font-size: 12px; } .estimate { color: var(--zhu); } .title-field input, .summary-field textarea { width: 100%; box-sizing: border-box; } .summary-field textarea { resize: vertical; line-height: 1.7; } .summary-field small, .source-details { color: var(--ink-2); font-size: 12px; }
.source-preview, .history { border: 1px solid var(--line-2); border-radius: 7px; padding: 10px 12px; } .source-preview summary, .history summary { cursor: pointer; font-weight: 600; } .preview-disclaimer { color: var(--ink-2); font-size: 12px; line-height: 1.6; } .source-preview article, .history article { padding: 9px 0; border-top: 1px solid var(--line-2); } .source-preview article div, .history article div { display: flex; justify-content: space-between; gap: 12px; } .source-preview article a { color: var(--zhu); font-size: 12px; } .source-preview article p, .history article p { margin: 5px 0 0; color: var(--ink-2); white-space: pre-wrap; line-height: 1.6; } .history time { color: var(--ink-2); font-size: 12px; }
.progress-panel { display: grid; gap: 6px; padding: 12px; background: var(--desk); border-radius: 7px; } progress { width: 100%; height: 8px; } .editor-actions { display: flex; gap: 10px; flex-wrap: wrap; } .source-details { display: flex; gap: 14px; flex-wrap: wrap; margin: 0; } .source-details div { display: grid; gap: 3px; } .source-details dt { font-weight: 600; } .source-details dd { margin: 0; word-break: break-all; }
.memory-empty { display: grid; gap: 8px; min-height: 180px; place-content: center; text-align: center; }
.memory-scopes { max-height: 650px; overflow: auto; }
.chapter-links summary { cursor: pointer; font-weight: 600; }
.builder-fields label, .editor-tools label { max-width: 100%; min-width: 0; }
.builder-fields select, .builder-fields input, .builder-fields textarea, .editor-tools input, .editor-tools select { max-width: 100%; box-sizing: border-box; }
.scene-quote-field { flex: 1 0 100%; }
.scene-quote-field textarea { width: 100%; min-height: 96px; line-height: 1.7; resize: vertical; }
.scene-match { margin: 0; color: var(--zhu); font-size: 12px; }
.scene-match.valid { color: var(--qing); }
.advanced-offsets { font-size: 12px; }
@media (max-width: 1100px) { .panel-header, .scope-builder-heading, .editor-heading { display: grid; } .memory-layout { grid-template-columns: minmax(0, 1fr); } .memory-scopes { max-height: 300px; } }
</style>
