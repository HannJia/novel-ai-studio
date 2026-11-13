<template>
  <section class="history-panel paper-panel" aria-labelledby="project-history-title">
    <h2 id="project-history-title">项目历史与单作品恢复</h2>
    <p>{{ desktop ? '桌面每次持久化提交都会保留快照，也可手动建立恢复点。' : '可为作品手动保存本地恢复点；记录保存在当前浏览器中，清除浏览器数据会同时清除这些记录。' }}</p>
      <p>先选择作品和版本，查看只读快照与差异，再明确确认恢复。</p>
      <div v-if="desktop" class="history-retention">
      <h3>自动版本保留</h3>
      <p>裁剪版本只会停止恢复该快照；提交记录、正文、Canon 与计费账本仍保留。</p>
      <p v-if="retentionError" role="alert">{{ retentionError }}</p><p v-if="retentionNotice" role="status">{{ retentionNotice }}</p>
      <template v-if="retention">
        <label>保留最近版本数（空白表示不按数量限制）<input v-model.number="retentionKeepLatest" type="number" min="1" max="1000000" :disabled="busy" @input="resetRetentionPreview" /></label>
        <label>保留此日期之后的版本（可空）<input v-model="retentionKeepSince" type="datetime-local" :disabled="busy" @input="resetRetentionPreview" /></label>
        <fieldset :disabled="busy">
          <legend>固定可恢复版本</legend>
          <label v-for="entry in entries" :key="entry.revision" class="retention-pin">
            <input v-model="retentionPins" type="checkbox" :value="entry.revision" :disabled="!!entry.prunedAt" @change="resetRetentionPreview" />
            {{ entry.createdAt }} · {{ entry.label || '自动快照' }} · {{ entry.revision.slice(0, 16) }}
          </label>
        </fieldset>
        <button :disabled="busy" @click="previewRetention">预览保留策略</button>
        <div v-if="retentionPreview" class="retention-preview">
        <template v-if="!retentionPreviewStale">
          <p>将停止恢复 {{ retentionPreview.prunedRevisions.length }} 个版本；提交记录及正文不会删除。</p>
          <ul><li v-for="item in retentionPreview.prunedRevisions" :key="item">{{ historyLabel(item) }}</li></ul>
          <p>请求账本归档来源：{{ retentionPreview.archiveSources.length }}</p>
          <ul><li v-for="source in retentionPreview.archiveSources" :key="source.revision + source.projectId">
            {{ historyLabel(source.revision) }} · {{ bookLabel(source.projectId) }} · 快照 {{ source.snapshot.slice(0, 16) }}
          </li></ul>
          <label><input v-model="retentionAcknowledged" type="checkbox" :disabled="busy" />我已确认以上版本将不可恢复，相关请求账本会保留</label>
          <button :disabled="busy || !retentionAcknowledged" @click="confirmRetention">确认应用保留策略</button>
          <button :disabled="busy" @click="cancelRetentionPreview">取消预览</button>
        </template>
        <p v-else role="status">保留条件已更改；请重新预览后确认。</p>
        <button v-if="retentionPreviewStale" type="button" :disabled="busy" @click="cancelRetentionPreview">关闭过期预览</button>
      </div>
    </template>
      <p v-else role="status">正在读取桌面保留策略…</p>
    </div>
    <div v-else class="history-retention">
      <h3>历史保留策略</h3><p>浏览器存储不支持作者控制的版本裁剪；可管理桌面项目历史。</p>
    </div>
    <div class="history-actions">
      <label>作品<select v-model="novelId" :disabled="busy" @change="clearPreview"><option value="">请选择作品</option><option v-for="book in books" :key="book.id" :value="book.id">{{ book.title }}</option></select></label>
      <button :disabled="busy || !currentBook" @click="checkpoint">为该作品保存手动恢复点</button>
      <button :disabled="busy" @click="refresh">刷新版本列表</button>
    </div>
    <div v-if="desktop" class="history-index">
      <h3>作品索引</h3>
      <p>作品索引是已保存内容的辅助目录。检查发现异常时，可从正式内容重建。</p>
      <button :disabled="busy || !currentBook" @click="inspectIndex">检查所选作品索引</button>
      <button :disabled="busy || !currentBook" @click="repairIndex">从正式内容重建索引</button>
      <p v-if="indexStatus" role="status">上次检查结果：{{ indexStatus.reason }}。后续保存后可重新检查。</p>
      <p v-for="warning in projectIndexWarnings.filter(row => row.projectId === novelId)" :key="warning.projectId" role="alert">正式内容已保存；曾有一次索引更新未完成，请检查当前状态或重建。{{ warning.message }}</p>
      <details v-if="indexStatus"><summary>索引版本信息</summary><p>检查时的正式快照：{{ indexStatus.snapshot }}<br />所需索引格式版本：{{ indexStatus.schemaVersion }} · 所需数据版本：{{ indexStatus.dataVersion }}</p></details>
    </div>
    <div class="history-capacity">
      <h3>历史容量与保留</h3>
      <p>{{ desktop ? '统计当前设备全部作品的项目存储。' : '统计当前浏览器保存的恢复点记录。' }}</p>
      <p>默认保留全部恢复点。先预览容量和保护范围，再由作者确认清理孤立文件。</p>
      <button :disabled="busy" @click="inspectCapacity">预览历史容量与可回收文件</button>
      <div v-if="capacity">
        <p>{{ desktop ? '项目文件' : '恢复点记录' }}：{{ capacity.totalFiles }} 项，{{ formatBytes(capacity.totalBytes) }}；保护 {{ capacity.protectedVersions }} 个版本。</p>
        <p>本次可回收 {{ capacity.reclaimableFiles }} 个文件，{{ formatBytes(capacity.reclaimableBytes) }}。</p>
        <ul><li v-for="reason in capacity.protectedReasons" :key="reason">{{ reason }}</li></ul>
        <p v-for="limit in capacity.limitations" :key="limit">{{ limit }}</p>
        <template v-if="desktop && capacity.reclaimableFiles">
          <label><input v-model="cleanupAcknowledged" type="checkbox" :disabled="busy" />我已核对保护范围，确认仅清理预览中的孤立文件。</label>
          <button :disabled="busy || !cleanupAcknowledged" @click="cleanCapacity">确认清理本次可回收文件</button>
        </template>
      </div>
    </div>
    <p v-if="!entries.length">尚无恢复点。保存第一个手动恢复点后即可查看历史。</p>
    <label>历史版本<select v-model="revision" :disabled="busy" @change="selectVersion"><option value="">请选择版本</option><option v-for="entry in entries" :key="entry.revision" :value="entry.revision">{{ entry.createdAt }} · {{ entry.label || '自动快照' }} · {{ entry.pinned ? '固定' : '' }}{{ entry.prunedAt ? '已裁剪（不可恢复）' : '' }} · {{ entry.revision.slice(0, 16) }}</option></select></label>
    <p v-if="selectedEntry?.prunedAt" role="status">此版本已裁剪，仅保留审计记录与付费账本，不可预览或恢复。</p>
    <p v-if="selectedEntry?.action">记录：{{ selectedEntry.action.label }}；作品 ID：{{ selectedEntry.action.novelId }}<span v-if="selectedEntry.action.sourceRevision">；来源版本：{{ selectedEntry.action.sourceRevision }}</span></p>
    <button :disabled="busy || !revision || !novelId || !!selectedEntry?.prunedAt" @click="preview">只读预览与当前版本比较</button>
    <p v-if="error" role="alert">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p>
    <div v-if="comparison">
      <h3>{{ comparison.historical.novel?.title }} · 历史快照</h3>
      <p>{{ comparison.diff.scopeStatement }}</p>
      <p v-for="note in comparison.diff.budgetNotes" :key="note">{{ note }}</p>
      <label>查看历史章节<select v-model="chapterId"><option value="">请选择章节</option><option v-for="chapter in historicalChapters" :key="chapter.id" :value="chapter.id">{{ chapter.title }}</option></select></label>
      <textarea v-if="historicalChapter" :value="historicalChapter.content" readonly aria-label="历史章节正文，只读" rows="12" />
      <label>查看快照记录（含无变化的作者历史）<select v-model="snapshotSection" @change="snapshotRow = ''; snapshotDetail = ''"><option value="">请选择记录类型</option><option v-for="section in snapshotSections" :key="section.key" :value="section.key">{{ section.label }}</option></select></label>
      <label v-if="snapshotSection">历史记录<select v-model="snapshotRow" @change="showSnapshotRow"><option value="">请选择记录</option><option v-for="(row, index) in snapshotRows" :key="index" :value="String(index)">{{ row.title || row.name || row.id || '作品设定' }}</option></select></label>
      <pre v-if="snapshotDetail" aria-label="历史记录，只读">{{ snapshotDetail }}</pre>
      <p>差异方向：当前 → 所选历史版本。账本实际恢复采用累计合并；审核和任务状态会按上方规则停用。</p>
      <details v-for="section in comparison.diff.sections" :key="section.key">
        <summary>{{ section.label }}：{{ section.summary }}</summary>
        <ul><li v-for="change in section.changes" :key="change.id">
          <button @click="showChange(change)">{{ kinds[change.kind] }} · {{ change.label }}</button>
          <span> {{ change.changedFields.join('、') }}</span>
        </li></ul>
      </details>
      <div v-if="changeDetail" class="history-diff"><h4>{{ changeDetail.label }}</h4><pre>{{ changeDetail.value }}</pre></div>
      <div class="history-confirm">
        <label><input v-model="acknowledged" type="checkbox" :disabled="busy" />我已查看差异，选择仅恢复这部作品；旧审核需要重审，付费任务不会自动继续。</label>
        <label>输入作品名以确认<input v-model="confirmationTitle" :disabled="busy" autocomplete="off" /></label>
        <button :disabled="busy || !acknowledged || confirmationTitle !== comparison.historical.novel?.title" @click="restore">恢复《{{ comparison.historical.novel?.title }}》</button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useNovelStore } from '@/stores/novel'
