<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useBookStore, useChapterStore, useEditorStore, useUiStore } from '@/stores'
import { ElMessage } from 'element-plus'

const route = useRoute()
const router = useRouter()
const bookStore = useBookStore()
const chapterStore = useChapterStore()
const editorStore = useEditorStore()
const uiStore = useUiStore()

const bookId = ref(route.params.bookId as string)
const showCreateChapterDialog = ref(false)
const newChapterTitle = ref('')

onMounted(async () => {
  uiStore.loadSettings()
  await loadBookData()
})

watch(() => route.params.bookId, async (newId) => {
  if (newId) {
    bookId.value = newId as string
    await loadBookData()
  }
})

async function loadBookData(): Promise<void> {
  await bookStore.fetchBookById(bookId.value)
  await chapterStore.fetchChaptersByBook(bookId.value)
}

function goHome(): void {
  router.push('/')
}

function handleChapterSelect(id: string): void {
  chapterStore.fetchChapterById(id)
}

function handleCreateChapter(): void {
  showCreateChapterDialog.value = true
  newChapterTitle.value = ''
}

async function submitCreateChapter(): Promise<void> {
  if (!newChapterTitle.value.trim()) {
    ElMessage.warning('请输入章节标题')
    return
  }

  const chapter = await chapterStore.createChapter({
    bookId: bookId.value,
    title: newChapterTitle.value.trim(),
    content: '',
    order: chapterStore.chapters.length + 1
  })

  if (chapter) {
    ElMessage.success('章节创建成功')
    showCreateChapterDialog.value = false
    newChapterTitle.value = ''
    // 自动选中新创建的章节
    chapterStore.setCurrentChapter(chapter)
  } else {
    ElMessage.error('创建章节失败')
  }
}
</script>

<template>
  <div class="editor-view">
    <!-- 顶部工具栏 -->
    <header class="editor-header">
      <div class="header-left">
        <el-button text @click="goHome">
          <el-icon><ArrowLeft /></el-icon>
          返回
        </el-button>
        <span class="book-title">{{ bookStore.currentBook?.title || '加载中...' }}</span>
      </div>
      <div class="header-center">
        <!-- 编辑器工具栏 -->
      </div>
      <div class="header-right">
        <span v-if="uiStore.showWordCount" class="word-count">
          {{ editorStore.wordCount }} 字
        </span>
        <el-button text @click="uiStore.toggleRightPanel">
          <el-icon><Setting /></el-icon>
        </el-button>
      </div>
    </header>

    <div class="editor-body">
      <!-- 左侧边栏 - 章节树 -->
      <aside class="editor-sidebar" :class="{ collapsed: uiStore.sidebarCollapsed }">
        <div class="sidebar-header">
          <span>章节目录</span>
          <el-button text size="small" @click="uiStore.toggleSidebar">
            <el-icon><Fold /></el-icon>
          </el-button>
        </div>
        <div class="sidebar-content">
          <div class="sidebar-actions">
            <el-button type="primary" size="small" @click="handleCreateChapter">
              <el-icon><Plus /></el-icon>
              新建章节
            </el-button>
          </div>
          <div v-if="chapterStore.loading" class="loading-state">
            <el-icon class="is-loading"><Loading /></el-icon>
          </div>
          <div v-else-if="chapterStore.chapters.length === 0" class="empty-state">
            <p>暂无章节</p>
            <el-button type="primary" size="small" @click="handleCreateChapter">新建章节</el-button>
          </div>
          <div v-else class="chapter-tree">
            <div
              v-for="chapter in chapterStore.chapterTree"
              :key="chapter.id"
              class="chapter-item"
              :class="{ active: chapterStore.currentChapter?.id === chapter.id }"
              @click="handleChapterSelect(chapter.id)"
            >
              <span class="chapter-title">{{ chapter.title }}</span>
              <span class="chapter-word-count">{{ chapter.wordCount }}字</span>
            </div>
          </div>
        </div>
      </aside>

      <!-- 主编辑区 -->
      <main class="editor-main">
        <div v-if="!chapterStore.currentChapter" class="no-chapter-selected">
          <el-empty description="请从左侧选择一个章节开始编辑" />
        </div>
        <div v-else class="editor-container" :style="{ maxWidth: uiStore.editorWidth + 'px' }">
          <h2 class="chapter-title-display">{{ chapterStore.currentChapter.title }}</h2>
          <textarea
            v-model="editorStore.content"
            class="main-textarea"
            :style="{
              fontSize: uiStore.fontSize + 'px',
              lineHeight: uiStore.lineHeight
            }"
            placeholder="开始写作..."
          ></textarea>
        </div>
      </main>

      <!-- 右侧面板 -->
      <aside class="editor-right-panel" v-show="uiStore.rightPanelVisible">
        <div class="panel-header">
          <el-tabs v-model="uiStore.rightPanelTab">
            <el-tab-pane label="AI助手" name="ai" />
            <el-tab-pane label="大纲" name="outline" />
            <el-tab-pane label="角色" name="character" />
          </el-tabs>
        </div>
        <div class="panel-content">
          <div v-if="uiStore.rightPanelTab === 'ai'" class="ai-panel">
            <p class="placeholder-text">AI助手功能开发中...</p>
          </div>
          <div v-else-if="uiStore.rightPanelTab === 'outline'" class="outline-panel">
            <p class="placeholder-text">大纲功能开发中...</p>
          </div>
          <div v-else-if="uiStore.rightPanelTab === 'character'" class="character-panel">
            <p class="placeholder-text">角色功能开发中...</p>
          </div>
        </div>
      </aside>
    </div>

    <!-- 状态栏 -->
    <footer class="editor-status-bar">
      <div class="status-left">
        <span v-if="editorStore.hasUnsavedChanges" class="unsaved-indicator">
          <el-icon><WarningFilled /></el-icon>
          未保存
        </span>
        <span v-else-if="editorStore.lastSavedAt" class="saved-indicator">
          <el-icon><CircleCheckFilled /></el-icon>
          已保存
        </span>
      </div>
      <div class="status-right">
        <span>字数：{{ editorStore.wordCount }}</span>
        <span v-if="editorStore.selectionLength > 0">
          选中：{{ editorStore.selectionLength }}
        </span>
      </div>
    </footer>

    <!-- 新建章节对话框 -->
    <el-dialog
      v-model="showCreateChapterDialog"
      title="新建章节"
      width="400px"
    >
      <el-form>
        <el-form-item label="章节标题" required>
          <el-input
            v-model="newChapterTitle"
            placeholder="请输入章节标题"
            @keyup.enter="submitCreateChapter"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateChapterDialog = false">取消</el-button>
        <el-button type="primary" @click="submitCreateChapter" :loading="chapterStore.loading">
          创建
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped lang="scss">
.editor-view {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background-color: $bg-page;
}

