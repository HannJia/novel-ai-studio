import type { ChapterPlanV2, CreationDraft, ScenePlan } from '@/types/reconstruction'
import type { Novel } from '@/types/novel'
import { invalidateSceneApprovals, syncCreationDraftPlanning } from './reconstructionCreation'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const text = (value: unknown, max = 1200): string => typeof value === 'string' ? value.trim().slice(0, max) : ''
const lines = (value: unknown): string[] => Array.isArray(value) ? value.map(item => text(item, 600)).filter(Boolean).slice(0, 16) : []

export function requireConfirmedStory(draft: CreationDraft): void {
  if (draft.contract.approval !== 'approved' || draft.approval.contract !== 'approved') throw new Error('请先确认作品契约')
  if (draft.approval.skeleton !== 'approved' || !draft.skeletons.some(item => item.id === draft.selectedSkeletonId && item.approval === 'approved')) {
    throw new Error('请先确认故事骨架')
  }
}

export function confirmChapterPlan(draft: CreationDraft, planId: string, now: string): CreationDraft {
  requireConfirmedStory(draft)
  const plan = draft.chapterPlans.find(item => item.id === planId && item.status !== 'archived')
  if (!plan) throw new Error('找不到章节计划')
  if (!plan.title.trim() || !plan.objective.trim()) throw new Error('请填写章节名称和目标')
  return { ...draft, chapterPlans: draft.chapterPlans.map(item => item.id === planId ? { ...item, approval: 'approved' } : item),
    stage: 'scene-outline', updatedAt: now }
}

export function reviseChapterPlan(draft: CreationDraft, plan: ChapterPlanV2, now: string): CreationDraft {
  const existing = draft.chapterPlans.find(item => item.id === plan.id)
  if (!existing) throw new Error('找不到章节计划')
  const next = { ...existing, title: plan.title.trim(), objective: plan.objective.trim(), conflict: plan.conflict.trim(),
    openingState: plan.openingState.trim(), endingState: plan.endingState.trim(), requiredEvents: lines(plan.requiredEvents),
    prohibitedReveals: lines(plan.prohibitedReveals), characterChangeNotes: lines(plan.characterChangeNotes) }
  if (JSON.stringify(next) === JSON.stringify(existing)) return draft
  return { ...draft, chapterPlans: draft.chapterPlans.map(item => item.id === plan.id ? { ...next, approval: 'draft' } : item),
    scenePlans: invalidateSceneApprovals(draft.scenePlans, new Set([plan.id])),
    approval: { ...draft.approval, 'chapter-outline': 'draft', 'scene-outline': 'draft' }, updatedAt: now }
}

export function requireSceneParent(draft: CreationDraft, planId: string): ChapterPlanV2 {
  requireConfirmedStory(draft)
  const plan = draft.chapterPlans.find(item => item.id === planId && item.status !== 'archived')
  if (!plan || plan.approval !== 'approved') throw new Error('请先确认本章计划')
  if (plan.endNumber !== undefined && plan.endNumber !== plan.number) throw new Error('请先为单个章节建立详细计划，再拆分场景')
  return plan
}

export function normalizeScenePlans(raw: unknown, chapterPlanId: string, batchId: string, characterIds: string[] = []): ScenePlan[] {
  const source = raw && typeof raw === 'object' && 'scenes' in raw ? (raw as { scenes: unknown }).scenes : raw
  if (!Array.isArray(source) || !source.length || source.length > 12) throw new Error('场景计划必须包含 1–12 个场景')
  return source.map((item: unknown, index) => {
    if (!item || typeof item !== 'object') throw new Error('场景计划格式无效')
    const value = item as Record<string, unknown>
    const title = text(value.title, 120), purpose = text(value.purpose), outputState = text(value.outputState)
    if (!title || !purpose || !outputState) throw new Error('每个场景都需要名称、目的和结束状态')
    const viewpoint = text(value.viewpointCharacterId, 120)
    if (viewpoint && !characterIds.includes(viewpoint)) throw new Error('场景视角引用了不存在的角色，请重新选择')
    return { id: 'scene:' + batchId + ':' + index, chapterPlanId, order: index + 1, title, purpose, outputState,
      viewpointCharacterId: viewpoint || undefined, locationId: text(value.locationId, 180) || undefined,
      conflict: text(value.conflict), requiredActions: lines(value.requiredActions), informationChanges: lines(value.informationChanges),
      status: 'planned', approval: 'awaiting_approval' }
  })
}

