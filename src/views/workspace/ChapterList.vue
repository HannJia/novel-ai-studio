<template>
  <div class="chapter-list page-container fade-in" id="chapter-list-view">
    <div class="list-header">
      <h2 class="page-title">章节列表</h2>
      <div class="header-actions">
        <n-popconfirm
          v-if="novel?.chapters?.length"
          @positive-click="clearAllChapters"
        >
          <template #trigger>
            <n-button size="small" type="error" quaternary>清空全部章节</n-button>
          </template>
          确定清空所有章节？此操作不可撤销。
        </n-popconfirm>
        <n-button v-if="novel?.chapters?.length" size="small" @click="batchGenerateEmptyChapters">
          批量生成空章
        </n-button>
        <n-button v-if="novel?.chapters?.length" size="small" @click="batchReviewChapters">
          批量审校
        </n-button>
        <n-button type="primary" size="small" @click="addNewChapter" id="add-chapter-btn">
          + 新建章节
        </n-button>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-if="!novel?.chapters?.length" class="empty-chapters paper-panel">
      <div class="empty-icon">📝</div>
      <h3>还没有章节</h3>
      <p>创建第一个章节，开始你的写作之旅</p>
      <n-button type="primary" @click="addNewChapter">✨ 创建第一章</n-button>
    </div>

    <!-- 按卷分组章节列表 -->
    <div v-else class="chapters-container">
      <div
        v-for="group in groupedChapters"
        :key="group.volumeIndex"
        class="volume-group"
      >
        <!-- 卷标题 -->
        <div
          v-if="hasVolumes"
          class="volume-group-header"
          @click="toggleVolume(group.volumeIndex)"
        >
          <span class="volume-group-icon">{{ collapsedVolumes.has(group.volumeIndex) ? '▶' : '▼' }}</span>
          <span class="volume-group-title">{{ group.volumeTitle }}</span>
          <span class="volume-group-count">{{ group.chapters.length }} 章</span>
        </div>

        <!-- 章节卡片 -->
        <div v-show="!collapsedVolumes.has(group.volumeIndex)" class="chapters-grid">
          <div
            v-for="(chapter, idx) in group.chapters"
            :key="chapter.id"
            class="chapter-card paper-panel"
            :ref="el => { if (isLastChapter(group, idx)) lastChapterEl = el as HTMLElement }"
          >
            <div class="chapter-main" @click="openChapter(chapter.id)">
              <div class="chapter-header-row">
                <div class="chapter-number">第 {{ chapter.chapterIndex + 1 }} 章</div>
                <n-popconfirm @positive-click="removeChapter(chapter.id)">
                  <template #trigger>
                    <n-button size="tiny" quaternary type="error" class="delete-btn" @click.stop>删除</n-button>
                  </template>
                  确定删除此章节？
                </n-popconfirm>
              </div>
              <h4 class="chapter-title">{{ chapter.title }}</h4>
              <div class="chapter-meta">
                <span :class="['status-dot', chapter.status]"></span>
                <span>{{ statusText(chapter.status) }}</span>
                <span class="meta-sep">·</span>
                <span>{{ chapter.wordCount.toLocaleString() }} 字</span>
              </div>
              <p class="chapter-preview" v-if="chapter.content">
                {{ chapter.content.substring(0, 80) }}...
              </p>
            </div>

            <!-- 单章总结展开/收起 -->
            <div class="summary-toggle" @click.stop="toggleSummary(chapter.id)">
              <span v-if="chapter.summary" class="summary-indicator has-summary">📋 总结</span>
              <span v-else class="summary-indicator no-summary">📋 无总结</span>
              <span class="summary-arrow">{{ expandedSummaries.has(chapter.id) ? '▲' : '▼' }}</span>
            </div>

            <!-- 单章总结内容 -->
            <div v-if="expandedSummaries.has(chapter.id)" class="summary-panel" @click.stop>
              <template v-if="editingSummaryId === chapter.id">
                <n-input
                  v-model:value="editSummaryText"
                  type="textarea"
                  :rows="4"
                  size="small"
                  placeholder="输入章节总结..."
                />
                <div class="summary-actions">
                  <n-button size="tiny" @click="editingSummaryId = ''">取消</n-button>
                  <n-button size="tiny" type="primary" @click="saveSummary(chapter.id)">保存</n-button>
                </div>
              </template>
              <template v-else>
                <p class="summary-text" v-if="chapter.summary">{{ chapter.summary }}</p>
                <p class="summary-text no-content" v-else>暂无总结</p>
                <div class="summary-actions">
                  <n-button size="tiny" @click="startEditSummary(chapter)">{{ chapter.summary ? '编辑' : '添加总结' }}</n-button>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NInput, NPopconfirm, useMessage } from 'naive-ui'
import { useNovelStore } from '@/stores/novel'
import { useConfigStore } from '@/stores/config'
import { callAI } from '@/services/ai'
import { buildChapterPrompt, buildContentReviewPrompt } from '@/services/prompts'
import { augmentWritingContextWithVectorMemory, buildReviewContext, buildWritingContext } from '@/services/context'
import { chapterBackgroundQueue } from '@/services/aiTaskQueue'
import type { Chapter } from '@/types/novel'

