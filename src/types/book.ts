/**
 * 书籍类型枚举（主分类）
 */
export type BookGenre =
  | 'xuanhuan'    // 玄幻
  | 'xiuzhen'     // 修真
  | 'dushi'       // 都市
  | 'kehuan'      // 科幻
  | 'lishi'       // 历史
  | 'yanqing'     // 言情
  | 'xuanyi'      // 悬疑
  | 'kongbu'      // 恐怖
  | 'qihuan'      // 奇幻
  | 'xianxia'     // 仙侠
  | 'wuxia'       // 武侠
  | 'youxi'       // 游戏
  | 'tiyu'        // 体育
  | 'junshi'      // 军事
  | 'qita'        // 其他

/**
 * 书籍子类型枚举
 */
export type BookSubGenre =
  // 玄幻子类
  | 'xuanhuan_dongfang'     // 东方玄幻
  | 'xuanhuan_yishi'        // 异世大陆
  | 'xuanhuan_gaowu'        // 高武世界
  | 'xuanhuan_wangjia'      // 王朝争霸
  // 修真子类
  | 'xiuzhen_xiandao'       // 仙道修真
  | 'xiuzhen_modao'         // 魔道修真
  | 'xiuzhen_hongchen'      // 红尘修真
  | 'xiuzhen_xiuxian'       // 凡人修仙
  // 都市子类
  | 'dushi_yineng'          // 都市异能
  | 'dushi_zhichang'        // 职场商战
  | 'dushi_shenghuo'        // 都市生活
  | 'dushi_chongsheng'      // 都市重生
  | 'dushi_yixian'          // 娱乐明星
  // 科幻子类
  | 'kehuan_xingji'         // 星际文明
  | 'kehuan_mori'           // 末日危机
  | 'kehuan_chaoji'         // 超级科技
  | 'kehuan_shikong'        // 时空穿梭
  | 'kehuan_jinhua'         // 进化变异
  // 历史子类
  | 'lishi_jiagong'         // 架空历史
  | 'lishi_qinhan'          // 秦汉三国
  | 'lishi_suitang'         // 隋唐五代
  | 'lishi_mingqing'        // 明清历史
  | 'lishi_minguo'          // 民国往事
  // 言情子类
  | 'yanqing_xiandai'       // 现代言情
  | 'yanqing_guzhuang'      // 古装言情
  | 'yanqing_chuanyue'      // 穿越言情
  | 'yanqing_chongsheng'    // 重生言情
  | 'yanqing_haomentianwen' // 豪门甜文
  // 悬疑子类
  | 'xuanyi_zhentan'        // 侦探推理
  | 'xuanyi_miansha'        // 密室逃脱
  | 'xuanyi_guiling'        // 诡秘悬疑
  | 'xuanyi_fanzui'         // 犯罪心理
  // 恐怖子类
  | 'kongbu_lingyi'         // 灵异鬼怪
  | 'kongbu_shenghua'       // 丧尸生化
  | 'kongbu_xinli'          // 心理恐怖
  | 'kongbu_kelusu'         // 克苏鲁
  // 奇幻子类
  | 'qihuan_xifang'         // 西方奇幻
  | 'qihuan_heian'          // 黑暗奇幻
  | 'qihuan_shishi'         // 史诗奇幻
  | 'qihuan_longyu'         // 龙与魔法
  // 仙侠子类
  | 'xianxia_gudian'        // 古典仙侠
  | 'xianxia_honghuang'     // 洪荒封神
  | 'xianxia_shenhua'       // 神话传说
  | 'xianxia_xiuxian'       // 幻想修仙
  // 武侠子类
  | 'wuxia_gudian'          // 传统武侠
  | 'wuxia_guoshu'          // 国术格斗
  | 'wuxia_jianghu'         // 武侠江湖
  // 游戏子类
  | 'youxi_youxiyishijie'   // 游戏异世界
  | 'youxi_wangyou'         // 网游竞技
  | 'youxi_dianji'          // 电子竞技
  | 'youxi_xunihome'        // 虚拟现实
  // 军事子类
  | 'junshi_zhanzheng'      // 战争风云
  | 'junshi_tezhong'        // 特种兵王
  | 'junshi_kangzhan'       // 抗战烽火
  | 'junshi_junlv'          // 军旅生涯
  // 其他
  | 'qita_other'            // 其他类型

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
  // 新增风格
  | 'shuangwen'   // 爽文
  | 'wenqing'     // 文青
  | 'zhengju'     // 正剧
  | 'xiju'        // 喜剧
  | 'beiju'       // 悲剧
  | 'langman'     // 浪漫
  | 'yujia'       // 硬核
  | 'richang'     // 日常
  | 'maoxian'     // 冒险
  | 'xiangsui'    // 细水长流
  | 'gaoneng'     // 高能快节奏
  | 'zhiyu'       // 治愈

