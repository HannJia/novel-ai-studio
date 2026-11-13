import type { ChapterPlan, Novel } from '@/types/novel'
import type { StoryAggregate } from './storyAggregate'
import { appendPlanningVersion, createPlanningSnapshot } from './planningVersions'
import { captureStoryImpact } from './storyImpactAnalysis'
import { appendStoryImpactReport } from './storyImpactTransactions'
import type { StoryImpactChange } from '@/types/storyImpact'
import type { StoryMemoryRecord } from '@/types/storyMemory'
import type { KnowledgeBase } from '@/types/knowledge'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import { createCreationDraftFromNovel, syncCreationDraftPlanning } from './reconstructionCreation'
import { registerChapterReviewInvalidation } from './chapterReviewInvalidationRequests'
import { confirmChapterPlan, requireConfirmedStory } from './reconstructionPlanning'

export type ChapterPlanInput = Omit<ChapterPlan, 'id' | 'createdAt' | 'updatedAt'>
export type ChapterPlanEdit =
  | { action: 'create'; data: ChapterPlanInput }
  | { action: 'create-batch'; plans: ChapterPlanInput[]; planningSourceVersion: string }
  | { action: 'update'; planId: string; expectedPlan: string; updates: Partial<Omit<ChapterPlan, 'id' | 'createdAt'>> }
  | { action: 'delete'; planId: string; expectedPlan?: string }
  | { action: 'complete'; chapterIndex: number }
  | { action: 'confirm-planning'; expectedVolumes: string; expectedPlans: string; confirmCreation?: boolean }

export interface ChapterPlanEditResult { changed: boolean; plans: ChapterPlan[]; created?: ChapterPlan; completed: number; reviewChapterIds?: string[] }
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))

/** Inputs used by chapter planning, excluding the plans this candidate batch will add. */
export function chapterPlanningSourceVersion(novel: Novel, memories: StoryMemoryRecord[] = [], knowledge: KnowledgeBase[] = []): string {
  return buildAnalysisSourceVersionId(JSON.stringify([novel.id, novel.title, novel.outline, novel.volumes,
    novel.characters, novel.eventLog, novel.storyArcs, novel.chapters.map(chapter => [chapter.id, chapter.chapterIndex,
      chapter.volumeIndex, chapter.title, chapter.content, chapter.summary, chapter.summarySource, chapter.status]),
    memories, (novel.knowledgeBaseIds || []).map(id => [id, knowledge.find(base => base.id === id)])]))
}

function normalizePlan(data: ChapterPlanInput, id: string, now: string): ChapterPlan {
  const start = Math.max(0, Math.round(data.targetChapterStart))
  return { ...copy(data), id, title: data.title.trim(), objective: data.objective.trim(), summary: data.summary.trim(),
    beats: data.beats.map(item => item.trim()).filter(Boolean).slice(0, 12), targetChapterStart: start,
    targetChapterEnd: Math.max(start, Math.round(data.targetChapterEnd)), relatedArcIds: [...new Set(data.relatedArcIds)],
    relatedEventIds: [...new Set(data.relatedEventIds)], versions: data.versions || [], createdAt: now, updatedAt: now }
}

