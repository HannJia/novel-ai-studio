import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  Chapter,
  ChapterTreeNode,
  CreateChapterInput,
  UpdateChapterInput,
  ChapterDetailOutline
} from '@/types'
import { DETAIL_OUTLINE_STEPS } from '@/types/chapter'
import * as chapterApi from '@/services/api/chapterApi'

export const useChapterStore = defineStore('chapter', () => {
  // 状态
  const chapters = ref<Chapter[]>([])
  const currentChapter = ref<Chapter | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // 细纲相关状态
  const detailOutlineLoading = ref(false)
  const detailOutlineError = ref<string | null>(null)
  const selectedChapterForOutline = ref<string | null>(null)  // 选中要查看/生成细纲的章节ID
  const pendingDetailOutline = ref<ChapterDetailOutline | null>(null)  // 待确认的细纲

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

  // ========== 细纲相关计算属性 ==========

  // 已完成章节列表（有内容的章节）
  const completedChapters = computed(() =>
    chapters.value.filter(ch => ch.content && ch.content.trim().length > 0)
  )

  // 下一章序号
  const nextChapterNumber = computed(() => chapters.value.length + 1)

  // 获取章节的细纲
  function getChapterDetailOutline(chapterId: string): ChapterDetailOutline | null {
    const chapter = chapters.value.find(ch => ch.id === chapterId)
    return chapter?.detailOutline || null
  }

  // 获取章节摘要（用于细纲展示）
  function getChapterSummary(chapterId: string): string {
    const chapter = chapters.value.find(ch => ch.id === chapterId)
    if (!chapter) return ''
    // 优先使用 summary，否则截取内容前100字
    if (chapter.summary) return chapter.summary
    if (chapter.content) {
      return chapter.content.slice(0, 100) + (chapter.content.length > 100 ? '...' : '')
    }
    return '暂无内容'
  }

  // ========== 细纲相关方法 ==========

  // 选择要查看/生成细纲的章节
  function selectChapterForOutline(chapterId: string | null): void {
    selectedChapterForOutline.value = chapterId
    pendingDetailOutline.value = null
  }

  // 创建空白细纲模板
  function createEmptyDetailOutline(chapterId: string): ChapterDetailOutline {
    return {
      chapterId,
      steps: DETAIL_OUTLINE_STEPS.map(step => ({
        type: step.type,
        content: '',
        completed: false
      })),
      status: 'draft'
    }
  }

  // 设置待确认的细纲（AI生成后）
  function setPendingDetailOutline(outline: ChapterDetailOutline | null): void {
    pendingDetailOutline.value = outline
  }

  // 更新细纲步骤内容
  function updateDetailOutlineStep(
    chapterId: string,
    stepType: string,
    content: string
  ): void {
    const chapter = chapters.value.find(ch => ch.id === chapterId)
    if (!chapter) return

    if (!chapter.detailOutline) {
      chapter.detailOutline = createEmptyDetailOutline(chapterId)
    }

    const step = chapter.detailOutline.steps.find(s => s.type === stepType)
    if (step) {
      step.content = content
    }
  }

  // 确认细纲
  function confirmDetailOutline(chapterId: string): void {
    if (pendingDetailOutline.value && pendingDetailOutline.value.chapterId === chapterId) {
      const chapter = chapters.value.find(ch => ch.id === chapterId)
      if (chapter) {
        chapter.detailOutline = {
          ...pendingDetailOutline.value,
          status: 'confirmed',
          confirmedAt: new Date().toISOString()
        }
        pendingDetailOutline.value = null
      }
    }
  }

  // 保存细纲到章节
  function saveDetailOutlineToChapter(chapterId: string, outline: ChapterDetailOutline): void {
    const chapter = chapters.value.find(ch => ch.id === chapterId)
    if (chapter) {
      chapter.detailOutline = outline
    }
  }

  // 标记细纲步骤为已完成
  function markStepCompleted(chapterId: string, stepType: string, completed: boolean): void {
    const chapter = chapters.value.find(ch => ch.id === chapterId)
    if (!chapter?.detailOutline) return

    const step = chapter.detailOutline.steps.find(s => s.type === stepType)
    if (step) {
      step.completed = completed
    }
  }

  // 获取前面章节的内容摘要（用于生成细纲的上下文）
  function getPreviousChaptersContext(beforeChapterOrder: number): string {
    const previousChapters = chapters.value
      .filter(ch => ch.order < beforeChapterOrder)
      .sort((a, b) => a.order - b.order)

    return previousChapters.map(ch => {
      const summary = ch.summary || (ch.content ? ch.content.slice(0, 200) + '...' : '')
      return `【${ch.title}】${summary}`
    }).join('\n\n')
  }

  return {
    // 状态
    chapters,
    currentChapter,
    loading,
    error,
    // 细纲状态
    detailOutlineLoading,
    detailOutlineError,
    selectedChapterForOutline,
    pendingDetailOutline,
    // 计算属性
    chapterTree,
    totalWordCount,
    completedChapters,
    nextChapterNumber,
    // 方法
    fetchChaptersByBook,
    fetchChapterById,
    createChapter,
    updateChapter,
    deleteChapter,
    setCurrentChapter,
    reorderChapters,
    // 细纲方法
    getChapterDetailOutline,
    getChapterSummary,
    selectChapterForOutline,
    createEmptyDetailOutline,
    setPendingDetailOutline,
    updateDetailOutlineStep,
    confirmDetailOutline,
    saveDetailOutlineToChapter,
    markStepCompleted,
    getPreviousChaptersContext
  }
})
