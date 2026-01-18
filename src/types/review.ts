/**
 * 审查问题级别
 */
export type ReviewLevel = 'error' | 'warning' | 'suggestion' | 'info'

/**
 * 审查问题类型
 */
export type ReviewIssueType =
  // Level A: 确定性错误
  | 'character_death_conflict'    // 角色生死冲突
  | 'name_inconsistency'          // 称呼不一致
  | 'timeline_conflict'           // 时间线冲突
  | 'power_level_conflict'        // 实力等级冲突
  | 'location_conflict'           // 地理位置冲突
  // Level B: 高可信警告
  | 'personality_deviation'       // 性格偏离
  | 'ability_exceeded'            // 能力超限
  | 'setting_conflict'            // 设定冲突
  | 'item_anomaly'                // 物品异常
  // Level C: 建议
  | 'causality_doubt'             // 因果关系存疑
  | 'pacing_issue'                // 节奏问题
  | 'emotion_abrupt'              // 情感突兀
  | 'foreshadow_forgotten'        // 伏笔遗忘
  // Level D: 提示
  | 'viewpoint_drift'             // 视角漂移
  | 'style_inconsistency'         // 文风不一致

/**
 * 审查问题状态
 */
export type ReviewIssueStatus = 'open' | 'fixed' | 'ignored'

/**
 * 审查问题位置信息
 */
export interface ReviewIssueLocation {
  paragraph?: number
  startOffset?: number
  endOffset?: number
  originalText?: string
  characterName?: string
}

/**
 * 审查问题参考信息
 */
export interface ReviewIssueReference {
  chapterId?: string
  chapterOrder?: number
  text?: string
  deathChapter?: number
  expectedResolve?: string
}

/**
 * 审查问题
 */
export interface ReviewIssue {
  id: string
  bookId: string
  chapterId: string
  chapterOrder: number
  level: ReviewLevel
  type: ReviewIssueType
  title: string
  description: string
  location?: ReviewIssueLocation
  suggestion?: string
  reference?: ReviewIssueReference
  confidence?: number
  status: ReviewIssueStatus
  createdAt: string
  updatedAt: string
}

/**
 * 审查报告
 */
export interface ReviewReport {
  id: string
  bookId: string
  chapterIds: string[]
  totalIssues: number
  issuesByLevel: Record<ReviewLevel, number>
  issuesByType: Record<string, number>
  issues: ReviewIssue[]
  startTime: string
  endTime: string
  duration: number
  reviewMode: 'single' | 'batch' | 'full'
  rulesExecuted: number
}

/**
 * 审查规则信息
 */
export interface ReviewRuleInfo {
  name: string
  description: string
  level: ReviewLevel
  type: ReviewIssueType
  requiresAI: boolean
  enabled: boolean
  priority: number
}

/**
 * 审查统计
 */
export interface ReviewStats {
  total: number
  byLevel: Record<ReviewLevel, number>
  byType: Record<string, number>
  error: number
  warning: number
  suggestion: number
  info: number
}

/**
 * 级别显示配置
 */
export const REVIEW_LEVEL_CONFIG: Record<ReviewLevel, {
  label: string
  color: string
  icon: string
  tagType: 'danger' | 'warning' | 'info' | 'success'
}> = {
  error: {
    label: '错误',
    color: '#f56c6c',
    icon: 'CircleCloseFilled',
    tagType: 'danger'
  },
  warning: {
    label: '警告',
    color: '#e6a23c',
    icon: 'WarningFilled',
    tagType: 'warning'
  },
  suggestion: {
    label: '建议',
    color: '#409eff',
    icon: 'InfoFilled',
    tagType: 'info'
  },
  info: {
    label: '提示',
    color: '#909399',
    icon: 'QuestionFilled',
    tagType: 'success'
  }
}

/**
 * 问题类型显示名称
 */
export const REVIEW_TYPE_LABELS: Record<ReviewIssueType, string> = {
  // Level A
  character_death_conflict: '角色生死冲突',
  name_inconsistency: '称呼不一致',
  timeline_conflict: '时间线冲突',
  power_level_conflict: '实力等级冲突',
  location_conflict: '地理位置冲突',
  // Level B
  personality_deviation: '性格偏离',
  ability_exceeded: '能力超限',
  setting_conflict: '设定冲突',
  item_anomaly: '物品异常',
  // Level C
  causality_doubt: '因果关系存疑',
  pacing_issue: '节奏问题',
  emotion_abrupt: '情感突兀',
  foreshadow_forgotten: '伏笔遗忘',
  // Level D
  viewpoint_drift: '视角漂移',
  style_inconsistency: '文风不一致'
}
