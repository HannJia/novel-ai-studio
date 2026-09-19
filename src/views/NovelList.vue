<template>
  <div class="page-container fade-in" id="novel-list-page">
    <!-- 页面头部 -->
    <div class="list-header">
      <h1 class="page-title">我的书架</h1>
      <div class="header-actions">
        <n-button secondary @click="$router.push('/knowledge')">📚 知识库</n-button>
        <n-button secondary @click="exportProject">备份项目</n-button>
        <n-button secondary @click="openImportPicker">导入项目</n-button>
        <input ref="importInput" class="hidden-file-input" type="file" accept=".json,application/json" @change="handleImportFile" />
        <n-button
          type="primary"
          size="large"
          @click="$router.push('/create')"
          id="create-novel-btn"
        >
          <template #icon>
            <n-icon><add-outline /></n-icon>
          </template>
          创建新书
        </n-button>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-if="novelStore.activeNovels.length === 0" class="empty-state">
      <div class="empty-illustration">📖</div>
      <h3>还没有任何作品</h3>
      <p>开始你的创作之旅，让 AI 助你书写精彩故事</p>
      <n-button type="primary" size="large" @click="$router.push('/create')">
        ✨ 创建第一本小说
      </n-button>
    </div>

    <!-- 小说卡片网格 -->
    <div v-else class="novel-grid">
      <div
        v-for="(novel, index) in novelStore.activeNovels"
        :key="novel.id"
        class="novel-card paper-panel"
        :style="{ animationDelay: `${index * 0.06}s` }"
        :id="'novel-card-' + novel.id"
        @click="openWorkspace(novel.id)"
      >
        <!-- 卡片左侧色条 -->
        <div class="card-accent"></div>

        <div class="card-body">
          <!-- 类型标签 -->
          <div class="card-tags">
            <span class="tag-chip">{{ novel.genreLabel }}</span>
            <span class="tag-chip">{{ novel.subGenreLabel }}</span>
          </div>

          <!-- 状态标记 -->
          <span v-if="novel.status === 'creating'" class="status-badge creating">生成中</span>

          <!-- 书名 -->
          <h3 class="card-title">{{ novel.title }}</h3>

          <!-- 进度信息 -->
          <div class="card-stats">
            <div class="stat-item">
              <span class="stat-label">已写</span>
              <span class="stat-value">{{ formatWordCount(novel.currentWordCount) }}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">目标</span>
              <span class="stat-value">{{ novel.targetWordCountMin }}~{{ novel.targetWordCountMax }} 万字</span>
            </div>
          </div>

          <!-- 进度条 -->
          <div class="progress-bar">
            <div
              class="progress-fill"
              :style="{ width: getProgress(novel) + '%' }"
            ></div>
          </div>

          <!-- 底部信息 -->
          <div class="card-footer">
            <span class="card-time">{{ formatDate(novel.updatedAt) }}</span>
            <div class="card-actions" @click.stop>
              <n-dropdown
                trigger="click"
                :options="cardMenuOptions"
                @select="(key: string) => handleCardAction(key, novel.id)"
              >
                <button class="action-btn" title="更多操作">
                  <n-icon :size="18"><ellipsis-horizontal /></n-icon>
                </button>
              </n-dropdown>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 归档区域 -->
    <n-modal v-model:show="showRenameModal" preset="card" title="修改书名" style="width: 420px;">
      <n-input v-model:value="renameTitle" placeholder="输入新的书名" @keydown="handleRenameKeydown" />
      <template #footer>
        <div class="rename-actions">
          <n-button @click="showRenameModal = false">取消</n-button>
          <n-button type="primary" :disabled="!renameTitle.trim()" @click="confirmRename">保存</n-button>
        </div>
      </template>
    </n-modal>

    <template v-if="novelStore.archivedNovels.length > 0">
      <div class="gradient-divider"></div>
      <div class="archived-section">
        <h3 class="section-title" @click="showArchived = !showArchived">
          📦 已归档 ({{ novelStore.archivedNovels.length }})
          <span class="toggle-arrow" :class="{ 'arrow-open': showArchived }">▸</span>
        </h3>
        <div v-if="showArchived" class="novel-grid archived-grid">
          <div
            v-for="novel in novelStore.archivedNovels"
            :key="novel.id"
            class="novel-card paper-panel archived-card"
          >
            <div class="card-accent archived-accent"></div>
            <div class="card-body">
              <div class="card-tags">
                <span class="tag-chip">{{ novel.genreLabel }}</span>
              </div>
              <h3 class="card-title">{{ novel.title }}</h3>
              <div class="card-footer">
                <span class="card-time">归档于 {{ formatDate(novel.updatedAt) }}</span>
                <n-button size="tiny" quaternary @click="novelStore.unarchiveNovel(novel.id)">
                  恢复
                </n-button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <template v-if="novelStore.trashedNovels.length > 0">
      <div class="gradient-divider"></div>
      <div class="archived-section trash-section">
        <h3 class="section-title" @click="showTrash = !showTrash">
          🗑️ 回收站 ({{ novelStore.trashedNovels.length }})
          <span class="toggle-arrow" :class="{ 'arrow-open': showTrash }">▸</span>
        </h3>
        <div v-if="showTrash" class="novel-grid archived-grid">
          <div v-for="novel in novelStore.trashedNovels" :key="novel.id" class="novel-card paper-panel archived-card">
            <div class="card-accent trash-accent"></div>
            <div class="card-body">
              <div class="card-tags"><span class="tag-chip">已移入回收站</span></div>
              <h3 class="card-title">{{ novel.title }}</h3>
              <div class="card-footer">
                <span class="card-time">移入于 {{ formatDate(novel.updatedAt) }}</span>
                <div class="trash-actions">
                  <n-button size="tiny" quaternary @click="restoreTrashedNovel(novel.id)">恢复</n-button>
                  <n-button size="tiny" quaternary type="error" @click="confirmPurgeNovel(novel.id)">永久删除</n-button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NIcon, NDropdown, NModal, NInput, useDialog, useMessage } from 'naive-ui'
