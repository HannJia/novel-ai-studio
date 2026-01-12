<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useBookStore, useChapterStore, useEditorStore, useUiStore, useAiStore } from '@/stores'
import { ElMessage, ElMessageBox } from 'element-plus'

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
})

onUnmounted(() => {
  stopAutoSave()
  // 离开时如果有未保存更改，提示保存
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

// 监听当前章节变化，加载内容到编辑器
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
  // 加载全书大纲
  if (bookStore.currentBook) {
    bookOutline.value = bookStore.currentBook.outline || ''
  }
}

function goHome(): void {
  // 离开前保存
  if (editorStore.hasUnsavedChanges) {
    saveContent()
  }
  router.push('/')
}

async function handleChapterSelect(id: string): Promise<void> {
  // 切换章节前保存当前内容
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
      // 如果删除的是当前编辑的章节，清空编辑器
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

// 保存内容到后端
async function saveContent(): Promise<void> {
  if (!editorStore.currentChapterId || !editorStore.hasUnsavedChanges) {
    return
  }

  editorStore.isSaving = true
  try {
    const result = await chapterStore.updateChapter(editorStore.currentChapterId, {
      content: editorStore.content
    })
    if (result) {
      editorStore.markAsSaved()
    }
  } catch (e) {
    console.error('保存失败:', e)
  } finally {
    editorStore.isSaving = false
  }
}

// 手动保存（Ctrl+S）
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

// 自动保存
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

// 键盘快捷键
function handleKeyDown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key === 's') {
    event.preventDefault()
    handleManualSave()
  }
  // ESC 退出专注模式
  if (event.key === 'Escape' && focusMode.value) {
    focusMode.value = false
  }
}

// 专注模式
function toggleFocusMode(): void {
  focusMode.value = !focusMode.value
  if (focusMode.value) {
    uiStore.sidebarCollapsed = true
    uiStore.rightPanelVisible = false
  }
}

// 全屏模式
function toggleFullscreen(): void {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen()
    isFullscreen.value = true
  } else {
    document.exitFullscreen()
    isFullscreen.value = false
  }
}

// AI 续写功能
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
    // 将生成的内容追加到编辑器
    editorStore.content = editorStore.content + '\n\n' + result.content
    ElMessage.success(`续写完成，生成约${result.tokenUsage?.completionTokens || 0}个token`)
  } else {
    ElMessage.error(aiStore.error || '续写失败')
  }
}

// 应用生成的内容
function applyGeneratedContent(): void {
  if (!aiStore.generatedContent) return
  editorStore.content = editorStore.content + '\n\n' + aiStore.generatedContent
  aiStore.generatedContent = ''
  ElMessage.success('内容已应用')
}

