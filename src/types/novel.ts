import type { ChatSearchRecord } from './chat'

// 小说分类类型
export interface Genre {
  label: string
  value: string
  children: SubGenre[]
}

interface SubGenre {
  label: string
  value: string
}

// 角色数据类型
export interface Character {
  id: string
  name: string              // 姓名
  aliases: string[]         // 别称/外号
  identity: string          // 身份
  personality: string       // 性格
  powerLevel: string        // 实力等级
  faction: string           // 阵营/势力
  status: '活跃' | '退场' | '死亡' | '失踪'
  firstAppearChapter: number // 首次出场章节
  description: string       // 详细描述
  relationships: CharacterRelation[]
  events: string[]          // 关键事件
  avatarColor: string       // 头像卡片颜色
}

interface CharacterRelation {
  targetId: string          // 关联角色 ID
  targetName: string        // 关联角色名
  relation: string          // 关系描述
}

// 事件记录类型
export interface EventLogEntry {
  id: string
  chapterIndex: number      // 发生章节
  title: string             // 事件标题
  description: string       // 事件描述
  characters: string[]      // 相关角色
  type: '主线' | '支线' | '伏笔' | '转折' | '战斗' | '其他'
  scope?: 'global' | 'volume' | 'chapter' // 事件追踪范围
  status?: 'planted' | 'developing' | 'resolved' | 'abandoned' // 进度状态
  hintCount?: number        // 已铺垫/提及次数
  storyTime?: string        // 故事内时间，如“玄历三年春”
  location?: string         // 事件发生地点
  targetChapter?: number    // 预计推进/回收章节（从 0 开始）
  importance?: 1 | 2 | 3 | 4 | 5
  source?: 'user' | 'ai'
  updatedAt?: string
  timestamp: string
}

export type StoryArcType = 'main' | 'sub' | 'character' | 'relationship' | 'mystery' | 'world'
export type StoryArcStatus = 'active' | 'paused' | 'completed' | 'abandoned'

export interface StoryArcNode {
  id: string
  title: string
  description: string
  targetChapter: number     // 预计发生章节（从 0 开始）
  actualChapter?: number    // 实际发生章节（从 0 开始）
  status: 'pending' | 'completed' | 'abandoned'
  createdAt: string
  updatedAt: string
}

export interface StoryArc {
  id: string
  title: string
  description: string
  type: StoryArcType
  importance: 1 | 2 | 3 | 4 | 5
  status: StoryArcStatus
  reactivateAt: string
  characterIds: string[]
  nodes: StoryArcNode[]
  createdAt: string
  updatedAt: string
}

export type ChapterPlanHorizon = 'next' | 'near' | 'far'
export type ChapterPlanStatus = 'planned' | 'active' | 'completed' | 'archived'

export interface ChapterPlan {
  id: string
  horizon: ChapterPlanHorizon
  title: string
  objective: string
  summary: string
  beats: string[]
  targetChapterStart: number // 从 0 开始
  targetChapterEnd: number   // 从 0 开始
  relatedArcIds: string[]
  relatedEventIds: string[]
  status: ChapterPlanStatus
  source: 'user' | 'ai'
  versions?: PlanningVersion[]
  createdAt: string
  updatedAt: string
}

export type StoryStateTargetType = 'story_arc' | 'arc_node' | 'event' | 'chapter_plan'
export type StoryStateProposalField = 'status' | 'targetChapter'

export interface StoryStateProposal {
  id: string
  targetType: StoryStateTargetType
  targetId: string
  parentId?: string
  targetTitle: string
  field: StoryStateProposalField
  oldValue: string
  newValue: string
  reason: string
  evidence: string
  chapterIndex: number
  status: 'pending' | 'accepted' | 'rejected'
  source: 'ai' | 'user'
  createdAt: string
  updatedAt: string
}

// 数据面板字段类型
export type DataPanelFieldType = 'text' | 'number' | 'percent' | 'days' | 'countdown' | 'formula'

type DataPanelAutomationTrigger = 'per_chapter' | 'on_mention' | 'elapsed_days'

export interface DataPanelAutomationRule {
  id: string
  trigger: DataPanelAutomationTrigger
  amount: number
  interval: number
  schedule?: number[]
  sourceFieldName?: string
  enabled: boolean
  lastEvaluatedChapterIndex?: number
  lastSourceValue?: number
  appliedCount?: number
  pendingChapterIndex?: number
}

export interface StoryClock {
  currentDay: number
  label: string
  lastChapterIndex?: number
  updatedAt: string
}

