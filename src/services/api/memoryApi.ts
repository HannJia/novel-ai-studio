import request from './index'
import type { ChapterSummary, StoryEvent, Foreshadow, CharacterStateChange } from '@/types/memory'

const BASE_URL = 'http://localhost:8080'

// ========== 章节摘要 API ==========

/**
 * 获取章节的摘要
 */
export function getChapterSummary(chapterId: string) {
  return request.get<ChapterSummary>(`${BASE_URL}/api/summaries/chapter/${chapterId}`)
}

/**
 * 获取书籍的所有章节摘要
 */
export function getBookSummaries(bookId: string) {
  return request.get<ChapterSummary[]>(`${BASE_URL}/api/summaries/book/${bookId}`)
}

/**
 * 获取指定章节之前的所有摘要
 */
export function getSummariesBeforeChapter(bookId: string, chapterOrder: number) {
  return request.get<ChapterSummary[]>(`${BASE_URL}/api/summaries/book/${bookId}/before/${chapterOrder}`)
}

/**
 * 获取最近N章的摘要
 */
export function getRecentSummaries(bookId: string, limit: number = 5) {
  return request.get<ChapterSummary[]>(`${BASE_URL}/api/summaries/book/${bookId}/recent?limit=${limit}`)
}

/**
 * AI生成章节摘要
 */
export function generateChapterSummary(chapterId: string) {
  return request.post<ChapterSummary>(`${BASE_URL}/api/summaries/generate/${chapterId}`)
}

/**
 * 保存/更新摘要
 */
export function saveSummary(summary: Partial<ChapterSummary>) {
  return request.post<ChapterSummary>(`${BASE_URL}/api/summaries`, summary)
}

/**
 * 更新摘要
 */
export function updateSummary(id: string, summary: Partial<ChapterSummary>) {
  return request.put<ChapterSummary>(`${BASE_URL}/api/summaries/${id}`, summary)
}

/**
 * 删除摘要
 */
export function deleteSummary(id: string) {
  return request.delete(`${BASE_URL}/api/summaries/${id}`)
}

/**
 * 构建前文摘要上下文
 */
export function buildSummaryContext(bookId: string, chapterOrder: number, maxChapters: number = 10) {
  return request.get<string>(`${BASE_URL}/api/summaries/context/${bookId}/${chapterOrder}?maxChapters=${maxChapters}`)
}

// ========== 故事事件 API ==========

/**
 * 获取书籍的所有事件
 */
export function getBookEvents(bookId: string) {
  return request.get<StoryEvent[]>(`${BASE_URL}/api/events/book/${bookId}`)
}

/**
 * 获取章节的所有事件
 */
export function getChapterEvents(chapterId: string) {
  return request.get<StoryEvent[]>(`${BASE_URL}/api/events/chapter/${chapterId}`)
}

/**
 * 获取书籍的主要事件
 */
export function getMajorEvents(bookId: string) {
  return request.get<StoryEvent[]>(`${BASE_URL}/api/events/book/${bookId}/major`)
}

/**
 * 获取涉及特定角色的事件
 */
export function getCharacterEvents(bookId: string, characterId: string) {
  return request.get<StoryEvent[]>(`${BASE_URL}/api/events/book/${bookId}/character/${characterId}`)
}

/**
 * 获取指定章节之前的所有事件
 */
export function getEventsBeforeChapter(bookId: string, chapterOrder: number) {
  return request.get<StoryEvent[]>(`${BASE_URL}/api/events/book/${bookId}/before/${chapterOrder}`)
}

/**
 * 获取事件详情
 */
export function getEvent(id: string) {
  return request.get<StoryEvent>(`${BASE_URL}/api/events/${id}`)
}

/**
 * 创建事件
 */
export function createEvent(event: Partial<StoryEvent>) {
  return request.post<StoryEvent>(`${BASE_URL}/api/events`, event)
}

/**
 * 批量创建事件
 */
export function createEvents(events: Partial<StoryEvent>[]) {
  return request.post<StoryEvent[]>(`${BASE_URL}/api/events/batch`, events)
}

