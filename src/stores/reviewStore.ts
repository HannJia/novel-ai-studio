import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ReviewIssue, ReviewReport, ReviewRuleInfo, ReviewStats, ReviewLevel } from '@/types/review'
import * as reviewApi from '@/services/api/reviewApi'

export const useReviewStore = defineStore('review', () => {
  // 状态
  const issues = ref<ReviewIssue[]>([])
  const stats = ref<ReviewStats | null>(null)
  const rules = ref<ReviewRuleInfo[]>([])
  const currentReport = ref<ReviewReport | null>(null)
  const loading = ref(false)
  const reviewing = ref(false)
  const error = ref<string | null>(null)

  // 计算属性
  const openIssues = computed(() => issues.value.filter(i => i.status === 'open'))
  const fixedIssues = computed(() => issues.value.filter(i => i.status === 'fixed'))
  const ignoredIssues = computed(() => issues.value.filter(i => i.status === 'ignored'))

  const errorIssues = computed(() => openIssues.value.filter(i => i.level === 'error'))
  const warningIssues = computed(() => openIssues.value.filter(i => i.level === 'warning'))
  const suggestionIssues = computed(() => openIssues.value.filter(i => i.level === 'suggestion'))
  const infoIssues = computed(() => openIssues.value.filter(i => i.level === 'info'))

  const issuesByChapter = computed(() => {
    const map = new Map<string, ReviewIssue[]>()
    for (const issue of openIssues.value) {
      const list = map.get(issue.chapterId) || []
      list.push(issue)
      map.set(issue.chapterId, list)
    }
    return map
  })

  // 获取规则列表
  async function fetchRules() {
    try {
      rules.value = await reviewApi.getRules()
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : '获取规则失败'
    }
  }

  // 获取书籍问题
  async function fetchBookIssues(bookId: string) {
    loading.value = true
    error.value = null
    try {
      issues.value = await reviewApi.getBookIssues(bookId)
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : '获取问题列表失败'
    } finally {
      loading.value = false
    }
  }

  // 获取章节问题
  async function fetchChapterIssues(chapterId: string) {
    loading.value = true
    error.value = null
    try {
      const chapterIssues = await reviewApi.getChapterIssues(chapterId)
      // 更新或添加到issues中
      for (const issue of chapterIssues) {
        const idx = issues.value.findIndex(i => i.id === issue.id)
        if (idx >= 0) {
          issues.value[idx] = issue
        } else {
          issues.value.push(issue)
        }
      }
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : '获取章节问题失败'
    } finally {
      loading.value = false
    }
  }

  // 获取统计信息
  async function fetchStats(bookId: string) {
    try {
      stats.value = await reviewApi.getBookStats(bookId)
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : '获取统计信息失败'
    }
  }

  // 审查单个章节
  async function reviewChapter(bookId: string, chapterId: string, levels?: ReviewLevel[]) {
    reviewing.value = true
    error.value = null
    try {
      currentReport.value = await reviewApi.reviewChapter(bookId, chapterId, levels)
      // 更新issues列表
      await fetchChapterIssues(chapterId)
      return currentReport.value
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : '审查失败'
      throw e
    } finally {
      reviewing.value = false
    }
  }

  // 审查整本书
  async function reviewBook(bookId: string, levels?: ReviewLevel[]) {
    reviewing.value = true
    error.value = null
    try {
      currentReport.value = await reviewApi.reviewBook(bookId, levels)
      // 更新issues列表
      await fetchBookIssues(bookId)
      return currentReport.value
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : '审查失败'
      throw e
    } finally {
      reviewing.value = false
    }
  }

  // 快速审查
  async function quickReview(bookId: string, chapterId: string) {
    reviewing.value = true
    error.value = null
    try {
      currentReport.value = await reviewApi.quickReview(bookId, chapterId)
      await fetchChapterIssues(chapterId)
      return currentReport.value
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : '快速审查失败'
      throw e
    } finally {
      reviewing.value = false
    }
  }

  // 更新问题状态
  async function updateIssueStatus(issueId: string, status: 'open' | 'fixed' | 'ignored') {
    try {
      await reviewApi.updateIssueStatus(issueId, status)
      const issue = issues.value.find(i => i.id === issueId)
      if (issue) {
        issue.status = status
      }
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : '更新状态失败'
      throw e
    }
  }

  // 批量更新状态
  async function batchUpdateStatus(issueIds: string[], status: 'open' | 'fixed' | 'ignored') {
    try {
      await reviewApi.batchUpdateStatus(issueIds, status)
      for (const id of issueIds) {
        const issue = issues.value.find(i => i.id === id)
        if (issue) {
          issue.status = status
        }
      }
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : '批量更新失败'
      throw e
    }
  }

  // 删除问题
  async function deleteIssue(issueId: string) {
    try {
      await reviewApi.deleteIssue(issueId)
      issues.value = issues.value.filter(i => i.id !== issueId)
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : '删除失败'
      throw e
    }
  }

  // 清除书籍问题
  async function clearBookIssues(bookId: string) {
    try {
      await reviewApi.clearBookIssues(bookId)
      issues.value = issues.value.filter(i => i.bookId !== bookId)
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : '清除失败'
      throw e
    }
  }

  // 获取章节的问题数量
  function getChapterIssueCount(chapterId: string): number {
    return openIssues.value.filter(i => i.chapterId === chapterId).length
  }

  // 获取章节的最高级别问题
  function getChapterHighestLevel(chapterId: string): ReviewLevel | null {
    const chapterIssues = openIssues.value.filter(i => i.chapterId === chapterId)
    if (chapterIssues.length === 0) return null

    const levels: ReviewLevel[] = ['error', 'warning', 'suggestion', 'info']
    for (const level of levels) {
      if (chapterIssues.some(i => i.level === level)) {
        return level
      }
    }
    return null
  }

  // 重置状态
  function reset() {
    issues.value = []
    stats.value = null
    currentReport.value = null
    error.value = null
  }

  return {
    // 状态
    issues,
    stats,
    rules,
    currentReport,
    loading,
    reviewing,
    error,

    // 计算属性
    openIssues,
    fixedIssues,
    ignoredIssues,
    errorIssues,
    warningIssues,
    suggestionIssues,
    infoIssues,
    issuesByChapter,

    // 方法
    fetchRules,
    fetchBookIssues,
    fetchChapterIssues,
    fetchStats,
    reviewChapter,
    reviewBook,
    quickReview,
    updateIssueStatus,
    batchUpdateStatus,
    deleteIssue,
    clearBookIssues,
    getChapterIssueCount,
    getChapterHighestLevel,
    reset
  }
})
