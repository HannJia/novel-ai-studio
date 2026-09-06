import type { WritingSkill } from '@/types/skill'

const CREATED_AT = '2026-01-01T00:00:00.000Z'

const builtInWritingSkills: WritingSkill[] = [
  {
    id: 'builtin-scene-causality',
    name: '场景因果链',
    description: '确保每个场景由目标、阻力、行动和结果组成。',
    task: 'writing',
    instructions: '组织场景时明确角色当下目标，让阻力迫使角色采取行动，并让行动产生可追踪的结果。禁止用偶然事件替代关键因果。',
    enabled: true,
    builtIn: true,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
  {
    id: 'builtin-dialogue-subtext',
    name: '对话潜台词',
    description: '减少说明式对白，让人物通过立场和回避传递信息。',
    task: 'writing',
    instructions: '对白必须符合人物身份和关系。避免角色直接复述双方都知道的信息；重要情绪优先通过措辞、停顿、动作和回避表达。',
    enabled: true,
    builtIn: true,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
  {
    id: 'builtin-pacing',
    name: '节奏控制',
    description: '控制信息释放、冲突升级和章节收束。',
    task: 'planning',
    instructions: '规划时交替安排推进、反应和转折，不连续堆叠同质冲突。每个关键节点必须改变人物选择或局势，远期节点不得被提前消费。',
    enabled: true,
    builtIn: true,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
  {
    id: 'builtin-continuity-review',
    name: '连续性审校',
    description: '审查时间、地点、角色状态和资源变化。',
    task: 'review',
    instructions: '优先核对时间顺序、人物位置、能力边界、资源数量、称谓和已发生事件。指出冲突时必须给出正文证据与既有设定证据。',
    enabled: true,
    builtIn: true,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
  {
    id: 'builtin-evidence-analysis',
    name: '证据优先分析',
    description: '结构化提取时只记录正文明确支持的事实。',
    task: 'analysis',
    instructions: '只提取输入文本明确出现的事实；推测、可能性和写作建议不得写成已发生事件或角色状态。缺少证据时返回空结果。',
    enabled: true,
    builtIn: true,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
]

export function createBuiltInSkills(): WritingSkill[] {
  return builtInWritingSkills.map(skill => ({ ...skill }))
}