// ==================== 高级设定类型 ====================

/**
 * 叙事视角
 */
export type NarrativePerspective =
  | 'first_person'       // 第一人称
  | 'third_limited'      // 第三人称限知
  | 'third_omniscient'   // 第三人称全知
  | 'multi_pov'          // 多视角切换

/**
 * 叙述时态
 */
export type NarrativeTense =
  | 'past'      // 过去时
  | 'present'   // 现在时

/**
 * 时代背景
 */
export type EraSetting =
  | 'ancient'       // 古代
  | 'modern'        // 现代
  | 'future'        // 未来
  | 'alternate'     // 架空

/**
 * 力量体系
 */
export type PowerSystem =
  | 'realm'         // 境界制（练气→渡劫）
  | 'level'         // 等级制
  | 'bloodline'     // 血脉制
  | 'martial'       // 武学制
  | 'magic'         // 魔法制
  | 'none'          // 无体系
  | 'custom'        // 自定义

/**
 * 科技水平
 */
export type TechLevel =
  | 'primitive'     // 原始
  | 'medieval'      // 中世纪
  | 'modern'        // 现代
  | 'near_future'   // 近未来
  | 'far_future'    // 超未来

/**
 * 金手指类型
 */
export type GoldenFingerType =
  | 'system'        // 系统流
  | 'space'         // 空间流/储物流（如掌天瓶）
  | 'inheritance'   // 传承流
  | 'rebirth'       // 重生流
  | 'bloodline'     // 血脉流
  | 'cultivation'   // 功法流
  | 'artifact'      // 神器流
  | 'none'          // 无金手指（纯废柴逆袭）

/**
 * 金手指详细设定
 */
export interface GoldenFingerSetting {
  type: GoldenFingerType
  name?: string           // 名称（如：掌天瓶、鸿蒙系统）
  description?: string    // 详细描述/功能说明
  limitation?: string     // 限制条件
  growthPath?: string     // 成长路线
}

/**
 * 主角性格
 */
export type ProtagonistPersonality =
  | 'calm'          // 冷静理智
  | 'hotblooded'    // 热血冲动
  | 'cunning'       // 腹黑算计
  | 'honest'        // 老实憨厚
  | 'ruthless'      // 心狠手辣
  | 'kind'          // 善良正义

/**
 * 感情线类型
 */
export type RomanceLine =
  | 'none'          // 无CP
  | 'single'        // 单女主/单男主
  | 'harem'         // 后宫
  | 'bl'            // BL
  | 'gl'            // GL
  | 'slow_burn'     // 慢热感情

/**
 * 后宫女主数量
 */
export type HaremSize =
  | 'small'         // 2-3人
  | 'medium'        // 4-5人
  | 'large'         // 6人以上

/**
 * 节奏偏好
 */
export type PacingPreference =
  | 'fast'          // 快节奏爽文
  | 'slow'          // 慢热铺垫
  | 'balanced'      // 张弛有度

/**
 * 爽点密度
 */
export type ConflictDensity =
  | 'high'          // 高频打脸
  | 'moderate'      // 适度冲突
  | 'low'           // 重剧情深度

/**
 * 虐点程度
 */
export type AngstLevel =
  | 'none'          // 全程顺利
  | 'minor'         // 小挫折
  | 'major'         // 大起大落
  | 'heavy'         // 持续虐心

/**
 * 结局倾向
 */
export type EndingPreference =
  | 'happy'         // HE（Happy Ending）
  | 'bad'           // BE（Bad Ending）
  | 'open'          // 开放式

/**
 * 文笔风格
 */
export type WritingStyle =
  | 'plain'         // 白话直白
  | 'literary'      // 文艺优美
  | 'humorous'      // 幽默诙谐
  | 'serious'       // 严谨冷峻

/**
 * 对话比例
 */
export type DialogueRatio =
  | 'dialogue_heavy'    // 多对话
  | 'balanced'          // 均衡
  | 'narration_heavy'   // 多叙述

