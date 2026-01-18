/**
 * 知识库API服务
 */
import { get, post, del, upload } from './index'
import type { KnowledgeFile, KnowledgeSearchResult, PaginatedResult } from '@/types'

const FILE_URL = '/knowledge/files'
const SEARCH_URL = '/knowledge/search'

/**
 * 上传知识库文件
 */
export async function uploadKnowledgeFile(
  file: File,
  bookId?: string,
  categoryId?: string
): Promise<KnowledgeFile> {
  const formData = new FormData()
  formData.append('file', file)
  if (bookId) formData.append('bookId', bookId)
  if (categoryId) formData.append('categoryId', categoryId)

  return post<KnowledgeFile>(`${FILE_URL}/upload`, formData)
}

/**
 * 获取书籍的所有文件
 */
export async function getKnowledgeFiles(bookId: string): Promise<KnowledgeFile[]> {
  return get<KnowledgeFile[]>(`${FILE_URL}/book/${bookId || 'global'}`)
}

/**
 * 获取全局知识库文件
 */
export async function getGlobalKnowledgeFiles(): Promise<KnowledgeFile[]> {
  return get<KnowledgeFile[]>(`${FILE_URL}/global`)
}

/**
 * 分页获取文件
 */
export async function getKnowledgeFilesPage(
  bookId: string,
  page: number = 1,
  pageSize: number = 10,
  categoryId?: string,
  isIndexed?: boolean
): Promise<PaginatedResult<KnowledgeFile>> {
  const params: Record<string, unknown> = { page, pageSize }
  if (categoryId) params.categoryId = categoryId
  if (isIndexed !== undefined) params.isIndexed = isIndexed
  return get<PaginatedResult<KnowledgeFile>>(`${FILE_URL}/book/${bookId || 'global'}/page`, params)
}

/**
 * 获取文件详情
 */
export async function getKnowledgeFile(id: string): Promise<KnowledgeFile> {
  return get<KnowledgeFile>(`${FILE_URL}/${id}`)
}

/**
 * 删除文件
 */
export async function deleteKnowledgeFile(id: string): Promise<void> {
  return del<void>(`${FILE_URL}/${id}`)
}

/**
 * 读取文件内容
 */
export async function getKnowledgeFileContent(id: string): Promise<string> {
  return get<string>(`${FILE_URL}/${id}/content`)
}

/**
 * 添加文件标签
 */
export async function addKnowledgeFileTag(id: string, tag: string): Promise<KnowledgeFile> {
  return post<KnowledgeFile>(`${FILE_URL}/${id}/tag`, { tag })
}

/**
 * 移除文件标签
 */
export async function removeKnowledgeFileTag(id: string, tag: string): Promise<KnowledgeFile> {
  return del<KnowledgeFile>(`${FILE_URL}/${id}/tag/${encodeURIComponent(tag)}`)
}

/**
 * 获取文件统计
 */
export async function getKnowledgeFileStats(bookId: string): Promise<{
  totalCount: number
  totalSize: number
  indexedCount: number
  typeCount: Record<string, number>
}> {
  return get(`${FILE_URL}/book/${bookId || 'global'}/stats`)
}

/**
 * 索引文件
 */
export async function indexKnowledgeFile(fileId: string): Promise<number> {
  return post<number>(`${SEARCH_URL}/index/${fileId}`)
}

/**
 * 搜索知识库
 */
export async function searchKnowledge(
  bookId: string,
  query: string,
  topK: number = 5
): Promise<KnowledgeSearchResult[]> {
  return get<KnowledgeSearchResult[]>(`${SEARCH_URL}/book/${bookId || 'global'}`, { query, topK })
}

/**
 * 搜索单个文件
 */
export async function searchInFile(
  fileId: string,
  query: string,
  topK: number = 5
): Promise<KnowledgeSearchResult[]> {
  return get<KnowledgeSearchResult[]>(`${SEARCH_URL}/file/${fileId}`, { query, topK })
}

/**
 * 获取相关上下文（用于AI生成）
 */
export async function getRelevantContext(
  bookId: string,
  query: string,
  maxChunks: number = 3
): Promise<string> {
  return get<string>(`${SEARCH_URL}/context/${bookId || 'global'}`, { query, maxChunks })
}

/**
 * 清除文件索引
 */
export async function clearFileIndex(fileId: string): Promise<void> {
  return del<void>(`${SEARCH_URL}/index/${fileId}`)
}

/**
 * 清除书籍所有索引
 */
export async function clearBookIndex(bookId: string): Promise<void> {
  return del<void>(`${SEARCH_URL}/index/book/${bookId || 'global'}`)
}