const route = useRoute()
const router = useRouter()
const novelStore = useNovelStore()
const configStore = useConfigStore()
const message = useMessage()

const novelId = computed(() => route.params.novelId as string)
const novel = computed(() => novelStore.getNovel(novelId.value))

const collapsedVolumes = ref(new Set<number>())
const expandedSummaries = ref(new Set<string>())
const editingSummaryId = ref('')
const editSummaryText = ref('')
const lastChapterEl = ref<HTMLElement | null>(null)

function isLastChapter(group: ChapterGroup, idx: number): boolean {
  if (!novel.value) return false
  const allChapters = novel.value.chapters
  if (allChapters.length === 0) return false
  const lastChapter = allChapters[allChapters.length - 1]
  return group.chapters[idx]?.id === lastChapter.id
}

onMounted(() => {
  nextTick(() => {
    if (lastChapterEl.value) {
      lastChapterEl.value.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  })
})

const hasVolumes = computed(() => (novel.value?.volumes?.length || 0) > 0)

// 按卷分组
interface ChapterGroup {
  volumeIndex: number
  volumeTitle: string
  chapters: Chapter[]
}

const groupedChapters = computed<ChapterGroup[]>(() => {
  if (!novel.value) return []
  const chapters = novel.value.chapters
  const volumes = novel.value.volumes || []

  if (!volumes.length) {
    // 没有分卷，全部放一组
    return [{ volumeIndex: -1, volumeTitle: '全部章节', chapters }]
  }

  // 按 volumeIndex 分组
  const groups: Record<number, Chapter[]> = {}
  const ungrouped: Chapter[] = []

  for (const ch of chapters) {
    const vi = ch.volumeIndex ?? -1
    if (vi >= 0) {
      if (!groups[vi]) groups[vi] = []
      groups[vi].push(ch)
    } else {
      ungrouped.push(ch)
    }
  }

  const result: ChapterGroup[] = []
  for (const vol of volumes) {
    result.push({
      volumeIndex: vol.volumeIndex,
      volumeTitle: `第${vol.volumeIndex + 1}卷 ${vol.title}`,
      chapters: groups[vol.volumeIndex] || [],
    })
  }
  if (ungrouped.length) {
    result.push({ volumeIndex: -1, volumeTitle: '未分卷', chapters: ungrouped })
  }
  return result
})

function statusText(status: string): string {
  const map: Record<string, string> = {
    draft: '草稿',
    writing: '写作中',
    completed: '已完成',
    reviewed: '已审查',
    finalized: '已定稿',
    locked: '已锁定',
  }
  return map[status] || status
}

function toggleVolume(idx: number) {
  if (collapsedVolumes.value.has(idx)) {
    collapsedVolumes.value.delete(idx)
  } else {
    collapsedVolumes.value.add(idx)
  }
}

function toggleSummary(id: string) {
  if (expandedSummaries.value.has(id)) {
    expandedSummaries.value.delete(id)
  } else {
    expandedSummaries.value.add(id)
  }
}

function startEditSummary(chapter: Chapter) {
  editingSummaryId.value = chapter.id
  editSummaryText.value = chapter.summary || ''
}

function saveSummary(chapterId: string) {
  novelStore.updateChapter(novelId.value, chapterId, { summary: editSummaryText.value })
  editingSummaryId.value = ''
  message.success('总结已保存')
}

function addNewChapter() {
  const chapter = novelStore.addChapter(novelId.value, {})
  if (chapter) {
    message.success('章节已创建')
    router.push(`/workspace/${novelId.value}/editor/${chapter.id}`)
  }
}

function openChapter(chapterId: string) {
  router.push(`/workspace/${novelId.value}/editor/${chapterId}`)
}

function removeChapter(chapterId: string) {
  novelStore.deleteChapter(novelId.value, chapterId)
  message.success('章节已删除')
}

function clearAllChapters() {
  novelStore.clearChapters(novelId.value)
  message.success('已清空全部章节')
}

function batchGenerateEmptyChapters() {
  if (!novel.value) return
  const queuedNovelId = novelId.value
  const model = configStore.getModelForTask('writing')
  if (!model) {
    message.warning('请先配置写作模型')
    return
  }
  const targets = novel.value.chapters.filter(ch => !ch.content.trim())
  if (targets.length === 0) {
    message.info('没有需要批量生成的空白章节')
    return
  }

  chapterBackgroundQueue.enqueueBatch('批量生成章节', targets.map(chapter => ({
    name: `生成第${chapter.chapterIndex + 1}章`,
    task: async () => {
       const currentNovel = novelStore.getNovel(queuedNovelId)
      const currentChapter = currentNovel?.chapters.find(ch => ch.id === chapter.id)
      if (!currentNovel || !currentChapter) return
      let ctx = buildWritingContext(currentNovel, currentChapter)
      ctx = await augmentWritingContextWithVectorMemory(currentNovel, currentChapter, ctx, configStore.embedding)
      const messages = buildChapterPrompt(
        currentNovel,
        ctx.outlineContext,
        ctx.chapterGuidance || `第${currentChapter.chapterIndex + 1}章`,
        ctx.previousSummary,
        ctx.lastParagraph,
        '',
      )
      let generated = ''
      await callAI({
        model,
        skillTask: 'writing',
        messages,
        stream: true,
        maxTokens: 4000,
        onChunk: chunk => { generated += chunk },
      })
      novelStore.updateChapter(currentNovel.id, currentChapter.id, {
        content: generated,
        status: 'writing',
      })
    },
  })))
  message.success(`已加入 ${targets.length} 个章节生成任务`)
}

function batchReviewChapters() {
  if (!novel.value) return
  const queuedNovelId = novelId.value
  const model = configStore.getModelForTask('review')
  if (!model) {
    message.warning('请先配置审校模型')
    return
  }
  const targets = novel.value.chapters.filter(ch => ch.content.trim().length > 100)
  if (targets.length === 0) {
    message.info('没有可审校的章节')
    return
  }

  chapterBackgroundQueue.enqueueBatch('批量审校章节', targets.map(chapter => ({
    name: `审校第${chapter.chapterIndex + 1}章`,
    task: async () => {
       const currentNovel = novelStore.getNovel(queuedNovelId)
      const currentChapter = currentNovel?.chapters.find(ch => ch.id === chapter.id)
      if (!currentNovel || !currentChapter) return
      const reviewContext = buildReviewContext(currentNovel, currentChapter, currentChapter.content)
      const messages = buildContentReviewPrompt(reviewContext, currentChapter.chapterIndex)
      let reviewText = ''
      await callAI({
        model,
        skillTask: 'review',
        messages,
        stream: true,
        onChunk: chunk => { reviewText += chunk },
      })
      novelStore.updateChapter(currentNovel.id, currentChapter.id, {
        contentReview: reviewText,
        status: currentChapter.status === 'finalized' ? 'finalized' : 'reviewed',
      })
    },
  })))
  message.success(`已加入 ${targets.length} 个章节审校任务`)
}
</script>

<style scoped>
.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-lg);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.empty-chapters {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 40vh;
  gap: 12px;
  text-align: center;
}