/**
 * 描写详细程度
 */
export type DescriptionLevel =
  | 'detailed'      // 详细
  | 'moderate'      // 适度
  | 'minimal'       // 极简

/**
 * 小说高级设定
 */
export interface NovelSettings {
  // 叙事设定
  narrative?: {
    perspective?: NarrativePerspective
    tense?: NarrativeTense
  }

  // 世界观设定
  worldBuilding?: {
    era?: EraSetting
    powerSystem?: PowerSystem
    powerSystemCustom?: string      // 自定义力量体系说明
    techLevel?: TechLevel
  }

  // 角色预设
  protagonist?: {
    personality?: ProtagonistPersonality
    goldenFinger?: GoldenFingerSetting
    romanceLine?: RomanceLine
    haremSize?: HaremSize           // 后宫女主数量（仅当romanceLine为harem时有效）
  }

  // 剧情偏好
  plot?: {
    pacing?: PacingPreference
    conflictDensity?: ConflictDensity
    angstLevel?: AngstLevel
    ending?: EndingPreference
  }

  // 写作风格
  writing?: {
    style?: WritingStyle
    dialogueRatio?: DialogueRatio
    psychologyDescription?: DescriptionLevel    // 心理描写
    environmentDescription?: DescriptionLevel   // 环境描写
  }

  // 禁忌/偏好
  preferences?: {
    forbiddenElements?: string[]    // 禁用元素
    requiredElements?: string[]     // 必含元素
    referenceWorks?: string         // 参考作品
  }
}

// ==================== 映射常量 ====================

/**
 * 叙事视角映射
 */
export const NARRATIVE_PERSPECTIVE_MAP: Record<NarrativePerspective, string> = {
  first_person: '第一人称',
  third_limited: '第三人称限知',
  third_omniscient: '第三人称全知',
  multi_pov: '多视角切换'
}

/**
 * 叙述时态映射
 */
export const NARRATIVE_TENSE_MAP: Record<NarrativeTense, string> = {
  past: '过去时',
  present: '现在时'
}

/**
 * 时代背景映射
 */
export const ERA_SETTING_MAP: Record<EraSetting, string> = {
  ancient: '古代',
  modern: '现代',
  future: '未来',
  alternate: '架空'
}

/**
 * 力量体系映射
 */
export const POWER_SYSTEM_MAP: Record<PowerSystem, string> = {
  realm: '境界制（练气→渡劫）',
  level: '等级制',
  bloodline: '血脉制',
  martial: '武学制',
  magic: '魔法制',
  none: '无体系',
  custom: '自定义'
}

/**
 * 科技水平映射
 */
export const TECH_LEVEL_MAP: Record<TechLevel, string> = {
  primitive: '原始',
  medieval: '中世纪',
  modern: '现代',
  near_future: '近未来',
  far_future: '超未来'
}

/**
 * 金手指类型映射
 */
export const GOLDEN_FINGER_TYPE_MAP: Record<GoldenFingerType, string> = {
  system: '系统流',
  space: '空间流/储物流',
  inheritance: '传承流',
  rebirth: '重生流',
  bloodline: '血脉流',
  cultivation: '功法流',
  artifact: '神器流',
  none: '无金手指'
}

/**
 * 金手指类型示例
 */
export const GOLDEN_FINGER_EXAMPLES: Record<GoldenFingerType, { name: string; desc: string }> = {
  system: { name: '鸿蒙修仙系统', desc: '完成任务获得修炼资源，提供功法推荐和敌人分析' },
  space: { name: '掌天瓶', desc: '缓慢吸收灵气产生灵液，加速灵药生长，间接帮助修炼' },
  inheritance: { name: '上古大能传承', desc: '继承某位大能的记忆、功法和部分修为' },
  rebirth: { name: '重生五百年前', desc: '带着前世记忆重生，知晓未来机缘和危机' },
  bloodline: { name: '远古神兽血脉', desc: '体内觉醒远古神兽血脉，获得特殊天赋和能力' },
  cultivation: { name: '无上功法', desc: '获得一门逆天功法，修炼速度远超常人' },
  artifact: { name: '混沌至宝', desc: '拥有一件威力无穷的远古神器' },
  none: { name: '无', desc: '凭借自身努力和机缘逆袭' }
}

/**
 * 主角性格映射
 */
