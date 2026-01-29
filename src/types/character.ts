/**
 * 角色类型
 */
export type CharacterType =
  | 'protagonist'   // 主角
  | 'supporting'    // 配角
  | 'antagonist'    // 反派
  | 'other'         // 其他

/**
 * 角色标签
 */
export type CharacterTag =
  | 'heroine'       // 女主
  | 'hero'          // 男主
  | 'important'     // 重要配角
  | 'love_interest' // 感情对象
  | 'mentor'        // 导师/师父
  | 'rival'         // 对手
  | 'comic_relief'  // 搞笑担当
  | 'mysterious'    // 神秘人物

/**
 * 角色标签映射
 */
export const CHARACTER_TAG_MAP: Record<CharacterTag, string> = {
  heroine: '女主',
  hero: '男主',
  important: '重要配角',
  love_interest: '感情对象',
  mentor: '导师/师父',
  rival: '对手',
  comic_relief: '搞笑担当',
  mysterious: '神秘人物'
}

/**
 * 角色档案
 */
export interface CharacterProfile {
  gender: string
  age: string
  appearance: string          // 外貌描述
  personality: string         // 性格特点
  background: string          // 背景故事
  abilities: string           // 能力/技能
  goals: string               // 目标/动机
  extra: Record<string, string>  // 自定义字段
}

/**
 * 角色关系
 */
export interface CharacterRelationship {
  targetId: string            // 关系对象ID
  targetName: string          // 关系对象名称
  relation: string            // 关系描述（如：师父、宿敌、恋人）
  description?: string        // 详细描述
}

/**
 * 角色状态（可变状态）
 */
export interface CharacterState {
  isAlive: boolean
  location: string            // 当前位置
  powerLevel: string          // 当前实力等级
  relationships: CharacterRelationship[]
  items: string[]             // 持有物品
  lastUpdatedChapter: number  // 最后更新的章节序号
  stateHistory: CharacterStateChange[]
}

/**
 * 角色状态变更记录
 */
export interface CharacterStateChange {
  chapterId: string
  chapterOrder: number
  field: string               // 变更的字段
  oldValue: string
  newValue: string
  reason: string              // 变更原因
  timestamp: string
}

/**
 * 角色完整接口
 */
export interface Character {
  id: string
  bookId: string
  name: string
  aliases: string[]           // 别名/称呼列表
  type: CharacterType
  tags?: CharacterTag[]       // 角色标签
  profile: CharacterProfile
  state: CharacterState
  createdAt: string
  updatedAt: string
}

/**
 * 角色类型映射（用于显示）
 */
export const CHARACTER_TYPE_MAP: Record<CharacterType, string> = {
  protagonist: '主角',
  supporting: '配角',
  antagonist: '反派',
  other: '其他'
}