/** 新候选保留已批准方案，只有作者确认替换时才撤下旧方案。 */
export function proposeScenePlans(draft: CreationDraft, planId: string, scenes: ScenePlan[], now: string): CreationDraft {
  requireSceneParent(draft, planId)
  if (!scenes.length || scenes.some(item => item.chapterPlanId !== planId || draft.scenePlans.some(old => old.id === item.id))
    || new Set(scenes.map(item => item.id)).size !== scenes.length) throw new Error('场景候选标识无效')
  const pending = scenes.map(item => ({ ...clone(item), approval: 'awaiting_approval' as const }))
  const scenePlans = [...draft.scenePlans.map(item => item.chapterPlanId === planId && ['draft', 'awaiting_approval'].includes(item.approval)
    ? { ...item, approval: 'rejected' as const } : item), ...pending]
  return { ...draft, scenePlans, chapterPlans: draft.chapterPlans.map(item => item.id === planId
    ? { ...item, scenePlanIds: scenePlans.filter(scene => scene.chapterPlanId === planId && scene.approval !== 'rejected').map(scene => scene.id) } : item),
    approval: { ...draft.approval, 'scene-outline': 'awaiting_approval' }, updatedAt: now }
}

export function approveScenePlans(draft: CreationDraft, planId: string, sceneIds: string[], now: string): CreationDraft {
  requireSceneParent(draft, planId)
  const scenes = sceneIds.map(id => draft.scenePlans.find(item => item.id === id && item.chapterPlanId === planId && item.approval !== 'rejected'))
  if (!sceneIds.length || new Set(sceneIds).size !== sceneIds.length || scenes.some(item => !item || !item.title.trim() || !item.purpose.trim() || !item.outputState.trim())) {
    throw new Error('请检查并选择完整的场景方案')
  }
  return { ...draft, scenePlans: draft.scenePlans.map(item => item.chapterPlanId !== planId ? item
    : sceneIds.includes(item.id) ? { ...item, order: sceneIds.indexOf(item.id) + 1, approval: 'approved' } : { ...item, approval: 'rejected' }),
    chapterPlans: draft.chapterPlans.map(item => item.id === planId ? { ...item, scenePlanIds: [...sceneIds] } : item), updatedAt: now }
}

/** 只投影当前章可用的作者确认内容，供提示、缓存和审核版本共用。 */
export function getApprovedPlanning(draft: CreationDraft | undefined, chapterIndex: number, novel?: Novel) {
  if (!draft) return undefined
  // 章节计划可能在场景页未挂载时被修改/删除，消费前也要核对来源，不能依赖页面同步。
  if (novel) draft = syncCreationDraftPlanning(draft, novel, draft.updatedAt)
  try { requireConfirmedStory(draft) } catch { return undefined }
  const { updatedAt: _updated, approval: _approval, cardConfirmations: _cards, ...contract } = draft.contract
  const plans = draft.chapterPlans.filter(item => item.approval === 'approved' && item.status !== 'archived'
    && item.number <= chapterIndex + 1 && (item.endNumber ?? item.number) >= chapterIndex + 1)
  return { contract, chapters: plans.map(({ status: _status, approval: _approved, scenePlanIds, ...plan }) => ({ ...plan,
    scenes: draft.scenePlans.filter(scene => scene.chapterPlanId === plan.id && scene.approval === 'approved' && scenePlanIds.includes(scene.id))
      .sort((a, b) => a.order - b.order).map(({ status: _sceneStatus, approval: _sceneApproval, ...scene }) => scene) })) }
}