export const PROTAGONIST_PERSONALITY_MAP: Record<ProtagonistPersonality, string> = {
  calm: '冷静理智',
  hotblooded: '热血冲动',
  cunning: '腹黑算计',
  honest: '老实憨厚',
  ruthless: '心狠手辣',
  kind: '善良正义'
}

/**
 * 感情线映射
 */
export const ROMANCE_LINE_MAP: Record<RomanceLine, string> = {
  none: '无CP',
  single: '单女主/单男主',
  harem: '后宫',
  bl: 'BL',
  gl: 'GL',
  slow_burn: '慢热感情'
}

/**
 * 后宫女主数量映射
 */
export const HAREM_SIZE_MAP: Record<HaremSize, string> = {
  small: '2-3人',
  medium: '4-5人',
  large: '6人以上'
}

/**
 * 节奏偏好映射
 */
export const PACING_PREFERENCE_MAP: Record<PacingPreference, string> = {
  fast: '快节奏爽文',
  slow: '慢热铺垫',
  balanced: '张弛有度'
}

/**
 * 爽点密度映射
 */
export const CONFLICT_DENSITY_MAP: Record<ConflictDensity, string> = {
  high: '高频打脸',
  moderate: '适度冲突',
  low: '重剧情深度'
}

/**
 * 虐点程度映射
 */
export const ANGST_LEVEL_MAP: Record<AngstLevel, string> = {
  none: '全程顺利',
  minor: '小挫折',
  major: '大起大落',
  heavy: '持续虐心'
}

/**
 * 结局倾向映射
 */
export const ENDING_PREFERENCE_MAP: Record<EndingPreference, string> = {
  happy: 'HE（圆满结局）',
  bad: 'BE（悲剧结局）',
  open: '开放式结局'
}

/**
 * 文笔风格映射
 */
export const WRITING_STYLE_MAP: Record<WritingStyle, string> = {
  plain: '白话直白',
  literary: '文艺优美',
  humorous: '幽默诙谐',
  serious: '严谨冷峻'
}

/**
 * 对话比例映射
 */
export const DIALOGUE_RATIO_MAP: Record<DialogueRatio, string> = {
  dialogue_heavy: '多对话',
  balanced: '均衡',
  narration_heavy: '多叙述'
}

/**
 * 描写详细程度映射
 */
export const DESCRIPTION_LEVEL_MAP: Record<DescriptionLevel, string> = {
  detailed: '详细',
  moderate: '适度',
  minimal: '极简'
}

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
  brief?: string        // 章节概要
  chapterId?: string    // 关联的实际章节ID
}

/**
 * 分卷大纲
 */
export interface VolumeOutline {
  id: string
  title: string
  summary?: string
  plotLine?: string           // 核心剧情线
  startChapter?: number       // 起始章节号
  endChapter?: number         // 结束章节号
  chapterCount?: number       // 章节数量
  wordCountTarget?: number    // 目标字数
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
  kongbu: '恐怖',
  qihuan: '奇幻',
  xianxia: '仙侠',
  wuxia: '武侠',
  youxi: '游戏',
  tiyu: '体育',
  junshi: '军事',
  qita: '其他'
}

/**
 * 书籍子类型映射（用于显示）
 */
