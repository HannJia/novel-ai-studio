<template>
  <div class="page-container fade-in shelf-page" id="novel-list-page">
    <!-- 页面头部 -->
    <div class="list-header">
      <div class="list-heading">
        <h1 class="page-title shelf-title">我的书架</h1>
        <p class="shelf-summary">
          共 {{ novelStore.activeNovels.length }} 部作品
          <span class="dot-sep">·</span>
          累计 {{ formatWordCount(totalWords) }}
        </p>
      </div>
      <div class="header-actions">
        <n-button type="primary" size="large" @click="$router.push('/create')" id="create-novel-btn">
          <template #icon><n-icon><add-outline /></n-icon></template>
          新建小说
        </n-button>
        <n-button size="large" @click="openImportPicker">
          <template #icon><n-icon><folder-open-outline /></n-icon></template>
          导入项目
        </n-button>
        <n-button size="large" @click="exportProject">
          <template #icon><n-icon><cloud-upload-outline /></n-icon></template>
          备份项目
        </n-button>
        <input ref="importInput" class="hidden-file-input" type="file" accept=".json,application/json" @change="handleImportFile" />
      </div>
    </div>

    <!-- 分类标签 -->
    <div class="shelf-tabs" role="tablist" aria-label="书架分类">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        role="tab"
        class="shelf-tab"
        :class="{ 'shelf-tab--active': activeTab === tab.key }"
        :aria-selected="activeTab === tab.key"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}<span v-if="tab.count" class="shelf-tab-count">{{ tab.count }}</span>
      </button>
    </div>

    <!-- 空状态 -->
    <div v-if="activeTab === 'all' && novelStore.activeNovels.length === 0" class="empty-state">
      <svg class="ink-mountains" viewBox="0 0 220 80" aria-hidden="true"><path fill="currentColor" d="M0 80 L40 38 L62 56 L98 14 L130 50 L150 34 L188 66 L220 46 L220 80 Z" /></svg>
      <h3>书架还空着</h3>
      <p>从一个念头开始，写下第一部作品</p>
      <n-button type="primary" size="large" @click="$router.push('/create')">创建第一本小说</n-button>
    </div>

    <div v-else-if="visibleNovels.length === 0" class="empty-state empty-state--small">
      <p>{{ emptyText }}</p>
    </div>

    <!-- 小说卡片网格 -->
    <div v-else class="novel-grid">
      <article
        v-for="(novel, index) in visibleNovels"
        :key="novel.id"
        class="novel-card"
        :class="{ 'novel-card--muted': !isActive(novel) }"
        :style="{ animationDelay: `${index * 0.05}s` }"
        :id="'novel-card-' + novel.id"
        :tabindex="isActive(novel) ? 0 : -1"
        :aria-label="`打开《${novel.title}》`"
        @click="isActive(novel) && openWorkspace(novel.id)"
        @keydown.enter="isActive(novel) && openWorkspace(novel.id)"
      >
        <!-- 线装书封面 -->
        <div class="book-cover" :style="coverStyle(novel)">
          <div class="book-binding" aria-hidden="true"><span v-for="n in 4" :key="n" /></div>
          <div class="book-label">
            <span class="book-label-text">{{ coverTitle(novel.title) }}</span>
            <span class="book-label-seal" aria-hidden="true" />
          </div>
          <span v-if="novel.status === 'creating'" class="cover-badge">生成中</span>
        </div>

        <div class="card-body">
          <h3 class="card-title" :title="novel.title">《{{ novel.title }}》</h3>
          <div class="card-tags">
            <span class="tag-chip">{{ novel.genreLabel }}<template v-if="novel.subGenreLabel"> · {{ novel.subGenreLabel }}</template></span>
            <span class="tag-chip tag-accent">{{ novel.writingMode === 'ai' ? 'AI 模式' : '写作辅助' }}</span>
          </div>

          <div class="card-stats">
            <span class="stat-value">{{ formatWordCount(novel.currentWordCount) }}</span>
            <span class="stat-label">{{ novel.chapters.length }} 章 · 目标 {{ novel.targetWordCountMin }}~{{ novel.targetWordCountMax }} 万</span>
          </div>
          <div class="progress-bar" role="progressbar" :aria-valuenow="Math.round(getProgress(novel))" aria-valuemin="0" aria-valuemax="100" aria-label="目标字数进度">
            <div class="progress-fill" :style="{ width: getProgress(novel) + '%' }"></div>
          </div>

          <div class="card-footer">
            <span class="card-time">
              <template v-if="novel.status === 'archived'">归档于 </template>
              <template v-else-if="novel.status === 'trash'">移入于 </template>
              <template v-else>最近编辑 </template>{{ formatDate(novel.updatedAt) }}
            </span>
            <div class="card-actions" @click.stop>
              <template v-if="novel.status === 'archived'">
                <n-button size="tiny" quaternary @click="novelStore.unarchiveNovel(novel.id)">恢复</n-button>
              </template>
              <template v-else-if="novel.status === 'trash'">
                <n-button size="tiny" quaternary @click="restoreTrashedNovel(novel.id)">恢复</n-button>
                <n-button size="tiny" quaternary type="error" @click="confirmPurgeNovel(novel.id)">永久删除</n-button>
              </template>
              <n-dropdown
                v-else
                trigger="click"
                :options="cardMenuOptions"
                @select="(key: string) => handleCardAction(key, novel.id)"
              >
                <button class="action-btn" title="更多操作" aria-label="更多操作">
                  <n-icon :size="18"><ellipsis-horizontal /></n-icon>
                </button>
              </n-dropdown>
            </div>
          </div>
        </div>
      </article>

      <!-- 新建入口 -->
      <button v-if="activeTab === 'all' || activeTab === 'writing'" class="novel-card new-card" @click="$router.push('/create')">
        <span class="new-card-plus"><n-icon :size="26"><add-outline /></n-icon></span>
        <span class="new-card-title">新建一部作品</span>
        <span class="new-card-hint">从一个念头，开始新的故事</span>
        <svg class="ink-mountains new-card-ink" viewBox="0 0 220 80" aria-hidden="true"><path fill="currentColor" d="M0 80 L40 38 L62 56 L98 14 L130 50 L150 34 L188 66 L220 46 L220 80 Z" /></svg>
      </button>
    </div>

    <!-- 继续写作 -->
    <button v-if="resumeTarget && activeTab === 'all'" class="resume-card" @click="resumeWriting">
      <span class="resume-ribbon" aria-hidden="true" />
      <span class="resume-text">
        <span class="resume-label">继续写作 · 《{{ resumeTarget.novel.title }}》</span>
        <span class="resume-chapter">{{ resumeTarget.chapterLabel }}</span>
      </span>
      <n-icon :size="18"><chevron-forward-outline /></n-icon>
    </button>

    <n-modal v-model:show="showRenameModal" preset="card" title="修改书名" style="width: 420px;">
      <n-input v-model:value="renameTitle" placeholder="输入新的书名" @keydown="handleRenameKeydown" />
      <template #footer>
        <div class="rename-actions">
          <n-button @click="showRenameModal = false">取消</n-button>
          <n-button type="primary" :disabled="!renameTitle.trim()" @click="confirmRename">保存</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NIcon, NDropdown, NModal, NInput, useDialog, useMessage } from 'naive-ui'
