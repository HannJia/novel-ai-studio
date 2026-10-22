<template>
  <div class="volume-page fade-in" :class="{ 'page-container': !props.embedded, 'volume-page-embedded': props.embedded }" id="volume-outline-page">
    <div class="volume-header">
      <div>
        <h2 v-if="!props.embedded" class="page-title">分卷规划</h2>
        <p v-else class="embedded-description">承接全书大纲，规划每卷的目标、转折与角色变化</p>
      </div>
      <div class="header-actions" v-if="novel">
        <n-button size="small" :disabled="generating || !!regeneratingId" @click="addManualVolume">+ 新增分卷</n-button>
        <n-button size="small" @click="generateVolumes" :loading="generating" :disabled="!novel.outline || hasDrafts">
          AI 生成分卷规划
        </n-button>
        <n-button v-if="props.embedded && volumes.length" size="small" type="primary" :disabled="generating || props.chapterPlanConfirmed || hasDrafts" @click="emit('confirmed')">
          {{ props.chapterPlanConfirmed ? '已确认并生成章节计划' : '确认分卷并生成章节计划' }}
        </n-button>
      </div>
    </div>

    <div v-if="volumes.length && !generating" class="volume-master-detail">
      <aside class="volume-nav">
        <button
          v-for="vol in volumes"
          :key="vol.id"
          type="button"
          class="volume-nav-item"
          :aria-pressed="selectedVolumeId === vol.id"
          :class="{ 'volume-nav-item-active': selectedVolumeId === vol.id }"
          @click="selectVolume(vol.id)"
        >
          <span class="volume-nav-number">{{ String(vol.volumeIndex + 1).padStart(2, '0') }}</span>
          <div class="volume-nav-content"><div class="volume-nav-title">
            <strong>{{ vol.title }}</strong>
          </div>
          <div class="volume-nav-meta">
            <span>{{ vol.estimatedChapters || '待定' }} 章</span>
            <span>·</span>
            <span>{{ vol.estimatedWordCount || '待定' }} 万字</span>
          </div>
          <p v-if="vol.summary" class="volume-nav-summary">{{ vol.summary.slice(0, 120) }}{{ vol.summary.length > 120 ? '…' : '' }}</p></div>
        </button>
      </aside>

      <main class="volume-detail-panel">
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
              <n-input v-model:value="editForm.title" size="small" />
              <label>主题</label>
              <n-input v-model:value="editForm.theme" size="small" />
              <label>剧情概要</label>
              <n-input v-model:value="editForm.summary" type="textarea" :rows="4" size="small" />
              <label>关键转折点</label>
              <n-input v-model:value="editForm.keyTurningPoints" type="textarea" :rows="2" size="small" />
              <label>角色变化</label>
              <n-input v-model:value="editForm.characterChanges" type="textarea" :rows="2" size="small" />
              <label>预估章节数</label>
              <n-input-number v-model:value="editForm.estimatedChapters" :min="1" :precision="0" size="small" />
              <label>预估字数（万字）</label>
              <n-input-number v-model:value="editForm.estimatedWordCount" :min="0.1" :precision="3" size="small" />
              <div class="edit-actions">
                <n-button size="small" @click="cancelEdit">取消</n-button>
                <n-button size="small" type="primary" @click="saveEdit(selectedVolume.id)">保存</n-button>
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
              <ol><li v-for="chapter in selectedVolumeChapters" :key="chapter.id"><span>第 {{ chapter.chapterIndex + 1 }} 章</span><strong>{{ chapter.title || '未命名章节' }}</strong><p v-if="chapter.summary">{{ chapter.summary }}</p></li></ol>
            </section>
            <div class="volume-actions">
              <n-button size="small" @click="startEdit(selectedVolume)">编辑</n-button>
              <n-button v-if="hasEstimateConflict(selectedVolume)" size="small" @click="syncEstimates(selectedVolume)">从概要同步预估</n-button>
              <n-button v-if="selectedVolume.versions?.length" size="small" @click="openVersionModal(selectedVolume)">版本 {{ selectedVolume.versions.length }}</n-button>
              <n-button size="small" :loading="regeneratingId === selectedVolume.id" @click="regenerateVolume(selectedVolume)">局部重生成</n-button>
              <n-popconfirm @positive-click="removeVolume(selectedVolume.id)">
                <template #trigger>
                  <n-button size="small" type="error" quaternary>删除</n-button>
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
      <n-button type="primary" @click="$router.push(`/workspace/${novelId}/outline`)">
        前往大纲页
      </n-button>
    </div>

    <!-- 无分卷 -->
    <div v-else-if="!volumes.length && !generating" class="empty-state paper-panel">
      <div class="empty-icon"><svg class="ink-mountains" viewBox="0 0 220 80" aria-hidden="true"><path fill="currentColor" d="M0 80 L40 38 L62 56 L98 14 L130 50 L150 34 L188 66 L220 46 L220 80 Z" /></svg></div>
      <h3>还没有分卷规划</h3>
      <p>AI 将根据总大纲自动规划每卷的剧情走向、章节数和字数</p>
      <n-button type="primary" @click="generateVolumes" :loading="generating">
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
          <n-button type="warning" size="small" @click="restoreSelectedVersion">恢复此版本</n-button>
        </div>
      </div>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, watch } from 'vue'
