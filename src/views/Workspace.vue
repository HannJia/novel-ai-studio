<template>
  <div class="workspace-layout" v-if="isWorkspaceRoute && novel" id="workspace-page">
    <!-- 侧边栏 -->
    <aside class="workspace-sidebar">
      <div class="sidebar-header">
        <button class="back-btn" @click="$router.push('/')" title="返回书架">
          <n-icon :size="18"><arrow-back-outline /></n-icon>
        </button>
        <div class="novel-info">
          <h3 class="novel-title" title="点击修改书名" @click="openRename">{{ novel.title }}</h3>
          <span class="novel-meta">{{ novel.genreLabel }} · {{ novel.subGenreLabel }}</span>
        </div>
      </div>

      <nav class="sidebar-nav">
        <router-link
          :to="`/workspace/${novelId}/chapters`"
          class="nav-link"
          active-class="nav-link--active"
          title="章节列表"
          aria-label="章节列表"
        >
          <span class="nav-link-icon">📝</span>
          <span>章节列表</span>
          <span class="nav-badge" v-if="novel.chapters.length > 0">{{ novel.chapters.length }}</span>
        </router-link>
        <router-link
          :to="`/workspace/${novelId}/outline`"
          class="nav-link"
          active-class="nav-link--active"
          title="大纲"
          aria-label="大纲"
        >
          <span class="nav-link-icon">📋</span>
          <span>大纲</span>
        </router-link>
        <router-link
          :to="`/workspace/${novelId}/characters`"
          class="nav-link"
          active-class="nav-link--active"
          title="角色库"
          aria-label="角色库"
        >
          <span class="nav-link-icon">👤</span>
          <span>角色库</span>
          <span class="nav-badge" v-if="novel.characters && novel.characters.length > 0">{{ novel.characters.length }}</span>
        </router-link>
        <router-link
          :to="`/workspace/${novelId}/knowledge`"
          class="nav-link"
          active-class="nav-link--active"
          title="知识库"
          aria-label="知识库"
        >
          <span class="nav-link-icon">📚</span>
          <span>知识库</span>
        </router-link>
        <router-link
          :to="`/workspace/${novelId}/planning`"
          class="nav-link"
          active-class="nav-link--active"
          title="剧情规划"
          aria-label="剧情规划"
        >
          <span class="nav-link-icon">🧭</span>
          <span>剧情规划</span>
          <span class="nav-badge" v-if="novel.storyArcs?.length">{{ novel.storyArcs.length }}</span>
        </router-link>
        <router-link
          :to="`/workspace/${novelId}/data`"
          class="nav-link"
          active-class="nav-link--active"
          title="数据面板"
          aria-label="数据面板"
        >
          <span class="nav-link-icon">🔢</span>
          <span>数据面板</span>
          <span class="nav-badge" v-if="novel.dataPanels?.length">{{ novel.dataPanels.length }}</span>
        </router-link>

        <router-link
          :to="`/workspace/${novelId}/inspiration`"
          class="nav-link"
          active-class="nav-link--active"
          title="灵感记录"
          aria-label="灵感记录"
        >
          <span class="nav-link-icon">💡</span>
          <span>灵感记录</span>
        </router-link>

        <div class="nav-divider"></div>

        <!-- 导出下拉 -->
        <n-dropdown :options="exportOptions" @select="handleExport" placement="right-start">
          <button class="nav-link" title="导出小说" aria-label="导出小说" style="border:none;background:none;width:100%;cursor:pointer;text-align:left;">
            <span class="nav-link-icon">📤</span>
            <span>导出小说</span>
          </button>
        </n-dropdown>

        <div v-if="aiActivities.length" class="ai-task-panel" aria-label="AI 任务">
          <div class="ai-task-panel-title">
            <span>AI 任务</span>
            <span v-if="runningAiActivities.length" class="ai-task-count">{{ runningAiActivities.length }}</span>
          </div>
          <button
            v-for="activity in aiActivities"
            :key="activity.id"
            type="button"
            class="ai-task-row"
            :class="`ai-task-${activity.status}`"
            :title="activity.status === 'completed' ? '点击返回任务位置并标记已读' : '点击返回任务位置'"
            @click="openAiActivity(activity)"
          >
            <span class="ai-task-indicator" :class="{ 'ai-task-indicator-done': activity.status === 'completed' }"></span>
            <span class="ai-task-name">{{ activity.name }}</span>
            <span class="ai-task-state">
              {{ activity.status === 'running' ? '进行中' : activity.status === 'completed' ? '已完成' : '失败' }}
            </span>
          </button>
        </div>
      </nav>

      <!-- 统计信息 -->
      <div class="sidebar-stats">
        <div class="stat-row">
          <span>总字数</span>
          <span class="stat-num">{{ formatWordCount(novel.currentWordCount, '') }}</span>
        </div>
        <div class="stat-row">
          <span>章节</span>
          <span class="stat-num">{{ novel.chapters.length }} 章</span>
        </div>
        <div class="stat-row">
          <span>目标</span>
          <span class="stat-num">{{ novel.targetWordCountMin }}~{{ novel.targetWordCountMax }} 万</span>
        </div>
        <div class="progress-bar-mini">
          <div class="progress-fill-mini" :style="{ width: getProgress + '%' }"></div>
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
    <AiChatAssistant :novelId="novelId" />

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
  <div v-else-if="isWorkspaceRoute" class="page-container fade-in" style="display:flex;align-items:center;justify-content:center;min-height:60vh;">
    <div style="text-align:center;">
      <div style="font-size:64px;">📖</div>
      <h2 style="margin:16px 0 8px;">找不到这本小说</h2>
      <n-button type="primary" @click="$router.push('/')">返回书架</n-button>
    </div>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'Workspace' })

