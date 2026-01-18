/**
 * 世界观设定相关类型
 */

/**
 * 设定分类
 */
export type WorldSettingCategory =
  | 'power_system'    // 力量体系
  | 'item'            // 物品道具
  | 'location'        // 地点场景
  | 'organization'    // 组织势力
  | 'other'           // 其他

/**
 * 设定分类映射
 */
export const SETTING_CATEGORY_MAP: Record<WorldSettingCategory, string> = {
  power_system: '力量体系',
  item: '物品道具',
  location: '地点场景',
  organization: '组织势力',
  other: '其他'
}

/**
 * 世界观设定
 */
export interface WorldSetting {
  id: string
  bookId: string
  category: WorldSettingCategory
  name: string
  content: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

/**
 * 创建设定输入
 */
export interface CreateWorldSettingInput {
  bookId: string
  category?: WorldSettingCategory
  name: string
  content?: string
  tags?: string[]
}

/**
 * 更新设定输入
 */
export interface UpdateWorldSettingInput {
  category?: WorldSettingCategory
  name?: string
  content?: string
  tags?: string[]
}

/**
 * 设定统计
 */
export interface WorldSettingStats {
  power_system: number
  item: number
  location: number
  organization: number
  other: number
  total: number
}