import { useRoute } from 'vue-router'
import { NButton, NEmpty, NInput, NInputNumber, NModal, NPopconfirm, NSelect, useMessage } from 'naive-ui'
import { useNovelStore } from '@/stores/novel'
import { useConfigStore } from '@/stores/config'
import { callAI } from '@/services/ai'
import { buildVolumePlanningPrompt } from '@/services/prompts'
import { renderMd } from '@/utils/markdown'
import type { Volume } from '@/types/novel'
import { parseAiJsonObject } from '@/utils/aiJson'
import { comparePlanningVersions, type PlanningDiff } from '@/services/planningVersions'
import { parseVolumeEstimates, parseVolumesFromText } from '@/services/volumeParsing'
import { buildBoundKnowledgeContext } from '@/services/knowledgeContext'

const props = withDefaults(defineProps<{
  embedded?: boolean
  chapterPlanConfirmed?: boolean
}>(), { embedded: false, chapterPlanConfirmed: false })
const emit = defineEmits<{ confirmed: [] }>()

const route = useRoute()
const novelStore = useNovelStore()
const configStore = useConfigStore()
const msg = useMessage()

const novelId = computed(() => route.params.novelId as string)
const novel = computed(() => novelStore.getNovel(novelId.value))
const volumes = computed(() => novel.value?.volumes || [])

const generating = ref(false)
const streamContent = ref('')
const selectedVolumeId = ref('')
const selectedVolume = computed(() => volumes.value.find(vol => vol.id === selectedVolumeId.value))
const selectedVolumeChapters = computed(() => selectedVolume.value ? (novel.value?.chapters || []).filter(chapter => chapter.volumeIndex === selectedVolume.value!.volumeIndex).sort((a, b) => a.chapterIndex - b.chapterIndex) : [])
const editingId = ref('')
const regeneratingId = ref('')
const showVersionModal = ref(false)
const versionVolume = ref<Volume | null>(null)
const selectedVersionId = ref('')
const editForm = ref({ title: '', theme: '', summary: '', keyTurningPoints: '', characterChanges: '', estimatedChapters: 1, estimatedWordCount: 0.225 })
const volumeDrafts = reactive(new Map<string, typeof editForm.value>())
const hasDrafts = computed(() => !!editingId.value || volumeDrafts.size > 0)
const versionOptions = computed(() => (versionVolume.value?.versions || []).slice().reverse().map(version => ({
  label: `${version.label} · ${new Date(version.savedAt).toLocaleString('zh-CN')}`,
  value: version.id,
})))
const versionDiff = computed<PlanningDiff[]>(() => {
  const version = versionVolume.value?.versions?.find(item => item.id === selectedVersionId.value)
  return versionVolume.value ? comparePlanningVersions(version, versionVolume.value) : []
})

