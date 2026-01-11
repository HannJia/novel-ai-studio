import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Chapter, ChapterTreeNode, CreateChapterInput, UpdateChapterInput } from '@/types'
import * as chapterApi from '@/services/api/chapterApi'

export const useChapterStore = defineStore('chapter', () => {
  // 状态
  const chapters = ref<Chapter[]>([])
  const currentChapter = ref<Chapter | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // 计算属性
  const chapterTree = computed<ChapterTreeNode[]>(() => {
    return chapters.value.map(ch => ({
      id: ch.id,
      title: ch.title,
      type: 'chapter' as const,
      order: ch.order,
      wordCount: ch.wordCount,
      status: ch.status
    }))
  })

  const totalWordCount = computed(() =>
    chapters.value.reduce((sum, ch) => sum + ch.wordCount, 0)
  )

  // 方法
  async function fetchChaptersByBook(bookId: string): Promise<void> {
    loading.value = true
    error.value = null
    try {
      chapters.value = await chapterApi.getChaptersByBook(bookId)
    } catch (e) {
      error.value = e instanceof Error ? e.message : '获取章节列表失败'
    } finally {
      loading.value = false
    }
  }

  async function fetchChapterById(id: string): Promise<Chapter | null> {
    loading.value = true
    error.value = null
    try {
      const chapter = await chapterApi.getChapter(id)
      currentChapter.value = chapter
      return chapter
    } catch (e) {
      error.value = e instanceof Error ? e.message : '获取章节详情失败'
      return null
    } finally {
      loading.value = false
    }
  }

  async function createChapter(input: CreateChapterInput): Promise<Chapter | null> {
    loading.value = true
    error.value = null
    try {
      const chapter = await chapterApi.createChapter(input)
      chapters.value.push(chapter)
      return chapter
    } catch (e) {
      error.value = e instanceof Error ? e.message : '创建章节失败'
      return null
    } finally {
      loading.value = false
    }
  }

  async function updateChapter(id: string, input: UpdateChapterInput): Promise<Chapter | null> {
    loading.value = true
    error.value = null
    try {
      const chapter = await chapterApi.updateChapter(id, input)
      const index = chapters.value.findIndex(ch => ch.id === id)
      if (index !== -1) {
        chapters.value[index] = chapter
      }
      if (currentChapter.value?.id === id) {
        currentChapter.value = chapter
      }
      return chapter
    } catch (e) {
      error.value = e instanceof Error ? e.message : '更新章节失败'
      return null
    } finally {
      loading.value = false
    }
  }

  async function deleteChapter(id: string): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      await chapterApi.deleteChapter(id)
      chapters.value = chapters.value.filter(ch => ch.id !== id)
      if (currentChapter.value?.id === id) {
        currentChapter.value = null
      }
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : '删除章节失败'
      return false
    } finally {
      loading.value = false
    }
  }

  function setCurrentChapter(chapter: Chapter | null): void {
    currentChapter.value = chapter
  }

  function reorderChapters(startIndex: number, endIndex: number): void {
    const [removed] = chapters.value.splice(startIndex, 1)
    chapters.value.splice(endIndex, 0, removed)
    // 更新order
    chapters.value.forEach((ch, index) => {
      ch.order = index + 1
    })
  }

  return {
    // 状态
    chapters,
    currentChapter,
    loading,
    error,
    // 计算属性
    chapterTree,
    totalWordCount,
    // 方法
    fetchChaptersByBook,
    fetchChapterById,
    createChapter,
    updateChapter,
    deleteChapter,
    setCurrentChapter,
    reorderChapters
  }
})
