<template>
  <div class="volume-page fade-in" id="volume-outline-page">
    <div class="volume-header">
      <div>
        <h2 class="volume-title">分卷大纲</h2><p class="volume-description">全书稳定主线和结局；当前卷详细展开，其余卷保持轮廓。</p>
      </div>
      <div class="header-actions" v-if="novel">
        <n-button size="small" :disabled="busy" @click="addManualVolume">+ 新增分卷</n-button>
        <n-button size="small" @click="generateVolumes" :loading="generating" :disabled="busy || !novel.outline || hasDrafts">
          AI 生成分卷规划
        </n-button>
        <n-button v-if="!props.compact && volumes.length" size="small" type="primary" :disabled="busy || props.chapterPlanConfirmed || hasDrafts" @click="emit('confirmed')">
          {{ props.chapterPlanConfirmed ? '已确认并生成章节计划' : '确认分卷并生成章节计划' }}
        </n-button>
      </div>
    </div>

    <div v-if="volumes.length && !generating" class="volume-master-detail">
      <section class="vols" aria-label="分卷大纲">
        <button
          v-for="vol in volumes"
          :key="vol.id"
          type="button"
          class="volc"
          :class="{ cur: selectedVolumeId === vol.id }"
          :aria-pressed="selectedVolumeId === vol.id"
          :aria-label="`选择第${vol.volumeIndex + 1}卷 ${vol.title || '未命名分卷'}`"
          :disabled="busy"
          @click="selectVolume(vol.id)"
        >
          <span class="vn">第{{ vol.volumeIndex + 1 }}卷</span>
          <h4>{{ vol.title || '未命名分卷' }}</h4>
          <dl>
            <dt>目标</dt><dd>{{ volumeCardField(vol, 'target') }}</dd>
            <dt>冲突</dt><dd>{{ volumeCardField(vol, 'conflict') }}</dd>
            <dt>转折</dt><dd>{{ volumeCardField(vol, 'turning') }}</dd>
            <dt>收束</dt><dd>{{ volumeCardField(vol, 'closure') }}</dd>
          </dl>
          <div class="chs" aria-label="真实章节">
            <template v-if="chapterNumbers(vol).length">
              <span v-for="chapterNumber in visibleChapterNumbers(vol)" :key="chapterNumber">第{{ chapterNumber }}章</span>
            </template>
            <span v-else>尚无已创建章节</span>
            <span>已建立 {{ chapterNumbers(vol).length }} 章</span>
            <span v-if="vol.estimatedChapters > 0">预计 {{ vol.estimatedChapters }} 章</span>
          </div>
        </button>
      </section>

      <main v-if="!props.compact || detailsOpen" class="volume-detail-panel">
        <button v-if="props.compact" type="button" class="collapse-detail" :disabled="busy || hasDrafts" @click="detailsOpen = false">收起分卷详情</button>
        <div v-if="selectedVolume" class="volume-detail-content">
          <div class="volume-detail-header">
            <div class="volume-detail-title-row">
              <span class="volume-index">第{{ selectedVolume.volumeIndex + 1 }}卷</span>
              <h3>{{ selectedVolume.title }}</h3>
              <span v-if="selectedVolume.theme" class="volume-badge">{{ selectedVolume.theme }}</span>
            </div>
            <div class="volume-meta">
              <span>预估 {{ selectedVolume.estimatedChapters || '待定' }} 章</span>
              <span>·</span>
              <span>{{ selectedVolume.estimatedWordCount || '待定' }} 万字</span>
            </div>
          </div>

          <template v-if="editingId === selectedVolume.id">
            <div class="edit-form">
              <label>卷名</label>
              <n-input v-model:value="editForm.title" size="small" :disabled="saving" />
              <label>主题</label>
              <n-input v-model:value="editForm.theme" size="small" :disabled="saving" />
              <label>剧情概要</label>
              <n-input v-model:value="editForm.summary" type="textarea" :rows="4" size="small" :disabled="saving" />
              <label>关键转折点</label>
              <n-input v-model:value="editForm.keyTurningPoints" type="textarea" :rows="2" size="small" :disabled="saving" />
              <label>角色变化</label>
              <n-input v-model:value="editForm.characterChanges" type="textarea" :rows="2" size="small" :disabled="saving" />
              <label>预估章节数</label>
              <n-input-number v-model:value="editForm.estimatedChapters" :min="1" :precision="0" size="small" :disabled="saving" />
              <label>预估字数（万字）</label>
              <n-input-number v-model:value="editForm.estimatedWordCount" :min="0.1" :precision="3" size="small" :disabled="saving" />
              <div class="edit-actions">
                <n-button size="small" :disabled="busy" @click="cancelEdit">取消</n-button>
                <n-button size="small" type="primary" :disabled="busy" :loading="saving" @click="saveEdit(selectedVolume.id)">保存</n-button>
              </div>
            </div>
          </template>

          <template v-else>
            <div class="detail-section" v-if="selectedVolume.summary">
              <h4>剧情概要</h4>
              <div class="volume-summary" v-html="renderMd(selectedVolume.summary)"></div>
            </div>
            <div class="detail-section" v-if="selectedVolume.keyTurningPoints">
              <h4>关键转折点</h4>
              <p>{{ selectedVolume.keyTurningPoints }}</p>
            </div>
            <div class="detail-section" v-if="selectedVolume.characterChanges">
              <h4>角色变化</h4>
              <p>{{ selectedVolume.characterChanges }}</p>
            </div>
            <section v-if="selectedVolumeChapters.length" class="volume-chapter-outline">
              <h4>已创建章节（{{ selectedVolumeChapters.length }} 章）</h4>
              <ol><li v-for="chapter in selectedVolumeChapters" :key="chapter.id"><span>第 {{ chapter.chapterIndex + 1 }} 章</span><strong>{{ chapterTitleForDisplay(chapter.title, chapter.chapterIndex) }}</strong><p v-if="chapter.summary">{{ chapter.summary }}</p><small v-if="chapter.summary && getChapterSummaryStatus(chapter) !== 'current'">总结待核对，暂不用于 AI 写作和审核。</small></li></ol>
            </section>
            <div class="volume-actions">
              <n-button size="small" :disabled="busy" @click="startEdit(selectedVolume)">编辑</n-button>
              <n-button v-if="hasEstimateConflict(selectedVolume)" size="small" :disabled="busy" @click="syncEstimates(selectedVolume)">从概要同步预估</n-button>
              <n-button v-if="selectedVolume.versions?.length" size="small" :disabled="busy" @click="openVersionModal(selectedVolume)">版本 {{ selectedVolume.versions.length }}</n-button>
              <n-button size="small" :disabled="busy || hasDrafts" :loading="regeneratingId === selectedVolume.id" @click="regenerateVolume(selectedVolume)">局部重生成</n-button>
              <n-popconfirm @update:show="show => captureDeleteBaseline(show, selectedVolume!.id)" @positive-click="removeVolume(selectedVolume.id)">
                <template #trigger>
                  <n-button size="small" type="error" :disabled="busy" quaternary>删除</n-button>
                </template>
                确定删除此分卷？
              </n-popconfirm>
            </div>
          </template>
        </div>
      </main>
    </div>

    <!-- 无总大纲提示 -->
    <div v-if="novel && !novel.outline" class="empty-state paper-panel">
      <div class="empty-icon"><svg class="ink-mountains" viewBox="0 0 220 80" aria-hidden="true"><path fill="currentColor" d="M0 80 L40 38 L62 56 L98 14 L130 50 L150 34 L188 66 L220 46 L220 80 Z" /></svg></div>
      <h3>请先生成总大纲</h3>
      <p>分卷规划需要基于总大纲生成</p>
      <n-button type="primary" @click="$router.push(`/outline/${novelId}`)">
        前往大纲页
      </n-button>
    </div>

    <!-- 无分卷 -->
    <div v-else-if="!volumes.length && !generating" class="empty-state paper-panel">
      <div class="empty-icon"><svg class="ink-mountains" viewBox="0 0 220 80" aria-hidden="true"><path fill="currentColor" d="M0 80 L40 38 L62 56 L98 14 L130 50 L150 34 L188 66 L220 46 L220 80 Z" /></svg></div>
      <h3>还没有分卷规划</h3>
      <p>AI 将根据总大纲自动规划每卷的剧情走向、章节数和字数</p>
      <n-button type="primary" @click="generateVolumes" :loading="generating" :disabled="busy">
        AI 生成分卷规划
      </n-button>
    </div>

    <!-- 生成中 -->
    <div v-if="generating" class="generating-hint paper-panel">
      <div class="typing-anim">AI 正在规划分卷结构…</div>
      <div v-if="streamContent" class="stream-preview" v-html="renderMd(streamContent)"></div>
      <div class="typing-cursor">▌</div>
    </div>



    <n-modal v-model:show="showVersionModal" preset="card" title="分卷规划版本对比" style="width: min(760px, calc(100vw - 32px));">
      <div v-if="versionVolume" class="version-dialog">
        <p><strong>第 {{ versionVolume.volumeIndex + 1 }} 卷 · {{ versionVolume.title }}</strong></p>
        <n-select v-model:value="selectedVersionId" :options="versionOptions" />
        <div v-if="versionDiff.length" class="version-diff-list">
          <div v-for="diff in versionDiff" :key="diff.field" class="version-diff-row">
            <strong>{{ diff.field }}</strong><span>{{ diff.before }}</span><span>→</span><span>{{ diff.after }}</span>
          </div>
        </div>
        <n-empty v-else description="当前版本与历史版本没有可见差异" />
        <div v-if="selectedVersionId" class="version-actions">
          <n-button type="warning" size="small" :disabled="busy" :loading="saving" @click="restoreSelectedVersion">恢复此版本</n-button>
        </div>
      </div>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, watch, onDeactivated, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import { NButton, NEmpty, NInput, NInputNumber, NModal, NPopconfirm, NSelect, useMessage } from 'naive-ui'