import { AddOutline, EllipsisHorizontal } from '@vicons/ionicons5'
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
const showArchived = ref(false)
const showTrash = ref(false)
const importInput = ref<HTMLInputElement | null>(null)
const showRenameModal = ref(false)
const renameNovelId = ref('')
const renameTitle = ref('')

// 打开工作台
function openWorkspace(novelId: string) {
  router.push(`/workspace/${novelId}`)
}

// 卡片菜单选项
const cardMenuOptions = [
  { label: '修改书名', key: 'rename' },
  { label: '📦 归档', key: 'archive' },
  { label: '🗑️ 移入回收站', key: 'delete' },
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
.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-xl);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.hidden-file-input {
  display: none;
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 50vh;
  gap: 14px;
  text-align: center;
  animation: fadeIn 0.6s ease;
}

.empty-illustration {
  font-size: 80px;
  margin-bottom: 8px;
  animation: float 3s ease-in-out infinite;
}

@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}

.empty-state h3 {
  font-size: 20px;
  color: var(--text-color-primary);
  font-weight: 600;
}

.empty-state p {
  font-size: 14px;
  color: var(--text-color-tertiary);
  margin-bottom: 8px;
}

/* 小说卡片网格 */
.novel-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: var(--space-lg);
}

.novel-card {
  display: flex;
  overflow: hidden;
  cursor: pointer;
  padding: 0;
  animation: fadeIn 0.4s ease backwards;
  transition: transform var(--transition-fast), box-shadow var(--transition-fast);
}

.novel-card:hover {
  transform: translateY(-3px);
}

/* 左侧色条 */
.card-accent {
  width: 4px;
  flex-shrink: 0;
  background: linear-gradient(180deg, var(--color-primary), var(--color-primary-suppl));
  border-radius: var(--radius-lg) 0 0 var(--radius-lg);
}

.archived-accent {
  background: linear-gradient(180deg, var(--text-color-tertiary), var(--text-color-disabled));
}

.card-body {
  flex: 1;
  padding: var(--space-lg);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.card-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.card-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-color-primary);
  line-height: 1.3;
  cursor: pointer;
  transition: color var(--transition-fast);
}

.card-title:hover {
  color: var(--color-primary);
}

.status-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 100px;
  font-size: 11px;
  font-weight: 600;
}

.status-badge.creating {
  background: rgba(240, 160, 32, 0.12);
  color: #F0A020;
}

.card-stats {
  display: flex;
  gap: 24px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat-label {
  font-size: 11px;
  color: var(--text-color-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.stat-value {
  font-size: 14px;
  color: var(--text-color-secondary);
  font-weight: 500;
}

/* 进度条 */
.progress-bar {
  width: 100%;
  height: 4px;
  background: var(--progress-track);
  border-radius: 100px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--color-primary), var(--color-primary-suppl));
  border-radius: 100px;
  transition: width 0.5s ease;
  min-width: 0;
}

.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: auto;
}

.card-time {
  font-size: 12px;
  color: var(--text-color-tertiary);
}

.action-btn {
  width: 32px;
  height: 32px;
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

/* 归档区域 */
.archived-section {
  margin-top: var(--space-md);
}

.section-title {
  font-size: 15px;
  color: var(--text-color-tertiary);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  user-select: none;
  margin-bottom: var(--space-md);
}

.section-title:hover {
  color: var(--text-color-secondary);
}

.toggle-arrow {
  font-size: 12px;
  transition: transform var(--transition-fast);
}

.arrow-open {
  transform: rotate(90deg);
}

.archived-card {
  opacity: 0.7;
}

.archived-card:hover {
  opacity: 1;
}

.trash-accent {
  background: linear-gradient(180deg, #d03050, #f0a020);
}

.trash-actions {
  display: flex;
  gap: 4px;
  align-items: center;
}

.rename-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
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
}
</style>