import { usesProjectKernel, inspectProjectIndex, projectIndexWarnings, readKernelHistoryRetention, previewKernelHistoryRetention, confirmKernelHistoryRetention } from '@/services/projectKernelClient'
import { listProjectHistory, readHistorySnapshot, previewProjectHistory, restoreProjectHistory, createProjectHistoryPoint, rebuildCurrentProjectIndex, previewProjectHistoryCapacity, cleanupProjectHistoryCapacity } from '@/services/projectHistory'
import type { ProjectIndexStatus } from '@/types/projectKernel'
import { historyTextDiff } from '@/services/projectHistoryDiff'
import type { ProjectHistoryChange, ProjectHistoryEntry, ProjectHistoryPreview, ProjectHistoryCapacity, ProjectHistoryRetentionState, ProjectHistoryRetentionPreview } from '@/types/projectHistory'

const novels = useNovelStore(), desktop = usesProjectKernel()
const busy = ref(false), error = ref(''), notice = ref(''), novelId = ref(''), revision = ref(''), chapterId = ref('')
const entries = shallowRef<ProjectHistoryEntry[]>([]), historicalBooks = shallowRef<Array<{ id: string; title: string }>>([])
const selectedEntry = computed(() => entries.value.find(row => row.revision === revision.value))
const comparison = shallowRef<ProjectHistoryPreview | null>(null)
const indexStatus = shallowRef<ProjectIndexStatus | null>(null)
const capacity = shallowRef<ProjectHistoryCapacity | null>(null), cleanupAcknowledged = ref(false)
const retention = shallowRef<ProjectHistoryRetentionState | null>(null)
const retentionPreview = shallowRef<ProjectHistoryRetentionPreview | null>(null)
const retentionKeepLatest = ref<number | null>(null), retentionKeepSince = ref(''), retentionPins = ref<string[]>([])
const retentionAcknowledged = ref(false), retentionError = ref(''), retentionNotice = ref('')
const retentionPreviewStale = ref(false)
const acknowledged = ref(false), confirmationTitle = ref('')
const kinds = { added: '新增', removed: '删除', changed: '修改' }
const changeDetail = shallowRef<{ label: string; value: string } | null>(null)
const detailCache = new Map<string, string>()
const snapshotSection = ref(''), snapshotRow = ref(''), snapshotDetail = ref('')
const snapshotSections = [
  { key: 'settings', label: '作品设定' }, { key: 'novel.inspirationHistory', label: '该书灵感会话' },
  { key: 'novel.chatHistory', label: '作品对话' }, { key: 'novel.dataPanelChanges', label: '数据决定' }, { key: 'novel.storyStateProposals', label: '故事状态提案' },
  { key: 'novel.volumes', label: '分卷' }, { key: 'novel.characters', label: '人物' }, { key: 'novel.eventLog', label: '事件' },
  { key: 'novel.chapterPlans', label: '章纲' }, { key: 'novel.storyArcs', label: '剧情弧线' }, { key: 'novel.dataPanels', label: '数据面板' },
  { key: 'chapterRevisions', label: '章节修订历史' }, { key: 'workspace.creationDraft', label: '创建与场景规划' },
  { key: 'workspace.candidates', label: '候选与作者决定' }, { key: 'workspace.canonMutations', label: 'Canon 决定历史' },
  { key: 'workspace.chapterReviews', label: '章节审核' }, { key: 'workspace.reviewFindings', label: '审核发现' },
  { key: 'workspace.storyMemories', label: '故事记忆' }, { key: 'workspace.impactReports', label: '影响报告' }, { key: 'workspace.aiRuns', label: '任务与账本' },
]
const snapshotRows = computed<Record<string, unknown>[]>(() => {
  const scope = comparison.value?.historical
  if (!scope || !snapshotSection.value) return []
  if (snapshotSection.value === 'settings') return [Object.fromEntries(Object.entries(scope.novel || {}).filter(([, value]) => !Array.isArray(value)))]
  if (snapshotSection.value === 'chapterRevisions') return scope.chapterRevisions as unknown as Record<string, unknown>[]
  const [owner, key] = snapshotSection.value.split('.')
  const value = (scope[owner as 'novel' | 'workspace'] as unknown as Record<string, unknown> | null)?.[key]
  return (Array.isArray(value) ? value : value ? [value] : []) as Record<string, unknown>[]
})
function showSnapshotRow() { snapshotDetail.value = snapshotRow.value === '' ? '' : JSON.stringify(snapshotRows.value[Number(snapshotRow.value)], null, 2) }
const books = computed(() => [...new Map([...novels.novels, ...historicalBooks.value].map(book => [book.id, { id: book.id, title: book.title }])).values()])
const currentBook = computed(() => novels.getNovel(novelId.value))
const historicalChapters = computed(() => [...(comparison.value?.historical.novel?.chapters || []), ...(comparison.value?.historical.novel?.archivedChapters || [])])
const historicalChapter = computed(() => historicalChapters.value.find(row => row.id === chapterId.value))
function clearPreview() { comparison.value = null; indexStatus.value = null; acknowledged.value = false; confirmationTitle.value = ''; chapterId.value = ''; changeDetail.value = null; detailCache.clear(); snapshotSection.value = ''; snapshotRow.value = ''; snapshotDetail.value = '' }
function resetRetentionPreview() {
  if (retentionPreview.value) retentionPreviewStale.value = true
  retentionAcknowledged.value = false
  retentionError.value = ''; retentionNotice.value = ''
}
async function work(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try { await action() } catch (cause) {
    error.value = cause instanceof Error && cause.name === 'QuotaExceededError'
      ? '浏览器本地存储空间不足，本次操作未完成。请先从书架导出项目备份，再使用桌面版继续管理历史；已有恢复点不会自动删除。'
      : cause instanceof Error ? cause.message : String(cause)
  } finally { busy.value = false }
}
async function refresh() { await work(async () => { clearPreview(); entries.value = await listProjectHistory(); if (desktop) await loadRetention() }) }
async function inspectIndex() { await work(async () => { indexStatus.value = null; indexStatus.value = await inspectProjectIndex(novelId.value) }) }
async function repairIndex() { await work(async () => { indexStatus.value = null; indexStatus.value = await rebuildCurrentProjectIndex(novelId.value); notice.value = '作品索引已从正式内容重建。' }) }
function historyLabel(revision: string) { const entry = entries.value.find(row => row.revision === revision); return entry ? entry.createdAt + ' · ' + (entry.label || '自动快照') + ' · ' + revision.slice(0, 16) : revision }
function bookLabel(projectId: string) { return books.value.find(book => book.id === projectId)?.title || projectId }
function cancelRetentionPreview() { retentionPreview.value = null; retentionAcknowledged.value = false; retentionPreviewStale.value = false }
async function loadRetention() {
  if (!desktop) return
  const state = await readKernelHistoryRetention()
  retention.value = state
  retentionKeepLatest.value = state.policy.keepLatest
  retentionKeepSince.value = state.policy.keepSince ? new Date(state.policy.keepSince).toISOString().slice(0, 16) : ''
  retentionPins.value = [...state.pinnedRevisions]
}
async function previewRetention() {
  resetRetentionPreview()
  const keepLatest = retentionKeepLatest.value
  if (keepLatest !== null && (!Number.isSafeInteger(keepLatest) || keepLatest < 1 || keepLatest > 1000000)) {
    retentionError.value = '保留数量须为 1 至 1000000，或留空。'; return
  }
  await work(async () => {
    if (retentionKeepSince.value && !Number.isFinite(Date.parse(retentionKeepSince.value))) throw new Error('保留日期无效。')
    const keepSince = retentionKeepSince.value ? new Date(retentionKeepSince.value).toISOString() : null
    retentionPreview.value = await previewKernelHistoryRetention({ keepLatest, keepSince }, retentionPins.value)
    retentionAcknowledged.value = false
    retentionPreviewStale.value = false
  })
}
async function confirmRetention() {
  const preview = retentionPreview.value
  if (!preview || !retentionAcknowledged.value || retentionPreviewStale.value) return
  retentionError.value = ''; retentionNotice.value = ''
  await work(async () => {
    retentionError.value = ''; retentionNotice.value = ''
    await confirmKernelHistoryRetention(preview.token, preview.baseRevision)
    const [nextRetention, nextEntries] = await Promise.all([readKernelHistoryRetention(), listProjectHistory()])
    retention.value = nextRetention
    entries.value = nextEntries
    retentionKeepLatest.value = nextRetention.policy.keepLatest
    retentionKeepSince.value = nextRetention.policy.keepSince ? new Date(nextRetention.policy.keepSince).toISOString().slice(0, 16) : ''
    retentionPins.value = [...nextRetention.pinnedRevisions]
    cancelRetentionPreview()
    retentionNotice.value = '保留策略已保存；提交记录、正文和请求账本仍保留。'
  })
}
function formatBytes(bytes: number) { return bytes < 1024 ? bytes + ' B' : bytes < 1024 * 1024 ? (bytes / 1024).toFixed(1) + ' KB' : (bytes / (1024 * 1024)).toFixed(1) + ' MB' }
async function inspectCapacity() { await work(async () => { capacity.value = null; cleanupAcknowledged.value = false; capacity.value = await previewProjectHistoryCapacity() }) }
async function cleanCapacity() {
  const preview = capacity.value
  if (!preview || !cleanupAcknowledged.value) return
  await work(async () => {
    capacity.value = null; cleanupAcknowledged.value = false
    const result = await cleanupProjectHistoryCapacity(preview)
    notice.value = '已清理 ' + result.removedFiles + ' 个文件，' + formatBytes(result.removedBytes) + '；跳过 ' + result.skippedFiles + ' 个变化或暂时无法清理的文件。全部恢复点保留。'
  })
}
async function selectVersion() { clearPreview(); historicalBooks.value = []; if (revision.value) await work(async () => {
  if (selectedEntry.value?.prunedAt) throw new Error('该版本已裁剪，不可恢复。')
  historicalBooks.value = (await readHistorySnapshot(revision.value)).novels.map(book => ({ id: book.id, title: book.title }))
}) }
async function checkpoint() { await work(async () => { await createProjectHistoryPoint(novelId.value); clearPreview(); entries.value = await listProjectHistory(); if (desktop) await loadRetention(); notice.value = '手动恢复点已保存。' }) }
async function preview() { await work(async () => { if (selectedEntry.value?.prunedAt) throw new Error('该版本已裁剪，不可恢复。'); clearPreview(); comparison.value = await previewProjectHistory(revision.value, novelId.value) }) }
async function restore() {
  const value = comparison.value
  if (!value || !acknowledged.value || confirmationTitle.value !== value.historical.novel?.title) return
  await work(async () => { await restoreProjectHistory(value.token); clearPreview(); entries.value = await listProjectHistory(); notice.value = '该作品已恢复并保存；恢复前保护点与作者历史可在版本列表中查看。' })
}
function showChange(change: ProjectHistoryChange) {
  if (!detailCache.has(change.id)) {
    const before = (change.before || {}) as Record<string, unknown>, after = (change.after || {}) as Record<string, unknown>
    detailCache.set(change.id, change.changedFields.map(field => {
      if (typeof before[field] === 'string' || typeof after[field] === 'string') {
        const diff = historyTextDiff(change, field)
        return field + '（' + diff.beforeLength + ' → ' + diff.afterLength + (diff.sameLength ? '，等长修改' : '') + '）\n' + diff.diff
      }
      return field + '\n当前：' + JSON.stringify(before[field], null, 2) + '\n历史：' + JSON.stringify(after[field], null, 2)
    }).join('\n\n'))
  }
  changeDetail.value = { label: change.label, value: detailCache.get(change.id)! }
}
onMounted(refresh)
</script>

    <style scoped>
.history-panel { padding: 24px; margin-top: 20px; }
.history-actions { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; }
.history-retention { border-top: 1px solid var(--line-2); margin-top: 16px; padding-top: 12px; }
.retention-pin { display: flex; align-items: center; gap: 8px; }
.retention-preview { border-left: 3px solid var(--line-2); padding-left: 12px; }
label { display: block; margin: 12px 0; }
select, textarea, input:not([type=checkbox]) { display: block; width: 100%; padding: 8px; color: var(--ink); background: var(--desk); border: 1px solid var(--line-2); border-radius: 6px; }
button { padding: 8px 12px; margin: 4px; cursor: pointer; }
button:disabled { cursor: default; opacity: .5; }
textarea { box-sizing: border-box; resize: vertical; }
details { margin: 12px 0; }
summary { cursor: pointer; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 60vh; overflow: auto; }
.history-confirm { margin-top: 24px; border-top: 1px solid var(--line-2); }
[role=alert] { color: var(--zhu); }
</style>