import { useNovelStore } from '@/stores/novel'
import { chapterTitleForDisplay } from '@/v3/write/chapterNumber'
import { useConfigStore } from '@/stores/config'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { callAI } from '@/services/ai'
import { buildVolumePlanningPrompt } from '@/services/prompts'
import { renderMd } from '@/utils/markdown'
import type { Volume } from '@/types/novel'
import { parseAiJsonObject } from '@/utils/aiJson'
import { comparePlanningVersions, type PlanningDiff } from '@/services/planningVersions'
import { parseVolumeEstimates, parseVolumesFromText } from '@/services/volumeParsing'
import { buildBoundKnowledgeContext } from '@/services/knowledgeContext'
import { getChapterSummaryStatus } from '@/services/derivedSources'

const props = withDefaults(defineProps<{
  compact?: boolean
  chapterPlanConfirmed?: boolean
}>(), { chapterPlanConfirmed: false })
const emit = defineEmits<{ confirmed: [] }>()

const route = useRoute()
const novelStore = useNovelStore()
const configStore = useConfigStore()
const workspace = useReconstructionWorkspaceStore()
const msg = useMessage()

const novelId = computed(() => route.params.novelId as string)
const novel = computed(() => novelStore.getNovel(novelId.value))
const volumes = computed(() => novel.value?.volumes || [])

