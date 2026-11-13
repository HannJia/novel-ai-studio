import type { Novel } from '@/types/novel'
import type { ChapterPlanV2, CreationDraft, ScenePlan } from '@/types/reconstruction'
import type { StoryImpactChange, StoryImpactKind } from '@/types/storyImpact'
import type { StoryAggregate } from './storyAggregate'
import { captureCreationBaseline } from './creationTransactions'
import { createCreationDraftFromNovel, syncCreationDraftPlanning } from './reconstructionCreation'
import { approveScenePlans, confirmChapterPlan, getApprovedPlanning, normalizeScenePlans, proposeScenePlans, requireSceneParent, reviseChapterPlan } from './reconstructionPlanning'
import { captureStoryImpact } from './storyImpactAnalysis'
import { appendStoryImpactReport, invalidateWrittenChapterReviews } from './storyImpactTransactions'
import { sceneContentSignature, sceneRecovery } from './planningRecovery'
import { assertScenePlanningRecovery } from './planningRecoveryValidation'

export type ScenePlanningEdit =
  | { action: 'sync' }
  | { action: 'chapter'; plan: ChapterPlanV2; confirm: boolean }
  | { action: 'scenes'; planId: string; scenes: ScenePlan[]; confirm: boolean; revisionId?: string }

export function captureScenePlanningBaseline(novel: Novel, draft?: CreationDraft): string {
  return JSON.stringify([novel.id, captureCreationBaseline(novel, draft ? { ...draft, sceneRecovery: undefined } : undefined),
    novel.chapters.map(chapter => [chapter.id, chapter.chapterIndex, chapter.volumeIndex])])
}

function semantic(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(semantic)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'updatedAt').map(([key, item]) => [key, semantic(item)]))
  return value
}
const signature = (value: unknown) => JSON.stringify(semantic(value))
const sceneContent = (scenes: ScenePlan[]) => JSON.stringify(scenes.map(scene => [scene.title, scene.purpose,
  scene.viewpointCharacterId || '', scene.locationId || '', scene.conflict || '', scene.requiredActions,
  scene.informationChanges, scene.outputState]))

function rowChanges<T extends { id: string; title: string }>(before: T[], after: T[], kind: StoryImpactKind): StoryImpactChange[] {
  const old = new Map(before.map(row => [row.id, row])), next = new Map(after.map(row => [row.id, row]))
  return [...new Set([...old.keys(), ...next.keys()])].flatMap(id => {
    const previous = old.get(id), current = next.get(id)
    if (signature(previous) === signature(current)) return []
    return [{ target: { kind, id, label: current?.title || previous?.title || '未命名规划' },
      action: !previous ? 'create' as const : !current ? 'delete' as const : 'update' as const,
      fields: !previous || !current ? ['$exists'] : [...new Set([...Object.keys(previous), ...Object.keys(current)])]
        .filter(field => field !== 'updatedAt' && signature((previous as Record<string, unknown>)[field]) !== signature((current as Record<string, unknown>)[field])) }]
  })
}

/** Mutate only the private aggregate. The store publishes after the durable commit. */
export function applyScenePlanningEdit(aggregate: StoryAggregate, edit: ScenePlanningEdit, expected: string,
  now: string, id: () => string): { changed: boolean; baseline: string } {
  const { novel, workspace } = aggregate
  if (expected !== captureScenePlanningBaseline(novel, workspace.creationDraft)) {
    throw new Error('作品契约、章节或场景规划已变化，当前输入已保留，请核对最新规划后再保存。')
  }
  const previous = workspace.creationDraft, before = captureStoryImpact(novel, workspace)
  const reviewInputs = new Map(novel.chapters.filter(chapter => chapter.content.trim())
    .map(chapter => [chapter.id, JSON.stringify(getApprovedPlanning(previous, chapter.chapterIndex, novel))]))
  let next = syncCreationDraftPlanning(previous || createCreationDraftFromNovel(novel, now), novel, now)
  if (previous && signature({ ...next, stage: previous.stage }) === signature(previous)) next.stage = previous.stage
  if (edit.action === 'chapter') {
    next = reviseChapterPlan(next, edit.plan, now)
    if (edit.confirm) next = confirmChapterPlan(next, edit.plan.id, now)
  } else if (edit.action === 'scenes') {
    const chapter = requireSceneParent(next, edit.planId)
    const normalized = normalizeScenePlans(edit.scenes, edit.planId, id(), novel.characters.map(person => person.id))
    if (edit.revisionId) {
      const recovery = sceneRecovery(next)
      assertScenePlanningRecovery(recovery)
      const revision = recovery.revisions.find(row => row.id === edit.revisionId)
      if (!revision || revision.chapterPlanId !== edit.planId || revision.baseline !== expected
        || signature(revision.chapter) !== signature(chapter)
        || recovery.options.find(row => row.id === revision.optionId)?.revisionId !== revision.id
        || sceneContentSignature(revision.scenes) !== sceneContentSignature(normalized)) {
        throw new Error('场景候选版本或打开基线已变化，输入已保留；请核对并保存新作者版本。')
      }
      if (edit.confirm && !revision.complete) throw new Error('未完整生成的场景须先由作者补齐并保存，不能直接批准。')
    }
    const pending = next.scenePlans.filter(scene => scene.chapterPlanId === edit.planId && ['draft', 'awaiting_approval'].includes(scene.approval))
      .sort((a, b) => a.order - b.order)
    const approved = next.scenePlans.filter(scene => scene.chapterPlanId === edit.planId && scene.approval === 'approved')
      .sort((a, b) => a.order - b.order)
    const current = pending.length ? pending : approved
    let ids = current.map(scene => scene.id)
    if (sceneContent(current) !== sceneContent(normalized)) {
      next = proposeScenePlans(next, edit.planId, normalized, now)
      ids = normalized.map(scene => scene.id)
    }
    if (edit.confirm) next = approveScenePlans(next, edit.planId, ids, now)
  }
  if (signature(previous) === signature(next)) return { changed: false, baseline: expected }
  workspace.creationDraft = next
  const reviewChapterIds = novel.chapters.filter(chapter => reviewInputs.has(chapter.id)
    && reviewInputs.get(chapter.id) !== JSON.stringify(getApprovedPlanning(next, chapter.chapterIndex, novel))).map(chapter => chapter.id)
  const changedReviews = new Set(reviewChapterIds)
  if (reviewChapterIds.length) invalidateWrittenChapterReviews(aggregate, novel.chapters.filter(chapter => !changedReviews.has(chapter.id)).map(chapter => chapter.id))
  const changes = [...rowChanges(previous?.chapterPlans || [], next.chapterPlans, 'plan'),
    ...rowChanges(previous?.scenePlans || [], next.scenePlans, 'scene')]
  if (!changes.length || signature(previous?.volumes) !== signature(next.volumes)) {
    changes.push({ target: { kind: 'novel', id: novel.id, label: novel.title }, action: previous ? 'update' : 'create', fields: ['creationDraft'] })
  }
  novel.updatedAt = now
  appendStoryImpactReport(aggregate, before, changes, reviewChapterIds, now, id, undefined, 'changed-inputs')
  return { changed: true, baseline: captureScenePlanningBaseline(novel, next) }
}
