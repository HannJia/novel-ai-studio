<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useBookStore } from '@/stores'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { Book, BookGenre, BookStyle } from '@/types'
import { BOOK_GENRE_MAP, BOOK_STYLE_MAP, BOOK_STATUS_MAP } from '@/types'
import CreateBookWizard from '@/components/book/CreateBookWizard.vue'
import CoverUploader from '@/components/book/CoverUploader.vue'
import { uploadCover } from '@/services/api/fileApi'

const router = useRouter()
const bookStore = useBookStore()

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
.home-view {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background-color: $bg-page;
}

.home-header {
  height: $header-height;
  padding: 0 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: $bg-base;
  border-bottom: 1px solid $border-light;
  box-shadow: $shadow-base;
}

.app-title {
  font-size: 20px;
  font-weight: 600;
  color: $primary-color;
}

.header-right {
  display: flex;
  gap: 12px;
}

.home-content {
  flex: 1;
  padding: 24px;
  overflow-y: auto;
}

.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: $text-secondary;
}

.loading-state {
  gap: 12px;

  .el-icon {
    font-size: 32px;
  }
}

.empty-actions {
  display: flex;
  gap: 12px;
  margin-top: 16px;
}

.book-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 24px;
}

.book-card {
  background-color: $bg-base;
  border-radius: $border-radius-large;
  overflow: hidden;
  cursor: pointer;
  transition: all $transition-duration $transition-ease;
  box-shadow: $shadow-light;

  &:hover {
    transform: translateY(-4px);
    box-shadow: $shadow-dark;
  }
}

.book-cover {
  width: 100%;
  height: 160px;
  background-color: $bg-page;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .cover-placeholder {
    font-size: 48px;
    color: $text-placeholder;
  }

  .cover-upload-area {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    height: 100%;
    cursor: pointer;
    transition: all $transition-duration $transition-ease;
    background-color: $bg-page;

    .el-icon {
      font-size: 32px;
      color: $text-placeholder;
      transition: color $transition-duration-fast;
    }

    .upload-hint {
      font-size: 12px;
      color: $text-placeholder;
      transition: color $transition-duration-fast;
    }

    .uploading-state {
      .el-icon {
        font-size: 32px;
        color: $primary-color;
      }
    }

    &:hover {
      background-color: rgba($primary-color, 0.05);

      .el-icon {
        color: $primary-color;
      }

      .upload-hint {
        color: $primary-color;
      }
    }
  }

  .delete-btn {
    position: absolute;
    top: 8px;
    right: 8px;
    opacity: 0;
    transition: opacity $transition-duration $transition-ease;
  }
}

.book-card:hover .delete-btn {
  opacity: 1;
}

.book-info {
  padding: 16px;
}

.book-title {
  font-size: 16px;
  font-weight: 600;
  color: $text-primary;
  margin-bottom: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.book-meta {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;

  .genre-tag,
  .style-tag {
    font-size: 12px;
    padding: 2px 8px;
    border-radius: 4px;
    background-color: $bg-page;
    color: $text-secondary;
  }
}

.book-stats {
  font-size: 12px;
  color: $text-secondary;
  margin-bottom: 8px;

  span {
    margin-right: 12px;
  }
}

.book-status {
  font-size: 12px;
  font-weight: 500;

  &.writing {
    color: $primary-color;
  }

  &.paused {
    color: $warning-color;
  }

  &.completed {
    color: $success-color;
  }
}

.create-book-form {
  display: flex;
  gap: 24px;

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
</style>