import { AddOutline, EllipsisHorizontal, FolderOpenOutline, CloudUploadOutline, ChevronForwardOutline } from '@vicons/ionicons5'
import { useNovelStore } from '@/stores/novel'
import type { Novel } from '@/types/novel'
import { formatWordCount } from '@/utils/format'
import { useKnowledgeStore } from '@/stores/knowledge'
import { createProjectBackup, downloadProjectBackup, parseProjectBackup } from '@/services/projectBackup'
import { MAX_PROJECT_BACKUP_BYTES } from '@/services/projectBackup'
import { importProject } from '@/services/projectTransfer'
import { loadProjectChapterRevisions } from '@/services/db/chapterRevisions'
import { useInspirationSessionsStore } from '@/stores/inspirationSessions'

const novelStore = useNovelStore()
const knowledgeStore = useKnowledgeStore()
const router = useRouter()
const dialog = useDialog()
const message = useMessage()
const importInput = ref<HTMLInputElement | null>(null)
const showRenameModal = ref(false)
const renameNovelId = ref('')
const renameTitle = ref('')

type ShelfTab = 'all' | 'writing' | 'archived' | 'trash'
const activeTab = ref<ShelfTab>('all')

const tabs = computed(() => [
  { key: 'all' as const, label: '全部', count: 0 },
  { key: 'writing' as const, label: '写作中', count: 0 },
  { key: 'archived' as const, label: '已归档', count: novelStore.archivedNovels.length },
  { key: 'trash' as const, label: '回收站', count: novelStore.trashedNovels.length },
])