.empty-icon { font-size: 48px; }

.empty-chapters h3 {
  font-size: 18px;
  color: var(--text-color-primary);
}

.empty-chapters p {
  font-size: 14px;
  color: var(--text-color-tertiary);
  margin-bottom: 8px;
}

/* 卷分组 */
.chapters-container {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}

.volume-group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast);
  margin-bottom: 6px;
}

.volume-group-header:hover {
  background: var(--bg-color-hover);
}

.volume-group-icon {
  font-size: 10px;
  color: var(--text-color-tertiary);
}

.volume-group-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color-primary);
}

.volume-group-count {
  font-size: 12px;
  color: var(--text-color-tertiary);
  margin-left: auto;
}

/* 章节网格 */
.chapters-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.chapter-card {
  display: flex;
  flex-direction: column;
  transition: transform var(--transition-fast), box-shadow var(--transition-fast);
}

.chapter-main {
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.chapter-main:hover {
  opacity: 0.85;
}

.chapter-number {
  font-size: 12px;
  color: var(--color-primary);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.chapter-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.delete-btn {
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.chapter-card:hover .delete-btn {
  opacity: 1;
}

.chapter-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-color-primary);
}

.chapter-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-color-tertiary);
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.status-dot.draft { background: var(--text-color-disabled); }
.status-dot.writing { background: var(--color-warning); }
.status-dot.completed { background: var(--color-success); }
.status-dot.reviewed { background: var(--color-info, #409eff); }
.status-dot.finalized { background: var(--color-primary); }
.status-dot.locked { background: #7c3aed; }

.meta-sep { color: var(--border-color); }

.chapter-preview {
  font-size: 13px;
  color: var(--text-color-tertiary);
  line-height: 1.5;
  margin-top: 4px;
}

/* 单章总结切换 */
.summary-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
  margin-top: 6px;
  border-top: 1px dashed var(--border-color-light);
  cursor: pointer;
  font-size: 12px;
}

.summary-indicator {
  color: var(--text-color-tertiary);
}

.summary-indicator.has-summary {
  color: var(--color-primary);
}

.summary-arrow {
  font-size: 10px;
  color: var(--text-color-tertiary);
}

/* 单章总结面板 */
.summary-panel {
  padding: 8px 0;
  animation: slideDown 0.15s ease;
}

@keyframes slideDown {
  from { opacity: 0; max-height: 0; }
  to { opacity: 1; max-height: 300px; }
}

.summary-text {
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-color-secondary);
  white-space: pre-wrap;
  margin-bottom: 6px;
}

.summary-text.no-content {
  color: var(--text-color-disabled);
  font-style: italic;
}

.summary-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
  margin-top: 6px;
}
</style>
