/**
 * 分页参数
 */
export interface PaginationParams {
  page: number
  pageSize: number
}

/**
 * 分页结果
 */
export interface PaginatedResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

/**
 * 操作结果
 */
export interface Result<T = void> {
  success: boolean
  data?: T
  error?: string
}

/**
 * 树形节点
 */
export interface TreeNode<T = unknown> {
  id: string
  label: string
  data?: T
  children?: TreeNode<T>[]
}

/**
 * 排序参数
 */
export interface SortParams {
  field: string
  order: 'asc' | 'desc'
}

/**
 * 时间范围
 */
export interface TimeRange {
  start: string
  end: string
}

/**
 * API响应
 */
export interface ApiResponse<T = unknown> {
  code: number
  message: string
  data: T
}

/**
 * 列表API响应
 */
export interface ListResponse<T> {
  code: number
  message: string
  data: {
    list: T[]
    total: number
    page: number
    pageSize: number
  }
}