function selectVolume(id: string) {
  if (id === selectedVolumeId.value) return
  if (editingId.value) {
    volumeDrafts.set(editingId.value, { ...editForm.value })
    editingId.value = ''
  }
  selectedVolumeId.value = id
  const draft = volumeDrafts.get(id)
  if (draft) {
    editForm.value = { ...draft }
    editingId.value = id
  }
}

function cancelEdit() {
  volumeDrafts.delete(editingId.value)
  editingId.value = ''
}

function initializeSelection() {
  if (volumes.value.length && !selectedVolumeId.value) {
    selectedVolumeId.value = volumes.value[0].id
  }
}

function addManualVolume() {
  if (!novel.value || generating.value || regeneratingId.value) return
  const volume: Volume = {
    id: crypto.randomUUID(), volumeIndex: Math.max(-1, ...volumes.value.map(item => item.volumeIndex)) + 1,
    title: '新分卷', theme: '', summary: '', keyTurningPoints: '', characterChanges: '',
    estimatedChapters: 1, estimatedWordCount: 0.225,
  }
  novelStore.setVolumes(novelId.value, [...volumes.value, volume])
  novelStore.setChapterPlanConfirmed(novelId.value, false)
  startEdit(volume)
}

// AI 生成分卷规划
async function generateVolumes() {
  if (!novel.value) return
  const model = configStore.getModelForTask('outline')
  if (!model) { msg.error('未配置 AI 模型'); return }

  generating.value = true
  streamContent.value = ''
  novelStore.setChapterPlanConfirmed(novelId.value, false)

  try {
    const messages = buildVolumePlanningPrompt(novel.value)
    const knowledgeContext = buildBoundKnowledgeContext(novel.value, `${novel.value.title}\n${novel.value.outline}`, 10, 900)
    const userMessage = messages.find(message => message.role === 'user')
    if (knowledgeContext && userMessage && typeof userMessage.content === 'string') {
      userMessage.content += `\n\n${knowledgeContext}\n\n请优先依据知识库中的事实、时间线和设定进行分卷规划。`
    }
    let fullContent = ''
    await callAI({
      model,
      skillTask: 'planning',
      messages,
      stream: true,
      onChunk: (chunk) => {
        fullContent += chunk
        streamContent.value = fullContent
      },
    })

    // 解析 AI 返回，尝试提取分卷信息
    const parsedVolumes = parseVolumesFromText(fullContent)
    if (parsedVolumes.length > 0) {
      novelStore.setVolumes(novelId.value, parsedVolumes)
      msg.success(`成功生成 ${parsedVolumes.length} 卷大纲`)
    } else {
      // 如果无法解析，把整段文字存为一卷
      novelStore.setVolumes(novelId.value, [{
        id: Date.now().toString(36),
        volumeIndex: 0,
        title: '全卷',
        theme: '',
        summary: fullContent,
        keyTurningPoints: '',
        characterChanges: '',
        estimatedChapters: 0,
        estimatedWordCount: 0,
      }])
      msg.info('已保存分卷内容（建议手动编辑分卷结构）')
    }
  } catch (err: any) {
    msg.error(err.message || '生成失败')
  } finally {
    generating.value = false
    streamContent.value = ''
  }
}

function hasEstimateConflict(volume: Volume) {
  const values = parseVolumeEstimates(volume.summary)
  return (values.estimatedChapters !== undefined && values.estimatedChapters !== volume.estimatedChapters)
    || (values.estimatedWordCount !== undefined && values.estimatedWordCount !== volume.estimatedWordCount)
}

function syncEstimates(volume: Volume) {
  const values = parseVolumeEstimates(volume.summary)
  novelStore.updateVolume(novelId.value, volume.id, {
    estimatedChapters: values.estimatedChapters ?? volume.estimatedChapters,
    estimatedWordCount: values.estimatedWordCount ?? volume.estimatedWordCount,
  })
  msg.success('已同步概要中的预估，原数值已保留在历史版本')
}

