<template>
  <div class="workspace-layout" v-if="novel" id="workspace-page">
    <!-- 侧边栏 -->
    <aside class="workspace-sidebar">
      <div class="sidebar-header">
        <button class="back-btn" @click="$router.push('/')" title="返回书架" aria-label="返回书架">
          <n-icon :size="17"><arrow-back-outline /></n-icon>
          <span>返回书架</span>
        </button>
        <div class="sidebar-book">
        <div class="sidebar-book-cover" aria-hidden="true"><span>{{ novel.title.slice(0, 8) }}</span></div>
        <div class="novel-info">
          <button type="button" class="novel-title" title="点击修改书名" :aria-label="`修改《${novel.title}》书名`" @click="openRename">《{{ novel.title }}》</button>
          <span class="novel-meta">{{ novel.genreLabel }} · {{ novel.subGenreLabel }}</span>
          <span class="novel-meta">{{ ({ creating: '设定中', writing: '创作中', archived: '已归档', trash: '回收站', completed: '已完结' })[novel.status] }} · {{ formatWordCount(novel.currentWordCount, '') }} 字</span>
        </div>
        </div>
      </div>

      <nav class="sidebar-nav" aria-label="作品导航">
        <template v-for="item in navItems" :key="item.path"><router-link
          :to="`/workspace/${novelId}/${item.path}`"
          class="nav-link"
          :class="{ 'nav-link--active': item.path === 'chapters' && isEditorRoute }"
          active-class="nav-link--active"
          :title="item.label"
          :aria-label="item.label"
        >
          <n-icon class="nav-link-icon" :size="18"><component :is="item.icon" /></n-icon>
          <span class="nav-link-label">{{ item.label }}</span>
          <span class="nav-badge" v-if="item.badge">{{ item.badge }}</span>
        </router-link>
        <ol v-if="item.path === 'chapters' && isEditorRoute" class="sidebar-chapters" aria-label="附近章节"><li v-for="chapter in nearbyChapters" :key="chapter.id"><router-link :to="`/workspace/${novelId}/editor/${chapter.id}`" :aria-current="route.params.chapterId === chapter.id ? 'page' : undefined">第 {{ chapter.chapterIndex + 1 }} 章 <span>{{ chapterTitleForDisplay(chapter.title, chapter.chapterIndex, '未命名') }}</span></router-link></li></ol>
        </template>

        <div class="nav-divider"></div>

        <!-- 导出下拉 -->
        <n-dropdown :options="exportOptions" @select="handleExport" placement="right-start">
          <button class="nav-link nav-button" title="导出小说" aria-label="导出小说">
            <n-icon class="nav-link-icon" :size="18"><share-outline /></n-icon>
            <span class="nav-link-label">导出小说</span>
          </button>
        </n-dropdown>

        <div v-if="aiActivities.length" class="ai-task-panel" aria-label="AI 任务">
          <div class="ai-task-panel-title">
            <span>AI 任务</span>
            <span v-if="runningAiActivities.length" class="ai-task-count">{{ runningAiActivities.length }}</span>
          </div>
          <template v-for="activity in aiActivities" :key="activity.id">
            <button
              type="button"
              class="ai-task-row"
              :class="`ai-task-${aiActivityState(activity)}`"
              :title="aiActivityState(activity) === 'running' ? '点击返回任务位置' : '点击返回任务位置并标记已读'"
              @click="openAiActivity(activity)"
            >
              <span class="ai-task-indicator" :class="{
                'ai-task-indicator-done': aiActivityState(activity) === 'completed',
                'ai-task-indicator-running': aiActivityState(activity) === 'running',
              }"></span>
              <span class="ai-task-name">{{ activity.name }}</span>
              <span class="ai-task-state">
                {{ aiActivityState(activity) === 'running' ? '进行中' : aiActivityState(activity) === 'completed' ? '已完成' : '失败' }}
              </span>
            </button>
            <p v-if="activity.error" class="ai-task-error" role="status">{{ activityError(activity.error) }}</p>
            <details v-if="childActivitiesOf(activity.id).length" class="ai-task-children" :open="aiActivityState(activity) === 'running'">
              <summary>执行步骤（{{ childActivitiesOf(activity.id).length }}）</summary>
              <div v-for="child in childActivitiesOf(activity.id)" :key="child.id" class="ai-task-child">
                <span class="ai-task-indicator" :class="{
                  'ai-task-indicator-done': child.status === 'completed',
                  'ai-task-indicator-running': child.status === 'running',
                  'ai-task-indicator-failed': child.status === 'failed',
                }"></span>
                <span class="ai-task-name">{{ child.name }}</span>
                <span class="ai-task-state">
                  {{ child.status === 'running' ? '进行中' : child.status === 'completed' ? '已完成' : '失败' }}
                </span>
                <p v-if="child.error" class="ai-task-error" role="status">{{ activityError(child.error) }}</p>
              </div>
            </details>
          </template>
        </div>
      </nav>

      <!-- 统计信息 -->
      <div class="sidebar-stats">
        <div class="stat-main">
          <span class="stat-big">{{ formatWordCount(novel.currentWordCount, '') }}</span>
          <span class="stat-unit">字 · {{ novel.chapters.length }} 章</span>
        </div>
        <div class="progress-bar-mini" role="progressbar" :aria-valuenow="Math.round(getProgress)" aria-valuemin="0" aria-valuemax="100" aria-label="目标字数进度">
          <div class="progress-fill-mini" :style="{ width: getProgress + '%' }"></div>
        </div>
        <div class="stat-row">
          <span>目标 {{ novel.targetWordCountMin }}~{{ novel.targetWordCountMax }} 万字</span>
          <span>{{ Math.round(getProgress) }}%</span>
        </div>
      </div>
    </aside>

    <!-- 主内容区 -->
    <main class="workspace-main">
      <router-view v-slot="{ Component, route: childRoute }">
        <keep-alive>
          <component :is="Component" :key="childRoute.fullPath" />
        </keep-alive>
      </router-view>
    </main>

    <!-- AI 对话助手 -->
    <AiChatAssistant :novelId="novelId" :chapter-id="typeof route.params.chapterId === 'string' ? route.params.chapterId : ''" :host="assistantChatHost" />

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

  <!-- 找不到小说 -->
  <div v-else class="page-container fade-in workspace-missing">
    <div class="workspace-missing-inner">
      <svg class="ink-mountains" viewBox="0 0 220 80" aria-hidden="true"><path fill="currentColor" d="M0 80 L40 38 L62 56 L98 14 L130 50 L150 34 L188 66 L220 46 L220 80 Z" /></svg>
      <h2>找不到这本小说</h2>
      <n-button type="primary" @click="$router.push('/')">返回书架</n-button>
    </div>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'Workspace' })

