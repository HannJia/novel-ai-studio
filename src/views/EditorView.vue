<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, watch, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useBookStore, useChapterStore, useEditorStore, useUiStore, useAiStore } from '@/stores'
import { ElMessage, ElMessageBox } from 'element-plus'

// 导入新组件
import EditorHeader from '@/components/editor/EditorHeader.vue'
import EditorSidebar from '@/components/editor/EditorSidebar.vue'
import EditorMain from '@/components/editor/EditorMain.vue'
import EditorRightPanel from '@/components/editor/EditorRightPanel.vue'
import EditorToolbar from '@/components/editor/EditorToolbar.vue'
import GenerateSettings from '@/components/editor/GenerateSettings.vue'

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

// 生成配置 - 字数区间（共享给 EditorSidebar 和 EditorRightPanel）
const generateConfig = reactive({
  chapterWordMin: 2000,
  chapterWordMax: 3000,
  continueWordMin: 300,
  continueWordMax: 800,
  temperature: 0.7
})

// AI 相关状态
const chapterOutline = ref('')
const bookOutline = ref('')
const outlineTab = ref<'book' | 'chapter'>('chapter')

// 编辑器状态
const focusMode = ref(false)
const isFullscreen = ref(false)
const showGenerateSettings = ref(false)

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
      content: editorStore.content
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