// 编辑分卷
function startEdit(vol: Volume) {
  selectVolume(vol.id)
  if (editingId.value === vol.id) return
  editingId.value = vol.id
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

function saveEdit(volId: string) {
  if (!(editForm.value.estimatedChapters > 0) || !(editForm.value.estimatedWordCount > 0)) {
    msg.warning('请填写有效的预估章节数和字数')
    return
  }
  novelStore.updateVolume(novelId.value, volId, editForm.value)
  volumeDrafts.delete(volId)
  editingId.value = ''
  msg.success('已保存')
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
  versionVolume.value = volume
  selectedVersionId.value = volume.versions?.[volume.versions.length - 1]?.id || ''
  showVersionModal.value = true
}

function restoreSelectedVersion() {
  if (!versionVolume.value || !selectedVersionId.value) return
  if (novelStore.restoreVolumeVersion(novelId.value, versionVolume.value.id, selectedVersionId.value)) {
    showVersionModal.value = false
    versionVolume.value = null
    msg.success('分卷规划已恢复')
  }
}

async function regenerateVolume(volume: Volume) {
  if (!novel.value || regeneratingId.value) return
  const model = configStore.getModelForTask('outline')
  if (!model) { msg.warning('请先配置大纲模型'); return }
  regeneratingId.value = volume.id
  try {
    const knowledgeContext = buildBoundKnowledgeContext(novel.value, `${novel.value.title}\n${novel.value.outline}\n${volume.title}\n${volume.summary}`, 10, 900)
    const result = await callAI({
      model,
      skillTask: 'planning',
      maxTokens: 1800,
      messages: [{ role: 'system', content: `你是长篇小说分卷编辑。只重写指定分卷，不改动其他分卷，只输出严格 JSON。

${knowledgeContext || '当前小说没有匹配的挂载知识库内容。'}` }, {
        role: 'user',
        content: `根据全书大纲和当前分卷内容，重新生成第 ${volume.volumeIndex + 1} 卷的局部规划。\n\n【全书大纲】\n${novel.value.outline.slice(0, 7000)}\n\n【当前分卷】\n${JSON.stringify(volume)}\n\n输出：{"title":"卷名","theme":"主题","summary":"剧情概要","keyTurningPoints":"关键转折","characterChanges":"角色变化","estimatedChapters":20,"estimatedWordCount":5}`,
      }],
    })
    const parsed = parseAiJsonObject<Partial<Volume>>(result.content)
    if (!parsed?.title || !parsed.summary) throw new Error('模型没有返回完整的分卷规划')
    novelStore.updateVolume(novelId.value, volume.id, {
      title: String(parsed.title).trim(),
      theme: String(parsed.theme || '').trim(),
      summary: String(parsed.summary).trim(),
      keyTurningPoints: String(parsed.keyTurningPoints || '').trim(),
      characterChanges: String(parsed.characterChanges || '').trim(),
      estimatedChapters: Math.max(1, Math.round(Number(parsed.estimatedChapters) || volume.estimatedChapters || 1)),
      estimatedWordCount: Math.max(1, Number(parsed.estimatedWordCount) || volume.estimatedWordCount || 1),
    })
    msg.success(`第 ${volume.volumeIndex + 1} 卷已局部重新生成，旧版本已保留`)
  } catch (error) {
    msg.error(error instanceof Error ? error.message : '分卷局部重新生成失败')
  } finally {
    regeneratingId.value = ''
  }
}

function removeVolume(volId: string) {
  novelStore.deleteVolume(novelId.value, volId)
  msg.success('已删除')
}
</script>

<style scoped>
.volume-page-embedded {
  padding-top: 8px;
}

.embedded-description {
  margin: 0;
  color: var(--text-color-tertiary);
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

.volume-page-embedded .empty-state {
  min-height: 280px;
}

.empty-icon { font-size: 48px; }
.empty-state h3 { font-size: 18px; color: var(--text-color-primary); }
.empty-state p { font-size: 14px; color: var(--text-color-tertiary); margin-bottom: 8px; }

/* 生成中 */
.generating-hint {
  text-align: center;
}

.typing-anim {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-primary);
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
  color: var(--text-color-secondary);
}

.typing-cursor {
  color: var(--color-primary);
  animation: blink 0.8s infinite;
  font-size: 18px;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

@media (max-width: 960px) {
  .volume-master-detail {
    grid-template-columns: 1fr;
  }

  .volume-nav {
    position: static;
    max-height: none;
    grid-row: 1;
  }

  .volume-detail-panel {
    grid-row: 2;
  }
}

.volume-master-detail {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}

.volume-nav {
  display: flex;
  flex-direction: column;
  gap: 8px;
  position: sticky;
  top: calc(56px + 16px);
  max-height: calc(100vh - 56px - 32px);
  overflow-y: auto;
}

.volume-nav-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-color-card);
  text-align: left;
  cursor: pointer;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.volume-nav-item:hover {
  border-color: var(--color-primary);
}

.volume-nav-item-active {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 1px var(--color-primary);
}

.volume-nav-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.volume-nav-index {
  font-size: 11px;
  font-weight: 700;
  color: var(--color-primary);
  background: var(--color-primary-light);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
}

.volume-nav-title strong {
  font-family: var(--font-family-serif);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--text-color-primary);
}

