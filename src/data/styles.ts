// 写作风格选项数据

interface StyleOption {
  label: string
  value: string
}

export interface StyleDimension {
  label: string
  key: string
  options: StyleOption[]
}

export const styleDimensions: StyleDimension[] = [
  {
    label: '叙事视角',
    key: 'narrativePov',
    options: [
      { label: '第一人称', value: 'first-person' },
      { label: '第三人称限知', value: 'third-limited' },
      { label: '第三人称全知', value: 'third-omniscient' },
      { label: '多视角切换', value: 'multi-pov' },
    ]
  },
  {
    label: '文风基调',
    key: 'toneStyle',
    options: [
      { label: '热血燃文', value: 'hot-blooded' },
      { label: '轻松幽默', value: 'humorous' },
      { label: '暗黑压抑', value: 'dark' },
      { label: '古典文雅', value: 'classical' },
      { label: '现代白话', value: 'modern' },
      { label: '温馨治愈', value: 'healing' },
      { label: '悲壮史诗', value: 'epic' },
      { label: '冷静克制', value: 'calm-calculated' },
    ]
  },
  {
    label: '描写密度',
    key: 'descriptionDensity',
    options: [
      { label: '精细描写', value: 'detailed' },
      { label: '适中平衡', value: 'balanced' },
      { label: '简洁明快', value: 'concise' },
    ]
  },
  {
    label: '对话风格',
    key: 'dialogueStyle',
    options: [
      { label: '简洁利落', value: 'crisp' },
      { label: '生活化口语', value: 'colloquial' },
      { label: '古风文言', value: 'classical-chinese' },
      { label: '幽默吐槽', value: 'humorous-retort' },
      { label: '正式严肃', value: 'formal' },
      { label: '克制含蓄', value: 'restrained' },
    ]
  },
  {
    label: '战斗描写',
    key: 'combatStyle',
    options: [
      { label: '热血燃爆', value: 'explosive' },
      { label: '策略智斗', value: 'strategic' },
      { label: '写实残酷', value: 'realistic' },
      { label: '飘逸流畅', value: 'elegant' },
      { label: '战术博弈', value: 'tactical' },
    ]
  },
  {
    label: '节奏控制',
    key: 'pacingControl',
    options: [
      { label: '快节奏', value: 'fast' },
      { label: '正常节奏', value: 'normal' },
      { label: '慢节奏', value: 'slow' },
      { label: '慢热铺垫', value: 'slow-burn' },
    ]
  },
  {
    label: '情感表达',
    key: 'emotionExpression',
    options: [
      { label: '内敛含蓄', value: 'restrained' },
      { label: '直接强烈', value: 'intense' },
      { label: '细腻层次丰富', value: 'nuanced' },
    ]
  },
]

// 性格标签选项（用于角色设定）
export const personalityTags: string[] = [
  '冷静', '热血', '腹黑', '善良', '狡诈', '正直', '沉稳',
  '暴躁', '温柔', '果断', '优柔', '幽默', '高冷', '傲慢',
  '谦逊', '坚韧', '敏感', '乐观', '悲观', '理性',
]

// 爽点模式选项
export const payoffPatterns: string[] = [
  '扮猪吃老虎', '终极反转', '天降奇遇', '以弱胜强',
  '装逼打脸', '意外觉醒', '逆境翻盘', '一鸣惊人',
  '隐藏实力', '关键时刻爆发',
]