async function handleContinueWriting(wordRange?: [number, number]): Promise<void> {
  if (!editorStore.content.trim()) {
    ElMessage.warning('请先输入一些内容再进行续写')
    return
  }

  if (!aiStore.hasConfig) {
    ElMessage.warning('请先在设置中配置AI')
    router.push('/config')
    return
  }

  // 使用传入的区间范围
  const [minWords, maxWords] = wordRange || [300, 800]
  const targetWordCount = Math.floor(Math.random() * (maxWords - minWords + 1)) + minWords

  const result = await aiStore.continueWriting({
    content: editorStore.content,
    outline: chapterOutline.value,
    wordCount: targetWordCount,
    minWordCount: minWords,
    maxWordCount: maxWords
  })

  if (result && result.content) {
    editorStore.content = editorStore.content + '\n\n' + result.content

    // 自动保存（直接调用 saveContent，不检查 hasUnsavedChanges）
    if (editorStore.currentChapterId) {
      editorStore.isSaving = true
      try {
        const saveResult = await chapterStore.updateChapter(editorStore.currentChapterId, {
          content: editorStore.content
        })
        if (saveResult) {
          editorStore.markAsSaved()
          // 刷新章节列表以更新字数显示
          await chapterStore.fetchChaptersByBook(bookId.value!)
          ElMessage.success(`续写完成并已保存，当前共 ${editorStore.wordCount} 字`)
        }
      } catch (e) {
        console.error('保存失败:', e)
        ElMessage.warning('续写完成，但保存失败')
      } finally {
        editorStore.isSaving = false
      }
    } else {
      ElMessage.success(`续写完成，生成约${result.tokenUsage?.completionTokens || 0}个token`)
    }
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
        :chapter-word-min="generateConfig.chapterWordMin"
        :chapter-word-max="generateConfig.chapterWordMax"
        @select-chapter="handleChapterSelect"
        @create-chapter="handleCreateChapter"
        @delete-chapter="handleDeleteChapter"
      />

      <!-- 主编辑区 -->
      <EditorMain :show-thinking="aiStore.generating" />

      <!-- 右侧面板 -->
      <EditorRightPanel
        v-model:chapter-word-min="generateConfig.chapterWordMin"
        v-model:chapter-word-max="generateConfig.chapterWordMax"
        v-model:continue-word-min="generateConfig.continueWordMin"
        v-model:continue-word-max="generateConfig.continueWordMax"
        v-model:temperature="generateConfig.temperature"
        :chapter-outline="chapterOutline"
        :book-outline="bookOutline"
        :outline-tab="outlineTab"
        @continue-writing="handleContinueWriting"
        @save-outline="saveOutline"
        @generate-outline="generateOutline"
      />
    </div>

    <!-- 底部工具栏 -->
    <EditorToolbar
      @undo="editorStore.undo"
      @regenerate="handleContinueWriting"
      @open-font-settings="uiStore.toggleRightPanel"
      @open-generate-settings="showGenerateSettings = true"
      @generate-next-chapter="handleCreateChapter"
      @generate-outline="generateOutline"
      @generate-from-outline="handleContinueWriting"
      @free-write="handleContinueWriting"
    />

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

    <!-- 生成设置弹窗 -->
    <GenerateSettings v-model:visible="showGenerateSettings" />
  </div>
</template>

<style scoped lang="scss">
// ==========================================
// 编辑器视图样式 - Gemini 3 Pro 设计方案
// ==========================================

.editor-view {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background-color: var(--bg-base, $dark-bg-base);
  transition: all $transition-duration $transition-timing;

  // ==========================================
  // 专注模式
  // ==========================================
  &.focus-mode {
    :deep(.editor-header) {
      opacity: 0;
      transform: translateY(-100%);
      pointer-events: none;

      &:hover {
        opacity: 1;
        transform: translateY(0);
        pointer-events: auto;
      }
    }

    :deep(.editor-sidebar) {
      width: 0;
      min-width: 0;
      opacity: 0;
      overflow: hidden;
      border: none;
    }

    :deep(.editor-right-panel) {
      width: 0;
      min-width: 0;
      opacity: 0;
      overflow: hidden;
      border: none;
    }

    .editor-status-bar {
      opacity: 0;
      transform: translateY(100%);

      &:hover {
        opacity: 1;
        transform: translateY(0);
      }
    }

    // 编辑器全屏居中
    :deep(.editor-main) {
      max-width: 900px;
      margin: 0 auto;
    }
  }
}

// ==========================================
// 主体区域 - 三栏布局
// ==========================================
.editor-body {
  flex: 1;
  display: flex;
  overflow: hidden;
  background-color: var(--bg-base, $dark-bg-base);
}

// ==========================================
// 状态栏
// ==========================================
.editor-status-bar {
  height: $status-bar-height;
  padding: 0 $spacing-base;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: var(--bg-surface, $dark-bg-surface);
  border-top: 1px solid var(--border-base, $dark-border-base);
  font-size: $font-size-extra-small;
  transition: all $transition-duration $transition-timing;
  flex-shrink: 0;
}

.status-left,
.status-center,
.status-right {
  display: flex;
  align-items: center;
  gap: $spacing-base;
}

.status-item {
  display: flex;
  align-items: center;
  gap: $spacing-xs;
  color: var(--text-secondary, $dark-text-secondary);
  transition: color $transition-duration-fast $transition-timing;

  .el-icon {
    font-size: 14px;
  }

  &.saving {
    color: $primary-color;

    .el-icon {
      animation: pulse 1s infinite;
    }
  }

  &.unsaved {
    color: $warning-color;
  }

  &.saved {
    color: $success-color;
  }

  &.ai {
    color: $primary-color;

    &::before {
      content: '';
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background-color: $primary-color;
      animation: pulse 1.5s infinite;
    }
  }

  &.shortcut {
    padding: 2px $spacing-sm;
    background-color: var(--bg-elevated, $dark-bg-elevated);
    border: 1px solid var(--border-base, $dark-border-base);
    border-radius: $border-radius-sm;
    font-size: 11px;
    font-family: $font-family-mono;
    color: var(--text-muted, $dark-text-muted);

    &:hover {
      background-color: var(--bg-hover, $dark-bg-hover);
      color: var(--text-secondary, $dark-text-secondary);
    }
  }
}

// ==========================================
// 动画
// ==========================================
@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

// ==========================================
// 对话框样式
// ==========================================
.create-chapter-dialog {
  :deep(.el-dialog) {
    border-radius: $border-radius-lg;
    background-color: var(--dialog-bg, $dark-bg-surface);
    border: 1px solid var(--border-base, $dark-border-base);
    box-shadow: var(--dialog-shadow, $dark-shadow-xl);
  }

  :deep(.el-dialog__header) {
    padding: $spacing-base $spacing-lg;
    border-bottom: 1px solid var(--border-base, $dark-border-base);
  }

  :deep(.el-dialog__body) {
    padding: $spacing-lg;
  }

  :deep(.el-dialog__footer) {
    padding: $spacing-base $spacing-lg;
    border-top: 1px solid var(--border-base, $dark-border-base);
  }
}

// ==========================================
// 响应式适配
// ==========================================
@media (max-width: 1200px) {
  .editor-view:not(.focus-mode) {
    :deep(.editor-right-panel) {
      width: 300px;
      min-width: 300px;
    }
  }
}

@media (max-width: 992px) {
  .editor-view:not(.focus-mode) {
    :deep(.editor-sidebar) {
      width: $sidebar-collapsed-width;
      min-width: $sidebar-collapsed-width;
    }

    :deep(.editor-right-panel) {
      position: absolute;
      right: 0;
      top: $header-height;
      bottom: $status-bar-height;
      z-index: $z-right-panel;
      box-shadow: var(--shadow-lg, $dark-shadow-lg);
    }
  }
}

// ==========================================
// 浅色主题
// ==========================================
:global(.theme-light) {
  .editor-view {
    background-color: #f8fafc;
  }

  .editor-body {
    background-color: #f8fafc;
  }

  .editor-status-bar {
    background-color: #ffffff;
    border-top-color: #e2e8f0;
  }

  .status-item {
    color: #64748b;

    &.shortcut {
      background-color: #f1f5f9;
      border-color: #e2e8f0;
      color: #94a3b8;

      &:hover {
        background-color: #e2e8f0;
        color: #64748b;
      }
    }
  }

  .create-chapter-dialog {
    :deep(.el-dialog) {
      background-color: #ffffff;
      border-color: #e2e8f0;
    }

    :deep(.el-dialog__header) {
      border-bottom-color: #e2e8f0;
    }

    :deep(.el-dialog__footer) {
      border-top-color: #e2e8f0;
    }
  }
}
</style>
