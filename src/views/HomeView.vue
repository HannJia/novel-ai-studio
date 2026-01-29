<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useBookStore, useUiStore } from '@/stores'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { Book, BookGenre, BookStyle } from '@/types'
import { BOOK_GENRE_MAP, BOOK_STYLE_MAP, BOOK_STATUS_MAP } from '@/types'
import CreateBookWizard from '@/components/book/CreateBookWizard.vue'
import CoverUploader from '@/components/book/CoverUploader.vue'
import { uploadCover } from '@/services/api/fileApi'

const router = useRouter()
const bookStore = useBookStore()
const uiStore = useUiStore()

const showCreateDialog = ref(false)
const showWizardDialog = ref(false)
const createForm = ref({
  title: '',
  author: '',
  genre: 'xuanhuan' as BookGenre,
  style: 'qingsong' as BookStyle,
  description: '',
  coverImage: ''
})

const genreOptions = Object.entries(BOOK_GENRE_MAP).map(([value, label]) => ({
  value,
  label
}))

const styleOptions = Object.entries(BOOK_STYLE_MAP).map(([value, label]) => ({
  value,
  label
}))

onMounted(() => {
  uiStore.loadSettings()
  bookStore.fetchBooks()
})

function handleOpenBook(book: Book): void {
  bookStore.setCurrentBook(book)
  router.push(`/editor/${book.id}`)
}

function handleCreateBook(): void {
  showCreateDialog.value = true
}

