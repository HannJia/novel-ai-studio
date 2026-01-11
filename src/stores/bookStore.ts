import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Book, BookStatus, CreateBookInput, UpdateBookInput } from '@/types'

// 本地存储 key
const STORAGE_KEY = 'novel-ai-studio-books'

// 生成唯一ID
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2)
}

// 从 localStorage 读取书籍
function loadBooksFromStorage(): Book[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    return data ? JSON.parse(data) : []
  } catch {
    return []
  }
}

// 保存书籍到 localStorage
function saveBooksToStorage(books: Book[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(books))
}

export const useBookStore = defineStore('book', () => {
  // 状态
  const books = ref<Book[]>([])
  const currentBook = ref<Book | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // 计算属性
  const bookCount = computed(() => books.value.length)

  const writingBooks = computed(() =>
    books.value.filter(b => b.status === 'writing')
  )

  const completedBooks = computed(() =>
    books.value.filter(b => b.status === 'completed')
  )

  // 方法
  async function fetchBooks(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      // 使用本地存储
      books.value = loadBooksFromStorage()
    } catch (e) {
      error.value = e instanceof Error ? e.message : '获取书籍列表失败'
    } finally {
      loading.value = false
    }
  }

  async function fetchBookById(id: string): Promise<Book | null> {
    loading.value = true
    error.value = null
    try {
      const allBooks = loadBooksFromStorage()
      const book = allBooks.find(b => b.id === id) || null
      currentBook.value = book
      return book
    } catch (e) {
      error.value = e instanceof Error ? e.message : '获取书籍详情失败'
      return null
    } finally {
      loading.value = false
    }
  }

  async function createBook(input: CreateBookInput): Promise<Book | null> {
    loading.value = true
    error.value = null
    try {
      const now = new Date().toISOString()
      const book: Book = {
        id: generateId(),
        title: input.title,
        author: input.author || '',
        genre: input.genre,
        style: input.style,
        description: input.description || '',
        status: 'writing',
        wordCount: 0,
        chapterCount: 0,
        createdAt: now,
        updatedAt: now
      }
      books.value.push(book)
      saveBooksToStorage(books.value)
      return book
    } catch (e) {
      error.value = e instanceof Error ? e.message : '创建书籍失败'
      return null
    } finally {
      loading.value = false
    }
  }

  async function updateBook(id: string, input: UpdateBookInput): Promise<Book | null> {
    loading.value = true
    error.value = null
    try {
      const index = books.value.findIndex(b => b.id === id)
      if (index === -1) {
        throw new Error('书籍不存在')
      }
      const book = {
        ...books.value[index],
        ...input,
        updatedAt: new Date().toISOString()
      }
      books.value[index] = book
      saveBooksToStorage(books.value)
      if (currentBook.value?.id === id) {
        currentBook.value = book
      }
      return book
    } catch (e) {
      error.value = e instanceof Error ? e.message : '更新书籍失败'
      return null
    } finally {
      loading.value = false
    }
  }

  async function deleteBook(id: string): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      books.value = books.value.filter(b => b.id !== id)
      saveBooksToStorage(books.value)
      if (currentBook.value?.id === id) {
        currentBook.value = null
      }
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : '删除书籍失败'
      return false
    } finally {
      loading.value = false
    }
  }

  function setCurrentBook(book: Book | null): void {
    currentBook.value = book
  }

  function updateBookStatus(id: string, status: BookStatus): void {
    const book = books.value.find(b => b.id === id)
    if (book) {
      book.status = status
    }
    if (currentBook.value?.id === id) {
      currentBook.value.status = status
    }
  }

  return {
    // 状态
    books,
    currentBook,
    loading,
    error,
    // 计算属性
    bookCount,
    writingBooks,
    completedBooks,
    // 方法
    fetchBooks,
    fetchBookById,
    createBook,
    updateBook,
    deleteBook,
    setCurrentBook,
    updateBookStatus
  }
})