import { computed, provide, ref, shallowRef, type Component } from 'vue'
import { useRoute } from 'vue-router'
import { NIcon, NButton, NDropdown, NModal, NInput, useMessage } from 'naive-ui'
import {
  ArrowBackOutline, DocumentTextOutline, ListOutline, PeopleOutline, LayersOutline,
  TrendingUpOutline, StatsChartOutline, BulbOutline, ShareOutline,
} from '@vicons/ionicons5'
import { useNovelStore } from '@/stores/novel'
import { chapterTitleForDisplay } from '@/v3/write/chapterNumber'
import { exportToTXT, exportToWordHtml, exportToEpub } from '@/services/export'
import AiChatAssistant from '@/components/AiChatAssistant.vue'
import { editorAssistantHostKey } from '@/services/editorAssistantHost'
import { formatWordCount } from '@/utils/format'
import { openAiActivity, useAiActivities } from '@/services/aiActivity'
import { safeAiErrorMessage } from '@/services/aiDiagnostics'
import { useConfigStore } from '@/stores/config'

const route = useRoute()
const novelStore = useNovelStore()
const configStore = useConfigStore()
const activityError = (error: string) => safeAiErrorMessage(error, configStore.models.map(model => model.apiKey))
const msg = useMessage()
const showRenameModal = ref(false)
const renameTitle = ref('')
const assistantChatHost = shallowRef<HTMLElement | null>(null)
provide(editorAssistantHostKey, (host, active) => {
  if (active) assistantChatHost.value = host
  else if (assistantChatHost.value === host) assistantChatHost.value = null
})
const {
  activities: aiActivities,
  runningActivities: runningAiActivities,
  childrenOf: childActivitiesOf,
  aiActivityState,
} = useAiActivities()

