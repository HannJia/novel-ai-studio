import { confirmTestStoryContract as confirmStoryContract } from '@/test/contractCardsFixture'
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as storyAggregate from '@/services/storyAggregate'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { useRoute } from 'vue-router'
import ScenePlanner from './ScenePlanner.vue'
import { useNovelStore } from '@/stores/novel'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { useConfigStore } from '@/stores/config'
import { callAI } from '@/services/ai'
import { createCreationDraftFromNovel,  buildPlotSkeletonFromOutline, confirmCreationSkeleton, syncCreationDraftPlanning } from '@/services/reconstructionCreation'
import { confirmChapterPlan, formatApprovedPlanning } from '@/services/reconstructionPlanning'

vi.mock('vue-router', async () => {
  const { reactive } = await import('vue')
  const route = reactive({ query: {} })
  return { useRoute: () => route, useRouter: () => ({ push: vi.fn() }) }
})
vi.mock('@/services/ai', async importOriginal => ({
  ...await importOriginal<object>(),
  callAI: vi.fn(),
}))
beforeEach(() => {
  setActivePinia(createPinia()); vi.clearAllMocks()
  useRoute().query = {}
  vi.spyOn(storyAggregate, 'readStoryAggregate').mockResolvedValue({ novel: null,
    workspace: { candidates: [], reviewFindings: [], canonMutations: [], chapterReviews: [], aiRuns: [] } })
  vi.spyOn(storyAggregate, 'saveStoryAggregate').mockResolvedValue()
})
afterEach(() => vi.restoreAllMocks())
const now = '2026-10-27T00:00:00.000Z'
async function fixture(options: { twoPlans?: boolean; initialPlanIndex?: number; routePlanIndex?: number; liveParent?: boolean } = {}) {
  const store = useNovelStore(), workspace = useReconstructionWorkspaceStore()
  const created = store.addNovel({ genre: 'urban', subGenre: 'business', tags: [], targetWordCountMin: 80, targetWordCountMax: 100,
    writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() })
  const novel = created
  store.addChapterPlan(novel.id, { horizon: 'next', title: '查访', objective: '获得线索', summary: '守卫阻拦', beats: options.liveParent ? ['核对原始记录'] : [],
    targetChapterStart: 0, targetChapterEnd: 0, relatedArcIds: [], relatedEventIds: [], status: 'planned', source: 'user' })
  if (options.twoPlans) store.addChapterPlan(novel.id, { horizon: 'next', title: '核实账册', objective: '核对线索', summary: '寻找登记员', beats: [],
    targetChapterStart: 1, targetChapterEnd: 1, relatedArcIds: [], relatedEventIds: [], status: 'planned', source: 'user' })
  let draft = createCreationDraftFromNovel(novel, now)
  draft = confirmStoryContract(draft, { ...draft.contract, centralConflict: '寻找父亲', endingDirection: '暂不确定' }, now)
  const skeleton = buildPlotSkeletonFromOutline(novel, '## 小说简介\n追寻失踪者', now)
  draft.skeletons = [{ ...skeleton, title: '追寻失踪者', premise: '父亲在一场旧案后失踪，主角循着零碎线索调查。',
    logline: '追寻失踪者并找到线索', promise: '逐步揭开父亲失踪的真相', ending: '主角找到父亲失踪的真相并作出选择。',
    beats: [{ id: 'beat:opening', title: '获得线索', description: '主角从守卫处得到第一条线索。', kind: 'opening',
      relatedCharacterIds: [], relatedPlotlineIds: [] }] }]
  draft = syncCreationDraftPlanning(confirmCreationSkeleton(draft, now), novel, now)
  for (const plan of draft.chapterPlans) draft = confirmChapterPlan(draft, plan.id, now)
  workspace.setCreationDraft(novel.id, draft)
  vi.spyOn(useConfigStore(), 'getModelForTask').mockReturnValue({ id: 'test', modelName: 'test', maxTokens: 4096, temperature: 0.7, topP: 1 } as never)
  if (options.routePlanIndex !== undefined) useRoute().query.plan = draft.chapterPlans[options.routePlanIndex].id
  const initialPlanId = options.initialPlanIndex !== undefined ? draft.chapterPlans[options.initialPlanIndex].id : undefined
  const wrapper = options.liveParent
    ? mount(defineComponent({ setup: () => () => h(ScenePlanner, { novel: store.getNovel(novel.id)!, ready: true, initialPlanId }) }))
    : mount(ScenePlanner, { props: { novel, ready: true, initialPlanId } })
  await flushPromises()
  const button = (label: string) => wrapper.findAll('button').find(item => item.text() === label)!
  const generateButton = () => button('生成一个新方案（先保留当前输入）')
  const submitScenes = () => wrapper.findAll('form').find(form => form.find('fieldset.scene-card').exists())!.trigger('submit')
  return { wrapper, button, generateButton, submitScenes, novel, workspace, plans: draft.chapterPlans }
}