import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { NIcon, NButton, NDropdown, NModal, NInput, useMessage } from 'naive-ui'
import { ArrowBackOutline } from '@vicons/ionicons5'
import { useNovelStore } from '@/stores/novel'
import { exportToTXT, exportToWordHtml, exportToEpub } from '@/services/export'
import AiChatAssistant from '@/components/AiChatAssistant.vue'
import { formatWordCount } from '@/utils/format'
import { openAiActivity, useAiActivities } from '@/services/aiActivity'

const route = useRoute()
const novelStore = useNovelStore()
const msg = useMessage()
const showRenameModal = ref(false)
const renameTitle = ref('')
const { activities: aiActivities, runningActivities: runningAiActivities } = useAiActivities()

const novelId = computed(() => route.params.novelId as string)
const novel = computed(() => novelStore.getNovel(novelId.value))
const isWorkspaceRoute = computed(() => route.matched.some(record => record.path.startsWith('/workspace')))

const exportOptions = [
  { label: '📄 导出为 TXT', key: 'txt' },
  { label: '📄 只导出正文 TXT（不含大纲）', key: 'txt-body' },
  { label: '📘 导出为 Word 兼容 HTML (.doc)', key: 'word' },
  { label: '📘 只导出正文 Word（不含大纲）', key: 'word-body' },
  { label: '📖 导出为 EPUB', key: 'epub' },
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

function confirmRename() {
  if (!novel.value) return
  const title = renameTitle.value.trim().replace(/[《》]/g, '')
  if (!title) return
  novelStore.updateTitle(novel.value.id, title)
  showRenameModal.value = false
  msg.success('书名已修改')
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
  height: calc(100vh - 52px);
  overflow: hidden;
}

/* 侧边栏 */
.workspace-sidebar {
  width: 220px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-color-sidebar);
  border-right: 1px solid var(--border-color-light);
  transition: background-color var(--transition-normal);
}

.sidebar-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px;
  border-bottom: 1px solid var(--border-color-light);
}

.back-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-color-secondary);
  cursor: pointer;
  flex-shrink: 0;
  transition: all var(--transition-fast);
}

.back-btn:hover {
  background: var(--bg-color-hover);
  color: var(--text-color-primary);
}

.novel-info {
  overflow: hidden;
}

.novel-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-color-primary);
  white-space: nowrap;
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
  font-size: 11px;
  color: var(--text-color-tertiary);
}

/* 导航链接 */
.sidebar-nav {
  flex: 1;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-link {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  font-size: 14px;
  color: var(--text-color-secondary);
  text-decoration: none;
  transition: all var(--transition-fast);
}

.nav-link:hover {
  background: var(--bg-color-hover);
  color: var(--text-color-primary);
}

.nav-link--active {
  background: var(--color-primary-light) !important;
  color: var(--color-primary) !important;
  font-weight: 600;
}

.nav-link-icon {
  font-size: 16px;
}

.nav-badge {
  margin-left: auto;
  padding: 1px 7px;
  border-radius: 100px;
  background: var(--bg-color-secondary);
  font-size: 11px;
  font-weight: 600;
  color: var(--text-color-tertiary);
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
}

.ai-task-count {
  min-width: 16px;
  padding: 1px 5px;
  border-radius: 8px;
  background: var(--color-primary-light);
  color: var(--color-primary);
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

.ai-task-indicator {
  width: 7px;
  height: 7px;
  border: 1px solid var(--color-primary);
  border-radius: 50%;
  background: transparent;
}

.ai-task-indicator-done {
  border-color: #35a854;
  background: #35a854;
}

.ai-task-failed .ai-task-indicator {
  border-color: var(--color-error);
  background: var(--color-error);
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
  padding: 16px;
  border-top: 1px solid var(--border-color-light);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-color-tertiary);
}

.stat-num {
  font-weight: 600;
  color: var(--text-color-secondary);
}

.progress-bar-mini {
  height: 3px;
  background: var(--progress-track);
  border-radius: 100px;
  margin-top: 4px;
  overflow: hidden;
}

.progress-fill-mini {
  height: 100%;
  background: linear-gradient(90deg, var(--color-primary), var(--color-primary-suppl));
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
  background: var(--bg-color);
}

@media (max-width: 768px) {
  .workspace-layout {
    padding-left: 56px;
  }

  .workspace-layout .workspace-sidebar {
    position: fixed;
    top: 52px;
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
  .sidebar-stats,
  .nav-badge,
  .nav-link > span:not(.nav-link-icon) {
    display: none;
  }

  .sidebar-nav {
    padding: 8px 6px;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .nav-link {
    justify-content: center;
    gap: 0;
    min-height: 40px;
    padding: 10px;
  }

  .nav-link-icon {
    flex-shrink: 0;
    font-size: 18px;
    line-height: 1;
  }

  .nav-divider {
    margin: 8px 4px;
  }

  .workspace-main {
    width: 100%;
  }
}
</style>
