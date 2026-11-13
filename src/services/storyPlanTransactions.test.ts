import { describe, expect, it } from 'vitest'
import { beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { characterStateFixture, stateTestTime as now } from '@/test/characterStateFixture'
import type { ReconstructionWorkspaceSnapshot } from '@/types/reconstruction'
import { applyChapterPlanEdit } from './storyPlanTransactions'
import { createCreationDraftFromNovel, syncCreationDraftPlanning } from './reconstructionCreation'
import { getApprovedPlanning } from './reconstructionPlanning'

const emptyWorkspace = (): ReconstructionWorkspaceSnapshot => ({ candidates: [], reviewFindings: [], chapterReviews: [], aiRuns: [], canonMutations: [] })
const input = (title = '调查线') => ({ horizon: 'near' as const, status: 'planned' as const, title, objective: '找到线索', summary: '推进调查', beats: ['询问', '跟进'],
  targetChapterStart: 0, targetChapterEnd: 1, relatedArcIds: [], relatedEventIds: [], source: 'user' as const })
beforeEach(() => setActivePinia(createPinia()))

describe('chapter plan impact transactions', () => {
  it.each([true, false])('confirms planning without changing prose or Canon, with an existing first chapter: %s', existing => {
    const { novel } = characterStateFixture(), workspace = emptyWorkspace()
    novel.volumes = [{ id: 'v', volumeIndex: 0, title: '灯起', theme: '', summary: '寻找信件', keyTurningPoints: '', characterChanges: '', estimatedChapters: 0, estimatedWordCount: 1 }]
    const savedChapter = novel.chapters[0]
    if (!existing) novel.chapters = []
    novel.chapterPlans = [{ ...input(), id: 'p', createdAt: now, updatedAt: now }]
    let draft = createCreationDraftFromNovel(novel, now)
    draft.contract.approval = 'approved'; draft.approval.contract = 'approved'; draft.approval.skeleton = 'approved'
    draft.selectedSkeletonId = 's'; draft.skeletons = [{ id: 's', title: '调查', premise: '调查', logline: '调查', promise: '悬疑', ending: '查明', beats: [], approval: 'approved', updatedAt: now }]
    draft = syncCreationDraftPlanning(draft, novel, now); workspace.creationDraft = draft
    const prose = novel.chapters.map(chapter => chapter.content), chapterIds = novel.chapters.map(chapter => chapter.id), canon = JSON.stringify(workspace.canonMutations)
    applyChapterPlanEdit({ novel, workspace }, { action: 'confirm-planning', expectedVolumes: JSON.stringify(novel.volumes), expectedPlans: JSON.stringify(novel.chapterPlans), confirmCreation: true }, now, () => 'confirm')
    expect(workspace.creationDraft?.approval['chapter-outline']).toBe('approved')
    expect(workspace.creationDraft?.volumes[0].approval).toBe('approved')
    expect(getApprovedPlanning(workspace.creationDraft, 0, novel)?.chapters).toHaveLength(1)
    expect(workspace.creationDraft?.scenePlans).toEqual([])
    expect(novel.chapters.map(chapter => chapter.content)).toEqual(prose)
    expect(JSON.stringify(workspace.canonMutations)).toBe(canon)
    expect(workspace.impactReports?.[0].reviewChapterIds).toEqual(chapterIds)
    if (!existing) {
      novel.chapters = [{ ...savedChapter, chapterIndex: 0, volumeIndex: 0, content: '', wordCount: 0 }]
      expect(getApprovedPlanning(workspace.creationDraft, 0, novel)?.chapters).toHaveLength(1)
    }
  })
  it('rejects creation planning confirmation before the story direction is approved', () => {
    const { novel } = characterStateFixture(), workspace = emptyWorkspace()
    novel.chapterPlans = [{ ...input(), id: 'p', createdAt: now, updatedAt: now }]
    expect(() => applyChapterPlanEdit({ novel, workspace }, { action: 'confirm-planning', expectedVolumes: JSON.stringify(novel.volumes), expectedPlans: JSON.stringify(novel.chapterPlans), confirmCreation: true }, now, () => 'nope')).toThrow('契约')
    expect(novel.chapterPlanConfirmed).not.toBe(true)
    expect(workspace.impactReports).toBeUndefined()
  })
  it('records creation and invalidates written chapter reviews in the same aggregate', () => {
    const { novel } = characterStateFixture(); novel.chapters[0].content = '已写正文'; novel.chapters[0].status = 'finalized'; novel.chapters[0].contentReviewSignature = 'valid'
    const workspace = emptyWorkspace(), result = applyChapterPlanEdit({ novel, workspace }, { action: 'create', data: input() }, now, () => 'plan-1')
    expect(result.created?.id).toBe('plan-1')
    expect(workspace.impactReports).toHaveLength(1)
    expect(workspace.impactReports![0].changes[0]).toMatchObject({ target: { kind: 'plan', id: 'plan-1' }, action: 'create' })
    expect(workspace.impactReports![0].reviewChapterIds).toContain(novel.chapters[0].id)
    expect(novel.chapters[0].status).toBe('writing')
    expect(novel.chapters[0].contentReviewSignature).toBe('')
  })

  it('rejects a stale update without changing the plan or emitting a report', () => {
    const { novel } = characterStateFixture(); novel.chapterPlans = [{ ...input(), id: 'plan-1', createdAt: now, updatedAt: now }]
    const workspace = emptyWorkspace(), baseline = JSON.stringify(novel.chapterPlans[0])
    novel.chapterPlans[0].title = '作者已修改'
    expect(() => applyChapterPlanEdit({ novel, workspace }, { action: 'update', planId: 'plan-1', expectedPlan: baseline, updates: { title: '过期修改' } }, now, () => 'unused')).toThrow('编辑期间发生变化')
    expect(novel.chapterPlans[0].title).toBe('作者已修改')
    expect(workspace.impactReports).toBeUndefined()
  })

  it('records completion for every matching next plan and removes deleted references', () => {
    const { novel } = characterStateFixture(); novel.chapters[0].content = '已写正文'
    novel.chapterPlans = [
      { ...input('本章计划'), id: 'plan-1', horizon: 'next', targetChapterStart: 0, targetChapterEnd: 0, createdAt: now, updatedAt: now },
      { ...input('后续计划'), id: 'plan-2', horizon: 'next', targetChapterStart: 0, targetChapterEnd: 1, createdAt: now, updatedAt: now },
    ]
    const workspace = emptyWorkspace(), aggregate = { novel, workspace }
    const completed = applyChapterPlanEdit(aggregate, { action: 'complete', chapterIndex: 0 }, now, () => 'report-1')
    expect(completed.completed).toBe(2)
    expect(novel.chapterPlans.every(plan => plan.status === 'awaiting_review')).toBe(true)
    expect(workspace.impactReports![0].changes).toHaveLength(2)

    const deleted = applyChapterPlanEdit(aggregate, { action: 'delete', planId: 'plan-1', expectedPlan: JSON.stringify(novel.chapterPlans[0]) }, now, () => 'report-2')
    expect(deleted.changed).toBe(true)
    expect(novel.chapterPlans.map(plan => plan.id)).toEqual(['plan-2'])
    expect(workspace.impactReports).toHaveLength(2)
    expect(workspace.impactReports![1].changes[0]).toMatchObject({ target: { id: 'plan-1' }, action: 'delete' })
  })
})