export interface DataPanelField {
  id: string
  name: string
  value: string
  unit: string
  note: string
  type?: DataPanelFieldType
  formula?: string
  autoCalculate?: boolean
  modifier?: { attribute: string; operation: 'flat' | 'percent' }
  calculationError?: string // 无效公式保留原值，但必须显示错误，不能冒充已计算
  automationRules?: DataPanelAutomationRule[]
}

export type DataPanelCategory = '角色' | '作物' | '资源' | '建筑' | '任务' | '装备' | '道具' | '自定义'
export type EquipmentState = 'stored' | 'equipped' | 'consumed' | 'lost'

// 数据面板对象
export interface DataPanelItem {
  id: string
  category: DataPanelCategory
  name: string
  fields: DataPanelField[]
  relatedKeywords: string[]
  ownerItemId?: string // 装备/道具明确归属的角色或其他数据对象
  equipmentState?: EquipmentState
  lastMentionChapterIndex?: number
  versions?: DataPanelVersion[]
  createdAt: string
  updatedAt: string
}

export interface DataPanelVersion {
  id: string
  label: string
  savedAt: string
  snapshot: string
}

// 数据面板变更建议
export interface DataPanelItemDraft {
  name: string
  category: DataPanelCategory
  fields: DataPanelField[]
  relatedKeywords: string[]
  ownerItemName?: string
  equipmentState?: EquipmentState
}

export type DataPanelMutation =
  | { kind: 'create'; item: DataPanelItemDraft }
  | { kind: 'equipment'; ownerItemName: string; state: EquipmentState }
  | { kind: 'field'; field: DataPanelField }

export interface DataPanelChange {
  id: string
  itemId: string
  fieldId: string
  itemName: string
  fieldName: string
  oldValue: string
  newValue: string
  reason: string
  confidence?: 'clear' | 'possible' | 'none'
  mutation?: DataPanelMutation
  chapterIndex: number
  status: 'pending' | 'accepted' | 'rejected'
  createdAt: string
}

// AI 对话消息类型
export interface DialogueMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  search?: ChatSearchRecord
  failed?: boolean
}

// 写作风格类型
export interface WritingStyle {
  narrativePov: string        // 叙事视角
  toneStyle: string           // 文风基调
  descriptionDensity: string  // 描写密度
  dialogueStyle: string       // 对话风格
  combatStyle: string         // 战斗描写
  pacingControl: string       // 节奏控制
  emotionExpression: string   // 情感表达
}

// 配角设定
interface SupportingCharacter {
  name: string
  relationship: string  // 与主角关系
  personality: string   // 性格
  role: string          // 作用（推动剧情/搞笑/对手等）
}

// 核心设定类型
export interface NovelSettings {
  // 主角设定
  protagonist: {
    name: string
    gender: string
    age: string
    background: string       // 身份背景
    personality: string[]    // 性格标签（多选）
    initialPower: string     // 初始实力
    cheatDescription: string // 金手指/外挂描述
    romanceTendency: string  // 感情线倾向
  }
  // 配角设定
  supportingCharacters: SupportingCharacter[]
  // 世界观设定
  worldBuilding: {
    worldType: string        // 世界类型
    worldScale: string       // 世界规模
    socialStructure: string  // 社会结构
    techLevel: string        // 科技水平
    specialRules: string     // 特殊规则
  }
  // 力量体系
  powerSystem: {
    systemName: string       // 体系名称
    levelHierarchy: string   // 等级划分
    combatStyleDesc: string  // 战斗风格描述
    auxiliarySystems: string // 辅助系统（炼丹/炼器/阵法）
  }
  // 核心冲突
  coreConflict: {
    mainConflict: string     // 主线矛盾
    mainVillain: string      // 主要反派设定
    factionConflicts: string // 势力对立关系
    coreSuspense: string     // 核心悬念
  }
  // 感情线
  romance: {
    romanceType: string      // 感情类型
    developmentPace: string  // 感情发展节奏
    toneChanges: string      // 感情基调变化
    emotionalConflict: string // 情感核心冲突
  }
  // 爽点设计
  payoff: {
    faceSlapFrequency: string // 打脸频率
    levelUpPace: string       // 升级节奏
    patterns: string[]        // 爽点模式（多选）
  }
  // 结构设计
  structure: {
    foreshadowingDensity: string // 伏笔密度：低/中/高/烧脑
  }
  // 其他设定
  otherSettings: string
}