/**
 * AI从章节中提取事件
 */
export function extractChapterEvents(chapterId: string) {
  return request.post<StoryEvent[]>(`${BASE_URL}/api/events/extract/${chapterId}`)
}

/**
 * 更新事件
 */
export function updateEvent(id: string, event: Partial<StoryEvent>) {
  return request.put<StoryEvent>(`${BASE_URL}/api/events/${id}`, event)
}

/**
 * 删除事件
 */
export function deleteEvent(id: string) {
  return request.delete(`${BASE_URL}/api/events/${id}`)
}

/**
 * 构建事件时间线上下文
 */
export function buildEventContext(bookId: string, chapterOrder: number) {
  return request.get<string>(`${BASE_URL}/api/events/context/${bookId}/${chapterOrder}`)
}

// ========== 角色状态变更 API ==========

/**
 * 获取角色的所有状态变更记录
 */
export function getCharacterStateChanges(characterId: string) {
  return request.get<CharacterStateChange[]>(`${BASE_URL}/api/character-states/character/${characterId}`)
}

/**
 * 获取书籍的所有状态变更记录
 */
export function getBookStateChanges(bookId: string) {
  return request.get<CharacterStateChange[]>(`${BASE_URL}/api/character-states/book/${bookId}`)
}

/**
 * 获取章节中的所有状态变更
 */
export function getChapterStateChanges(chapterId: string) {
  return request.get<CharacterStateChange[]>(`${BASE_URL}/api/character-states/chapter/${chapterId}`)
}

/**
 * 获取角色在指定章节的状态
 */
export function getCharacterStateAtChapter(characterId: string, chapterOrder: number) {
  return request.get<Record<string, string>>(`${BASE_URL}/api/character-states/character/${characterId}/at-chapter/${chapterOrder}`)
}

/**
 * 获取角色的最新状态
 */
export function getLatestCharacterState(characterId: string) {
  return request.get<Record<string, string>>(`${BASE_URL}/api/character-states/character/${characterId}/latest`)
}

/**
 * 记录状态变更
 */
export function recordStateChange(change: Partial<CharacterStateChange>) {
  return request.post<CharacterStateChange>(`${BASE_URL}/api/character-states`, change)
}

/**
 * 批量记录状态变更
 */
export function recordStateChanges(changes: Partial<CharacterStateChange>[]) {
  return request.post<CharacterStateChange[]>(`${BASE_URL}/api/character-states/batch`, changes)
}

/**
 * 获取角色状态变更历史（按章节分组）
 */
export function getCharacterStateHistory(characterId: string) {
  return request.get<Record<number, CharacterStateChange[]>>(`${BASE_URL}/api/character-states/character/${characterId}/history`)
}

// ========== 伏笔 API ==========

/**
 * 获取书籍的所有伏笔
 */
export function getBookForeshadows(bookId: string) {
  return request.get<Foreshadow[]>(`${BASE_URL}/api/foreshadows/book/${bookId}`)
}

/**
 * 按状态获取书籍的伏笔
 */
export function getForeshadowsByStatus(bookId: string, status: string) {
  return request.get<Foreshadow[]>(`${BASE_URL}/api/foreshadows/book/${bookId}/status/${status}`)
}

/**
 * 获取未回收的伏笔
 */
export function getUnresolvedForeshadows(bookId: string) {
  return request.get<Foreshadow[]>(`${BASE_URL}/api/foreshadows/book/${bookId}/unresolved`)
}

/**
 * 获取重要的未回收伏笔
 */
export function getMajorUnresolvedForeshadows(bookId: string) {
  return request.get<Foreshadow[]>(`${BASE_URL}/api/foreshadows/book/${bookId}/major-unresolved`)
}

/**
 * 获取章节中埋设的伏笔
 */
export function getChapterForeshadows(chapterId: string) {
  return request.get<Foreshadow[]>(`${BASE_URL}/api/foreshadows/chapter/${chapterId}`)
}

