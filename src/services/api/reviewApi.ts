import request from '@/utils/request'
import type { ReviewIssue, ReviewReport, ReviewRuleInfo, ReviewStats } from '@/types/review'

const BASE_URL = '/api/review'

/**
 * 获取所有可用规则
 */
export function getRules(): Promise<ReviewRuleInfo[]> {
  return request.get(`${BASE_URL}/rules`)
}

/**
 * 审查单个章节
 */
export function reviewChapter(
  bookId: string,
  chapterId: string,
  levels?: string[]
): Promise<ReviewReport> {
  const params = levels?.length ? { levels: levels.join(',') } : {}
  return request.post(`${BASE_URL}/chapter/${bookId}/${chapterId}`, null, { params })
}

/**
 * 审查整本书
 */
export function reviewBook(
  bookId: string,
  levels?: string[]
): Promise<ReviewReport> {
  const params = levels?.length ? { levels: levels.join(',') } : {}
  return request.post(`${BASE_URL}/book/${bookId}`, null, { params })
}

/**
 * 快速审查（仅Level A规则）
 */
export function quickReview(
  bookId: string,
  chapterId: string
): Promise<ReviewReport> {
  return request.post(`${BASE_URL}/quick/${bookId}/${chapterId}`)
}

/**
 * 获取书籍的所有审查问题
 */
export function getBookIssues(bookId: string): Promise<ReviewIssue[]> {
  return request.get(`${BASE_URL}/issues/book/${bookId}`)
}

/**
 * 获取章节的审查问题
 */
export function getChapterIssues(chapterId: string): Promise<ReviewIssue[]> {
  return request.get(`${BASE_URL}/issues/chapter/${chapterId}`)
}

/**
 * 获取书籍未解决的问题统计
 */
export function getBookStats(bookId: string): Promise<ReviewStats> {
  return request.get(`${BASE_URL}/stats/${bookId}`)
}

/**
 * 更新问题状态
 */
export function updateIssueStatus(
  issueId: string,
  status: 'open' | 'fixed' | 'ignored'
): Promise<void> {
  return request.put(`${BASE_URL}/issues/${issueId}/status`, { status })
}

/**
 * 批量更新问题状态
 */
export function batchUpdateStatus(
  issueIds: string[],
  status: 'open' | 'fixed' | 'ignored'
): Promise<void> {
  return request.put(`${BASE_URL}/issues/batch-status`, { issueIds, status })
}

/**
 * 删除单个问题
 */
export function deleteIssue(issueId: string): Promise<void> {
  return request.delete(`${BASE_URL}/issues/${issueId}`)
}

/**
 * 清除书籍的所有问题
 */
export function clearBookIssues(bookId: string): Promise<void> {
  return request.delete(`${BASE_URL}/issues/book/${bookId}`)
}

/**
 * 获取单个问题详情
 */
export function getIssue(issueId: string): Promise<ReviewIssue> {
  return request.get(`${BASE_URL}/issues/${issueId}`)
}