const generating = ref(false)
const streamContent = ref('')
const selectedVolumeId = ref('')
const detailsOpen = ref(false)
const selectedVolume = computed(() => volumes.value.find(vol => vol.id === selectedVolumeId.value))
const selectedVolumeChapters = computed(() => selectedVolume.value ? (novel.value?.chapters || []).filter(chapter => chapter.volumeIndex === selectedVolume.value!.volumeIndex).sort((a, b) => a.chapterIndex - b.chapterIndex) : [])
type VolumeCardField = 'target' | 'conflict' | 'turning' | 'closure'

function textOrUnfilled(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : '未填写'
}

function summaryLabel(summary: string, label: '目标' | '冲突' | '转折' | '收束') {
  const line = summary.split(/\r?\n/)
    .map(item => item.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+)/, '').replace(/\*\*|__|`/g, '').trim())
    .find(item => item.startsWith(label + '：') || item.startsWith(label + ':'))
  return line ? textOrUnfilled(line.slice(label.length + 1)) : '未填写'
}

function volumeCardField(volume: Volume, field: VolumeCardField) {
  if (field === 'turning') {
    const turning = textOrUnfilled(volume.keyTurningPoints)
    return turning === '未填写' ? summaryLabel(volume.summary, '转折') : turning
  }
  if (field === 'target') return summaryLabel(volume.summary, '目标')
  if (field === 'conflict') return summaryLabel(volume.summary, '冲突')
  return summaryLabel(volume.summary, '收束')
}

function chapterNumbers(volume: Volume) {
  return (novel.value?.chapters || [])
    .filter(chapter => chapter.volumeIndex === volume.volumeIndex)
    .sort((a, b) => a.chapterIndex - b.chapterIndex)
    .map(chapter => chapter.chapterIndex + 1)
}

function visibleChapterNumbers(volume: Volume) {
  return chapterNumbers(volume).slice(0, 8)
}
const editingId = ref('')
const regeneratingId = ref('')
const saving = ref(false)
const busy = computed(() => saving.value || generating.value || !!regeneratingId.value)
type PlanningBaseline = ReturnType<typeof novelStore.capturePlanningEditBaseline>
const editBaseline = ref<PlanningBaseline>()
const versionBaseline = ref<PlanningBaseline>()
const deleteBaselines = new Map<string, PlanningBaseline>()
let generationController: AbortController | undefined
const abortGeneration = () => generationController?.abort(new DOMException('已离开分卷规划', 'AbortError'))
onDeactivated(abortGeneration)
onBeforeUnmount(abortGeneration)
const showVersionModal = ref(false)
const versionVolume = ref<Volume | null>(null)
const selectedVersionId = ref('')
const editForm = ref({ title: '', theme: '', summary: '', keyTurningPoints: '', characterChanges: '', estimatedChapters: 1, estimatedWordCount: 0.225 })
const volumeDrafts = reactive(new Map<string, { form: typeof editForm.value; baseline: PlanningBaseline }>())
const hasDrafts = computed(() => !!editingId.value || volumeDrafts.size > 0)
watch(novelId, () => {
  abortGeneration()
  volumeDrafts.clear(); deleteBaselines.clear()
  editingId.value = ''; editBaseline.value = undefined; selectedVolumeId.value = ''; detailsOpen.value = false
  showVersionModal.value = false; versionVolume.value = null; versionBaseline.value = undefined
})
const versionOptions = computed(() => (versionVolume.value?.versions || []).slice().reverse().map(version => ({
  label: `${version.label} · ${new Date(version.savedAt).toLocaleString('zh-CN')}`,
  value: version.id,
})))
const versionDiff = computed<PlanningDiff[]>(() => {
  const version = versionVolume.value?.versions?.find(item => item.id === selectedVersionId.value)
  return versionVolume.value ? comparePlanningVersions(version, versionVolume.value) : []
})

function selectVolume(id: string) {
  if (busy.value) return
  detailsOpen.value = true
  if (id === selectedVolumeId.value) return
  if (editingId.value) {
    if (editBaseline.value) volumeDrafts.set(editingId.value, { form: { ...editForm.value }, baseline: editBaseline.value })
    editingId.value = ''
  }
  selectedVolumeId.value = id
  const draft = volumeDrafts.get(id)
  if (draft) {
    editForm.value = { ...draft.form }
    editBaseline.value = draft.baseline
    editingId.value = id
  }
}

function cancelEdit() {
  if (busy.value) return
  volumeDrafts.delete(editingId.value)
  editingId.value = ''
  editBaseline.value = undefined
}

function initializeSelection() {
  if (volumes.value.length && !selectedVolumeId.value) {
    selectedVolumeId.value = volumes.value[0].id
  }
}

async function addManualVolume() {
  if (!novel.value || busy.value) return
  const volume: Volume = {
    id: crypto.randomUUID(), volumeIndex: Math.max(-1, ...volumes.value.map(item => item.volumeIndex)) + 1,
    title: '新分卷', theme: '', summary: '', keyTurningPoints: '', characterChanges: '',
    estimatedChapters: 1, estimatedWordCount: 0.225,
  }
  saving.value = true
  try {
    await novelStore.setVolumesWithImpact(novelId.value, [...volumes.value, volume])
    saving.value = false
    startEdit(volumes.value.find(item => item.id === volume.id)!)
  } catch (error) { msg.error(error instanceof Error ? error.message : '新增分卷失败') }
  finally { saving.value = false }
}

// AI 生成分卷规划
async function generateVolumes() {
  if (!novel.value || busy.value || hasDrafts.value) return
  const model = configStore.getModelForTask('outline')
  if (!model) { msg.error('未配置 AI 模型'); return }

  generating.value = true
  streamContent.value = ''
  const owner = novelId.value, baseline = novelStore.capturePlanningEditBaseline(owner)
  const directionBaseline = workspace.captureCreationEditBaseline(owner)
  const controller = generationController = new AbortController()

  try {
    const messages = buildVolumePlanningPrompt(novel.value, workspace.getCreationDraft(owner))
    const knowledgeContext = buildBoundKnowledgeContext(novel.value, `${novel.value.title}\n${novel.value.outline}`, 10, 900)
    const userMessage = messages.find(message => message.role === 'user')
    if (knowledgeContext && userMessage && typeof userMessage.content === 'string') {
      userMessage.content += `\n\n${knowledgeContext}\n\n请优先依据知识库中的事实、时间线和设定进行分卷规划。`
    }
    let fullContent = ''
    const result = await callAI({
      model,
      skillTask: 'planning',
      messages,
      stream: true,
      signal: controller.signal,
      noAutomaticRetry: true,
      onChunk: (chunk) => {
        fullContent += chunk
        streamContent.value = fullContent
      },
    })
    controller.signal.throwIfAborted()
    if (owner !== novelId.value) throw new Error('作品已切换，生成结果未保存。')
    if (directionBaseline !== workspace.captureCreationEditBaseline(owner)) throw new Error('作品契约或故事方向已经变化，分卷结果未保存，请重新核对。')
    if (result.finishReason && result.finishReason !== 'stop') throw new Error('分卷结果未完整结束，请重新生成。')
    fullContent ||= result.content
    if (!fullContent.trim()) throw new Error('AI 未返回分卷内容，原规划已保留。')

    // 解析 AI 返回，尝试提取分卷信息
    const parsedVolumes = parseVolumesFromText(fullContent)
    if (parsedVolumes.length > 0) {
      await novelStore.setVolumesWithImpact(owner, parsedVolumes, baseline)
      msg.success(`成功生成 ${parsedVolumes.length} 卷大纲`)
    } else {
      // 如果无法解析，把整段文字存为一卷
      await novelStore.setVolumesWithImpact(owner, [{
        id: Date.now().toString(36),
        volumeIndex: 0,
        title: '全卷',
        theme: '',
        summary: fullContent,
        keyTurningPoints: '',
        characterChanges: '',
        estimatedChapters: 0,
        estimatedWordCount: 0,
      }], baseline)
      msg.info('已保存分卷内容（建议手动编辑分卷结构）')
    }
  } catch (err: any) {
    msg.error(err.message || '生成失败')
  } finally {
    generating.value = false
    generationController = undefined
    streamContent.value = ''
  }
}

function hasEstimateConflict(volume: Volume) {
  const values = parseVolumeEstimates(volume.summary)
  return (values.estimatedChapters !== undefined && values.estimatedChapters !== volume.estimatedChapters)
    || (values.estimatedWordCount !== undefined && values.estimatedWordCount !== volume.estimatedWordCount)
}

async function syncEstimates(volume: Volume) {
  if (busy.value) return
  saving.value = true
  const values = parseVolumeEstimates(volume.summary)
  try { await novelStore.updateVolumeWithImpact(novelId.value, volume.id, {
    estimatedChapters: values.estimatedChapters ?? volume.estimatedChapters,
    estimatedWordCount: values.estimatedWordCount ?? volume.estimatedWordCount,
  })
    msg.success('已同步概要中的预估，原数值已保留在历史版本')
  } catch (error) { msg.error(error instanceof Error ? error.message : '分卷保存失败') }
  finally { saving.value = false }
}

// 编辑分卷
function startEdit(vol: Volume) {
  if (busy.value || !vol) return
  selectVolume(vol.id)
  if (editingId.value === vol.id) return
  editingId.value = vol.id
  editBaseline.value = novelStore.capturePlanningEditBaseline(novelId.value, vol.id)
  editForm.value = {
    title: vol.title,
    theme: vol.theme,
    summary: vol.summary,
    keyTurningPoints: vol.keyTurningPoints,
    characterChanges: vol.characterChanges,
    estimatedChapters: vol.estimatedChapters,
    estimatedWordCount: vol.estimatedWordCount,
  }
}

async function saveEdit(volId: string) {
  if (busy.value || !editBaseline.value) return
  if (!(editForm.value.estimatedChapters > 0) || !(editForm.value.estimatedWordCount > 0)) {
    msg.warning('请填写有效的预估章节数和字数')
    return
  }
  saving.value = true
  try {
    await novelStore.updateVolumeWithImpact(novelId.value, volId, editForm.value, editBaseline.value)
    volumeDrafts.delete(volId)
    editingId.value = ''
    msg.success('已保存')
  } catch (error) { msg.error(error instanceof Error ? error.message : '分卷保存失败') }
  finally { saving.value = false }
}

watch(volumes, () => {
  initializeSelection()
  if (selectedVolumeId.value && !volumes.value.find(vol => vol.id === selectedVolumeId.value)) {
    selectedVolumeId.value = volumes.value[0]?.id || ''
  }
  for (const id of volumeDrafts.keys()) if (!volumes.value.some(volume => volume.id === id)) volumeDrafts.delete(id)
  if (editingId.value && !volumes.value.some(volume => volume.id === editingId.value)) editingId.value = ''
}, { immediate: true })

function openVersionModal(volume: Volume) {
  if (busy.value) return
  versionVolume.value = JSON.parse(JSON.stringify(volume))
  versionBaseline.value = novelStore.capturePlanningEditBaseline(novelId.value, volume.id)
  selectedVersionId.value = volume.versions?.[volume.versions.length - 1]?.id || ''
  showVersionModal.value = true
}

async function restoreSelectedVersion() {
  if (busy.value || !versionVolume.value || !selectedVersionId.value || !versionBaseline.value) return
  const version = versionVolume.value.versions?.find(item => item.id === selectedVersionId.value)
  if (!version) return
  saving.value = true
  try {
    const snapshot = JSON.parse(version.snapshot) as Partial<Volume>
    await novelStore.updateVolumeWithImpact(novelId.value, versionVolume.value.id, {
      title: String(snapshot.title || versionVolume.value.title), theme: String(snapshot.theme || ''),
      summary: String(snapshot.summary || ''), keyTurningPoints: String(snapshot.keyTurningPoints || ''),
      characterChanges: String(snapshot.characterChanges || ''),
      estimatedChapters: Number(snapshot.estimatedChapters) || versionVolume.value.estimatedChapters,
      estimatedWordCount: Number(snapshot.estimatedWordCount) || versionVolume.value.estimatedWordCount,
    }, versionBaseline.value)
    showVersionModal.value = false
    versionVolume.value = null
    msg.success('分卷规划已恢复')
  } catch (error) { msg.error(error instanceof Error ? error.message : '分卷恢复失败') }
  finally { saving.value = false }
}

async function regenerateVolume(volume: Volume) {
  if (!novel.value || busy.value || hasDrafts.value) return
  const model = configStore.getModelForTask('outline')
  if (!model) { msg.warning('请先配置大纲模型'); return }
  regeneratingId.value = volume.id
  const owner = novelId.value, baseline = novelStore.capturePlanningEditBaseline(owner, volume.id)
  const controller = generationController = new AbortController()
  try {
    const knowledgeContext = buildBoundKnowledgeContext(novel.value, `${novel.value.title}\n${novel.value.outline}\n${volume.title}\n${volume.summary}`, 10, 900)
    const result = await callAI({
      model,
      skillTask: 'planning',
      maxTokens: 1800,
      signal: controller.signal,
      noAutomaticRetry: true,
      messages: [{ role: 'system', content: `你是长篇小说分卷编辑。只重写指定分卷，不改动其他分卷，只输出严格 JSON。

${knowledgeContext || '当前小说没有匹配的挂载知识库内容。'}` }, {
        role: 'user',
        content: `根据全书大纲和当前分卷内容，重新生成第 ${volume.volumeIndex + 1} 卷的局部规划。\n\n【全书大纲】\n${novel.value.outline.slice(0, 7000)}\n\n【当前分卷】\n${JSON.stringify(volume)}\n\n输出：{"title":"卷名","theme":"主题","summary":"剧情概要","keyTurningPoints":"关键转折","characterChanges":"角色变化","estimatedChapters":20,"estimatedWordCount":5}`,
      }],
    })
    controller.signal.throwIfAborted()
    if (owner !== novelId.value) throw new Error('作品已切换，生成结果未保存。')
    if (result.finishReason && result.finishReason !== 'stop') throw new Error('分卷结果未完整结束，请重新生成。')
    const parsed = parseAiJsonObject<Partial<Volume>>(result.content)
    if (!parsed?.title || !parsed.summary) throw new Error('模型没有返回完整的分卷规划')
    await novelStore.updateVolumeWithImpact(owner, volume.id, {
      title: String(parsed.title).trim(),
      theme: String(parsed.theme || '').trim(),
      summary: String(parsed.summary).trim(),
      keyTurningPoints: String(parsed.keyTurningPoints || '').trim(),
      characterChanges: String(parsed.characterChanges || '').trim(),
      estimatedChapters: Math.max(1, Math.round(Number(parsed.estimatedChapters) || volume.estimatedChapters || 1)),
      estimatedWordCount: Math.max(1, Number(parsed.estimatedWordCount) || volume.estimatedWordCount || 1),
    }, baseline)
    msg.success(`第 ${volume.volumeIndex + 1} 卷已局部重新生成，旧版本已保留`)
  } catch (error) {
    msg.error(error instanceof Error ? error.message : '分卷局部重新生成失败')
  } finally {
    regeneratingId.value = ''
    generationController = undefined
  }
}

function captureDeleteBaseline(show: boolean, volId: string) {
  if (show) deleteBaselines.set(volId, novelStore.capturePlanningEditBaseline(novelId.value, volId))
}

async function removeVolume(volId: string) {
  if (busy.value) return
  saving.value = true
  try {
    if (await novelStore.deleteVolumeWithImpact(novelId.value, volId, deleteBaselines.get(volId))) msg.success('已删除')
  } catch (error) { msg.error(error instanceof Error ? error.message : '分卷删除失败') }
  finally { saving.value = false }
}
</script>

<style scoped>
.volume-page {
  padding-top: 8px;
}

.volume-description {
  margin: 0;
  color: var(--ink-3);
  font-size: 13px;
}

.volume-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-lg);
}

.header-actions {
  display: flex;
  gap: 8px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 40vh;
  gap: 12px;
  text-align: center;
}

.volume-page .empty-state {
  min-height: 280px;
}

.empty-icon { font-size: 48px; }
.empty-state h3 { font-size: 18px; color: var(--ink); }
.empty-state p { font-size: 14px; color: var(--ink-3); margin-bottom: 8px; }

/* 生成中 */
.generating-hint {
  text-align: center;
}

.typing-anim {
  font-size: 16px;
  font-weight: 600;
  color: var(--zhu);
  margin-bottom: var(--space-md);
  animation: pulse-text 1.5s ease-in-out infinite;
}

@keyframes pulse-text {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.stream-preview {
  text-align: left;
  font-size: 14px;
  line-height: 1.7;
  max-height: 400px;
  overflow-y: auto;
  color: var(--ink-2);
}

.typing-cursor {
  color: var(--zhu);
  animation: blink 0.8s infinite;
  font-size: 18px;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

.volume-detail-panel {
  min-width: 0;
}

.volume-detail-content {
  padding: 20px;
  border: 1px solid var(--line-2);
  border-radius: var(--r-m);
  background: var(--paper);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

.volume-detail-header {
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--line);
}

.volume-detail-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.volume-detail-title-row h3 {
  margin: 0;
  font-family: var(--f-serif);
  font-size: 20px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--ink);
}

.volume-index {
  font-size: 12px;
  font-weight: 700;
  color: var(--zhu);
  background: var(--zhu-soft);
  padding: 2px 8px;
  border-radius: var(--r-s);
}

.volume-badge {
  font-size: 11px;
  color: var(--ink-3);
  background: var(--panel);
  padding: 2px 8px;
  border-radius: 100px;
}

.volume-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
}

.detail-section {
  margin-bottom: var(--space-md);
}

.detail-section h4 {
  font-family: var(--f-serif);
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--ink);
  margin-bottom: 8px;
}

.detail-section p {
  font-size: 13px;
  line-height: 1.7;
  color: var(--ink-2);
  white-space: pre-wrap;
}

.volume-actions {
  display: flex;
  gap: 8px;
  margin-top: var(--space-sm);
}

.version-dialog { display: grid; gap: 12px; }
.version-dialog > p { margin: 0; }
.version-diff-list { display: grid; gap: 8px; max-height: 360px; overflow: auto; }
.version-diff-row { display: grid; grid-template-columns: 110px minmax(0, 1fr) 20px minmax(0, 1fr); gap: 8px; padding: 8px; border: 1px solid var(--line); border-radius: var(--r-s); font-size: 13px; }
.version-diff-row span { overflow-wrap: anywhere; }

/* 编辑表单 */
.edit-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.edit-form label {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-2);
}

.edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
.volume-detail-content { padding: 24px; }
.volume-detail-title-row h3 { font-size: 25px; }
.detail-section { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 16px; align-items: start; border: 1px solid var(--line); border-radius: var(--r-m); padding: 18px; }
.detail-section h4 { font-size: 16px; color: var(--ink); margin: 0; }
.detail-section p, .detail-section .volume-summary { font-size: 14px; line-height: 1.8; min-width: 0; overflow-wrap: anywhere; }
.volume-chapter-outline { padding: 20px 0; border-top: 1px solid var(--line); }
.volume-chapter-outline h4 { font: 600 17px var(--f-serif); margin-bottom: 16px; }
.volume-chapter-outline ol { list-style: none; display: grid; gap: 12px; }
.volume-chapter-outline li { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 4px 12px; color: var(--ink-2); font-size: 13px; }
.volume-chapter-outline li p { grid-column: 2; }
@media (max-width: 550px) { .volume-detail-content { padding: 16px; } .detail-section { grid-template-columns: minmax(0, 1fr); padding: 14px; } }

.volume-master-detail {
  display: block;
}
.volume-title { margin: 0 0 5px; font: 600 18px var(--f-serif); letter-spacing: .06em; }
.collapse-detail { display: block; margin: 16px 24px 0 auto; color: var(--ink-3); font-size: 12px; text-decoration: underline; }
@media (max-width: 760px) {
  .volume-page .volume-header { flex-direction: column; align-items: stretch; gap: 14px; }
  .volume-page .header-actions { flex-wrap: wrap; justify-content: flex-start; gap: 8px; }
}

.volume-master-detail .volume-detail-panel {
  margin-top: 24px;
}

.volume-page .vols {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.volume-page .volc {
  display: block;
  width: 100%;
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: var(--r-m);
  background: var(--paper);
  color: var(--ink);
  text-align: left;
  font: inherit;
  cursor: pointer;
  transition: border-color .15s, box-shadow .15s, transform .15s;
}

.volume-page .volc:hover {
  border-color: var(--ink-3);
  box-shadow: var(--shadow-1);
  transform: translateY(-1px);
}

.volume-page .volc.cur {
  border-color: var(--ink-3);
  box-shadow: var(--shadow-2);
}

.volume-page .volc:focus-visible {
  outline: 2px solid var(--zhu);
  outline-offset: 2px;
}

.volume-page .volc:disabled {
  cursor: default;
}

.volume-page .volc .vn {
  display: block;
  color: var(--zhu);
  font: 500 12px var(--f-serif);
  letter-spacing: .3em;
}

.volume-page .volc h4 {
  margin: 6px 0 10px;
  color: var(--ink);
  font: 600 17px var(--f-serif);
  overflow-wrap: anywhere;
}

.volume-page .volc dl {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  gap: 5px 6px;
  margin: 0;
  font-size: 12.5px;
  line-height: 1.55;
}

.volume-page .volc dt {
  color: var(--ink-3);
}

.volume-page .volc dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

.volume-page .chs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 12px;
}

.volume-page .chs span {
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--panel-2);
  color: var(--ink-3);
  font: 11px var(--f-num);
}

@media (max-width: 1280px) {
  .volume-page .vols {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .volume-page .vols {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