const novelId = ref(route.params.novelId as string)
const novel = computed(() => novelStore.getNovel(novelId.value))
// 编辑器属于“章节”分组，导航高亮保持在章节上
const isEditorRoute = computed(() => route.name === 'WorkspaceEditor')
const nearbyChapters = computed(() => {
  const chapters = [...(novel.value?.chapters || [])].sort((a, b) => a.chapterIndex - b.chapterIndex)
  const index = Math.max(0, chapters.findIndex(chapter => chapter.id === route.params.chapterId))
  return chapters.slice(Math.max(0, index - 2), index + 3)
})

const navItems = computed<Array<{ path: string; label: string; icon: Component; badge?: number }>>(() => {
  const book = novel.value
  return [
    { path: 'chapters', label: '章节', icon: DocumentTextOutline, badge: book?.chapters.length || undefined },
    { path: 'outline', label: '大纲', icon: ListOutline },
    { path: 'planning', label: '剧情规划', icon: TrendingUpOutline, badge: book?.storyArcs?.length || undefined },
    { path: 'characters', label: '角色库', icon: PeopleOutline, badge: book?.characters?.length || undefined },
    { path: 'knowledge', label: '知识库', icon: LayersOutline },
    { path: 'data', label: '数据面板', icon: StatsChartOutline, badge: book?.dataPanels?.length || undefined },
    { path: 'inspiration', label: '灵感记录', icon: BulbOutline },
  ]
})

const exportOptions = [
  { label: '导出为 TXT', key: 'txt' },
  { label: '只导出正文 TXT（不含大纲）', key: 'txt-body' },
  { label: '导出为 Word 兼容 HTML (.doc)', key: 'word' },
  { label: '只导出正文 Word（不含大纲）', key: 'word-body' },
  { label: '导出为 EPUB', key: 'epub' },
]

async function handleExport(key: string) {
  if (!novel.value) return
  if (key === 'txt' || key === 'txt-body') {
    exportToTXT(novel.value, { bodyOnly: key === 'txt-body' })
    msg.success('已导出为 TXT')
  } else if (key === 'word' || key === 'word-body') {
    exportToWordHtml(novel.value, { bodyOnly: key === 'word-body' })
    msg.success('已导出为 Word')
  } else if (key === 'epub') {
    try {
      await exportToEpub(novel.value)
      msg.success('已导出为 EPUB')
    } catch (e: any) {
      msg.error('EPUB 导出失败：' + e.message)
    }
  }
}

function openRename() {
  renameTitle.value = novel.value?.title || ''
  showRenameModal.value = true
}

async function confirmRename() {
  if (!novel.value) return
  const title = renameTitle.value.trim().replace(/[《》]/g, '')
  if (!title) return
  try {
    await novelStore.updateTitleWithImpact(novel.value.id, title)
    showRenameModal.value = false
    msg.success('书名已修改')
  } catch (error) { msg.error(error instanceof Error ? error.message : '书名保存失败') }
}

function handleRenameKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter') return
  event.preventDefault()
  confirmRename()
}

const getProgress = computed(() => {
  if (!novel.value) return 0
  const target = novel.value.targetWordCountMin * 10000
  if (target === 0) return 0
  return Math.min(100, (novel.value.currentWordCount / target) * 100)
})
</script>

