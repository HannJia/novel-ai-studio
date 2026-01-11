/**
 * 章节API服务
 */
import { get, post, put, del } from './index'
import type { Chapter, CreateChapterInput, UpdateChapterInput } from '@/types'

const BASE_URL = '/chapters'

/**
 * 获取书籍的章节列表
 */
export async function getChaptersByBook(bookId: string): Promise<Chapter[]> {
  return get<Chapter[]>(`${BASE_URL}/book/${bookId}`)
}

/**
 * 获取章节详情
 */
export async function getChapter(id: string): Promise<Chapter> {
  return get<Chapter>(`${BASE_URL}/${id}`)
}

/**
 * 创建章节
 */
export async function createChapter(input: CreateChapterInput): Promise<Chapter> {
  return post<Chapter>(BASE_URL, input)
}

/**
 * 更新章节
 */
export async function updateChapter(id: string, input: UpdateChapterInput): Promise<Chapter> {
  return put<Chapter>(`${BASE_URL}/${id}`, input)
}

/**
 * 删除章节
 */
export async function deleteChapter(id: string): Promise<void> {
  return del<void>(`${BASE_URL}/${id}`)
}

/**
 * 重新排序章节
 */
export async function reorderChapters(bookId: string, chapterIds: string[]): Promise<void> {
  return post<void>(`${BASE_URL}/book/${bookId}/reorder`, chapterIds)
}
