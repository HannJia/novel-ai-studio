import { confirmTestStoryContract as confirmStoryContract } from '@/test/contractCardsFixture'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useNovelStore } from '@/stores/novel'
import { buildPlotSkeletonFromOutline, confirmCreationSkeleton,  createCreationDraftFromNovel, reviseCreationSkeleton, reviseStoryContract, syncCreationDraftPlanning } from './reconstructionCreation'
import { approveScenePlans, buildScenePlanningPrompt, confirmChapterPlan, formatApprovedPlanning, normalizeScenePlans, proposeScenePlans, reviseChapterPlan } from './reconstructionPlanning'
import { buildReviewContext, buildWritingContext } from './context'
import { buildReviewContextVersion } from './reconstructionReviewVersion'

const now = '2026-10-27T00:00:00.000Z'
beforeEach(() => setActivePinia(createPinia()))
function fixture() {
  const store = useNovelStore()
  const novel = store.addNovel({ genre: 'urban', subGenre: 'business', tags: [], targetWordCountMin: 80, targetWordCountMax: 100,
    writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() })
  novel.volumes = [{ id: 'v1', volumeIndex: 0, title: '雾城', theme: '', summary: '追查', keyTurningPoints: '遇到阻力', characterChanges: '开始怀疑', estimatedChapters: 30, estimatedWordCount: 6 }]
  const chapter = store.addChapter(novel.id, { title: '进入城门', content: '', volumeIndex: 0 })!
  store.addChapterPlan(novel.id, { horizon: 'next', title: chapter.title, objective: '得到线索', summary: '守卫阻拦', beats: ['询问守卫'],
    targetChapterStart: 0, targetChapterEnd: 0, relatedArcIds: [], relatedEventIds: [], status: 'planned', source: 'user' })
  let draft = createCreationDraftFromNovel(novel, now)
  draft = confirmStoryContract(draft, { ...draft.contract, centralConflict: '寻找真相', endingDirection: '暂不确定', forbiddenTopics: ['禁止突然复活'] }, now)
  draft.skeletons = [buildPlotSkeletonFromOutline(novel, '## 小说简介\n追寻失踪者', now)]
  draft.skeletons[0] = { ...draft.skeletons[0], logline: '林澈追查失踪者并逐步揭开真相。', promise: '每个线索都推进失踪案调查。',
    ending: '林澈找到失踪者并作出选择。', beats: [{ id: 'beat-opening', title: '获得线索', description: '林澈发现第一条线索。',
      kind: 'opening', relatedPlotlineIds: [], relatedCharacterIds: [] }] }
  draft = confirmCreationSkeleton(draft, now)
  draft = syncCreationDraftPlanning(draft, novel, now)
  const planId = draft.chapterPlans[0].id
  draft = confirmChapterPlan(draft, planId, now)
  return { store, novel, chapter, draft, planId }
}
const scene = (title: string) => ({ title, purpose: '试探守卫', conflict: '守卫拒绝透露', outputState: '获得线索', requiredActions: ['展示信物'], informationChanges: ['主角得知有人提前入城'] })