<style scoped>
.workspace-layout {
  display: flex;
  height: 100%;
  overflow: hidden;
}

/* 侧边栏 */
.workspace-sidebar {
  width: 208px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-color-sidebar);
  border-right: 1px solid var(--border-color);
  transition: background-color var(--transition-normal);
}

@media (min-width: 1200px) {
  .workspace-sidebar { width: 208px; }
}

.sidebar-header {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 16px;
  padding: 20px 16px;
  border-bottom: 1px solid var(--border-color);
}

.back-btn {
  width: fit-content;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-color-secondary);
  cursor: pointer;
  flex-shrink: 0;
  transition: all var(--transition-fast);
}

.sidebar-book { display: flex; align-items: center; gap: 12px; min-width: 0; }
.sidebar-book-cover { display: grid; place-items: center; flex: 0 0 48px; height: 72px; padding: 8px 6px; border-radius: 3px 6px 6px 3px; background: var(--color-primary); color: var(--text-color-inverse); box-shadow: inset 4px 0 0 #ffffff26, 0 4px 10px #0000000c; }
.sidebar-book-cover span { writing-mode: vertical-rl; font-family: var(--font-family-serif); font-size: 14px; letter-spacing: 2px; max-height: 60px; overflow: hidden; }

.back-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.novel-info {
  min-width: 0;
  overflow: hidden;
}

.novel-title {
  border: 0;
  background: none;
  padding: 0;
  max-width: 100%;
  text-align: left;
  font-family: var(--font-family-serif);
  font-size: 16px;
  font-weight: 700;
  color: var(--text-color-primary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}

.novel-title:hover {
  color: var(--color-primary);
}

.rename-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.novel-meta {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-color-tertiary);
}

/* 导航链接 */
.sidebar-nav {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-link {
  position: relative;
  display: flex;
  align-items: center;
  gap: 11px;
  min-height: 40px;
  padding: 0 12px;
  border-radius: var(--radius-md);
  font-size: 14px;
  color: var(--text-color-secondary);
  text-decoration: none;
  transition: background-color var(--transition-fast), color var(--transition-fast);
}

.nav-button {
  width: 100%;
  border: none;
  background: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.nav-link:hover {
  background: var(--bg-color-hover);
  color: var(--text-color-primary);
}

.nav-link:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}

.nav-link--active {
  background: var(--color-primary-light) !important;
  color: var(--color-primary) !important;
  font-weight: 600;
}

.nav-link--active::before {
  content: '';
  position: absolute;
  left: -8px;
  top: 9px;
  bottom: 9px;
  width: 3px;
  border-radius: 0 2px 2px 0;
  background: var(--color-primary);
}

.nav-link-icon {
  flex-shrink: 0;
}

.nav-badge {
  margin-left: auto;
  min-width: 22px;
  padding: 0 6px;
  border-radius: 100px;
  background: var(--bg-color-secondary);
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
  text-align: center;
  color: var(--text-color-tertiary);
}

.nav-link--active .nav-badge {
  background: var(--bg-color-card);
  color: var(--color-primary);
}

.ai-task-panel {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border-color-light);
}

.ai-task-panel-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px 5px;
  color: var(--text-color-tertiary);
  font-size: 11px;
  letter-spacing: 0.1em;
}

.ai-task-count {
  min-width: 16px;
  padding: 1px 5px;
  border-radius: 8px;
  background: var(--color-accent-light);
  color: var(--color-accent);
  text-align: center;
}

.ai-task-row {
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
  width: 100%;
  min-height: 30px;
  padding: 5px 12px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-color-secondary);
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.ai-task-row:hover {
  background: var(--bg-color-hover);
  color: var(--text-color-primary);
}

.ai-task-child {
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
  min-height: 25px;
  padding: 3px 12px 3px 27px;
  color: var(--text-color-tertiary);
  font-size: 11px;
}

