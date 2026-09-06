import type { ModelConfig } from '@/stores/config'
import type {
  Chapter, ChapterPlan, ChapterPlanHorizon, Novel, StoryStateProposal,
  StoryArcType, StoryStateProposalField, StoryStateTargetType,
} from '@/types/novel'
import { callAI } from '@/services/ai'
import { parseAiJsonObject } from '@/utils/aiJson'

export type ChapterPlanDraft = Omit<ChapterPlan, 'id' | 'createdAt' | 'updatedAt'>
export type StoryStateProposalDraft = Omit<StoryStateProposal, 'id' | 'status' | 'createdAt' | 'updatedAt'>

export interface StoryArcDraft {
  title: string
  description: string
  type: StoryArcType
  importance: 1 | 2 | 3 | 4 | 5
  characterNames: string[]
  nodes: Array<{ title: string; description: string; targetChapter: number }>
}

interface AiPlan {
  horizon?: string
  level?: string
  tier?: string
  layer?: string
  title?: string
  objective?: string
  summary?: string
  beats?: unknown
  targetChapterStart?: unknown
  targetChapterEnd?: unknown
  relatedArcIds?: unknown
  relatedEventIds?: unknown
}

interface AiProposal {
  targetType?: string
  targetId?: string
  parentId?: string
  field?: string
  newValue?: unknown
  reason?: string
  evidence?: string
}

interface AiStoryArc {
  title?: string
  description?: string
  type?: string
  importance?: unknown
  characterNames?: unknown
  nodes?: Array<{ title?: string; description?: string; targetChapter?: unknown }>
}

const HORIZONS = new Set<ChapterPlanHorizon>(['next', 'near', 'far'])
const STORY_ARC_TYPES = new Set<StoryArcType>(['main', 'sub', 'character', 'relationship', 'mystery', 'world'])

function normalizeHorizon(value: unknown): ChapterPlanHorizon {
  const normalized = String(value || '').trim().toLowerCase()
  if (HORIZONS.has(normalized as ChapterPlanHorizon)) return normalized as ChapterPlanHorizon
  if (/下一章|next.?chapter|immediate|近期详细/.test(normalized)) return 'next'
  if (/近期|近程|中期|near|mid/.test(normalized)) return 'near'
  if (/远期|远程|长期|far|long/.test(normalized)) return 'far'
  return 'near'
}

function compact(value: string, limit: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, limit)
}

function stringList(value: unknown, limit = 12): string[] {
  if (!Array.isArray(value)) return []
  return value.map(item => String(item || '').trim()).filter(Boolean).slice(0, limit)
}

function nextWritableChapterIndex(novel: Novel): number {
  const unfinished = [...(novel.chapters || [])]
    .sort((a, b) => a.chapterIndex - b.chapterIndex)
    .find(chapter => !['completed', 'reviewed', 'finalized', 'locked'].includes(chapter.status))
  if (unfinished) return unfinished.chapterIndex
  return Math.max(0, ...novel.chapters.map(chapter => chapter.chapterIndex + 1))
}

export function normalizeChapterPlanDrafts(novel: Novel, plans: AiPlan[]): ChapterPlanDraft[] {
  const nextChapter = nextWritableChapterIndex(novel)
  const arcIds = new Set((novel.storyArcs || []).map(arc => arc.id))
  const eventIds = new Set((novel.eventLog || []).map(event => event.id))
  return plans.slice(0, 12).flatMap(raw => {
    const horizon = normalizeHorizon(raw.horizon || raw.level || raw.tier || raw.layer)
    const title = String(raw.title || '').trim().slice(0, 120)
    const objective = String(raw.objective || '').trim().slice(0, 600)
    const summary = String(raw.summary || '').trim().slice(0, 1200)
    if (!title || (!objective && !summary)) return []
    const requestedStart = Math.round(Number(raw.targetChapterStart) || nextChapter + 1) - 1
    const minimumStart = horizon === 'next' ? nextChapter : nextChapter + 1
    const start = horizon === 'next' ? nextChapter : Math.max(minimumStart, requestedStart)
    const requestedEnd = Math.round(Number(raw.targetChapterEnd) || start + 1) - 1
    const end = horizon === 'next' ? nextChapter : Math.max(start, requestedEnd)
    return [{
      horizon,
      title,
      objective,
      summary,
      beats: stringList(raw.beats),
      targetChapterStart: start,
      targetChapterEnd: end,
      relatedArcIds: stringList(raw.relatedArcIds).filter(id => arcIds.has(id)),
      relatedEventIds: stringList(raw.relatedEventIds).filter(id => eventIds.has(id)),
      status: 'planned' as const,
      source: 'ai' as const,
    }]
  })
}