async function handleDeleteBook(book: Book, event: Event): Promise<void> {
  event.stopPropagation()
  try {
    await ElMessageBox.confirm(
      `确定要删除书籍《${book.title}》吗？此操作将同时删除所有章节，且不可恢复。`,
      '删除确认',
      {
        confirmButtonText: '确定删除',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
    const success = await bookStore.deleteBook(book.id)
    if (success) {
      ElMessage.success('书籍已删除')
    } else {
      ElMessage.error('删除失败')
    }
  } catch {
    // 用户取消删除
  }
}

async function submitCreateBook(): Promise<void> {
  const book = await bookStore.createBook(createForm.value)
  if (book) {
    showCreateDialog.value = false
    resetCreateForm()
  }
}

function resetCreateForm(): void {
  createForm.value = {
    title: '',
    author: '',
    genre: 'xuanhuan',
    style: 'qingsong',
    description: '',
    coverImage: ''
  }
}

function formatWordCount(count: number): string {
  if (count >= 10000) {
    return (count / 10000).toFixed(1) + '万'
  }
  return count.toString()
}

function goToSettings(): void {
  router.push('/config')
}

function handleCreateWithAI(): void {
  showWizardDialog.value = true
}

function handleWizardClose(): void {
  showWizardDialog.value = false
}

function handleWizardCreated(bookId: string): void {
  showWizardDialog.value = false
  bookStore.fetchBooks()
  router.push(`/editor/${bookId}`)
}

function handleCreateCommand(command: string): void {
  if (command === 'wizard') {
    showWizardDialog.value = true
  } else {
    showCreateDialog.value = true
  }
}

// 书籍卡片封面上传状态
const uploadingCoverBookId = ref<string | null>(null)

// 处理封面文件选择
async function handleCoverFileSelect(event: Event, book: Book): Promise<void> {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (file) {
    await uploadBookCover(file, book)
  }
  // 清空input，允许重复选择同一文件
  target.value = ''
}

// 上传封面
async function uploadBookCover(file: File, book: Book): Promise<void> {
  // 验证文件类型
  if (!file.type.startsWith('image/')) {
    ElMessage.error('请选择图片文件')
    return
  }

  // 验证文件大小（最大5MB）
  if (file.size > 5 * 1024 * 1024) {
    ElMessage.error('图片大小不能超过5MB')
    return
  }

  uploadingCoverBookId.value = book.id
  try {
    const result = await uploadCover(file)
    // 更新书籍封面
    await bookStore.updateBook(book.id, { coverImage: result.url })
    ElMessage.success('封面上传成功')
  } catch (e) {
    ElMessage.error('上传失败: ' + (e instanceof Error ? e.message : '未知错误'))
  } finally {
    uploadingCoverBookId.value = null
  }
}
</script>

<template>
  <div class="home-view">
    <!-- 顶部栏 -->
    <header class="home-header">
      <div class="header-left">
        <h1 class="app-title">NovelAI Studio</h1>
      </div>
      <div class="header-right">
        <el-dropdown @command="handleCreateCommand">
          <el-button type="primary">
            <el-icon><Plus /></el-icon>
            新建书籍
            <el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="wizard">
                <el-icon><MagicStick /></el-icon>
                AI 辅助创建
              </el-dropdown-item>
              <el-dropdown-item command="simple">
                <el-icon><Edit /></el-icon>
                快速创建
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-button @click="goToSettings">
          <el-icon><Setting /></el-icon>
          设置
        </el-button>
      </div>
    </header>

    <!-- 书籍列表 -->
    <main class="home-content">
      <div v-if="bookStore.loading" class="loading-state">
        <el-icon class="is-loading"><Loading /></el-icon>
        <span>加载中...</span>
      </div>

      <div v-else-if="bookStore.books.length === 0" class="empty-state">
        <el-empty description="还没有书籍，开始创作你的第一本吧">
          <div class="empty-actions">
            <el-button type="primary" @click="showWizardDialog = true">
              <el-icon><MagicStick /></el-icon>
              AI 辅助创建
            </el-button>
            <el-button @click="showCreateDialog = true">
              <el-icon><Edit /></el-icon>
              快速创建
            </el-button>
          </div>
        </el-empty>
      </div>

      <div v-else class="book-grid">
        <div
          v-for="book in bookStore.books"
          :key="book.id"
          class="book-card"
          @click="handleOpenBook(book)"
        >
          <div class="book-cover">
            <img
              v-if="book.coverImage"
              :src="book.coverImage"
              :alt="book.title"
            />
            <label v-else class="cover-placeholder cover-upload-area">
              <div v-if="uploadingCoverBookId === book.id" class="uploading-state">
                <el-icon class="is-loading"><Loading /></el-icon>
              </div>
              <template v-else>
                <el-icon><Plus /></el-icon>
                <span class="upload-hint">上传封面</span>
              </template>
              <input
                type="file"
                accept="image/*"
                @click.stop
                @change="handleCoverFileSelect($event, book)"
                style="display: none"
              />
            </label>
            <el-button
              class="delete-btn"
              type="danger"
              size="small"
              circle
              @click="handleDeleteBook(book, $event)"
            >
              <el-icon><Delete /></el-icon>
            </el-button>
          </div>
          <div class="book-info">
            <h3 class="book-title">{{ book.title }}</h3>
            <p class="book-meta">
              <span class="genre-tag">{{ BOOK_GENRE_MAP[book.genre] }}</span>
              <span class="style-tag">{{ BOOK_STYLE_MAP[book.style] }}</span>
            </p>
            <p class="book-stats">
              <span>{{ formatWordCount(book.wordCount) }}字</span>
              <span>{{ book.chapterCount }}章</span>
            </p>
            <p class="book-status" :class="book.status">
              {{ BOOK_STATUS_MAP[book.status] }}
            </p>
          </div>
        </div>
      </div>
    </main>

    <!-- 创建书籍对话框 -->
    <el-dialog
      v-model="showCreateDialog"
      title="新建书籍"
      width="600px"
      @close="resetCreateForm"
    >
      <div class="create-book-form">
        <div class="form-left">
          <CoverUploader v-model="createForm.coverImage" />
        </div>
        <div class="form-right">
          <el-form :model="createForm" label-width="80px">
            <el-form-item label="书名" required>
              <el-input v-model="createForm.title" placeholder="请输入书名" />
            </el-form-item>
            <el-form-item label="作者">
              <el-input v-model="createForm.author" placeholder="请输入作者名" />
            </el-form-item>
            <el-form-item label="类型" required>
              <el-select v-model="createForm.genre" placeholder="请选择类型">
                <el-option
                  v-for="option in genreOptions"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="风格" required>
              <el-select v-model="createForm.style" placeholder="请选择风格">
                <el-option
                  v-for="option in styleOptions"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="简介">
              <el-input
                v-model="createForm.description"
                type="textarea"
                :rows="4"
                placeholder="请输入书籍简介"
              />
            </el-form-item>
          </el-form>
        </div>
      </div>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="submitCreateBook" :loading="bookStore.loading">
          创建
        </el-button>
      </template>
    </el-dialog>

    <!-- AI 辅助创建书籍对话框 -->
    <el-dialog
      v-model="showWizardDialog"
      title="AI 辅助创建书籍"
      width="800px"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <CreateBookWizard
        @close="handleWizardClose"
        @created="handleWizardCreated"
      />
    </el-dialog>
  </div>
</template>

<style scoped lang="scss">
// ==========================================
// 书架页面样式 - Gemini 3 Pro 设计方案
// ==========================================

.home-view {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background-color: var(--bg-base, $dark-bg-base);
}

// ==========================================
// 顶部工具栏
// ==========================================
.home-header {
  height: $header-height;
  padding: 0 $spacing-xl;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: var(--bg-surface, $dark-bg-surface);
  border-bottom: 1px solid var(--border-base, $dark-border-base);
  backdrop-filter: blur(8px);
}

.app-title {
  font-size: $font-size-extra-large;
  font-weight: 700;
  background: linear-gradient(135deg, $primary-color, $primary-light);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.header-right {
  display: flex;
  gap: $spacing-md;
}

// ==========================================
// 主内容区
// ==========================================
.home-content {
  flex: 1;
  padding: $spacing-xxl;
  overflow-y: auto;
}

.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary, $dark-text-secondary);
}

.loading-state {
  gap: $spacing-md;

  .el-icon {
    font-size: 40px;
    color: $primary-color;
  }
}

.empty-actions {
  display: flex;
  gap: $spacing-md;
  margin-top: $spacing-lg;
}

// ==========================================
// 书籍网格
// ==========================================
.book-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: $spacing-xl;
}