const visibleNovels = computed<Novel[]>(() => {
  if (activeTab.value === 'archived') return novelStore.archivedNovels
  if (activeTab.value === 'trash') return novelStore.trashedNovels
  if (activeTab.value === 'writing') return novelStore.activeNovels.filter(novel => novel.status !== 'completed')
  return novelStore.activeNovels
})

const emptyText = computed(() => ({
  all: '',
  writing: '没有正在写作的作品',
  archived: '没有归档的作品',
  trash: '回收站是空的',
}[activeTab.value]))

const totalWords = computed(() => novelStore.activeNovels.reduce((sum, novel) => sum + (novel.currentWordCount || 0), 0))

function isActive(novel: Novel) {
  return novel.status !== 'archived' && novel.status !== 'trash'
}

// 最近编辑的作品和章节
const resumeTarget = computed(() => {
  const novel = [...novelStore.activeNovels].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  if (!novel) return null
  const chapter = [...novel.chapters].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  return {
    novel,
    chapter,
    chapterLabel: chapter ? `第 ${chapter.chapterIndex + 1} 章 ${chapter.title}` : '打开章节列表',
  }
})

function resumeWriting() {
  const target = resumeTarget.value
  if (!target) return
  if (target.chapter) router.push(`/workspace/${target.novel.id}/editor/${target.chapter.id}`)
  else openWorkspace(target.novel.id)
}

// 封面布色：按书 id 稳定取色
const coverPalette = [
  ['#2F4A66', '#3B5A7A'], // 黛蓝
  ['#9C7A3C', '#B08C4A'], // 赭黄
  ['#4F7A72', '#5F8C83'], // 青瓷
  ['#8A3B3B', '#A04848'], // 胭脂
  ['#5B5470', '#6B6484'], // 藕紫
  ['#4D5B3A', '#5E6E47'], // 苍绿
]

function coverStyle(novel: Novel) {
  // FNV-1a：id 前缀是时间戳，简单累乘容易让同时创建的书撞色
  let hash = 0x811c9dc5
  for (const char of novel.id) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0
  // ^ 结果是有符号 32 位整数，必须转回无符号，否则取模可能为负
  const [base, light] = coverPalette[((hash ^ (hash >>> 16)) >>> 0) % coverPalette.length]
  return { '--cover-base': base, '--cover-light': light } as Record<string, string>
}

function coverTitle(title: string) {
  const clean = title.replace(/[《》]/g, '').trim() || '未命名'
  return clean.length > 8 ? `${clean.slice(0, 7)}…` : clean
}

// 打开工作台
function openWorkspace(novelId: string) {
  router.push(`/workspace/${novelId}`)
}

// 卡片菜单选项
const cardMenuOptions = [
  { label: '修改书名', key: 'rename' },
  { label: '归档', key: 'archive' },
  { label: '移入回收站', key: 'delete' },
]

// 处理卡片操作
function handleCardAction(key: string, novelId: string) {
  if (key === 'rename') {
    const novel = novelStore.getNovel(novelId)
    renameNovelId.value = novelId
    renameTitle.value = novel?.title || ''
    showRenameModal.value = true
  } else if (key === 'archive') {
    novelStore.archiveNovel(novelId)
  } else if (key === 'delete') {
    dialog.warning({
      title: '移入回收站',
      content: '小说会从书架隐藏，但仍可在回收站恢复。确定继续吗？',
      positiveText: '移入回收站',
      negativeText: '取消',
      onPositiveClick: () => {
        novelStore.deleteNovel(novelId)
      },
    })
  }
}

function restoreTrashedNovel(id: string) {
  novelStore.restoreNovel(id)
  message.success('小说已恢复到书架')
}

function confirmPurgeNovel(id: string) {
  dialog.error({
    title: '永久删除小说',
    content: '此操作会删除小说及其章节、数据面板和历史记录，无法恢复。确定永久删除吗？',
    positiveText: '永久删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      await novelStore.purgeNovel(id)
      message.success('小说已永久删除')
    },
  })
}

async function exportProject() {
  try {
    const backup = createProjectBackup(novelStore.novels, knowledgeStore.knowledgeBases, await loadProjectChapterRevisions(), useInspirationSessionsStore().sessions)
    parseProjectBackup(JSON.stringify(backup))
    downloadProjectBackup(backup, `ai-novel-writer-backup-${new Date().toISOString().slice(0, 10)}.json`)
    message.success('项目备份已校验并导出')
  } catch (error) { message.error(error instanceof Error ? error.message : '备份校验失败') }
}