describe('scene planning workbench', () => {
  it('uses native selection props and retains the current editor when the parent clears its selection', async () => {
    const { wrapper, plans } = await fixture({ twoPlans: true, initialPlanIndex: 1, routePlanIndex: 0 })
    expect(wrapper.get('select[aria-label="场景目标章节"]').element).toHaveProperty('value', plans[1].id)
    expect(wrapper.get('textarea[aria-label="章节名称"]').element).toHaveProperty('value', plans[1].title)
    useRoute().query.plan = 'unavailable-legacy-plan'
    await flushPromises()
    expect(wrapper.get('select[aria-label="场景目标章节"]').element).toHaveProperty('value', plans[1].id)
    useRoute().query.plan = plans[0].id
    await wrapper.setProps({ initialPlanId: undefined }); await flushPromises()
    expect(wrapper.get('select[aria-label="场景目标章节"]').element).toHaveProperty('value', plans[1].id)
    wrapper.unmount()
  })

  it('uses only native selection props when no plan is selected', async () => {
    const { wrapper, plans } = await fixture({ twoPlans: true, routePlanIndex: 1 })
    expect(wrapper.get('select[aria-label="场景目标章节"]').element).toHaveProperty('value', plans[0].id)
    useRoute().query.plan = plans[1].id
    await flushPromises()
    expect(wrapper.get('select[aria-label="场景目标章节"]').element).toHaveProperty('value', plans[0].id)
    wrapper.unmount()
  })

  it('checkpoints prop-driven chapter switches and restores the original author inputs without remounting', async () => {
    const { wrapper, button, novel, workspace, plans } = await fixture({ twoPlans: true, initialPlanIndex: 0, routePlanIndex: 0 })
    const instance = wrapper.vm, history = wrapper.getComponent({ name: 'ScenePlanningHistory' }).vm.$
    await button('添加场景').trigger('click')
    await wrapper.get('textarea[aria-label="场景1名称"]').setValue('切换前的手写场景')
    await wrapper.get('textarea[aria-label="场景1目的"]').setValue('保留作者线索')
    await wrapper.get('textarea[aria-label="场景1结束状态"]').setValue('尚未提交的结果')
    await wrapper.get('textarea[aria-label="章节目标"]').setValue('切换前的章目标')
    await wrapper.get('textarea[placeholder^="希望比较的方向"]').setValue('切换前的生成要求')
    await wrapper.setProps({ initialPlanId: plans[1].id }); await flushPromises()
    expect(wrapper.vm).toBe(instance)
    expect(wrapper.getComponent({ name: 'ScenePlanningHistory' }).vm.$).toBe(history)
    expect(wrapper.get('select[aria-label="场景目标章节"]').element).toHaveProperty('value', plans[1].id)
    expect(wrapper.get('textarea[aria-label="章节目标"]').element).toHaveProperty('value', plans[1].objective)
    await vi.waitFor(() => {
      expect(wrapper.find('[role="alert"]').exists()).toBe(false)
      expect(workspace.getCreationDraft(novel.id)?.sceneRecovery?.editors.find(row => row.chapterPlanId === plans[0].id))
        .toMatchObject({ chapter: { objective: '切换前的章目标' }, instructions: '切换前的生成要求',
          scenes: [{ title: '切换前的手写场景', purpose: '保留作者线索', outputState: '尚未提交的结果' }] })
    })
    const saved = workspace.getCreationDraft(novel.id)!.sceneRecovery!.editors.find(row => row.chapterPlanId === plans[0].id)!
    await wrapper.setProps({ initialPlanId: plans[0].id }); await flushPromises()
    await button('恢复这些输入').trigger('click'); await flushPromises()
    expect(wrapper.get('textarea[aria-label="章节目标"]').element).toHaveProperty('value', '切换前的章目标')
    expect(wrapper.get('textarea[aria-label="场景1名称"]').element).toHaveProperty('value', '切换前的手写场景')
    expect(wrapper.get('textarea[placeholder^="希望比较的方向"]').element).toHaveProperty('value', '切换前的生成要求')
    expect(workspace.getCreationDraft(novel.id)!.sceneRecovery!.editors.some(row => row.chapterPlanId === plans[0].id && row.id !== saved.id
      && row.baseline === saved.baseline && row.scenes[0]?.title === '切换前的手写场景')).toBe(true)
    expect(workspace.getCreationDraft(novel.id)!.scenePlans).toHaveLength(0)
    expect(callAI).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('defers a prop-selected chapter until an author save finishes and retains the previous chapter checkpoint', async () => {
    const { wrapper, button, novel, workspace, plans } = await fixture({ twoPlans: true, initialPlanIndex: 0, routePlanIndex: 0 })
    await wrapper.get('textarea[aria-label="章节目标"]').setValue('保存结束前保留的目标')
    await button('添加场景').trigger('click')
    await wrapper.get('textarea[aria-label="场景1名称"]').setValue('保存期间的场景草稿')
    await flushPromises()
    const commit = workspace.commitScenePlanningEdit
    let finish!: () => void
    vi.spyOn(workspace, 'commitScenePlanningEdit').mockImplementationOnce((...args) => new Promise((resolve, reject) => {
      finish = () => { void commit(...args).then(resolve, reject) }
    }))
    await button('保存章计划草稿').trigger('click'); await flushPromises()
    expect(finish).toBeTypeOf('function')
    expect(wrapper.get('select[aria-label="场景目标章节"]').attributes('disabled')).toBeDefined()
    await wrapper.setProps({ initialPlanId: plans[1].id }); await flushPromises()
    expect(wrapper.get('select[aria-label="场景目标章节"]').element).toHaveProperty('value', plans[0].id)
    expect(wrapper.get('textarea[aria-label="场景1名称"]').element).toHaveProperty('value', '保存期间的场景草稿')
    finish(); await flushPromises()
    expect(wrapper.get('select[aria-label="场景目标章节"]').element).toHaveProperty('value', plans[1].id)
    expect(wrapper.get('textarea[aria-label="章节名称"]').element).toHaveProperty('value', plans[1].title)
    expect(workspace.getCreationDraft(novel.id)!.sceneRecovery!.editors.some(row => row.chapterPlanId === plans[0].id
      && row.chapter.objective === '保存结束前保留的目标' && row.scenes[0]?.title === '保存期间的场景草稿')).toBe(true)
    expect(callAI).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('saves an author version without publishing scenes before confirmation', async () => {
    const { wrapper, button, novel, workspace } = await fixture()
    await button('添加场景').trigger('click')
    await wrapper.get('textarea[aria-label="场景1名称"]').setValue('未保存的候选')
    await wrapper.get('textarea[aria-label="场景1目的"]').setValue('寻找物证')
    await wrapper.get('textarea[aria-label="场景1结束状态"]').setValue('取得账册')
    await button('保存作者方案版本').trigger('click')
    await flushPromises()
    expect(workspace.getCreationDraft(novel.id)!.scenePlans).toHaveLength(0)
    expect(wrapper.get('textarea[aria-label="场景1名称"]').element).toHaveProperty('value', '未保存的候选')
    await vi.waitFor(() => {
      const revisions = workspace.getCreationDraft(novel.id)!.sceneRecovery?.revisions || []
      expect(revisions[revisions.length - 1]?.scenes[0]?.title).toBe('未保存的候选')
    })
    expect(wrapper.findAll('[role="status"]').map(item => item.text()).join(' ')).toContain('尚未替换正式场景')
    wrapper.unmount()
  })
  it('keeps generated scenes pending, allows editing and explicitly approves them for writing', async () => {
    const { wrapper, button, generateButton, submitScenes, novel, workspace } = await fixture()
    vi.mocked(callAI).mockResolvedValueOnce({ content: JSON.stringify({ scenes: [
      { title: '询问守卫', purpose: '得到线索', outputState: '得知父亲去向', requiredActions: ['展示信物'], informationChanges: ['主角知道线索'] },
    ] }), finishReason: 'stop' } as never)
    await generateButton().trigger('click')
    await flushPromises()
    expect(workspace.getCreationDraft(novel.id)!.scenePlans).toHaveLength(0)
    expect(workspace.getCreationDraft(novel.id)!.sceneRecovery?.revisions.some(revision => revision.kind === 'model'
      && revision.scenes[0]?.title === '询问守卫')).toBe(true)
    expect(formatApprovedPlanning(workspace.getCreationDraft(novel.id), 0)).not.toContain('询问守卫')
    await wrapper.get('textarea[aria-label="场景1结束状态"]').setValue('只得到假线索')
    expect(button('确认并使用这些场景').attributes('disabled')).toBeDefined()
    await button('保存作者方案版本').trigger('click')
    await flushPromises()
    expect(button('确认并使用这些场景').attributes('disabled')).toBeUndefined()
    await submitScenes()
    await flushPromises()
    expect(formatApprovedPlanning(workspace.getCreationDraft(novel.id), 0)).toContain('只得到假线索')
    expect(formatApprovedPlanning(workspace.getCreationDraft(novel.id), 0)).not.toContain('得知父亲去向')
    expect(storyAggregate.saveStoryAggregate).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('supports manual scene design without an AI request and enforces chapter confirmation after edits', async () => {
    const { wrapper, button, submitScenes, novel, workspace } = await fixture()
    await wrapper.get('textarea[aria-label="禁止揭露的信息"]').setValue('不能透露凶手')
    expect(button('生成一个新方案（先保留当前输入）').attributes('disabled')).toBeDefined()
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    await button('添加场景').trigger('click')
    await wrapper.get('textarea[aria-label="场景1名称"]').setValue('潜入仓库')
    await wrapper.get('textarea[aria-label="场景1目的"]').setValue('寻找物证')
    await wrapper.get('textarea[aria-label="场景1结束状态"]').setValue('取得账册')
    expect(button('确认并使用这些场景').attributes('disabled')).toBeDefined()
    await button('保存作者方案版本').trigger('click')
    await flushPromises()
    expect(button('确认并使用这些场景').attributes('disabled')).toBeUndefined()
    await submitScenes()
    await flushPromises()
    expect(formatApprovedPlanning(workspace.getCreationDraft(novel.id), 0)).toContain('取得账册')
    expect(formatApprovedPlanning(workspace.getCreationDraft(novel.id), 0)).toContain('不能透露凶手')
    expect(callAI).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('waits for an author chapter commit before synchronizing the reactive novel it publishes', async () => {
    const { wrapper, button, novel, workspace } = await fixture({ liveParent: true })
    try {
      // As in the real parent, populated legacy beat arrays are reactive and
      // their publication schedules source sync while the author commit unwinds.
      const commits = vi.spyOn(workspace, 'commitScenePlanningEdit')
      await wrapper.get('textarea[aria-label="开场状态"]').setValue('尚未取得原始账册')
      await wrapper.get('textarea[aria-label="结束状态"]').setValue('双方保留原始账册')
      await flushPromises()
      await wrapper.find('form').trigger('submit')
      await vi.waitFor(() => expect(commits.mock.calls.some(([, edit]) => edit.action === 'chapter')).toBe(true))
      await vi.waitFor(() => expect(button('保存章计划草稿').attributes('disabled')).toBeUndefined())
      expect(commits.mock.calls.filter(([, edit]) => edit.action === 'chapter').map(([, edit]) => edit)).toEqual([
        expect.objectContaining({ action: 'chapter', plan: expect.objectContaining({ openingState: '尚未取得原始账册', endingState: '双方保留原始账册' }) }),
      ])
      expect(wrapper.findAll('[role="alert"]').map(row => row.text())).toEqual([])
      expect(workspace.getCreationDraft(novel.id)!.chapterPlans[0]).toMatchObject({ approval: 'approved',
        openingState: '尚未取得原始账册', endingState: '双方保留原始账册' })
      expect(wrapper.find('[role="alert"]').exists()).toBe(false)
      await button('添加场景').trigger('click')
      await wrapper.get('textarea[aria-label="场景1名称"]').setValue('对照账册')
      await wrapper.get('textarea[aria-label="场景1目的"]').setValue('核对原始证据')
      await wrapper.get('textarea[aria-label="场景1结束状态"]').setValue('双方保留记录')
      await button('保存作者方案版本').trigger('click')
      await flushPromises()
      expect(wrapper.find('[role="alert"]').exists()).toBe(false)
      expect(button('确认并使用这些场景').attributes('disabled')).toBeUndefined()
      expect(workspace.getCreationDraft(novel.id)!.scenePlans).toHaveLength(0)
      expect(callAI).not.toHaveBeenCalled()
    } finally { wrapper.unmount() }
  })

  it('rejects a late generated plan when the author changes the contract', async () => {
    const { wrapper, generateButton, novel, workspace } = await fixture()
    let finish!: (value: never) => void
    vi.mocked(callAI).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await generateButton().trigger('click')
    await flushPromises()
    workspace.getCreationDraft(novel.id)!.contract.endingDirection = '作者更改结局'
    finish({ content: JSON.stringify({ scenes: [{ title: '迟到结果', purpose: '找人', outputState: '找到', requiredActions: [], informationChanges: [] }] }), finishReason: 'stop' } as never)
    await flushPromises()
    expect(wrapper.findAll('[role="status"]').map(item => item.text()).join(' ')).toContain('规划已变化')
    expect(workspace.getCreationDraft(novel.id)!.scenePlans).toHaveLength(0)
    wrapper.unmount()
  })

  it('keeps generated scenes as candidates until the author saves and confirms a version', async () => {
    const { wrapper, button, generateButton, submitScenes, novel, workspace } = await fixture()
    vi.mocked(callAI).mockResolvedValueOnce({ content: JSON.stringify({ scenes: [{ title: '未保存模型候选', purpose: '找信物', outputState: '取得线索' }] }), finishReason: 'stop' } as never)
    await generateButton().trigger('click'); await flushPromises()
    expect(workspace.getCreationDraft(novel.id)!.scenePlans).toHaveLength(0)
    expect(wrapper.get('textarea[aria-label="场景1名称"]').element).toHaveProperty('value', '未保存模型候选')
    expect(workspace.getCreationDraft(novel.id)!.sceneRecovery?.revisions.some(revision => revision.scenes[0]?.title === '未保存模型候选')).toBe(true)
    await wrapper.get('textarea[aria-label="场景1结束状态"]').setValue('作者核对后的线索')
    expect(button('确认并使用这些场景').attributes('disabled')).toBeDefined()
    await button('保存作者方案版本').trigger('click'); await flushPromises()
    expect(button('确认并使用这些场景').attributes('disabled')).toBeUndefined()
    await submitScenes(); await flushPromises()
    expect(workspace.getCreationDraft(novel.id)!.scenePlans).toHaveLength(1)
    expect(workspace.getCreationDraft(novel.id)!.scenePlans[0].approval).toBe('approved')
    const revisions = workspace.getCreationDraft(novel.id)!.sceneRecovery?.revisions || []
    expect(revisions[revisions.length - 1]?.scenes[0]?.outputState).toBe('作者核对后的线索')
    expect(callAI).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('preserves author forms on automatic source sync and refuses their old baseline', async () => {
    const { wrapper, button, novel } = await fixture()
    await wrapper.get('textarea[aria-label="禁止揭露的信息"]').setValue('作者尚未保存的禁令')
    novel.chapterPlans![0].objective = '另一窗口更新的目标'
    await flushPromises()
    expect(wrapper.get('textarea[aria-label="禁止揭露的信息"]').element).toHaveProperty('value', '作者尚未保存的禁令')
    await wrapper.find('form').trigger('submit'); await flushPromises()
    expect(wrapper.findAll('[role="status"]').map(item => item.text()).join(' ')).toContain('本章计划有未保存修改')
    expect(novel.chapterPlans![0].objective).toBe('另一窗口更新的目标')
    await button('保留输入快照并重新读取规划').trigger('click'); await flushPromises()
    expect(wrapper.get('textarea[aria-label="章节目标"]').element).toHaveProperty('value', '另一窗口更新的目标')
    wrapper.unmount()
  })

  it('keeps unsaved scene edits when the author confirms a changed chapter plan', async () => {
    const { wrapper, button } = await fixture()
    await button('添加场景').trigger('click')
    await wrapper.get('textarea[aria-label="场景1名称"]').setValue('手写场景尚未保存')
    await wrapper.get('textarea[aria-label="章节目标"]').setValue('作者重新设计目标')
    await wrapper.find('form').trigger('submit'); await flushPromises()
    expect(wrapper.get('textarea[aria-label="场景1名称"]').element).toHaveProperty('value', '手写场景尚未保存')
    expect(button('生成一个新方案（先保留当前输入）')).toBeDefined()
    expect(callAI).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('does not rebase a late generated candidate onto an automatically refreshed plan', async () => {
    const { wrapper, generateButton, novel, workspace } = await fixture()
    let finish!: (value: never) => void
    vi.mocked(callAI).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await generateButton().trigger('click'); await flushPromises()
    novel.chapterPlans![0].objective = '重新核实账册'
    await flushPromises()
    finish({ content: JSON.stringify({ scenes: [{ title: '旧目标候选', purpose: '找人', outputState: '找到', requiredActions: [], informationChanges: [] }] }), finishReason: 'stop' } as never)
    await flushPromises()
    expect(wrapper.findAll('[role="status"]').map(item => item.text()).join(' ')).toContain('已变化')
    await wrapper.find('form').trigger('submit'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('已变化')
    expect(workspace.getCreationDraft(novel.id)!.scenePlans).toHaveLength(0)
    wrapper.unmount()
  })
})
