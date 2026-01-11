/**
 * 章节摘要（L2短期记忆）
 */
export interface ChapterSummary {
  chapterId: string
  chapterOrder: number
  summary: string             // 摘要正文（500-1000字）
  keyEvents: string[]         // 关键事件列表
  charactersAppeared: string[]// 出场角色ID列表
  emotionalTone: string       // 情感基调
  createdAt: string
  updatedAt: string
}

/**
 * 故事事件（L3长期记忆）
 */
export interface StoryEvent {
  id: string
  bookId: string
  chapterId: string
  chapterOrder: number
  title: string
  description: string
  eventType: 'major' | 'minor' | 'background'
  involvedCharacters: string[]
  location: string
  timelineOrder: number       // 故事内时间顺序
  impact: string              // 事件影响
  createdAt: string
}

/**
 * 伏笔类型
 */
export type ForeshadowType =
  | 'prophecy'     // 预言
  | 'item'         // 物品
  | 'character'    // 角色相关
  | 'event'        // 事件
  | 'hint'         // 暗示

/**
 * 伏笔重要性
 */
export type ForeshadowImportance = 'major' | 'minor' | 'subtle'

/**
 * 伏笔状态
 */
export type ForeshadowStatus =
  | 'planted'      // 已埋设
  | 'partial'      // 部分回收
  | 'resolved'     // 已回收
  | 'abandoned'    // 已废弃

/**
 * 伏笔
 */
export interface Foreshadow {
  id: string
  bookId: string
  title: string
  type: ForeshadowType
  importance: ForeshadowImportance
  status: ForeshadowStatus
  plantedChapter: number
  plantedChapterId: string
  plantedText: string         // 埋设伏笔的原文
  expectedResolve?: string    // 预期回收点描述
  relatedCharacters: string[] // 相关角色ID
  resolutionChapters: number[]// 回收章节序号
  resolutionNotes?: string    // 回收说明
  source: 'manual' | 'ai_detected'
  confidence?: number         // AI识别的置信度
  createdAt: string
  updatedAt: string
}

/**
 * 伏笔类型映射
 */
export const FORESHADOW_TYPE_MAP: Record<ForeshadowType, string> = {
  prophecy: '预言',
  item: '物品',
  character: '角色相关',
  event: '事件',
  hint: '暗示'
}

/**
 * 伏笔重要性映射
 */
export const FORESHADOW_IMPORTANCE_MAP: Record<ForeshadowImportance, string> = {
  major: '主要',
  minor: '次要',
  subtle: '微妙'
}

/**
 * 伏笔状态映射
 */
export const FORESHADOW_STATUS_MAP: Record<ForeshadowStatus, string> = {
  planted: '已埋设',
  partial: '部分回收',
  resolved: '已回收',
  abandoned: '已废弃'
}