function openImportPicker() {
  importInput.value?.click()
}

async function handleImportFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    if (file.size > MAX_PROJECT_BACKUP_BYTES) throw new Error('备份文件超过 256 MB 安全上限')
    const backup = parseProjectBackup(await file.text())
    dialog.warning({
      title: '覆盖本地项目',
      content: `备份包含 ${backup.novels.length} 本小说和 ${backup.knowledgeBases.length} 个知识库。导入会覆盖当前全部本地数据，确定继续吗？`,
      positiveText: '覆盖并导入',
      negativeText: '取消',
      onPositiveClick: async () => {
        try {
          await importProject(backup)
          message.success('项目导入成功')
        } catch (error) {
          message.error(error instanceof Error ? error.message : '项目导入失败')
        }
      },
    })
  } catch (error) {
    message.error(error instanceof Error ? error.message : '无法读取备份文件')
  }
}

function confirmRename() {
  const title = renameTitle.value.trim().replace(/[《》]/g, '')
  if (!renameNovelId.value || !title) return
  novelStore.updateTitle(renameNovelId.value, title)
  showRenameModal.value = false
  message.success('书名已修改')
}

function handleRenameKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter') return
  event.preventDefault()
  confirmRename()
}

// 计算进度百分比
function getProgress(novel: Novel): number {
  const target = novel.targetWordCountMin * 10000
  if (target === 0) return 0
  return Math.min(100, (novel.currentWordCount / target) * 100)
}

// 格式化日期
function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
</script>

<style scoped>
.shelf-page {
  max-width: 1440px;
  margin: 0 auto;
  padding: 36px 44px 48px;
}

.list-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 26px;
}

.shelf-title {
  margin-bottom: 6px;
  font-size: 36px;
}

.shelf-summary {
  font-size: 14px;
  color: var(--text-color-tertiary);
}

.dot-sep {
  margin: 0 8px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.hidden-file-input {
  display: none;
}

/* 分类标签 */
.shelf-tabs {
  display: flex;
  gap: 28px;
  margin-bottom: 26px;
  border-bottom: 1px solid var(--border-color);
}

.shelf-tab {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 4px 12px;
  border: none;
  background: none;
  font: inherit;
  font-size: 15px;
  color: var(--text-color-secondary);
  cursor: pointer;
}

.shelf-tab:hover {
  color: var(--text-color-primary);
}

.shelf-tab--active {
  color: var(--color-primary);
  font-weight: 600;
}

.shelf-tab--active::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  background: var(--color-primary);
}

.shelf-tab:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.shelf-tab-count {
  min-width: 18px;
  padding: 0 5px;
  border-radius: 100px;
  background: var(--bg-color-secondary);
  font-size: 11px;
  line-height: 17px;
  text-align: center;
  color: var(--text-color-tertiary);
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 46vh;
  gap: 12px;
  text-align: center;
  animation: fadeIn 0.6s ease;
}

.empty-state--small {
  min-height: 30vh;
  color: var(--text-color-tertiary);
}

.empty-state h3 {
  font-size: 22px;
  color: var(--text-color-primary);
}

.empty-state p {
  font-size: 14px;
  color: var(--text-color-tertiary);
  margin-bottom: 6px;
}

/* 小说卡片网格 */
.novel-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 22px;
}

.novel-card {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--radius-lg);
  background: var(--bg-color-card);
  box-shadow: var(--shadow-card);
  cursor: pointer;
  animation: fadeIn 0.4s ease backwards;
  transition: transform var(--transition-fast), box-shadow var(--transition-fast);
}

.novel-card:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow-hover);
}

.novel-card:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 3px;
}

.novel-card--muted {
  cursor: default;
}

.novel-card--muted .book-cover {
  filter: grayscale(0.65);
  opacity: 0.75;
}

/* 线装书封面 */
.book-cover {
  position: relative;
  aspect-ratio: 4 / 5;
  max-height: 300px;
  background:
    repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.025) 0 1px, transparent 1px 3px),
    repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.03) 0 1px, transparent 1px 3px),
    linear-gradient(160deg, var(--cover-light), var(--cover-base));
  overflow: hidden;
}

.book-cover::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 42%;
  background: rgba(0, 0, 0, 0.12);
  clip-path: polygon(0 70%, 16% 38%, 28% 56%, 46% 14%, 62% 50%, 74% 32%, 90% 62%, 100% 44%, 100% 100%, 0 100%);
}