function planningTargets(novel: Novel) {
  return {
    arcs: (novel.storyArcs || []).filter(arc => arc.status === 'active').map(arc => ({
      id: arc.id,
      title: arc.title,
      description: compact(arc.description, 260),
      nodes: arc.nodes.filter(node => node.status === 'pending').map(node => ({
        id: node.id,
        title: node.title,
        targetChapter: node.targetChapter + 1,
      })),
    })),
    events: (novel.eventLog || []).filter(event => !['resolved', 'abandoned'].includes(event.status || '')).map(event => ({
      id: event.id,
      title: event.title,
      status: event.status || 'developing',
      targetChapter: event.targetChapter === undefined ? null : event.targetChapter + 1,
      description: compact(event.description, 220),
    })),
  }
}

export function normalizeStoryArcDrafts(arcs: AiStoryArc[]): StoryArcDraft[] {
  return arcs.slice(0, 6).flatMap(raw => {
    const title = String(raw.title || '').trim().slice(0, 120)
    if (!title) return []
    const type = STORY_ARC_TYPES.has(raw.type as StoryArcType) ? raw.type as StoryArcType : 'sub'
    const importance = Math.min(5, Math.max(1, Math.round(Number(raw.importance) || 3))) as 1 | 2 | 3 | 4 | 5
    const nodes = (Array.isArray(raw.nodes) ? raw.nodes : []).slice(0, 6).flatMap(node => {
      const nodeTitle = String(node?.title || '').trim().slice(0, 120)
      if (!nodeTitle) return []
      return [{
        title: nodeTitle,
        description: String(node?.description || '').trim().slice(0, 600),
        targetChapter: Math.max(1, Math.round(Number(node?.targetChapter) || 1)),
      }]
    })
    return [{
      title,
      description: String(raw.description || '').trim().slice(0, 1200),
      type,
      importance,
      characterNames: stringList(raw.characterNames, 20),
      nodes,
    }]
  })
}

export async function generateStoryArcDrafts(novel: Novel, model: ModelConfig): Promise<StoryArcDraft[]> {
  if (!novel.outline.trim()) throw new Error('缺少总大纲，无法提取故事弧线')
  const result = await callAI({
    model,
    skillTask: 'planning',
    maxTokens: 3000,
    messages: [{
      role: 'system',
      content: '你是小说结构编辑。请从总大纲提取跨章节叙事弧线和关键里程碑，只输出严格 JSON，不要解释。',
    }, {
      role: 'user',
      content: `请分析《${novel.title}》的总大纲，提取 3-6 条真正跨章节发展的故事弧线。\n\n【总大纲】\n${novel.outline.slice(0, 7000)}\n\n【已有角色】\n${novel.characters.map(character => character.name).join('、') || '暂无'}\n\n只输出以下 JSON：\n{"arcs":[{"title":"弧线名","description":"目标、冲突与预期变化","type":"main|sub|character|relationship|mystery|world","importance":1,"characterNames":["角色名"],"nodes":[{"title":"里程碑","description":"发生什么以及产生的变化","targetChapter":1}]}]}\n\n规则：importance 为 1-5；targetChapter 使用从 1 开始的章节号；每条弧线 2-6 个按章节递增的节点；不要把单章事件误当成弧线。`,
    }],
  })
  const parsed = parseAiJsonObject<{ arcs?: AiStoryArc[] }>(result.content)
  const drafts = normalizeStoryArcDrafts(Array.isArray(parsed?.arcs) ? parsed!.arcs! : [])
  if (!drafts.length) throw new Error('模型没有返回可用的弧线数据')
  return drafts
}