.editor-header {
  height: $header-height;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: $bg-base;
  border-bottom: 1px solid $border-light;
  z-index: $z-header;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;

  .book-title {
    font-weight: 600;
    color: $text-primary;
  }
}

.header-right {
  display: flex;
  align-items: center;
  gap: 16px;

  .word-count {
    font-size: 12px;
    color: $text-secondary;
  }
}

.editor-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.editor-sidebar {
  width: $sidebar-width;
  background-color: $bg-base;
  border-right: 1px solid $border-light;
  display: flex;
  flex-direction: column;
  transition: width $transition-duration $transition-ease;

  &.collapsed {
    width: $sidebar-collapsed-width;

    .sidebar-content {
      display: none;
    }
  }
}

.sidebar-header {
  height: 40px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid $border-lighter;
  font-weight: 500;
}

.sidebar-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.sidebar-actions {
  padding: 8px;
  margin-bottom: 8px;
  border-bottom: 1px solid $border-lighter;
}

.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  color: $text-secondary;
  gap: 12px;
}

.chapter-tree {
  display: flex;
  flex-direction: column;
}

.chapter-item {
  padding: 8px 12px;
  border-radius: $border-radius-base;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  transition: background-color $transition-duration $transition-ease;

  &:hover {
    background-color: $bg-page;
  }

  &.active {
    background-color: rgba($primary-color, 0.1);
    color: $primary-color;
  }

  .chapter-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chapter-word-count {
    font-size: 12px;
    color: $text-secondary;
    margin-left: 8px;
  }
}

.editor-main {
  flex: 1;
  display: flex;
  justify-content: center;
  overflow-y: auto;
  padding: 24px;
}

.no-chapter-selected {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
}

.editor-container {
  width: 100%;
  max-width: 800px;
}

.chapter-title-display {
  font-size: 24px;
  font-weight: 600;
  margin-bottom: 24px;
  color: $text-primary;
}

.main-textarea {
  width: 100%;
  min-height: 500px;
  padding: 16px;
  border: 1px solid $border-light;
  border-radius: $border-radius-base;
  resize: vertical;
  font-family: $font-family;
  background-color: $bg-base;

  &:focus {
    outline: none;
    border-color: $primary-color;
  }

  &::placeholder {
    color: $text-placeholder;
  }
}

.editor-right-panel {
  width: $right-panel-width;
  background-color: $bg-base;
  border-left: 1px solid $border-light;
  display: flex;
  flex-direction: column;
}

.panel-header {
  border-bottom: 1px solid $border-lighter;
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.placeholder-text {
  color: $text-secondary;
  text-align: center;
  padding: 24px;
}

.editor-status-bar {
  height: $status-bar-height;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: $bg-base;
  border-top: 1px solid $border-light;
  font-size: 12px;
  color: $text-secondary;
}

.status-left,
.status-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.unsaved-indicator {
  color: $warning-color;
  display: flex;
  align-items: center;
  gap: 4px;
}

.saved-indicator {
  color: $success-color;
  display: flex;
  align-items: center;
  gap: 4px;
}
</style>