// ==========================================
// 书籍卡片
// ==========================================
.book-card {
  background-color: var(--card-bg, $dark-bg-surface);
  border: 1px solid var(--card-border, $dark-border-base);
  border-radius: $border-radius-lg;
  overflow: hidden;
  cursor: pointer;
  transition: all $transition-duration $transition-timing;
  box-shadow: var(--card-shadow, $dark-card-shadow);

  &:hover {
    transform: translateY(-6px);
    box-shadow: var(--card-hover-shadow, $dark-card-shadow-hover);
    border-color: var(--card-hover-border, $dark-border-light);

    .book-cover::after {
      opacity: 1;
    }

    .delete-btn {
      opacity: 1;
    }
  }
}

// ==========================================
// 书籍封面
// ==========================================
.book-cover {
  width: 100%;
  height: 180px;
  background-color: var(--bg-elevated, $dark-bg-elevated);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;

  // 悬浮渐变遮罩
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(
      to top,
      rgba(0, 0, 0, 0.6) 0%,
      transparent 50%
    );
    opacity: 0;
    transition: opacity $transition-duration $transition-timing;
    pointer-events: none;
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform $transition-duration-slow $transition-timing;
  }

  &:hover img {
    transform: scale(1.05);
  }

  .cover-placeholder {
    font-size: 48px;
    color: var(--text-muted, $dark-text-muted);
  }

  .cover-upload-area {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: $spacing-sm;
    width: 100%;
    height: 100%;
    cursor: pointer;
    transition: all $transition-duration $transition-timing;
    background-color: var(--bg-elevated, $dark-bg-elevated);
    border: 2px dashed var(--border-base, $dark-border-base);
    margin: $spacing-sm;
    width: calc(100% - #{$spacing-base});
    height: calc(100% - #{$spacing-base});
    border-radius: $border-radius-md;

    .el-icon {
      font-size: 36px;
      color: var(--text-muted, $dark-text-muted);
      transition: all $transition-duration-fast $transition-timing;
    }

    .upload-hint {
      font-size: $font-size-small;
      color: var(--text-muted, $dark-text-muted);
      transition: all $transition-duration-fast $transition-timing;
    }

    .uploading-state {
      .el-icon {
        font-size: 36px;
        color: $primary-color;
      }
    }

    &:hover {
      background-color: rgba($primary-color, 0.08);
      border-color: $primary-color;

      .el-icon,
      .upload-hint {
        color: $primary-color;
      }
    }
  }

  .delete-btn {
    position: absolute;
    top: $spacing-sm;
    right: $spacing-sm;
    opacity: 0;
    z-index: 10;
    transition: opacity $transition-duration $transition-timing;
  }
}

// ==========================================
// 书籍信息
// ==========================================
.book-info {
  padding: $spacing-base;
}

.book-title {
  font-size: $font-size-medium;
  font-weight: 600;
  color: var(--text-primary, $dark-text-primary);
  margin-bottom: $spacing-sm;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.4;
}

.book-meta {
  display: flex;
  flex-wrap: wrap;
  gap: $spacing-xs;
  margin-bottom: $spacing-sm;

  .genre-tag,
  .style-tag {
    font-size: $font-size-extra-small;
    padding: 2px $spacing-sm;
    border-radius: $border-radius-sm;
    background-color: rgba($primary-color, 0.15);
    color: $primary-light;
    font-weight: 500;
  }

  .style-tag {
    background-color: rgba($accent-cyan, 0.15);
    color: $accent-cyan;
  }
}

.book-stats {
  font-size: $font-size-extra-small;
  color: var(--text-secondary, $dark-text-secondary);
  margin-bottom: $spacing-sm;
  display: flex;
  gap: $spacing-md;

  span {
    display: flex;
    align-items: center;
    gap: 4px;
  }
}

.book-status {
  font-size: $font-size-extra-small;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 4px;

  &::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }

  &.writing {
    color: $primary-color;
    &::before {
      background-color: $primary-color;
      box-shadow: 0 0 8px rgba($primary-color, 0.5);
    }
  }

  &.paused {
    color: $warning-color;
    &::before {
      background-color: $warning-color;
    }
  }

  &.completed {
    color: $success-color;
    &::before {
      background-color: $success-color;
    }
  }
}

