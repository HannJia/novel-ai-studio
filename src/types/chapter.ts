/**
 * 章节状态
 */
export type ChapterStatus = 'draft' | 'completed' | 'reviewing'

/**
 * 细纲步骤类型
 */
export type DetailOutlineStepType = 'scene' | 'characters' | 'conflict' | 'climax' | 'ending'

/**
 * 细纲步骤配置
 */
export const DETAIL_OUTLINE_STEPS: {
  type: DetailOutlineStepType
  label: string
  description: string
}[] = [
  { type: 'scene', label: '场景铺设', description: '设定本章的场景环境、时间地点' },
  { type: 'characters', label: '角色出场', description: '本章出场的角色及其状态' },
  { type: 'conflict', label: '冲突展开', description: '本章的核心冲突或矛盾' },
  { type: 'climax', label: '高潮推进', description: '情节的高潮部分' },
  { type: 'ending', label: '本章收尾', description: '本章的结尾和留白' },
]

/**
 * 细纲单步内容
 */
export interface DetailOutlineStep {
  type: DetailOutlineStepType
  content: string             // 该步骤的具体内容
  completed: boolean          // 是否已完成
}

/**
 * 章节细纲
 */
export interface ChapterDetailOutline {
  chapterId: string
  steps: DetailOutlineStep[]
  status: 'draft' | 'confirmed' | 'generated'  // 草稿/已确认/已生成章节
  generatedAt?: string
  confirmedAt?: string
}

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
  detailOutline?: ChapterDetailOutline  // 细纲数据
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
