/**
 * 书籍API服务
 */
import { get, post, put, del } from './index'
import type { Book, CreateBookInput, UpdateBookInput, PaginatedResult } from '@/types'

const BASE_URL = '/books'

/**
 * 获取书籍列表
 */
export async function getBooks(): Promise<Book[]> {
  return get<Book[]>(BASE_URL)
}

/**
 * 分页获取书籍列表
 */
export async function getBooksPage(
  page: number = 1,
  pageSize: number = 10,
  status?: string,
  genre?: string
): Promise<PaginatedResult<Book>> {
  const params: Record<string, unknown> = { page, pageSize }
  if (status) params.status = status
  if (genre) params.genre = genre
  return get<PaginatedResult<Book>>(`${BASE_URL}/page`, params)
}

/**
 * 获取书籍详情
 */
export async function getBook(id: string): Promise<Book> {
  return get<Book>(`${BASE_URL}/${id}`)
}

/**
 * 创建书籍
 */
export async function createBook(input: CreateBookInput): Promise<Book> {
  return post<Book>(BASE_URL, input)
}

/**
 * 更新书籍
 */
export async function updateBook(id: string, input: UpdateBookInput): Promise<Book> {
  return put<Book>(`${BASE_URL}/${id}`, input)
}

/**
 * 删除书籍
 */
export async function deleteBook(id: string): Promise<void> {
  return del<void>(`${BASE_URL}/${id}`)
}
