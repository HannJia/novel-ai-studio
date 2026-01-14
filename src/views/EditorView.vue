<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useBookStore, useChapterStore, useEditorStore, useUiStore, useAiStore } from '@/stores'
import { ElMessage, ElMessageBox } from 'element-plus'

// 导入新组件
import EditorHeader from '@/components/editor/EditorHeader.vue'
import EditorSidebar from '@/components/editor/EditorSidebar.vue'
import EditorMain from '@/components/editor/EditorMain.vue'
import EditorRightPanel from '@/components/editor/EditorRightPanel.vue'

const route = useRoute()
const router = useRouter()
const bookStore = useBookStore()
const chapterStore = useChapterStore()
const editorStore = useEditorStore()
const uiStore = useUiStore()
const aiStore = useAiStore()

const bookId = ref(route.params.bookId as string)
const showCreateChapterDialog = ref(false)
const newChapterTitle = ref('')
const autoSaveTimer = ref<number | null>(null)

// AI 相关状态
const continueWordCount = ref(500)
const chapterOutline = ref('')
const bookOutline = ref('')
const outlineTab = ref<'book' | 'chapter'>('chapter')

// 编辑器状态
const focusMode = ref(false)
const isFullscreen = ref(false)

const chineseNumbers = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '二十一', '二十二', '二十三', '二十四', '二十五', '二十六', '二十七', '二十八', '二十九', '三十',
  '三十一', '三十二', '三十三', '三十四', '三十五', '三十六', '三十七', '三十八', '三十九', '四十',
  '四十一', '四十二', '四十三', '四十四', '四十五', '四十六', '四十七', '四十八', '四十九', '五十']

function toChineseNumber(num: number): string {
  if (num <= 50) return chineseNumbers[num]
  return num.toString()
}

const defaultChapterTitle = computed(() => {
  const nextOrder = chapterStore.chapters.length + 1
  return '第' + toChineseNumber(nextOrder) + '章'
})

onMounted(async () => {
  uiStore.loadSettings()
  await loadBookData()
  await aiStore.fetchConfigs()
  startAutoSave()
  document.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  stopAutoSave()
  document.removeEventListener('keydown', handleKeyDown)
  if (editorStore.hasUnsavedChanges) {
    saveContent()
  }
})

watch(() => route.params.bookId, async (newId) => {
  if (newId) {
    bookId.value = newId as string
    await loadBookData()
  }
})

watch(() => chapterStore.currentChapter, (newChapter) => {
  if (newChapter) {
    editorStore.loadChapterContent(newChapter.content || '', newChapter.id)
    chapterOutline.value = newChapter.outline || ''
  } else {
    editorStore.reset()
    chapterOutline.value = ''
  }
})

async function loadBookData(): Promise<void> {
  await bookStore.fetchBookById(bookId.value)
  await chapterStore.fetchChaptersByBook(bookId.value)
  if (bookStore.currentBook) {
    bookOutline.value = bookStore.currentBook.outline || ''
  }
}

async function handleChapterSelect(id: string): Promise<void> {
  if (editorStore.hasUnsavedChanges && editorStore.currentChapterId) {
    await saveContent()
  }
  chapterStore.fetchChapterById(id)
}

function handleCreateChapter(): void {
  showCreateChapterDialog.value = true
  newChapterTitle.value = defaultChapterTitle.value
}

async function handleDeleteChapter(chapterId: string, chapterTitle: string, event: Event): Promise<void> {
  event.stopPropagation()
  try {
    await ElMessageBox.confirm(
      '确定要删除章节《' + chapterTitle + '》吗？此操作不可恢复。',
      '删除确认',
      { confirmButtonText: '确定删除', cancelButtonText: '取消', type: 'warning' }
    )
    const success = await chapterStore.deleteChapter(chapterId)
    if (success) {
      ElMessage.success('章节已删除')
      if (editorStore.currentChapterId === chapterId) {
        editorStore.reset()
      }
    } else {
      ElMessage.error('删除失败')
    }
  } catch { }
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
    chapterStore.setCurrentChapter(chapter)
  } else {
    ElMessage.error('创建章节失败')
  }
}

