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
 * 书籍接口
 */
export interface Book {
  id: string
  title: string
  author: string
  genre: BookGenre
  style: BookStyle
  description: string
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