export async function generateChapterPlanDrafts(novel: Novel, model: ModelConfig): Promise<ChapterPlanDraft[]> {
  const nextChapter = nextWritableChapterIndex(novel)
  const targets = planningTargets(novel)
  const result = await callAI({
    model,
    skillTask: 'planning',
    maxTokens: 3200,
    messages: [{
      role: 'system',
      content: '你是长篇小说的章节策划编辑。把总纲拆成 next、near、far 三层滚动计划。只输出严格 JSON，不解释。',
    }, {
      role: 'user',
      content: `为《${novel.title}》从第 ${nextChapter + 1} 章开始生成滚动章节计划。

【三层要求】
- next：1 条，只覆盖下一章，必须给出可直接写作的目标与 3-6 个节拍。
- near：2-4 条，覆盖随后约 2-10 章，明确冲突升级和信息释放。
- far：1-3 条，覆盖更远章节，只保留方向、关键转折和收束条件。
- 章节号从 1 开始。不得重复已完成剧情，不得创造与总纲冲突的新设定。

【总纲】
${novel.outline.slice(0, 9000)}

【分卷规划】
${novel.volumes.length
  ? novel.volumes.map(volume => `第${volume.volumeIndex + 1}卷《${volume.title}》\n主题：${volume.theme || '未填写'}\n剧情目标：${compact(volume.summary, 800)}\n关键转折：${compact(volume.keyTurningPoints, 400)}\n角色变化：${compact(volume.characterChanges, 300)}\n预计：${volume.estimatedChapters}章 / ${volume.estimatedWordCount}万字`).join('\n\n')
  : '尚未建立分卷规划；请仅生成保守的首批计划，并避免虚构跨卷结构。'}

【最近章节】
${novel.chapters.slice(-5).map(chapter => `第${chapter.chapterIndex + 1}章 ${chapter.title}：${compact(chapter.summary || chapter.content, 420)}`).join('\n') || '暂无'}

【可关联目标，relatedArcIds / relatedEventIds 只能使用这里的 id】
${JSON.stringify(targets)}

输出：
{"plans":[{"horizon":"next|near|far","title":"计划名","objective":"阶段目标","summary":"冲突、推进与预期变化","beats":["节拍1"],"targetChapterStart":1,"targetChapterEnd":1,"relatedArcIds":["id"],"relatedEventIds":["id"]}]}`,
    }],
  })
  const parsed = parseAiJsonObject<{ plans?: AiPlan[]; chapterPlans?: AiPlan[]; chapter_plans?: AiPlan[] }>(result.content)
  const rawPlans = parsed?.plans || parsed?.chapterPlans || parsed?.chapter_plans || []
  const drafts = normalizeChapterPlanDrafts(novel, Array.isArray(rawPlans) ? rawPlans : [])
  if (!drafts.some(plan => plan.horizon === 'next')) throw new Error('模型没有返回可用的下一章计划')
  return drafts
}

function currentTargetValue(novel: Novel, raw: AiProposal): {
  targetType: StoryStateTargetType
  targetId: string
  parentId?: string
  title: string
  field: StoryStateProposalField
  value: string
} | null {
  const targetType = raw.targetType as StoryStateTargetType
  const field = raw.field as StoryStateProposalField
  const targetId = String(raw.targetId || '')
  if (!['status', 'targetChapter'].includes(field) || !targetId) return null
  if (targetType === 'story_arc') {
    const target = novel.storyArcs?.find(item => item.id === targetId)
    if (!target || field !== 'status') return null
    return { targetType, targetId, title: target.title, field, value: target.status }
  }
  if (targetType === 'arc_node') {
    const parent = novel.storyArcs?.find(arc => arc.id === raw.parentId || arc.nodes.some(node => node.id === targetId))
    const target = parent?.nodes.find(item => item.id === targetId)
    if (!parent || !target) return null
    return {
      targetType, targetId, parentId: parent.id, title: `${parent.title} / ${target.title}`, field,
      value: field === 'status' ? target.status : String(target.targetChapter),
    }
  }
  if (targetType === 'event') {
    const target = novel.eventLog.find(item => item.id === targetId)
    if (!target) return null
    return {
      targetType, targetId, title: target.title, field,
      value: field === 'status' ? (target.status || 'developing') : String(target.targetChapter ?? target.chapterIndex),
    }
  }
  if (targetType === 'chapter_plan') {
    const target = novel.chapterPlans?.find(item => item.id === targetId)
    if (!target || field !== 'status') return null
    return { targetType, targetId, title: target.title, field, value: target.status }
  }
  return null
}

function validStatus(targetType: StoryStateTargetType, value: string): boolean {
  const allowed: Record<StoryStateTargetType, string[]> = {
    story_arc: ['active', 'paused', 'completed', 'abandoned'],
    arc_node: ['pending', 'completed', 'abandoned'],
    event: ['planted', 'developing', 'resolved', 'abandoned'],
    chapter_plan: ['planned', 'active', 'completed', 'archived'],
  }
  return allowed[targetType].includes(value)
}

export function normalizeStoryStateProposalDrafts(
  novel: Novel,
  chapter: Chapter,
  proposals: AiProposal[],
): StoryStateProposalDraft[] {
  return proposals.slice(0, 20).flatMap(raw => {
    const target = currentTargetValue(novel, raw)
    if (!target) return []
    let newValue = String(raw.newValue ?? '').trim()
    if (target.field === 'status') {
      if (!validStatus(target.targetType, newValue)) return []
    } else {
      const chapterNumber = Math.round(Number(newValue))
      if (!Number.isFinite(chapterNumber) || chapterNumber < 1) return []
      newValue = String(chapterNumber - 1)
    }
    if (newValue === target.value) return []
    return [{
      targetType: target.targetType,
      targetId: target.targetId,
      parentId: target.parentId,
      targetTitle: target.title,
      field: target.field,
      oldValue: target.value,
      newValue,
      reason: compact(String(raw.reason || '章节正文已体现对应变化'), 500),
      evidence: compact(String(raw.evidence || ''), 600),
      chapterIndex: chapter.chapterIndex,
      source: 'ai' as const,
    }]
  })
}