async function saveContent(): Promise<void> {
  if (!editorStore.currentChapterId || !editorStore.hasUnsavedChanges) {
    return
  }

  editorStore.isSaving = true
  try {
    // 计算字数并一起保存
    const result = await chapterStore.updateChapter(editorStore.currentChapterId, {
      content: editorStore.content,
      wordCount: editorStore.wordCount  // 保存时同步更新字数
    })
    if (result) {
      editorStore.markAsSaved()
      // 刷新书籍信息以更新总字数
      if (bookId.value) {
        await bookStore.fetchBookById(bookId.value)
      }
    }
  } catch (e) {
    console.error('保存失败:', e)
  } finally {
    editorStore.isSaving = false
  }
}

async function handleManualSave(): Promise<void> {
  if (!editorStore.hasUnsavedChanges) {
    ElMessage.info('没有需要保存的更改')
    return
  }
  await saveContent()
  if (!editorStore.hasUnsavedChanges) {
    ElMessage.success('保存成功')
  } else {
    ElMessage.error('保存失败')
  }
}

function startAutoSave(): void {
  if (autoSaveTimer.value) {
    clearInterval(autoSaveTimer.value)
  }
  autoSaveTimer.value = window.setInterval(() => {
    if (editorStore.autoSaveEnabled && editorStore.hasUnsavedChanges) {
      saveContent()
    }
  }, editorStore.autoSaveInterval)
}

function stopAutoSave(): void {
  if (autoSaveTimer.value) {
    clearInterval(autoSaveTimer.value)
    autoSaveTimer.value = null
  }
}

function handleKeyDown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key === 's') {
    event.preventDefault()
    handleManualSave()
  }
  if (event.key === 'Escape' && focusMode.value) {
    focusMode.value = false
    uiStore.sidebarCollapsed = false
    uiStore.rightPanelVisible = true
  }
}

function toggleFocusMode(): void {
  focusMode.value = !focusMode.value
  if (focusMode.value) {
    uiStore.sidebarCollapsed = true
    uiStore.rightPanelVisible = false
  } else {
    uiStore.sidebarCollapsed = false
    uiStore.rightPanelVisible = true
  }
}

function toggleFullscreen(): void {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen()
    isFullscreen.value = true
  } else {
    document.exitFullscreen()
    isFullscreen.value = false
  }
}

async function handleContinueWriting(): Promise<void> {
  if (!editorStore.content.trim()) {
    ElMessage.warning('请先输入一些内容再进行续写')
    return
  }

  if (!aiStore.hasConfig) {
    ElMessage.warning('请先在设置中配置AI')
    router.push('/config')
    return
  }

  const result = await aiStore.continueWriting({
    content: editorStore.content,
    outline: chapterOutline.value,
    wordCount: continueWordCount.value
  })

  if (result && result.content) {
    editorStore.content = editorStore.content + '\n\n' + result.content
    ElMessage.success(`续写完成，生成约${result.tokenUsage?.completionTokens || 0}个token`)
  } else {
    ElMessage.error(aiStore.error || '续写失败')
  }
}

async function saveOutline(): Promise<void> {
  if (outlineTab.value === 'chapter') {
    if (!editorStore.currentChapterId) {
      ElMessage.warning('请先选择一个章节')
      return
    }
    const result = await chapterStore.updateChapter(editorStore.currentChapterId, {
      outline: chapterOutline.value
    })
    if (result) {
      ElMessage.success('章节大纲已保存')
    } else {
      ElMessage.error('保存大纲失败')
    }
  } else {
    if (!bookStore.currentBook) return
    const result = await bookStore.updateBook(bookStore.currentBook.id, {
      outline: bookOutline.value
    })
    if (result) {
      ElMessage.success('全书大纲已保存')
    } else {
      ElMessage.error('保存大纲失败')
    }
  }
}

async function generateOutline(): Promise<void> {
  if (!bookStore.currentBook) return

  if (!aiStore.hasConfig) {
    ElMessage.warning('请先在设置中配置AI')
    router.push('/config')
    return
  }

  const result = await aiStore.generateOutline({
    bookTitle: bookStore.currentBook.title,
    genre: bookStore.currentBook.genre,
    style: bookStore.currentBook.style,
    description: bookStore.currentBook.description,
    type: outlineTab.value === 'book' ? 'book' : 'chapter'
  })

  if (result && result.content) {
    if (outlineTab.value === 'chapter') {
      chapterOutline.value = result.content
    } else {
      bookOutline.value = result.content
    }
    ElMessage.success('大纲生成完成')
  } else {
    ElMessage.error(aiStore.error || '生成大纲失败')
  }
}
</script>