.book-binding {
  position: absolute;
  top: 0;
  right: 14px;
  bottom: 0;
  width: 2px;
  background: rgba(255, 253, 248, 0.5);
}

.book-binding span {
  position: absolute;
  right: -6px;
  width: 14px;
  height: 2px;
  background: rgba(255, 253, 248, 0.75);
}

.book-binding span:nth-child(1) { top: 12%; }
.book-binding span:nth-child(2) { top: 37%; }
.book-binding span:nth-child(3) { top: 62%; }
.book-binding span:nth-child(4) { top: 87%; }

.book-label {
  position: absolute;
  top: 9%;
  left: 15%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px 8px 10px;
  border: 1px solid rgba(60, 40, 20, 0.35);
  background: #F7F0E1;
  box-shadow: inset 0 0 0 3px #F7F0E1, inset 0 0 0 4px rgba(60, 40, 20, 0.25), 0 2px 6px rgba(0, 0, 0, 0.2);
  z-index: 1;
}

.book-label-text {
  writing-mode: vertical-rl;
  font-family: var(--font-family-serif);
  font-size: 19px;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: #2B2A28;
}

.book-label-seal {
  width: 12px;
  height: 12px;
  border-radius: 2px;
  background: #B83A2E;
}

.cover-badge {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 2;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  background: rgba(255, 253, 248, 0.9);
  font-size: 11px;
  color: var(--color-warning);
}

.card-body {
  flex: 1;
  padding: 14px 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.card-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--text-color-primary);
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.card-stats {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.stat-value {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color-primary);
  font-variant-numeric: tabular-nums;
}

.stat-label {
  font-size: 11px;
  color: var(--text-color-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 进度条 */
.progress-bar {
  width: 100%;
  height: 4px;
  margin-top: -4px;
  background: var(--progress-track);
  border-radius: 100px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--progress-fill);
  border-radius: 100px;
  transition: width 0.5s ease;
}

.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: auto;
  min-height: 28px;
}

.card-time {
  font-size: 12px;
  color: var(--text-color-tertiary);
}

.card-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.action-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-color-tertiary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.action-btn:hover {
  background: var(--bg-color-hover);
  color: var(--text-color-primary);
}

/* 新建入口卡片 */
.new-card {
  position: relative;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 360px;
  border: 1px dashed var(--border-color-hover);
  background: transparent;
  box-shadow: none;
  font: inherit;
  color: var(--text-color-primary);
}

.new-card:hover {
  border-color: var(--color-primary);
  box-shadow: none;
}

.new-card-plus {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  margin-bottom: 6px;
  border: 1px solid var(--border-color-hover);
  border-radius: 50%;
  color: var(--text-color-secondary);
  transition: all var(--transition-fast);
}

.new-card:hover .new-card-plus {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.new-card-title {
  font-family: var(--font-family-serif);
  font-size: 17px;
  font-weight: 700;
}

.new-card-hint {
  font-size: 12px;
  color: var(--text-color-tertiary);
}

.new-card-ink {
  position: absolute;
  bottom: 16px;
  width: 70%;
  opacity: 0.07;
}

/* 继续写作 */
.resume-card {
  position: fixed;
  right: 32px;
  bottom: 28px;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 14px;
  max-width: 380px;
  padding: 14px 18px 14px 22px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  background: var(--bg-color-card);
  box-shadow: var(--shadow-lg);
  font: inherit;
  color: var(--text-color-secondary);
  text-align: left;
  cursor: pointer;
  transition: transform var(--transition-fast), border-color var(--transition-fast);
}

.resume-card:hover {
  transform: translateY(-2px);
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.resume-ribbon {
  position: absolute;
  top: -1px;
  left: 10px;
  width: 8px;
  height: 22px;
  background: var(--color-primary);
  clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 75%, 0 100%);
}

.resume-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.resume-label {
  font-size: 12px;
  color: var(--text-color-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.resume-chapter {
  font-family: var(--font-family-serif);
  font-size: 16px;
  font-weight: 700;
  color: var(--text-color-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rename-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

@media (max-width: 900px) {
  .shelf-page { padding: 24px 20px 96px; }
}

@media (max-width: 640px) {
  .list-header {
    align-items: flex-start;
    flex-direction: column;
    gap: 12px;
  }

  .header-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .resume-card {
    left: 12px;
    right: 12px;
    bottom: 12px;
    max-width: none;
  }
}
</style>