export const BOOK_SUB_GENRE_MAP: Record<BookSubGenre, string> = {
  // 玄幻子类
  xuanhuan_dongfang: '东方玄幻',
  xuanhuan_yishi: '异世大陆',
  xuanhuan_gaowu: '高武世界',
  xuanhuan_wangjia: '王朝争霸',
  // 修真子类
  xiuzhen_xiandao: '仙道修真',
  xiuzhen_modao: '魔道修真',
  xiuzhen_hongchen: '红尘修真',
  xiuzhen_xiuxian: '凡人修仙',
  // 都市子类
  dushi_yineng: '都市异能',
  dushi_zhichang: '职场商战',
  dushi_shenghuo: '都市生活',
  dushi_chongsheng: '都市重生',
  dushi_yixian: '娱乐明星',
  // 科幻子类
  kehuan_xingji: '星际文明',
  kehuan_mori: '末日危机',
  kehuan_chaoji: '超级科技',
  kehuan_shikong: '时空穿梭',
  kehuan_jinhua: '进化变异',
  // 历史子类
  lishi_jiagong: '架空历史',
  lishi_qinhan: '秦汉三国',
  lishi_suitang: '隋唐五代',
  lishi_mingqing: '明清历史',
  lishi_minguo: '民国往事',
  // 言情子类
  yanqing_xiandai: '现代言情',
  yanqing_guzhuang: '古装言情',
  yanqing_chuanyue: '穿越言情',
  yanqing_chongsheng: '重生言情',
  yanqing_haomentianwen: '豪门甜文',
  // 悬疑子类
  xuanyi_zhentan: '侦探推理',
  xuanyi_miansha: '密室逃脱',
  xuanyi_guiling: '诡秘悬疑',
  xuanyi_fanzui: '犯罪心理',
  // 恐怖子类
  kongbu_lingyi: '灵异鬼怪',
  kongbu_shenghua: '丧尸生化',
  kongbu_xinli: '心理恐怖',
  kongbu_kelusu: '克苏鲁',
  // 奇幻子类
  qihuan_xifang: '西方奇幻',
  qihuan_heian: '黑暗奇幻',
  qihuan_shishi: '史诗奇幻',
  qihuan_longyu: '龙与魔法',
  // 仙侠子类
  xianxia_gudian: '古典仙侠',
  xianxia_honghuang: '洪荒封神',
  xianxia_shenhua: '神话传说',
  xianxia_xiuxian: '幻想修仙',
  // 武侠子类
  wuxia_gudian: '传统武侠',
  wuxia_guoshu: '国术格斗',
  wuxia_jianghu: '武侠江湖',
  // 游戏子类
  youxi_youxiyishijie: '游戏异世界',
  youxi_wangyou: '网游竞技',
  youxi_dianji: '电子竞技',
  youxi_xunihome: '虚拟现实',
  // 军事子类
  junshi_zhanzheng: '战争风云',
  junshi_tezhong: '特种兵王',
  junshi_kangzhan: '抗战烽火',
  junshi_junlv: '军旅生涯',
  // 其他
  qita_other: '其他类型'
}

/**
 * 类型-子类型关联映射
 */
export const GENRE_SUB_GENRES_MAP: Record<BookGenre, BookSubGenre[]> = {
  xuanhuan: ['xuanhuan_dongfang', 'xuanhuan_yishi', 'xuanhuan_gaowu', 'xuanhuan_wangjia'],
  xiuzhen: ['xiuzhen_xiandao', 'xiuzhen_modao', 'xiuzhen_hongchen', 'xiuzhen_xiuxian'],
  dushi: ['dushi_yineng', 'dushi_zhichang', 'dushi_shenghuo', 'dushi_chongsheng', 'dushi_yixian'],
  kehuan: ['kehuan_xingji', 'kehuan_mori', 'kehuan_chaoji', 'kehuan_shikong', 'kehuan_jinhua'],
  lishi: ['lishi_jiagong', 'lishi_qinhan', 'lishi_suitang', 'lishi_mingqing', 'lishi_minguo'],
  yanqing: ['yanqing_xiandai', 'yanqing_guzhuang', 'yanqing_chuanyue', 'yanqing_chongsheng', 'yanqing_haomentianwen'],
  xuanyi: ['xuanyi_zhentan', 'xuanyi_miansha', 'xuanyi_guiling', 'xuanyi_fanzui'],
  kongbu: ['kongbu_lingyi', 'kongbu_shenghua', 'kongbu_xinli', 'kongbu_kelusu'],
  qihuan: ['qihuan_xifang', 'qihuan_heian', 'qihuan_shishi', 'qihuan_longyu'],
  xianxia: ['xianxia_gudian', 'xianxia_honghuang', 'xianxia_shenhua', 'xianxia_xiuxian'],
  wuxia: ['wuxia_gudian', 'wuxia_guoshu', 'wuxia_jianghu'],
  youxi: ['youxi_youxiyishijie', 'youxi_wangyou', 'youxi_dianji', 'youxi_xunihome'],
  tiyu: [],  // 体育暂无子类
  junshi: ['junshi_zhanzheng', 'junshi_tezhong', 'junshi_kangzhan', 'junshi_junlv'],
  qita: ['qita_other']
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
  heian: '黑暗',
  shuangwen: '爽文',
  wenqing: '文青',
  zhengju: '正剧',
  xiju: '喜剧',
  beiju: '悲剧',
  langman: '浪漫',
  yujia: '硬核',
  richang: '日常',
  maoxian: '冒险',
  xiangsui: '细水长流',
  gaoneng: '高能快节奏',
  zhiyu: '治愈'
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
  tags?: string[]             // 角色标签（如：女主、重要配角等）
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
