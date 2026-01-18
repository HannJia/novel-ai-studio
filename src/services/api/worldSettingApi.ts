/**
 * 世界观设定API服务
 */
import { get, post, put, del } from './index'
import type {
  WorldSetting,
  CreateWorldSettingInput,
  UpdateWorldSettingInput,
  WorldSettingStats,
  PaginatedResult
} from '@/types'

const BASE_URL = '/world-settings'

/**
 * 获取书籍的所有设定
 */
export async function getSettingsByBook(bookId: string): Promise<WorldSetting[]> {
  return get<WorldSetting[]>(`${BASE_URL}/book/${bookId}`)
}

/**
 * 按分类获取设定
 */
export async function getSettingsByCategory(
  bookId: string,
  category: string
): Promise<WorldSetting[]> {
  return get<WorldSetting[]>(`${BASE_URL}/book/${bookId}/category/${category}`)
}

/**
 * 分页获取设定
 */
export async function getSettingsPage(
  bookId: string,
  page: number = 1,
  pageSize: number = 10,
  category?: string
): Promise<PaginatedResult<WorldSetting>> {
  const params: Record<string, unknown> = { page, pageSize }
  if (category) params.category = category
  return get<PaginatedResult<WorldSetting>>(`${BASE_URL}/book/${bookId}/page`, params)
}

/**
 * 获取设定详情
 */
export async function getSetting(id: string): Promise<WorldSetting> {
  return get<WorldSetting>(`${BASE_URL}/${id}`)
}

/**
 * 创建设定
 */
export async function createSetting(input: CreateWorldSettingInput): Promise<WorldSetting> {
  return post<WorldSetting>(BASE_URL, input)
}

/**
 * 更新设定
 */
export async function updateSetting(id: string, input: UpdateWorldSettingInput): Promise<WorldSetting> {
  return put<WorldSetting>(`${BASE_URL}/${id}`, input)
}

/**
 * 删除设定
 */
export async function deleteSetting(id: string): Promise<void> {
  return del<void>(`${BASE_URL}/${id}`)
}

/**
 * 批量删除设定
 */
export async function deleteSettings(ids: string[]): Promise<void> {
  return del<void>(`${BASE_URL}/batch`)
}

/**
 * 搜索设定
 */
export async function searchSettings(bookId: string, keyword: string): Promise<WorldSetting[]> {
  return get<WorldSetting[]>(`${BASE_URL}/book/${bookId}/search`, { keyword })
}

/**
 * 按标签获取设定
 */
export async function getSettingsByTag(bookId: string, tag: string): Promise<WorldSetting[]> {
  return get<WorldSetting[]>(`${BASE_URL}/book/${bookId}/tag/${encodeURIComponent(tag)}`)
}

/**
 * 添加标签
 */
export async function addSettingTag(id: string, tag: string): Promise<WorldSetting> {
  return post<WorldSetting>(`${BASE_URL}/${id}/tag`, { tag })
}

/**
 * 移除标签
 */
export async function removeSettingTag(id: string, tag: string): Promise<WorldSetting> {
  return del<WorldSetting>(`${BASE_URL}/${id}/tag/${encodeURIComponent(tag)}`)
}

/**
 * 获取设定统计
 */
export async function getSettingStats(bookId: string): Promise<WorldSettingStats> {
  return get<WorldSettingStats>(`${BASE_URL}/book/${bookId}/stats`)
}

/**
 * 获取所有标签
 */
export async function getAllTags(bookId: string): Promise<string[]> {
  return get<string[]>(`${BASE_URL}/book/${bookId}/tags`)
}