describe('approved chapter and scene planning', () => {
  it('requires downstream reapproval after switching or editing the confirmed skeleton', () => {
    const { draft, planId } = fixture()
    const scenes = normalizeScenePlans([scene('旧骨架对应场景')], planId, 'skeleton')
    let next = approveScenePlans(proposeScenePlans(draft, planId, scenes, now), planId, [scenes[0].id], now)
    next = reviseCreationSkeleton(next, next.selectedSkeletonId!, { ...next.skeletons[0], ending: '全新的结局' }, now)
    next = confirmCreationSkeleton(next, now)
    expect(next.chapterPlans[0].approval).toBe('draft')
    expect(next.scenePlans[0].approval).toBe('draft')
    expect(formatApprovedPlanning(next, 0)).not.toContain('旧骨架对应场景')
  })
  it('keeps the approved scene set active until the author approves a complete replacement', () => {
    const { draft, planId } = fixture()
    const original = normalizeScenePlans([scene('原方案')], planId, 'one')
    let next = approveScenePlans(proposeScenePlans(draft, planId, original, now), planId, original.map(item => item.id), now)
    const proposed = normalizeScenePlans([scene('替代方案')], planId, 'two')
    next = proposeScenePlans(next, planId, proposed, now)
    expect(formatApprovedPlanning(next, 0)).toContain('原方案')
    expect(formatApprovedPlanning(next, 0)).not.toContain('替代方案')
    next = approveScenePlans(next, planId, proposed.map(item => item.id), now)
    expect(formatApprovedPlanning(next, 0)).toContain('替代方案')
    expect(formatApprovedPlanning(next, 0)).not.toContain('原方案')
    expect(next.scenePlans.find(item => item.id === original[0].id)?.approval).toBe('rejected')
    expect(() => approveScenePlans(next, planId, ['unknown'], now)).toThrow('完整')
  })

  it('rejects malformed scenes, forged viewpoints, and unconfirmed or multi-chapter parents', () => {
    const { draft, planId } = fixture()
    expect(() => normalizeScenePlans([{}], planId, 'bad')).toThrow('名称')
    expect(() => normalizeScenePlans([scene('场景'), { ...scene('场景二'), viewpointCharacterId: 'invented' }], planId, 'bad')).toThrow('角色')
    expect(() => normalizeScenePlans([], planId, 'bad')).toThrow('1–12')
    expect(() => buildScenePlanningPrompt({ ...draft, approval: {} }, planId, [])).toThrow('作品契约')
    draft.chapterPlans[0].endNumber = 3
    expect(() => buildScenePlanningPrompt(draft, planId, [])).toThrow('单个章节')
  })

  it('preserves V2 details and links across synchronization and revokes scenes when a source plan changes', () => {
    const { draft, novel, planId } = fixture()
    let next = reviseChapterPlan(draft, { ...draft.chapterPlans[0], title: '作者修改的标题', openingState: '日落时分', endingState: '赶在关门前入城', prohibitedReveals: ['不能揭露父亲身份'] }, now)
    next = confirmChapterPlan(next, planId, now)
    const scenes = normalizeScenePlans([scene('过城门')], planId, 'stable')
    next = approveScenePlans(proposeScenePlans(next, planId, scenes, now), planId, [scenes[0].id], now)
    const synced = syncCreationDraftPlanning(next, novel, now)
    expect(synced.chapterPlans[0]).toMatchObject({ title: '作者修改的标题', openingState: '日落时分', prohibitedReveals: ['不能揭露父亲身份'], volumeId: 'volume:v1', approval: 'approved', scenePlanIds: [scenes[0].id] })
    expect(synced.volumes[0].chapterPlanIds).toEqual([planId])
    expect(synced.scenePlans[0].approval).toBe('approved')
    novel.chapterPlans![0].summary = '守卫同意放行'
    const changed = syncCreationDraftPlanning(synced, novel, now)
    expect(changed.chapterPlans[0].approval).toBe('draft')
    expect(changed.scenePlans[0].approval).toBe('draft')
    expect(changed.chapterPlans[0].prohibitedReveals).toEqual(['不能揭露父亲身份'])
    expect(formatApprovedPlanning(changed, 0)).not.toContain('过城门')
  })

  it('binds writing, review and their cached versions to approved scenes without including pending or other-chapter scenes', () => {
    const { draft, novel, chapter, planId } = fixture()
    const scenes = normalizeScenePlans([scene('已批场景')], planId, 'first')
    let next = proposeScenePlans(draft, planId, scenes, now)
    const initial = buildWritingContext(novel, chapter, undefined, next)
    const initialVersion = buildReviewContextVersion(novel, chapter, [], next)
    expect(initial.chapterGuidance).not.toContain('已批场景')
    next = approveScenePlans(next, planId, [scenes[0].id], now)
    expect(buildWritingContext(novel, chapter, undefined, next).chapterGuidance).toContain('已批场景')
    expect(buildReviewContext(novel, chapter, '', undefined, undefined, next).chapterGuidance).toContain('已批场景')
    expect(buildReviewContextVersion(novel, chapter, [], next)).not.toBe(initialVersion)
    const version = buildReviewContextVersion(novel, chapter, [], next)
    next = proposeScenePlans(next, planId, normalizeScenePlans([scene('未批场景')], planId, 'pending'), now)
    expect(buildReviewContextVersion(novel, chapter, [], next)).toBe(version)
    expect(formatApprovedPlanning(next, 1)).not.toContain('已批场景')
    next.scenePlans[0].outputState = '被关在城外'
    expect(buildReviewContextVersion(novel, chapter, [], next)).not.toBe(version)
    expect(buildWritingContext(novel, chapter, undefined, next).chapterGuidance).toContain('被关在城外')
    next = reviseStoryContract(next, { ...next.contract, endingDirection: '远走高飞' }, now)
    expect(formatApprovedPlanning(next, 0)).toBe('')
    expect(buildWritingContext(novel, chapter, undefined, next).chapterGuidance).not.toContain('被关在城外')
  })

  it('includes prohibition and author intent in scene generation and invalidates approval after chapter edits', () => {
    const { draft, planId } = fixture()
    let next = reviseChapterPlan(draft, { ...draft.chapterPlans[0], prohibitedReveals: ['不可揭露凶手'] }, now)
    expect(() => buildScenePlanningPrompt(next, planId, [])).toThrow('本章计划')
    next = confirmChapterPlan(next, planId, now)
    expect(buildScenePlanningPrompt(next, planId, [])).toContain('不可揭露凶手')
    expect(buildScenePlanningPrompt(next, planId, [])).toContain('禁止突然复活')
  })

  it('rejects stale scene constraints even when the scene page did not synchronize an external chapter-plan edit', () => {
    const { draft, novel, chapter, planId } = fixture()
    const scenes = normalizeScenePlans([scene('旧场景目标')], planId, 'external')
    const next = approveScenePlans(proposeScenePlans(draft, planId, scenes, now), planId, [scenes[0].id], now)
    expect(buildWritingContext(novel, chapter, undefined, next).chapterGuidance).toContain('旧场景目标')
    const before = buildReviewContextVersion(novel, chapter, [], next)
    novel.chapterPlans![0].objective = '作者从另一页面修改了章目标'
    expect(buildWritingContext(novel, chapter, undefined, next).chapterGuidance).not.toContain('旧场景目标')
    expect(buildReviewContext(novel, chapter, '', undefined, undefined, next).structuredState).not.toContain('旧场景目标')
    expect(buildReviewContextVersion(novel, chapter, [], next)).not.toBe(before)
    expect(next.scenePlans[0].approval).toBe('approved') // 读取只做有效性投影，不偷偷修改作者草稿。
  })

  it('revokes dependent scenes after a volume change while preserving detailed chapter edits', () => {
    const { draft, novel, chapter, planId } = fixture()
    let next = confirmChapterPlan(reviseChapterPlan(draft, { ...draft.chapterPlans[0], title: '作者自定标题' }, now), planId, now)
    const scenes = normalizeScenePlans([scene('旧卷对应场景')], planId, 'volume')
    next = approveScenePlans(proposeScenePlans(next, planId, scenes, now), planId, [scenes[0].id], now)
    novel.volumes![0].summary = '更换本卷主线'
    expect(buildWritingContext(novel, chapter, undefined, next).chapterGuidance).not.toContain('旧卷对应场景')
    const updated = syncCreationDraftPlanning(next, novel, now)
    expect(updated.chapterPlans[0]).toMatchObject({ title: '作者自定标题', approval: 'draft' })
  })

  it('does not resurrect rejected history or mix the previous approved set into a pending replacement after contract edits', () => {
    const { draft, planId } = fixture()
    const old = normalizeScenePlans([scene('原方案')], planId, 'old')
    let next = approveScenePlans(proposeScenePlans(draft, planId, old, now), planId, [old[0].id], now)
    const pending = normalizeScenePlans([scene('新方案')], planId, 'new')
    next = proposeScenePlans(next, planId, pending, now)
    next = reviseStoryContract(next, { ...next.contract, endingDirection: '改变结局' }, now)
    expect(next.scenePlans.find(item => item.id === old[0].id)?.approval).toBe('rejected')
    expect(next.scenePlans.find(item => item.id === pending[0].id)?.approval).toBe('draft')
    next = reviseStoryContract(next, { ...next.contract, endingDirection: '再次修改结局' }, now)
    expect(next.scenePlans.find(item => item.id === old[0].id)?.approval).toBe('rejected')
  })
})