export function formatApprovedPlanning(draft: CreationDraft | undefined, chapterIndex: number, novel?: Novel): string {
  const approved = getApprovedPlanning(draft, chapterIndex, novel)
  if (!approved) return ''
  return '【作者确认的作品契约与本章场景计划】\n以下是创作约束及待发生的计划，不是已经发生的事实。创作方向以已确认契约为准；与正文事实冲突时应指出并交作者处理，不擅自改写事实。未批准的场景不得作为既定方向。\n' + JSON.stringify(approved)
}

export function buildScenePlanningPrompt(draft: CreationDraft, planId: string, characters: Array<{ id: string; name: string }>,
  input?: { instructions: string; scenes: ScenePlan[]; alternatives: Array<{ title: string; scenes: ScenePlan[] }> }): string {
  const plan = requireSceneParent(draft, planId)
  return '将作者确认的本章计划拆成 2–6 个连续场景，每个场景写明目的、冲突、必须动作、谁获得什么信息以及结束状态。遵守禁止揭露的秘密；不把计划视为已发生事实。只输出 JSON：'
    + '{"scenes":[{"title":"","purpose":"","viewpointCharacterId":"角色ID或空串","locationId":"地点名称","conflict":"","requiredActions":[""],"informationChanges":[""],"outputState":""}]}\n'
    + JSON.stringify({ contract: draft.contract, skeleton: draft.skeletons.find(item => item.id === draft.selectedSkeletonId), chapter: plan, characters,
      ...(input ? { authorInstructions: input.instructions, editingCandidate: input.scenes, previousAlternatives: input.alternatives,
        request: '这次只生成一个完整的新方案，供作者比较；不要把已有候选当成已批准场景。' } : {}) })
}

/** Parse the complete root, never a balanced inner fragment of truncated JSON. */
export function parseScenePlanningOutput(content: string, planId: string, batchId: string, characterIds: string[]): ScenePlan[] {
  const source = content.trim().replace(/^\x60{3}(?:json)?\s*/i, '').replace(/\s*\x60{3}$/, '').trim()
  let raw: unknown
  try { raw = JSON.parse(source) } catch { throw new Error('场景 JSON 未完整闭合，原始输出已保留，请恢复补齐或明确续作。') }
  return normalizeScenePlans(raw, planId, batchId, characterIds)
}

/** Recover balanced scene objects for editing only; callers must retain incomplete=true. */
export function recoverPartialScenePlans(content: string, planId: string, batchId: string, characterIds: string[]): ScenePlan[] {
  const values: Record<string, unknown>[] = [], starts: number[] = []
  let quoted = false, escaped = false
  for (let index = 0; index < content.length; index++) {
    const char = content[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (char.charCodeAt(0) === 92) escaped = true
      else if (char === '"') quoted = false
    } else if (char === '"') quoted = true
    else if (char === '{') starts.push(index)
    else if (char === '}' && starts.length) {
      const start = starts.pop()!
      try {
        const value = JSON.parse(content.slice(start, index + 1))
        if (value && typeof value === 'object' && !Array.isArray(value) && ('purpose' in value || 'outputState' in value)) values.push(value)
      } catch { /* The unclosed remainder stays in the durable request output. */ }
    }
  }
  return values.slice(0, 12).map((value, index) => ({ id: 'scene:' + batchId + ':' + index, chapterPlanId: planId,
    order: index + 1, title: text(value.title, 120), purpose: text(value.purpose), outputState: text(value.outputState),
    viewpointCharacterId: typeof value.viewpointCharacterId === 'string' && characterIds.includes(value.viewpointCharacterId) ? value.viewpointCharacterId : undefined,
    locationId: text(value.locationId, 180) || undefined, conflict: text(value.conflict), requiredActions: lines(value.requiredActions),
    informationChanges: lines(value.informationChanges), status: 'planned', approval: 'draft' }))
}
