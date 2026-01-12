/**
 * 章节状态
 */
export type ChapterStatus = 'draft' | 'completed' | 'reviewing'

/**
 * 章节接口
 */
export interface Chapter {
  id: string
  bookId: string
  volumeId: string | null
  title: string
  content: string
  outline: string             // 章节大纲
  summary?: string            // AI生成的摘要（记忆系统用）
  wordCount: number           // 不含标点
  order: number
  status: ChapterStatus
  createdAt: string
  updatedAt: string
}

/**
 * 创建章节输入
 */
export interface CreateChapterInput {
  bookId: string
  volumeId?: string
  title: string
  content?: string
  outline?: string
  order?: number
}

/**
 * 更新章节输入
 */
export interface UpdateChapterInput {
  title?: string
  content?: string
  outline?: string
  summary?: string
  status?: ChapterStatus
}

/**
 * 章节树节点（用于侧边栏展示）
 */
export interface ChapterTreeNode {
  id: string
  title: string
  type: 'volume' | 'chapter'
  order: number
  wordCount: number
  status?: ChapterStatus
  children?: ChapterTreeNode[]
}

/**
 * 章节状态映射（用于显示）
 */
export const CHAPTER_STATUS_MAP: Record<ChapterStatus, string> = {
  draft: '草稿',
  completed: '已完成',
  reviewing: '审查中'
}