.volume-nav-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--text-color-tertiary);
  font-variant-numeric: tabular-nums;
}

.volume-nav-summary {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.volume-detail-panel {
  min-width: 0;
}

.volume-detail-content {
  padding: 20px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-color-card);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

.volume-detail-header {
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border-color-light);
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
  font-family: var(--font-family-serif);
  font-size: 20px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--text-color-primary);
}

.volume-index {
  font-size: 12px;
  font-weight: 700;
  color: var(--color-primary);
  background: var(--color-primary-light);
  padding: 2px 8px;
  border-radius: var(--radius-sm);
}

.volume-badge {
  font-size: 11px;
  color: var(--text-color-tertiary);
  background: var(--bg-color-secondary);
  padding: 2px 8px;
  border-radius: 100px;
}

.volume-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-color-tertiary);
  font-variant-numeric: tabular-nums;
}

.detail-section {
  margin-bottom: var(--space-md);
}

.detail-section h4 {
  font-family: var(--font-family-serif);
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--text-color-primary);
  margin-bottom: 8px;
}

.detail-section p {
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-color-secondary);
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
.version-diff-row { display: grid; grid-template-columns: 110px minmax(0, 1fr) 20px minmax(0, 1fr); gap: 8px; padding: 8px; border: 1px solid var(--border-color-light); border-radius: var(--radius-sm); font-size: 13px; }
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
  color: var(--text-color-secondary);
}

.edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
.volume-master-detail { grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); gap: 24px; }
.volume-nav { gap: 16px; }
.volume-nav-item { display: flex; gap: 16px; min-height: 150px; padding: 22px; }
.volume-nav-number { flex: 0 0 auto; font: 600 32px/1.3 var(--font-family-serif); color: var(--color-accent); }
.volume-nav-item-active .volume-nav-number { color: var(--color-primary); }
.volume-nav-content { min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.volume-nav-title strong { font-size: 20px; line-height: 1.5; overflow-wrap: anywhere; }
.volume-nav-meta { font-size: 13px; }
.volume-nav-summary { font-size: 14px; line-height: 1.8; -webkit-line-clamp: 3; }
.volume-detail-content { padding: 24px; }
.volume-detail-title-row h3 { font-size: 25px; }
.detail-section { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 16px; align-items: start; border: 1px solid var(--border-color-light); border-radius: var(--radius-md); padding: 18px; }
.detail-section h4 { font-size: 16px; color: var(--text-color-primary); margin: 0; }
.detail-section p, .detail-section .volume-summary { font-size: 14px; line-height: 1.8; min-width: 0; overflow-wrap: anywhere; }
.volume-chapter-outline { padding: 20px 0; border-top: 1px solid var(--border-color-light); }
.volume-chapter-outline h4 { font: 600 17px var(--font-family-serif); margin-bottom: 16px; }
.volume-chapter-outline ol { list-style: none; display: grid; gap: 12px; }
.volume-chapter-outline li { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 4px 12px; color: var(--text-color-secondary); font-size: 13px; }
.volume-chapter-outline li p { grid-column: 2; }
@media (max-width: 900px) { .volume-master-detail { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 550px) { .volume-nav-item, .volume-detail-content { padding: 16px; } .detail-section { grid-template-columns: minmax(0, 1fr); padding: 14px; } }
</style>