/**
 * 获取与角色相关的伏笔
 */
export function getCharacterForeshadows(bookId: string, characterId: string) {
  return request.get<Foreshadow[]>(`${BASE_URL}/api/foreshadows/book/${bookId}/character/${characterId}`)
}

/**
 * 获取伏笔详情
 */
export function getForeshadow(id: string) {
  return request.get<Foreshadow>(`${BASE_URL}/api/foreshadows/${id}`)
}

/**
 * 创建伏笔
 */
export function createForeshadow(foreshadow: Partial<Foreshadow>) {
  return request.post<Foreshadow>(`${BASE_URL}/api/foreshadows`, foreshadow)
}

/**
 * 更新伏笔
 */
export function updateForeshadow(id: string, foreshadow: Partial<Foreshadow>) {
  return request.put<Foreshadow>(`${BASE_URL}/api/foreshadows/${id}`, foreshadow)
}

/**
 * 更新伏笔状态
 */
export function updateForeshadowStatus(id: string, status: string, notes?: string) {
  const params = new URLSearchParams({ status })
  if (notes) params.append('notes', notes)
  return request.put<Foreshadow>(`${BASE_URL}/api/foreshadows/${id}/status?${params}`)
}

/**
 * 添加回收章节
 */
export function addResolutionChapter(id: string, chapterOrder: number) {
  return request.post<Foreshadow>(`${BASE_URL}/api/foreshadows/${id}/resolution-chapter?chapterOrder=${chapterOrder}`)
}

/**
 * 标记为完全回收
 */
export function resolveForeshadow(id: string, notes?: string) {
  const params = notes ? `?notes=${encodeURIComponent(notes)}` : ''
  return request.post<Foreshadow>(`${BASE_URL}/api/foreshadows/${id}/resolve${params}`)
}

/**
 * 标记为废弃
 */
export function abandonForeshadow(id: string, reason?: string) {
  const params = reason ? `?reason=${encodeURIComponent(reason)}` : ''
  return request.post<Foreshadow>(`${BASE_URL}/api/foreshadows/${id}/abandon${params}`)
}

/**
 * 删除伏笔
 */
export function deleteForeshadow(id: string) {
  return request.delete(`${BASE_URL}/api/foreshadows/${id}`)
}

/**
 * 统计各状态的伏笔数量
 */
export function getForeshadowStats(bookId: string) {
  return request.get<Record<string, number>>(`${BASE_URL}/api/foreshadows/book/${bookId}/stats`)
}

/**
 * 获取需要提醒的伏笔
 */
export function getForeshadowReminders(bookId: string, currentChapter: number, minChaptersAgo: number = 5) {
  return request.get<Foreshadow[]>(`${BASE_URL}/api/foreshadows/book/${bookId}/reminders?currentChapter=${currentChapter}&minChaptersAgo=${minChaptersAgo}`)
}

/**
 * 构建伏笔提醒上下文
 */
export function buildForeshadowContext(bookId: string, chapterOrder: number) {
  return request.get<string>(`${BASE_URL}/api/foreshadows/context/${bookId}/${chapterOrder}`)
}

// ========== 记忆提取 API ==========

export interface MemoryExtractionResult {
  success: boolean
  message: string
  summary?: ChapterSummary
  events?: StoryEvent[]
  stateChanges?: CharacterStateChange[]
}

/**
 * 为章节提取记忆（同步）
 */
export function extractChapterMemory(chapterId: string) {
  return request.post<MemoryExtractionResult>(`${BASE_URL}/api/memory/extract/chapter/${chapterId}`)
}

/**
 * 为章节提取记忆（异步）
 */
export function extractChapterMemoryAsync(chapterId: string) {
  return request.post(`${BASE_URL}/api/memory/extract/chapter/${chapterId}/async`)
}

/**
 * 为书籍所有章节提取记忆（异步）
 */
export function extractBookMemory(bookId: string) {
  return request.post(`${BASE_URL}/api/memory/extract/book/${bookId}`)
}