<template>
  <div class="editor-view" :class="{ 'focus-mode': focusMode }">
    <!-- 顶部工具栏 -->
    <EditorHeader
      :focus-mode="focusMode"
      :is-fullscreen="isFullscreen"
      @save="handleManualSave"
      @continue-writing="handleContinueWriting"
      @toggle-focus="toggleFocusMode"
      @toggle-fullscreen="toggleFullscreen"
    />

    <!-- 主体区域 -->
    <div class="editor-body">
      <!-- 左侧边栏 -->
      <EditorSidebar
        @select-chapter="handleChapterSelect"
        @create-chapter="handleCreateChapter"
        @delete-chapter="handleDeleteChapter"
      />

      <!-- 主编辑区 -->
      <EditorMain :show-thinking="aiStore.generating" />

      <!-- 右侧面板 -->
      <EditorRightPanel
        v-model:continue-word-count="continueWordCount"
        :chapter-outline="chapterOutline"
        :book-outline="bookOutline"
        :outline-tab="outlineTab"
        @continue-writing="handleContinueWriting"
        @save-outline="saveOutline"
        @generate-outline="generateOutline"
      />
    </div>

    <!-- 状态栏 -->
    <footer class="editor-status-bar">
      <div class="status-left">
        <span v-if="editorStore.isSaving" class="status-item saving">
          <el-icon class="is-loading"><Loading /></el-icon>
          保存中...
        </span>
        <span v-else-if="editorStore.hasUnsavedChanges" class="status-item unsaved">
          <el-icon><WarningFilled /></el-icon>
          未保存
        </span>
        <span v-else-if="editorStore.lastSavedAt" class="status-item saved">
          <el-icon><CircleCheckFilled /></el-icon>
          已保存
        </span>
        <span v-if="aiStore.generating" class="status-item ai">
          <el-icon class="is-loading"><Loading /></el-icon>
          AI生成中
        </span>
      </div>
      <div class="status-center">
        <span class="status-item">
          今日: {{ bookStore.currentBook?.wordCount || 0 }} 字
        </span>
      </div>
      <div class="status-right">
        <span class="status-item">字数: {{ editorStore.wordCount }}</span>
        <span class="status-item shortcut">Ctrl+S 保存</span>
        <span class="status-item shortcut">Ctrl+G 生成</span>
      </div>
    </footer>

    <!-- 新建章节对话框 -->
    <el-dialog
      v-model="showCreateChapterDialog"
      title="新建章节"
      width="400px"
      class="create-chapter-dialog"
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
  background-color: var(--page-bg, $bg-page);
  transition: all $transition-duration $transition-ease;

  // 专注模式
  &.focus-mode {
    :deep(.editor-header) {
      opacity: 0.3;
      &:hover { opacity: 1; }
    }

    :deep(.editor-sidebar) {
      width: 0;
      opacity: 0;
      overflow: hidden;
    }

    :deep(.editor-right-panel) {
      width: 0;
      opacity: 0;
      overflow: hidden;
    }

    .editor-status-bar {
      opacity: 0.3;
      &:hover { opacity: 1; }
    }
  }
}

.editor-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.editor-status-bar {
  height: $status-bar-height;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: var(--status-bg, $bg-base);
  border-top: 1px solid var(--border-color, $border-light);
  font-size: 12px;
  transition: all $transition-duration $transition-ease;
}

.status-left,
.status-center,
.status-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.status-item {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--text-secondary, $text-secondary);

  &.saving {
    color: $primary-color;
  }

  &.unsaved {
    color: $warning-color;
  }

  &.saved {
    color: $success-color;
  }

  &.ai {
    color: $primary-color;
  }

  &.shortcut {
    padding: 2px 8px;
    background-color: var(--shortcut-bg, $light-bg-panel);
    border-radius: $border-radius-small;
    font-size: 11px;
  }
}

// 深色主题适配
:global(html.dark) .editor-view {
  --page-bg: #{$dark-bg-page};
  --status-bg: #{$dark-bg-base};
  --border-color: #{$dark-border-light};
  --text-secondary: #{$dark-text-secondary};
  --shortcut-bg: #{$dark-bg-panel};
}

// 对话框样式
.create-chapter-dialog {
  :deep(.el-dialog) {
    border-radius: $border-radius-card;
  }
}
</style>