function stateTargets(novel: Novel) {
  return {
    storyArcs: (novel.storyArcs || []).filter(arc => !['completed', 'abandoned'].includes(arc.status)).map(arc => ({
      id: arc.id, title: arc.title, status: arc.status,
      nodes: arc.nodes.filter(node => node.status === 'pending').map(node => ({
        id: node.id, title: node.title, status: node.status, targetChapter: node.targetChapter + 1,
      })),
    })),
    events: (novel.eventLog || []).filter(event => !['resolved', 'abandoned'].includes(event.status || '')).map(event => ({
      id: event.id, title: event.title, status: event.status || 'developing',
      targetChapter: event.targetChapter === undefined ? null : event.targetChapter + 1,
    })),
    chapterPlans: (novel.chapterPlans || []).filter(plan => !['completed', 'archived'].includes(plan.status)).map(plan => ({
      id: plan.id, title: plan.title, status: plan.status,
      chapters: [plan.targetChapterStart + 1, plan.targetChapterEnd + 1],
    })),
  }
}

export async function generateStoryStateProposalDrafts(
  novel: Novel,
  chapter: Chapter,
  model: ModelConfig,
): Promise<StoryStateProposalDraft[]> {
  const result = await callAI({
    model,
    skillTask: 'analysis',
    maxTokens: 2200,
    messages: [{
      role: 'system',
      content: '你是小说连续性维护编辑。只根据正文明确证据提出状态变更，不直接修改数据。只输出严格 JSON。',
    }, {
      role: 'user',
      content: `检查第 ${chapter.chapterIndex + 1} 章是否完成或推进了已登记目标，并提出最少量的状态变更。

【正文】
${chapter.content.slice(0, 10000)}

【章节总结】
${chapter.summary || '暂无'}

【允许修改的目标；targetId 必须来自这里】
${JSON.stringify(stateTargets(novel))}

规则：
1. field 只允许 status 或 targetChapter。
2. targetChapter 输出从 1 开始的新章节号；只有原预计章节明显失效时才调整。
3. arc_node 完成必须有正文已发生的直接证据；event resolved 必须真正解决；chapter_plan completed 必须覆盖目标已完成。
4. 不确定就不输出。不得创建新目标。

输出：
{"proposals":[{"targetType":"story_arc|arc_node|event|chapter_plan","targetId":"id","parentId":"弧线id，仅arc_node需要","field":"status|targetChapter","newValue":"新状态或章节号","reason":"为什么要改","evidence":"正文中的简短证据"}]}`,
    }],
  })
  const parsed = parseAiJsonObject<{ proposals?: AiProposal[] }>(result.content)
  return normalizeStoryStateProposalDrafts(novel, chapter, Array.isArray(parsed?.proposals) ? parsed!.proposals! : [])
}

export function formatChapterPlanContext(novel: Novel, chapterIndex: number): string {
  const available = (novel.chapterPlans || [])
    .filter(plan => !['completed', 'archived'].includes(plan.status))
    .sort((a, b) => a.targetChapterStart - b.targetChapterStart || a.targetChapterEnd - b.targetChapterEnd)
  if (!available.length) return ''
  const selected: ChapterPlan[] = []
  const add = (plan?: ChapterPlan) => {
    if (plan && !selected.some(item => item.id === plan.id)) selected.push(plan)
  }
  available.filter(plan => plan.targetChapterStart <= chapterIndex && plan.targetChapterEnd >= chapterIndex).forEach(add)
  for (const horizon of ['next', 'near', 'far'] as ChapterPlanHorizon[]) {
    add(available.find(plan => plan.horizon === horizon && plan.targetChapterEnd >= chapterIndex
      && (horizon !== 'next' || plan.targetChapterStart <= chapterIndex)))
  }
  const labels: Record<ChapterPlanHorizon, string> = { next: '下一章', near: '近期', far: '远期' }
  return selected.slice(0, 6).map(plan => {
    const range = plan.targetChapterStart === plan.targetChapterEnd
      ? `第${plan.targetChapterStart + 1}章`
      : `第${plan.targetChapterStart + 1}-${plan.targetChapterEnd + 1}章`
    const beats = plan.beats.length ? `\n节拍：${plan.beats.join('；')}` : ''
    return `• [${labels[plan.horizon]} / ${range}] ${plan.title}\n目标：${plan.objective}\n${plan.summary}${beats}`
  }).join('\n')
}
