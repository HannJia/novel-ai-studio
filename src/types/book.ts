/**
 * 书籍类型枚举
 */
export type BookGenre =
  | 'xuanhuan'    // 玄幻
  | 'xiuzhen'     // 修真
  | 'dushi'       // 都市
  | 'kehuan'      // 科幻
  | 'lishi'       // 历史
  | 'yanqing'     // 言情
  | 'xuanyi'      // 悬疑
  | 'qita'        // 其他

/**
 * 书籍风格枚举
 */
export type BookStyle =
  | 'qingsong'    // 轻松
  | 'yansu'       // 严肃
  | 'rexue'       // 热血
  | 'nuexin'      // 虐心
  | 'huaji'       // 搞笑
  | 'heian'       // 黑暗

/**
 * 书籍状态
 */
export type BookStatus = 'writing' | 'paused' | 'completed'

/**
 * 分卷大纲章节
 */
export interface VolumeOutlineChapter {
  id: string
  title: string
  chapterId?: string
}

/**
 * 分卷大纲
 */
export interface VolumeOutline {
  id: string
  title: string
  summary?: string
  chapters: VolumeOutlineChapter[]
}

/**
 * 书籍接口
 */
export interface Book {
  id: string
  title: string
  author: string
  genre: BookGenre
  style: BookStyle
  description: string
  outline?: string              // 全书大纲
  volumes?: VolumeOutline[]     // 分卷大纲
  coverImage?: string
  status: BookStatus
  wordCount: number           // 不含标点的总字数
  chapterCount: number
  createdAt: string           // ISO日期字符串
  updatedAt: string
}

/**
 * 创建书籍的输入
 */
export interface CreateBookInput {
  title: string
  author?: string
  genre: BookGenre
  style: BookStyle
  description?: string
  coverImage?: string
}

/**
 * 更新书籍的输入
 */
export interface UpdateBookInput {
  title?: string
  author?: string
  genre?: BookGenre
  style?: BookStyle
  description?: string
  outline?: string
  volumes?: VolumeOutline[]  // 分卷大纲
  status?: BookStatus
  coverImage?: string
}

/**
 * 卷接口
 */
export interface Volume {
  id: string
  bookId: string
  title: string
  order: number
  chapterCount: number
  wordCount: number
  createdAt: string
  updatedAt: string
}

/**
 * 书籍类型映射（用于显示）
 */
export const BOOK_GENRE_MAP: Record<BookGenre, string> = {
  xuanhuan: '玄幻',
  xiuzhen: '修真',
  dushi: '都市',
  kehuan: '科幻',
  lishi: '历史',
  yanqing: '言情',
  xuanyi: '悬疑',
  qita: '其他'
}

/**
 * 书籍风格映射（用于显示）
 */
export const BOOK_STYLE_MAP: Record<BookStyle, string> = {
  qingsong: '轻松',
  yansu: '严肃',
  rexue: '热血',
  nuexin: '虐心',
  huaji: '搞笑',
  heian: '黑暗'
}

/**
 * 书籍状态映射（用于显示）
 */
export const BOOK_STATUS_MAP: Record<BookStatus, string> = {
  writing: '连载中',
  paused: '暂停',
  completed: '已完结'
}

/**
 * AI 初始化小说输入
 */
export interface NovelInitInput {
  title: string
  genre: BookGenre
  style: BookStyle
  author?: string
  protagonist?: string      // 主角简要设定
  worldKeywords?: string    // 世界观关键词
  coreConflict?: string     // 核心冲突
  configId?: string         // AI配置ID
}

/**
 * AI 生成的角色信息
 */
export interface GeneratedCharacter {
  name: string
  role: 'protagonist' | 'supporting' | 'antagonist'  // 主角/配角/反派
  description: string
}

/**
 * AI 初始化小说结果
 */
export interface NovelInitResult {
  description: string           // 生成的简介
  outline: string               // 生成的大纲
  characters: GeneratedCharacter[]  // 生成的角色
}

/**
 * AI 修改小说请求
 */
export interface NovelRefineInput {
  currentContent: NovelInitResult
  userRequest: string           // 用户修改要求
  configId?: string
}

/**
 * 创建书籍的完整输入（含AI生成内容）
 */
export interface CreateBookWithAIInput {
  title: string
  author?: string
  genre: BookGenre
  style: BookStyle
  description: string
  outline: string
}
