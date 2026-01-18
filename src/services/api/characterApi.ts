/**
 * 角色API服务
 */
import { get, post, put, del } from './index'
import type { Character, CharacterProfile, CharacterState, PaginatedResult } from '@/types'

const BASE_URL = '/characters'

/**
 * 创建角色输入
 */
export interface CreateCharacterInput {
  bookId: string
  name: string
  aliases?: string[]
  type?: 'protagonist' | 'supporting' | 'antagonist' | 'other'
  profile?: Partial<CharacterProfile>
  state?: Partial<CharacterState>
}

/**
 * 更新角色输入
 */
export interface UpdateCharacterInput {
  name?: string
  aliases?: string[]
  type?: 'protagonist' | 'supporting' | 'antagonist' | 'other'
  profile?: Partial<CharacterProfile>
  state?: Partial<CharacterState>
}

/**
 * 角色统计
 */
export interface CharacterStats {
  protagonist: number
  supporting: number
  antagonist: number
  other: number
  total: number
}

/**
 * 获取书籍的所有角色
 */
export async function getCharactersByBook(bookId: string): Promise<Character[]> {
  return get<Character[]>(`${BASE_URL}/book/${bookId}`)
}

/**
 * 按类型获取书籍角色
 */
export async function getCharactersByType(
  bookId: string,
  type: string
): Promise<Character[]> {
  return get<Character[]>(`${BASE_URL}/book/${bookId}/type/${type}`)
}

/**
 * 分页获取书籍角色
 */
export async function getCharactersPage(
  bookId: string,
  page: number = 1,
  pageSize: number = 10,
  type?: string
): Promise<PaginatedResult<Character>> {
  const params: Record<string, unknown> = { page, pageSize }
  if (type) params.type = type
  return get<PaginatedResult<Character>>(`${BASE_URL}/book/${bookId}/page`, params)
}

/**
 * 获取角色详情
 */
export async function getCharacter(id: string): Promise<Character> {
  return get<Character>(`${BASE_URL}/${id}`)
}

/**
 * 创建角色
 */
export async function createCharacter(input: CreateCharacterInput): Promise<Character> {
  return post<Character>(BASE_URL, input)
}

/**
 * 更新角色
 */
export async function updateCharacter(id: string, input: UpdateCharacterInput): Promise<Character> {
  return put<Character>(`${BASE_URL}/${id}`, input)
}

/**
 * 更新角色档案
 */
export async function updateCharacterProfile(
  id: string,
  profile: Partial<CharacterProfile>
): Promise<Character> {
  return put<Character>(`${BASE_URL}/${id}/profile`, profile)
}

/**
 * 更新角色状态
 */
export async function updateCharacterState(
  id: string,
  state: Partial<CharacterState>
): Promise<Character> {
  return put<Character>(`${BASE_URL}/${id}/state`, state)
}

/**
 * 添加角色别名
 */
export async function addCharacterAlias(id: string, alias: string): Promise<Character> {
  return post<Character>(`${BASE_URL}/${id}/alias`, { alias })
}

/**
 * 移除角色别名
 */
export async function removeCharacterAlias(id: string, alias: string): Promise<Character> {
  return del<Character>(`${BASE_URL}/${id}/alias/${encodeURIComponent(alias)}`)
}

/**
 * 删除角色
 */
export async function deleteCharacter(id: string): Promise<void> {
  return del<void>(`${BASE_URL}/${id}`)
}

/**
 * 搜索角色
 */
export async function searchCharacters(bookId: string, keyword: string): Promise<Character[]> {
  return get<Character[]>(`${BASE_URL}/book/${bookId}/search`, { keyword })
}

/**
 * 获取角色统计
 */
export async function getCharacterStats(bookId: string): Promise<CharacterStats> {
  return get<CharacterStats>(`${BASE_URL}/book/${bookId}/stats`)
}