// 分卷数据类型
export interface Volume {
  id: string
  volumeIndex: number        // 卷序号
  title: string              // 卷名
  theme: string              // 主题
  summary: string            // 剧情概要
  keyTurningPoints: string   // 关键转折点
  characterChanges: string   // 角色变化
  estimatedChapters: number  // 预估章节数
  estimatedWordCount: number // 预估字数（万字）
  versions?: PlanningVersion[]
}

export interface PlanningVersion {
  id: string
  label: string
  savedAt: string
  snapshot: string
}

// 章节数据类型
export interface Chapter {
  id: string
  volumeIndex: number     // 所属卷序号
  chapterIndex: number    // 章节序号（全局）
  title: string           // 章节名（AI 生成或用户编辑）
  content: string         // 正文内容
  summary: string         // 章节总结（AI 生成）
  bannedReview?: string   // 违禁词审查结果
  contentReview?: string  // 内容一致性审查结果
  contentReviewSignature?: string // 内容审查对应的正文签名
  reviewRewriteBlockedSignature?: string // 该版正文自动重写已用尽，避免重复循环
  wordCount: number       // 正文字数
  storyDaysElapsed?: number // 本章明确经过的故事天数
  storyDay?: number         // 本章完成后对应的故事日
  status: 'draft' | 'writing' | 'completed' | 'reviewed' | 'finalized' | 'locked'
  sceneNotes?: SceneNote[]
  versions?: ChapterVersion[]
  createdAt: string
  updatedAt: string
}

export interface SceneNote {
  id: string
  title: string
  content: string
  source: 'user' | 'ai'
  createdAt: string
  updatedAt: string
}

export interface ChapterVersion {
  id: string
  label: string
  savedAt: string
  snapshot: string
}

export type ChapterRevisionSource = 'ai' | 'user' | 'review'
export type ChapterRevisionStatus = 'pending' | 'accepted' | 'rejected' | 'stale'

export interface ChapterRevision {
  id: string
  novelId: string
  chapterId: string
  baseContent: string
  proposedContent: string
  diff: string
  source: ChapterRevisionSource
  reason: string
  status: ChapterRevisionStatus
  createdAt: string
  updatedAt: string
  appliedAt?: string
}

// 小说数据类型
export interface Novel {
  id: string
  title: string
  genre: string           // 大类 value
  subGenre: string        // 子类 value
  genreLabel: string      // 大类显示名
  subGenreLabel: string   // 子类显示名
  tags: string[]          // 题材标签
  targetWordCountMin: number  // 目标字数下限（万字）
  targetWordCountMax: number  // 目标字数上限（万字）
  currentWordCount: number    // 当前字数
  writingStyle: WritingStyle
  writingMode?: 'manual' | 'ai'
  settings: NovelSettings
  outline: string           // 总大纲内容（Markdown）
  synopsis: string          // 小说简介
  volumes: Volume[]         // 分卷列表
  chapters: Chapter[]       // 章节列表
  characters: Character[]   // 角色库
  chatHistory: DialogueMessage[] // 书内助手对话，不含创建前的灵感讨论
  inspirationHistory?: DialogueMessage[] // 创建时确认保留的灵感存档，不受助手历史上限影响
  chatWebSearchEnabled?: boolean // 默认关闭，按书记忆对话联网选择
  storyClock?: StoryClock  // 故事内时间轴，用于驱动数据面板自动计算
  knowledgeBaseIds: string[]  // 绑定的知识库 ID 列表
  eventLog: EventLogEntry[]   // 事件表（自动+手动）
  storyArcs?: StoryArc[]      // 跨章节叙事弧线
  chapterPlans?: ChapterPlan[] // next / near / far 三层章节计划
  chapterPlanConfirmed?: boolean // 已确认分卷并生成过章节计划
  storyStateProposals?: StoryStateProposal[] // 章节完成后的可审查状态变更
  dataPanels: DataPanelItem[]  // 数据面板
  dataPanelChanges: DataPanelChange[] // 数据变更建议
  status: 'creating' | 'writing' | 'archived' | 'trash' | 'completed'
  createdAt: string       // ISO 日期字符串
  updatedAt: string       // ISO 日期字符串
}

// 创建向导表单数据
export interface CreateWizardForm {
  writingMode?: 'manual' | 'ai'
  knowledgeEnabled?: boolean
  knowledgeBaseIds?: string[]
  // 第一页
  genre: string
  subGenre: string
  tags: string[]
  targetWordCountMin: number
  targetWordCountMax: number
  writingStyle: WritingStyle
  // 第二页
  settings: NovelSettings
}