/** Apply a chapter-plan mutation to a private aggregate and persist its impact report with it. */
export function applyChapterPlanEdit(aggregate: StoryAggregate, edit: ChapterPlanEdit, now: string, id: () => string,
  knowledge: KnowledgeBase[] = []): ChapterPlanEditResult {
  const { novel, workspace } = aggregate
  const before = captureStoryImpact(novel, workspace)
  novel.chapterPlans ||= []
  const changes: StoryImpactChange[] = []
  let created: ChapterPlan | undefined
  let completed = 0

  if (edit.action === 'create-batch') {
    if (edit.planningSourceVersion !== chapterPlanningSourceVersion(novel, workspace.storyMemories, knowledge)) {
      throw new Error('生成计划所依据的大纲、正文或记忆已经变化，请重新生成并核对。')
    }
    const planKey = (plan: ChapterPlanInput) => JSON.stringify([plan.horizon, plan.title.trim().toLowerCase(), plan.targetChapterStart])
    const existing = new Set(novel.chapterPlans.map(planKey))
    for (const input of edit.plans) {
      if (existing.has(planKey(input))) continue
      const plan = normalizePlan(input, id(), now)
      if (!plan.title || !plan.objective) throw new Error('请检查每条计划的名称和目标。')
      novel.chapterPlans.push(plan); existing.add(planKey(plan))
      changes.push({ target: { kind: 'plan', id: plan.id, label: plan.title }, action: 'create', fields: ['$exists'] })
    }
    if (!changes.length) return { changed: false, plans: novel.chapterPlans, completed: 0 }
  } else if (edit.action === 'create') {
    const plan = normalizePlan(edit.data, id(), now)
    novel.chapterPlans.push(plan); created = plan
    changes.push({ target: { kind: 'plan', id: plan.id, label: plan.title }, action: 'create', fields: ['$exists'] })
  } else if (edit.action === 'update') {
    const plan = novel.chapterPlans.find(item => item.id === edit.planId)
    if (!plan) throw new Error('章节计划已删除，请重新打开。')
    if (edit.expectedPlan && JSON.stringify(plan) !== edit.expectedPlan) throw new Error('章节计划在编辑期间发生变化，请重新打开核对。')
    const beforePlan = createPlanningSnapshot(plan), next = { ...plan, ...copy(edit.updates) } as ChapterPlan
    const afterPlan = createPlanningSnapshot(next)
    if (beforePlan === afterPlan) return { changed: false, plans: novel.chapterPlans, completed: 0 }
    plan.versions = appendPlanningVersion(plan.versions, beforePlan, '编辑前版本', now)
    Object.assign(plan, copy(edit.updates), { updatedAt: now })
    plan.title = plan.title.trim(); plan.objective = plan.objective.trim(); plan.summary = plan.summary.trim()
    plan.targetChapterStart = Math.max(0, Math.round(plan.targetChapterStart))
    plan.targetChapterEnd = Math.max(plan.targetChapterStart, Math.round(plan.targetChapterEnd))
    plan.beats = plan.beats.map(item => item.trim()).filter(Boolean).slice(0, 12)
    changes.push({ target: { kind: 'plan', id: plan.id, label: plan.title }, action: 'update', fields: Object.keys(edit.updates) })
  } else if (edit.action === 'delete') {
    const plan = novel.chapterPlans.find(item => item.id === edit.planId)
    if (!plan) return { changed: false, plans: novel.chapterPlans, completed: 0 }
    if (edit.expectedPlan && JSON.stringify(plan) !== edit.expectedPlan) throw new Error('章节计划在删除期间发生变化，请重新打开核对。')
    changes.push({ target: { kind: 'plan', id: plan.id, label: plan.title }, action: 'delete', fields: ['$exists'] })
    novel.chapterPlans = novel.chapterPlans.filter(item => item.id !== plan.id)
    novel.storyStateProposals = novel.storyStateProposals?.filter(item => item.targetType !== 'chapter_plan' || item.targetId !== plan.id)
  } else if (edit.action === 'confirm-planning') {
    if (JSON.stringify(novel.volumes) !== edit.expectedVolumes || JSON.stringify(novel.chapterPlans) !== edit.expectedPlans) {
      throw new Error('分卷或章节计划已经变化，请重新核对后确认。')
    }
    if (!novel.chapterPlans.length) throw new Error('请先检查并确认至少一条章节计划。')
    if (edit.confirmCreation) {
      const draft = syncCreationDraftPlanning(workspace.creationDraft || createCreationDraftFromNovel(novel, now), novel, now)
      requireConfirmedStory(draft)
      if (!draft.volumes.length || !draft.chapterPlans.some(plan => plan.status !== 'archived')) throw new Error('请先保存分卷与章节计划。')
      // Validate every displayed plan before changing the aggregate. Scene approvals remain separate.
      for (const plan of draft.chapterPlans.filter(plan => plan.status !== 'archived')) confirmChapterPlan(draft, plan.id, now)
    }
    if (novel.chapterPlanConfirmed && !edit.confirmCreation) return { changed: false, plans: novel.chapterPlans, completed: 0 }
    novel.chapterPlanConfirmed = true
    changes.push({ target: { kind: 'novel', id: novel.id, label: novel.title }, action: 'confirm', fields: ['chapterPlanConfirmed'] })
  } else {
    for (const plan of novel.chapterPlans) if (plan.horizon === 'next' && ['planned', 'active'].includes(plan.status)
      && plan.targetChapterStart <= edit.chapterIndex && plan.targetChapterEnd >= edit.chapterIndex) {
      plan.status = 'awaiting_review'; plan.updatedAt = now; completed++
      changes.push({ target: { kind: 'plan', id: plan.id, label: plan.title }, action: 'confirm', fields: ['status'] })
    }
    if (!completed) return { changed: false, plans: novel.chapterPlans, completed: 0 }
  }

  workspace.creationDraft = syncCreationDraftPlanning(workspace.creationDraft || createCreationDraftFromNovel(novel, now), novel, now)
  if (edit.action === 'confirm-planning' && edit.confirmCreation) {
    let draft = workspace.creationDraft
    for (const plan of draft.chapterPlans.filter(plan => plan.status !== 'archived')) draft = confirmChapterPlan(draft, plan.id, now)
    workspace.creationDraft = { ...draft, stage: 'ready', volumes: draft.volumes.map(volume => ({ ...volume, approval: 'approved' })),
      approval: { ...draft.approval, 'volume-outline': 'approved', 'chapter-outline': 'approved' }, updatedAt: now }
  }
  const reviewChapterIds = edit.action === 'confirm-planning' && !edit.confirmCreation ? []
    : registerChapterReviewInvalidation(novel, novel.chapters.map(chapter => chapter.id))
  novel.updatedAt = now
  appendStoryImpactReport(aggregate, before, changes, reviewChapterIds, now, id)
  return { changed: true, plans: novel.chapterPlans, created, completed, reviewChapterIds }
}
