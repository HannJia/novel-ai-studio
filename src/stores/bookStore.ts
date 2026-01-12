import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Book, BookStatus, CreateBookInput, UpdateBookInput } from '@/types'
import * as bookApi from '@/services/api/bookApi'

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
      books.value = await bookApi.getBooks()
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
      const book = await bookApi.getBook(id)
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
      const book = await bookApi.createBook(input)
      books.value.push(book)
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
      const book = await bookApi.updateBook(id, input)
      const index = books.value.findIndex(b => b.id === id)
      if (index !== -1) {
        books.value[index] = book
      }
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
      await bookApi.deleteBook(id)
      books.value = books.value.filter(b => b.id !== id)
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
