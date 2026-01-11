<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useBookStore } from '@/stores'
import type { Book, BookGenre, BookStyle } from '@/types'
import { BOOK_GENRE_MAP, BOOK_STYLE_MAP, BOOK_STATUS_MAP } from '@/types'

const router = useRouter()
const bookStore = useBookStore()

const showCreateDialog = ref(false)
const createForm = ref({
  title: '',
  author: '',
  genre: 'xuanhuan' as BookGenre,
  style: 'qingsong' as BookStyle,
  description: ''
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
    description: ''
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
</script>

<template>
  <div class="home-view">
    <!-- 顶部栏 -->
    <header class="home-header">
      <div class="header-left">
        <h1 class="app-title">NovelAI Studio</h1>
      </div>
      <div class="header-right">
        <el-button type="primary" @click="handleCreateBook">
          <el-icon><Plus /></el-icon>
          新建书籍
        </el-button>
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
        <el-empty description="还没有书籍，点击上方按钮创建一本吧">
          <el-button type="primary" @click="handleCreateBook">新建书籍</el-button>
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
            <div v-else class="cover-placeholder">
              <el-icon><Document /></el-icon>
            </div>
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
      width="500px"
      @close="resetCreateForm"
    >
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
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="submitCreateBook" :loading="bookStore.loading">
          创建
        </el-button>
      </template>
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

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .cover-placeholder {
    font-size: 48px;
    color: $text-placeholder;
  }
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
</style>
