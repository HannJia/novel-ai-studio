/**
 * 书籍API服务
 */
import { get, post, put, del } from './index'
import type { Book, CreateBookInput, UpdateBookInput, PaginatedResult, VolumeOutline } from '@/types'

const BASE_URL = '/books'

/**
 * 处理 volumes 字段的 JSON 解析
 */
function parseBookVolumes(book: Book): Book {
  if (book.volumes && typeof book.volumes === 'string') {
    try {
      book.volumes = JSON.parse(book.volumes) as VolumeOutline[]
    } catch {
      book.volumes = []
    }
  }
  return book
}

/**
 * 获取书籍列表
 */
export async function getBooks(): Promise<Book[]> {
  const books = await get<Book[]>(BASE_URL)
  return books.map(parseBookVolumes)
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
  const result = await get<PaginatedResult<Book>>(`${BASE_URL}/page`, params)
  result.records = result.records.map(parseBookVolumes)
  return result
}

/**
 * 获取书籍详情
 */
export async function getBook(id: string): Promise<Book> {
  const book = await get<Book>(`${BASE_URL}/${id}`)
  return parseBookVolumes(book)
}

/**
 * 创建书籍
 */
export async function createBook(input: CreateBookInput): Promise<Book> {
  const book = await post<Book>(BASE_URL, input)
  return parseBookVolumes(book)
}

/**
 * 更新书籍
 */
export async function updateBook(id: string, input: UpdateBookInput): Promise<Book> {
  // 将 volumes 数组序列化为 JSON 字符串
  const payload: Record<string, unknown> = { ...input }
  if (input.volumes) {
    payload.volumes = JSON.stringify(input.volumes)
  }
  const book = await put<Book>(`${BASE_URL}/${id}`, payload)
  return parseBookVolumes(book)
}

/**
 * 删除书籍
 */
export async function deleteBook(id: string): Promise<void> {
  return del<void>(`${BASE_URL}/${id}`)
}