// 保存大纲
async function saveOutline(): Promise<void> {
  if (outlineTab.value === 'chapter') {
    // 保存章节大纲
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
    // 保存全书大纲
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

// 生成大纲
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
  <div class="editor-view" :class="{ 'focus-mode': focusMode }" @keydown="handleKeyDown">
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
        <el-button-group v-if="chapterStore.currentChapter" class="editor-toolbar">
          <el-tooltip content="保存 (Ctrl+S)" placement="bottom">
            <el-button size="small" @click="handleManualSave" :loading="editorStore.isSaving">
              <el-icon><DocumentChecked /></el-icon>
            </el-button>
          </el-tooltip>
          <el-tooltip content="AI续写" placement="bottom">
            <el-button
              size="small"
              type="primary"
              @click="handleContinueWriting"
              :loading="aiStore.generating"
              :disabled="!aiStore.hasConfig"
            >
              <el-icon><MagicStick /></el-icon>
            </el-button>
          </el-tooltip>
          <el-tooltip content="专注模式" placement="bottom">
            <el-button size="small" @click="toggleFocusMode" :type="focusMode ? 'success' : ''">
              <el-icon><View /></el-icon>
            </el-button>
          </el-tooltip>
          <el-tooltip content="全屏" placement="bottom">
            <el-button size="small" @click="toggleFullscreen">
              <el-icon><FullScreen /></el-icon>
            </el-button>
          </el-tooltip>
        </el-button-group>
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
              <div class="chapter-actions"><span class="chapter-word-count">{{ chapter.wordCount }}字</span><el-button class="delete-chapter-btn" type="danger" size="small" text @click="handleDeleteChapter(chapter.id, chapter.title, $event)"><el-icon><Delete /></el-icon></el-button></div>
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
          <!-- AI助手面板 -->
          <div v-if="uiStore.rightPanelTab === 'ai'" class="ai-panel">
            <div v-if="!aiStore.hasConfig" class="no-config-tip">
              <el-icon><WarningFilled /></el-icon>
              <p>尚未配置AI</p>
              <el-button type="primary" size="small" @click="router.push('/config')">
                前往配置
              </el-button>
            </div>

            <template v-else>
              <!-- 续写设置 -->
              <div class="ai-section">
                <h4>AI续写</h4>
                <el-form label-position="top" size="small">
                  <el-form-item label="续写字数">
                    <el-slider
                      v-model="continueWordCount"
                      :min="100"
                      :max="2000"
                      :step="100"
                      show-input
                      :show-input-controls="false"
                    />
                  </el-form-item>
                  <el-form-item>
                    <el-button
                      type="primary"
                      @click="handleContinueWriting"
                      :loading="aiStore.generating"
                      :disabled="!editorStore.content.trim()"
                      style="width: 100%"
                    >
                      <el-icon><MagicStick /></el-icon>
                      开始续写
                    </el-button>
                  </el-form-item>
                </el-form>
              </div>

              <!-- 生成结果预览 -->
              <div v-if="aiStore.generatedContent" class="ai-section generated-content">
                <h4>生成结果</h4>
                <div class="content-preview">
                  {{ aiStore.generatedContent }}
                </div>
                <div class="content-actions">
                  <el-button size="small" @click="aiStore.generatedContent = ''">
                    放弃
                  </el-button>
                  <el-button type="primary" size="small" @click="applyGeneratedContent">
                    应用到正文
                  </el-button>
                </div>
              </div>

              <!-- 生成状态 -->
              <div v-if="aiStore.generating" class="ai-section generating-status">
                <el-icon class="is-loading"><Loading /></el-icon>
                <span>正在生成中...</span>
              </div>

              <!-- AI配置信息 -->
              <div class="ai-section ai-config-info">
                <h4>当前配置</h4>
                <p v-if="aiStore.defaultConfig">
                  {{ aiStore.defaultConfig.name }} ({{ aiStore.defaultConfig.model }})
                </p>
                <el-button text size="small" @click="router.push('/config')">
                  管理配置
                </el-button>
              </div>
            </template>
          </div>

          <!-- 大纲面板 -->
          <div v-else-if="uiStore.rightPanelTab === 'outline'" class="outline-panel">
            <!-- 大纲类型切换 -->
            <div class="outline-tabs">
              <el-radio-group v-model="outlineTab" size="small">
                <el-radio-button value="book">全书大纲</el-radio-button>
                <el-radio-button value="chapter">章节大纲</el-radio-button>
              </el-radio-group>
            </div>

            <!-- 操作按钮 -->
            <div class="outline-actions">
              <el-button
                size="small"
                @click="generateOutline"
                :loading="aiStore.generating"
                :disabled="!aiStore.hasConfig"
              >
                <el-icon><MagicStick /></el-icon>
                AI生成
              </el-button>
              <el-button size="small" type="primary" @click="saveOutline">
                <el-icon><DocumentChecked /></el-icon>
                保存
              </el-button>
            </div>

            <!-- 全书大纲 -->
            <div v-if="outlineTab === 'book'" class="outline-content">
              <el-input
                v-model="bookOutline"
                type="textarea"
                :rows="16"
                placeholder="在此编写全书大纲，包括故事主线、主要角色、重要事件等..."
                resize="none"
              />
              <p class="outline-tip">
                全书大纲帮助把控整体故事走向，确保剧情连贯
              </p>
            </div>

            <!-- 章节大纲 -->
            <div v-else class="outline-content">
              <div v-if="!chapterStore.currentChapter" class="no-chapter-tip">
                <el-icon><InfoFilled /></el-icon>
                <span>请先选择一个章节</span>
              </div>
              <template v-else>
                <div class="current-chapter-info">
                  当前章节：{{ chapterStore.currentChapter.title }}
                </div>
                <el-input
                  v-model="chapterOutline"
                  type="textarea"
                  :rows="14"
                  placeholder="在此编写本章大纲，包括情节发展、人物互动等..."
                  resize="none"
                />
                <p class="outline-tip">
                  章节大纲将帮助AI续写时更好地理解创作意图
                </p>
              </template>
            </div>
          </div>

          <!-- 角色面板 -->
          <div v-else-if="uiStore.rightPanelTab === 'character'" class="character-panel">
            <p class="placeholder-text">角色功能开发中...</p>
          </div>
        </div>
      </aside>
    </div>

    <!-- 状态栏 -->
    <footer class="editor-status-bar">
      <div class="status-left">
        <span v-if="editorStore.isSaving" class="saving-indicator">
          <el-icon class="is-loading"><Loading /></el-icon>
          保存中...
        </span>
        <span v-else-if="editorStore.hasUnsavedChanges" class="unsaved-indicator">
          <el-icon><WarningFilled /></el-icon>
          未保存
        </span>
        <span v-else-if="editorStore.lastSavedAt" class="saved-indicator">
          <el-icon><CircleCheckFilled /></el-icon>
          已保存
        </span>
        <span v-if="aiStore.generating" class="ai-status">
          <el-icon class="is-loading"><Loading /></el-icon>
          AI生成中
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

  // 专注模式
  &.focus-mode {
    .editor-header {
      opacity: 0.3;
      transition: opacity 0.3s ease;

      &:hover {
        opacity: 1;
      }
    }

    .editor-sidebar {
      width: 0;
      overflow: hidden;
    }

    .editor-right-panel {
      width: 0;
      overflow: hidden;
    }

    .editor-status-bar {
      opacity: 0.3;
      transition: opacity 0.3s ease;

      &:hover {
        opacity: 1;
      }
    }

    .editor-main {
      background-color: $bg-base;
    }
  }
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
    .delete-chapter-btn { opacity: 1; }
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

.saving-indicator {
  color: $primary-color;
  display: flex;
  align-items: center;
  gap: 4px;
}

.ai-status {
  color: $primary-color;
  display: flex;
  align-items: center;
  gap: 4px;
}

.chapter-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.delete-chapter-btn {
  opacity: 0;
  transition: opacity 0.2s ease;
  padding: 2px;
}

// AI 面板样式
.ai-panel {
  .no-config-tip {
    text-align: center;
    padding: 32px 16px;
    color: $text-secondary;

    .el-icon {
      font-size: 32px;
      margin-bottom: 12px;
      color: $warning-color;
    }

    p {
      margin-bottom: 16px;
    }
  }
}

.ai-section {
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid $border-lighter;

  &:last-child {
    border-bottom: none;
  }

  h4 {
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 12px;
    color: $text-primary;
  }
}

.generated-content {
  .content-preview {
    max-height: 200px;
    overflow-y: auto;
    padding: 12px;
    background-color: $bg-page;
    border-radius: $border-radius-base;
    font-size: 13px;
    line-height: 1.6;
    margin-bottom: 12px;
    white-space: pre-wrap;
  }

  .content-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
}

.generating-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  color: $primary-color;
}

.ai-config-info {
  p {
    font-size: 12px;
    color: $text-regular;
    margin-bottom: 8px;
  }
}

// 大纲面板样式
.outline-panel {
  .outline-tabs {
    margin-bottom: 16px;

    .el-radio-group {
      width: 100%;

      .el-radio-button {
        flex: 1;
      }
    }
  }

  .outline-actions {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
  }

  .outline-content {
    margin-top: 8px;
  }

  .no-chapter-tip {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 32px 16px;
    color: $text-secondary;
    background-color: $bg-page;
    border-radius: $border-radius-base;
  }

  .current-chapter-info {
    font-size: 12px;
    color: $text-secondary;
    margin-bottom: 8px;
    padding: 8px 12px;
    background-color: $bg-page;
    border-radius: $border-radius-base;
  }

  .outline-tip {
    font-size: 12px;
    color: $text-secondary;
    margin-top: 8px;
  }
}
</style>
