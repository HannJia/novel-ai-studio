import { ref, watch, onMounted, onUnmounted } from 'vue'
import { useReviewStore } from '@/stores/reviewStore'
import { useBookStore } from '@/stores/bookStore'
import { useChapterStore } from '@/stores/chapterStore'
import { debounce } from 'lodash-es'

/**
 * 实时审查 Hook
 * 在编辑器中使用，监听章节内容变化并触发审查
 */
export function useRealtimeReview(options?: {
  debounceTime?: number
  autoReview?: boolean
  onIssuesFound?: (count: number) => void
}) {
  const reviewStore = useReviewStore()
  const bookStore = useBookStore()
  const chapterStore = useChapterStore()

  const isReviewing = ref(false)
  const issueCount = ref(0)
  const lastReviewTime = ref<Date | null>(null)

  // 防抖时间
  const debounceTime = options?.debounceTime || 3000

  // 执行审查
  async function doReview() {
    const bookId = bookStore.currentBook?.id
    const chapterId = chapterStore.currentChapter?.id

    if (!bookId || !chapterId) {
      return
    }

    isReviewing.value = true

    try {
      // 快速审查，仅检测错误
      const report = await reviewStore.quickReview(bookId, chapterId)
      issueCount.value = report.totalIssues
      lastReviewTime.value = new Date()

      if (report.totalIssues > 0 && options?.onIssuesFound) {
        options.onIssuesFound(report.totalIssues)
      }
    } catch (e) {
      console.error('Realtime review failed:', e)
    } finally {
      isReviewing.value = false
    }
  }

  // 防抖版本的审查函数
  const debouncedReview = debounce(doReview, debounceTime)

  // 触发审查
  function triggerReview() {
    if (options?.autoReview !== false) {
      debouncedReview()
    }
  }

  // 监听章节内容变化
  watch(
    () => chapterStore.currentChapter?.content,
    () => {
      triggerReview()
    }
  )

  // 获取当前章节的问题
  function getCurrentChapterIssues() {
    const chapterId = chapterStore.currentChapter?.id
    if (!chapterId) return []
    return reviewStore.openIssues.filter(i => i.chapterId === chapterId)
  }

  // 获取当前章节最高级别问题
  function getCurrentChapterHighestLevel() {
    const chapterId = chapterStore.currentChapter?.id
    if (!chapterId) return null
    return reviewStore.getChapterHighestLevel(chapterId)
  }

  // 清理
  onUnmounted(() => {
    debouncedReview.cancel()
  })

  return {
    isReviewing,
    issueCount,
    lastReviewTime,
    triggerReview,
    doReview,
    getCurrentChapterIssues,
    getCurrentChapterHighestLevel
  }
}

/**
 * 章节保存时触发审查 Hook
 */
export function useReviewOnSave() {
  const reviewStore = useReviewStore()
  const bookStore = useBookStore()

  async function reviewAfterSave(chapterId: string) {
    const bookId = bookStore.currentBook?.id
    if (!bookId) return

    try {
      await reviewStore.quickReview(bookId, chapterId)
    } catch (e) {
      console.error('Review after save failed:', e)
    }
  }

  return {
    reviewAfterSave
  }
}