.ai-task-error {
  grid-column: 1 / -1;
  margin: 2px 12px 8px;
  color: var(--color-accent);
  font-size: 11px;
  line-height: 1.5;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.ai-task-children {
  margin: 0 12px 4px 27px;
  color: var(--text-color-tertiary);
  font-size: 10px;
}

.ai-task-children summary {
  padding: 2px 0;
  cursor: pointer;
  user-select: none;
}

.ai-task-indicator {
  width: 7px;
  height: 7px;
  border: 1px solid var(--color-accent);
  border-radius: 50%;
  background: transparent;
}

.ai-task-indicator-done {
  border-color: var(--color-success);
  background: var(--color-success);
}

.ai-task-failed .ai-task-indicator {
  border-color: var(--color-error);
  background: var(--color-error);
}

.ai-task-indicator-running {
  border-color: var(--color-accent);
  background: var(--color-accent);
  animation: ai-pulse 1.4s ease-in-out infinite;
}

.ai-task-indicator-failed {
  border-color: var(--color-error);
  background: var(--color-error);
}

@keyframes ai-pulse {
  50% { opacity: 0.35; }
}

@media (prefers-reduced-motion: reduce) {
  .ai-task-indicator-running { animation: none; }
}

.ai-task-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.ai-task-state {
  color: var(--text-color-tertiary);
  font-size: 10px;
  white-space: nowrap;
}

/* 统计信息 */
.sidebar-stats {
  margin: 0 10px 12px;
  padding: 12px;
  border: 1px solid var(--border-color-light);
  border-radius: var(--radius-lg);
  background: var(--bg-color-card);
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.stat-main {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.stat-big {
  font-family: var(--font-family-serif);
  font-size: 20px;
  font-weight: 700;
  color: var(--text-color-primary);
  font-variant-numeric: tabular-nums;
}

.stat-unit {
  font-size: 12px;
  color: var(--text-color-tertiary);
}

.stat-row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-color-tertiary);
}

.progress-bar-mini {
  height: 4px;
  background: var(--progress-track);
  border-radius: 100px;
  overflow: hidden;
}

.progress-fill-mini {
  height: 100%;
  background: var(--progress-fill);
  border-radius: 100px;
  transition: width 0.5s ease;
}

/* 导航分隔线 */
.nav-divider {
  height: 1px;
  background: var(--border-color-light);
  margin: 8px 12px;
}

/* 主内容区 */
.workspace-main {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

.workspace-missing {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
}

.workspace-missing-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  text-align: center;
}

@media (max-width: 768px) {
  .workspace-layout {
    padding-left: 56px;
  }

  .workspace-layout .workspace-sidebar {
    position: fixed;
    top: var(--app-header-height, 56px);
    bottom: 0;
    left: 0;
    width: 56px;
    z-index: 100;
  }

  .sidebar-header {
    justify-content: center;
    padding: 10px 6px;
  }

  .novel-info,
  .sidebar-book,
  .back-btn span,
  .sidebar-stats,
  .nav-badge,
  .nav-link-label,
  .ai-task-panel {
    display: none;
  }

  .back-btn { width: 32px; align-self: center; }

  .sidebar-nav {
    padding: 8px 6px;
    overflow-x: hidden;
  }

  .nav-link {
    justify-content: center;
    gap: 0;
    padding: 10px;
  }

  .nav-link--active::before {
    left: -6px;
  }

  .nav-divider {
    margin: 8px 4px;
  }

  .workspace-main {
    width: 100%;
  }
}
.sidebar-chapters { list-style: none; padding: 6px 0 16px 18px; margin-left: 16px; border-left: 1px solid var(--border-color-hover); display: grid; gap: 4px; }
.sidebar-chapters a { display: block; padding: 8px; color: var(--text-color-secondary); font-size: 12px; border-radius: var(--radius-sm); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.sidebar-chapters a[aria-current="page"] { color: var(--color-primary); background: var(--color-primary-light); }
.sidebar-chapters span { margin-left: 6px; }
@media (max-width: 768px) { .sidebar-chapters { display: none; } }
</style>