// ==========================================
// 创建书籍表单
// ==========================================
.create-book-form {
  display: flex;
  gap: $spacing-xl;

  .form-left {
    flex-shrink: 0;
  }

  .form-right {
    flex: 1;

    .el-select {
      width: 100%;
    }
  }
}

// ==========================================
// 响应式适配
// ==========================================
@media (max-width: 768px) {
  .home-header {
    padding: 0 $spacing-base;
  }

  .home-content {
    padding: $spacing-base;
  }

  .book-grid {
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: $spacing-base;
  }

  .book-cover {
    height: 140px;
  }
}

// ==========================================
// 浅色主题
// ==========================================
:global(.theme-light) {
  .home-view {
    background-color: #f8fafc;
  }

  .home-header {
    background-color: #ffffff;
    border-bottom-color: #e2e8f0;
  }

  .home-content {
    background-color: #f8fafc;
  }

  .loading-state,
  .empty-state {
    color: #64748b;
  }

  .book-card {
    background-color: #ffffff;
    border-color: #e2e8f0;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);

    &:hover {
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
      border-color: #cbd5e1;
    }
  }

  .book-cover {
    background-color: #f1f5f9;

    .cover-placeholder {
      color: #94a3b8;
    }

    .cover-upload-area {
      background-color: #f8fafc;
      border-color: #e2e8f0;

      .el-icon,
      .upload-hint {
        color: #94a3b8;
      }

      &:hover {
        background-color: rgba(249, 115, 22, 0.08);
        border-color: #f97316;

        .el-icon,
        .upload-hint {
          color: #f97316;
        }
      }
    }
  }

  .book-info {
    background-color: #ffffff;
  }

  .book-title {
    color: #1e293b;
  }

  .book-stats {
    color: #64748b;
  }
}
</style>
