import { confirmTestStoryContract as confirmStoryContract } from '@/test/contractCardsFixture'
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { defineComponent, nextTick } from 'vue'
import PlanView from './PlanView.vue'
import { useNovelStore } from '@/stores/novel'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { buildPlotSkeletonFromOutline, confirmCreationSkeleton,  createCreationDraftFromNovel, syncCreationDraftPlanning } from '@/services/reconstructionCreation'
import { approveScenePlans, confirmChapterPlan, normalizeScenePlans, proposeScenePlans } from '@/services/reconstructionPlanning'
import { appendEntityRevision, captureEntityRevision } from '@/services/entityProvenance'
import { buildAnalysisSourceVersionId } from '@/services/reconstructionCandidates'
import type { EventLogEntry, StoryArcNode, StoryArc } from '@/types/novel'

const { route, replace } = vi.hoisted(() => ({
  route: { params: { novelId: '' }, query: { view: 'overview' } as Record<string, string> },
  replace: vi.fn(),
}))
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ replace }) }))

const PlannerStub = defineComponent({
  props: ['embedded', 'initialTab', 'initialSelection'], emits: ['navigate', 'tabChange'],
  template: '<div class="planner-stub" :data-tab="initialTab" :data-selection="initialSelection"><button class="planner-navigate" @click="$emit(\'navigate\', { tab: \'arcs\', selection: \'arc-1\' })">定位弧线</button><button class="planner-tab-change" @click="$emit(\'tabChange\', \'memory\')">切换回顾</button></div>',
})
const now = '2026-11-09T00:00:00.000Z'
let pinia: ReturnType<typeof createPinia>, wrapper: ReturnType<typeof mount> | undefined

function book() {
  const novels = useNovelStore()
  const created = novels.addNovel({ workingTitle: '合成渡口', genre: 'fantasy', subGenre: 'xuanhuan', tags: [], targetWordCountMin: 20, targetWordCountMax: 30,
    writingStyle: novels.defaultWritingStyle(), settings: novels.defaultSettings() })
  const novel = novels.getNovel(created.id)!
  route.params.novelId = novel.id
  return { novels, novel, workspace: useReconstructionWorkspaceStore() }
}
function planningBook() {
  const fixture = book(), { novels, novel, workspace } = fixture
  novel.volumes.push({ id: 'v1', volumeIndex: 0, title: '灯起', theme: '追查旧案', summary: '从渡口追查线索', keyTurningPoints: '见到旧疤', characterChanges: '开始怀疑', estimatedChapters: 4, estimatedWordCount: 1 })
  const chapter = novels.addChapter(novel.id, { title: '雨夜守灯', content: '沈砚在雨夜守灯。', volumeIndex: 0 })!
  novels.addChapter(novel.id, { title: '灯座之下', content: '', volumeIndex: 0 })
  chapter.sceneNotes = [{ id: 'note', title: '旧场景笔记', content: '这是笔记，不是批准的场景。', source: 'user', createdAt: now, updatedAt: now }]
  const plan = novels.addChapterPlan(novel.id, { horizon: 'next', title: chapter.title, objective: '试探守灯人的来历', summary: '保留身份悬念', beats: ['渡口守夜', '试探旧事'],
    targetChapterStart: 0, targetChapterEnd: 0, relatedArcIds: [], relatedEventIds: [], status: 'planned', source: 'user' })!
  let draft = createCreationDraftFromNovel(novel, now)
  draft = confirmStoryContract(draft, { ...draft.contract, centralConflict: '追查渡口旧案', endingDirection: '查清真相' }, now)
  draft.skeletons = [{ ...buildPlotSkeletonFromOutline(novel, '追查旧案', now), logline: '沈砚追查渡口旧案。', promise: '每个线索都推进旧案调查。', ending: '沈砚查清旧案并作出选择。',
    beats: [{ id: 'opening', title: '旧案线索', description: '沈砚在渡口找到线索。', kind: 'opening', relatedPlotlineIds: [], relatedCharacterIds: [] }] }]
  draft = syncCreationDraftPlanning(confirmCreationSkeleton(draft, now), novel, now)
  const planId = 'chapter-plan:' + plan.id
  draft = confirmChapterPlan(draft, planId, now)
  const scenes = normalizeScenePlans([{ title: '雨落渡口', purpose: '守灯时试探旧事', outputState: '问题仍未得到回答' }], planId, 'approved')
  draft = approveScenePlans(proposeScenePlans(draft, planId, scenes, now), planId, scenes.map(scene => scene.id), now)
  const pending = normalizeScenePlans([{ title: '未批替代方案', purpose: '直接追问身份', outputState: '引出新的分歧' }], planId, 'pending')
  draft = proposeScenePlans(draft, planId, pending, now)
  workspace.setCreationDraft(novel.id, draft)
  route.query.planChapter = '1'
  return { ...fixture, chapter, plan, planId, sceneId: scenes[0].id }
}
async function mountPlan() {
  wrapper = mount(PlanView, { global: { stubs: { Teleport: true, RouterLink: true, StoryPlanner: PlannerStub } } })
  await flushPromises()
  return wrapper
}
function button(text: string) {
  const found = wrapper!.findAll('button').find(item => item.text() === text)
  if (!found) throw new Error('按钮不存在：' + text)
  return found
}
function event(overrides: Partial<EventLogEntry> = {}): EventLogEntry {
  return { id: 'fs1', title: '不灭的青灯', description: '守灯人的秘密', type: '伏笔', chapterIndex: 0, characters: [], status: 'developing',
    hintCount: 99, lastProgressChapterIndex: 1, targetChapter: 3, source: 'user', timestamp: now, ...overrides }
}
function arcNodes() {
  const actual: StoryArcNode = { id: 'actual', title: '守灯的夜晚', targetChapter: 0, actualChapter: 0, status: 'completed', description: '', createdAt: now, updatedAt: now }
  const planned: StoryArcNode = { ...actual, id: 'planned', title: '发现灯座', targetChapter: 1, actualChapter: undefined, status: 'pending' }
  const forged: StoryArcNode = { ...actual, id: 'forged', title: '无证据的完成', targetChapter: 1, actualChapter: 1 }
  return { actual, planned, forged }
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear()
  pinia = createPinia(); setActivePinia(pinia)
  route.params.novelId = ''; route.query = { view: 'overview' }
  replace.mockReset().mockResolvedValue(undefined)
  vi.spyOn(useReconstructionWorkspaceStore(), 'hydrateFromPersistence').mockResolvedValue({ candidates: [], reviewFindings: [], canonMutations: [], chapterReviews: [], aiRuns: [] })
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined; disposePinia(pinia); vi.restoreAllMocks() })

describe('V3 规划三栏与真实投影', () => {
  it('保留完整工作台导航与实体选择的 V3 路由', async () => {
    book(); await mountPlan()
    await button('规划工作台').trigger('click'); await nextTick()
    expect(wrapper!.get('.planner-stub').attributes('data-tab')).toBe('plans')
    await wrapper!.get('.planner-navigate').trigger('click'); await nextTick()
    expect(wrapper!.get('.planner-stub').attributes('data-tab')).toBe('arcs')
    expect(wrapper!.get('.planner-stub').attributes('data-selection')).toBe('arc-1')
    expect(replace).toHaveBeenLastCalledWith({ query: { view: 'workbench', plannerTab: 'arcs', plannerSelection: 'arc-1' } })
    await wrapper!.get('.planner-tab-change').trigger('click')
    expect(replace).toHaveBeenLastCalledWith({ query: { view: 'workbench', plannerTab: 'memory', plannerSelection: undefined } })
  })

  it('空作品仍显示三栏空态，不编造章节、场景或伏笔', async () => {
    book(); await mountPlan()
    expect(wrapper!.find('.structure-side').exists()).toBe(true)
    expect(wrapper!.get('.plan-board').text()).toContain('还没有故事弧线')
    expect(wrapper!.get('.plan-board').text()).toContain('尚未登记伏笔')
    expect(wrapper!.findAll('.tree-chapter')).toHaveLength(0)
    expect(wrapper!.findAll('.scene-card')).toHaveLength(0)
    expect(wrapper!.get('.plan-detail').text()).toContain('全书')
  })

  it('按真实卷章选择，区分批准场景、待确认方案和普通场景笔记，读取不改数据', async () => {
    const { novel, workspace, sceneId } = planningBook()
    const before = JSON.stringify(novel), draftBefore = JSON.stringify(workspace.getCreationDraft(novel.id))
    await mountPlan()
    expect(wrapper!.get('.tree-volume').text()).toContain('卷1 灯起')
    expect(wrapper!.get('.plan-detail h2').text()).toBe('雨夜守灯')
    expect(wrapper!.get('.chapter-fields').text()).toContain('试探守灯人的来历')
    const scenes = wrapper!.findAll('.scene-card')
    expect(scenes).toHaveLength(2)
    expect(scenes[0].text()).toContain('已批准 · 计划')
    expect(scenes[1].text()).toContain('待确认')
    expect(wrapper!.get('.scene-notes').text()).toContain('旧场景笔记')
    await wrapper!.findAll('.tree-scene')[0].trigger('click')
    expect(wrapper!.get(`[data-scene-id="${sceneId}"]`).classes()).toContain('selected')
    expect(wrapper!.get(`[data-scene-id="${sceneId}"]`).text()).toContain('问题仍未得到回答')
    await wrapper!.get('[data-chapter-index="1"]').trigger('click')
    expect(wrapper!.get('.plan-detail h2').text()).toBe('灯座之下')
    expect(wrapper!.get('.plan-detail').text()).toContain('尚无单章章纲')
    expect(replace).toHaveBeenLastCalledWith({ query: { view: 'overview', planChapter: '2', planVolume: undefined, planFocus: undefined } })
    expect(JSON.stringify(novel)).toBe(before)
    expect(JSON.stringify(workspace.getCreationDraft(novel.id))).toBe(draftBefore)
  })

  it('全书显示真实批准骨架，分卷展示规划字段，折叠不删除章节', async () => {
    const { novel } = planningBook(); await mountPlan()
    await wrapper!.get('.tree-book').trigger('click')
    expect(wrapper!.get('.plan-detail').text()).toContain('已批准骨架 · 计划')
    expect(wrapper!.get('.plan-detail').text()).toContain('沈砚追查渡口旧案。')
    await wrapper!.get('.tree-volume .tree-item').trigger('click')
    expect(wrapper!.get('.plan-detail .detail-fields').text()).toContain('追查旧案')
    expect(wrapper!.get('.plan-detail .detail-fields').text()).toContain('2 章已建立')
    await wrapper!.get('.tree-toggle').trigger('click')
    expect(wrapper!.findAll('.tree-chapter')).toHaveLength(0)
    expect(novel.chapters).toHaveLength(2)
    await wrapper!.get('.tree-toggle').trigger('click')
    expect(wrapper!.findAll('.tree-chapter')).toHaveLength(2)
  })

  it('跳至所选章的真实场景编辑器，而非默认打开首章', async () => {
    const { planId } = planningBook(); await mountPlan()
    await button('章纲与场景').trigger('click')
    expect(wrapper!.get('.planner-stub').attributes('data-tab')).toBe('scenes')
    expect(wrapper!.get('.planner-stub').attributes('data-selection')).toBe(planId)
    expect(replace).toHaveBeenLastCalledWith({ query: { view: 'workbench', planChapter: '1', plannerTab: 'scenes', plannerSelection: planId } })
  })

  it('外部规划变更后撤下批准标签，保留原方案和草稿，不把旧审批投影为有效', async () => {
    const { novel, plan, workspace } = planningBook()
    plan.objective = '从另一页面改过的目标'
    const draftBefore = JSON.stringify(workspace.getCreationDraft(novel.id))
    await mountPlan()
    expect(wrapper!.get('.detail-tags').text()).toContain('待确认章纲')
    expect(wrapper!.findAll('.scene-card').every(card => card.text().includes('待确认'))).toBe(true)
    expect(wrapper!.get('.chapter-fields').text()).toContain('从另一页面改过的目标')
    expect(JSON.stringify(workspace.getCreationDraft(novel.id))).toBe(draftBefore)
  })

  it('跨章规划单独列出，不冒充本章章纲或制造区间内全部章节', async () => {
    const { novels, novel } = book()
    novels.addChapter(novel.id, { title: '空章', content: '' })
    novels.addChapterPlan(novel.id, { horizon: 'far', title: '旧案卷末收束', objective: '收束旧案', summary: '', beats: [], targetChapterStart: 0, targetChapterEnd: 80,
      relatedArcIds: [], relatedEventIds: [], status: 'planned', source: 'user' })
    await mountPlan()
    expect(wrapper!.findAll('.tree-chapter')).toHaveLength(1)
    expect(wrapper!.get('.range-plans').text()).toContain('1–81')
    expect(wrapper!.find('.chapter-fields').exists()).toBe(false)
    expect(wrapper!.get('.detail-ranges').text()).toContain('旧案卷末收束')
  })

  it('只有未来单章计划时仍显示未建章，不虚构正文或字数', async () => {
    const { novels, novel } = planningBook()
    novels.addChapterPlan(novel.id, { horizon: 'near', title: '未写的来信', objective: '留待下一阶段', summary: '', beats: [], targetChapterStart: 3, targetChapterEnd: 3,
      relatedArcIds: [], relatedEventIds: [], status: 'planned', source: 'user' })
    route.query.planChapter = '4'
    await mountPlan()
    expect(wrapper!.get('.plan-detail h2').text()).toBe('未写的来信')
    expect(wrapper!.get('.detail-tags').text()).toContain('尚未建章')
    expect(wrapper!.get('.detail-tags').text()).not.toContain('已批准规划')
    expect(wrapper!.find('.detail-word-count').exists()).toBe(false)
    expect(wrapper!.findAll('router-link-stub').some(link => String(link.attributes('to')).startsWith('/write/'))).toBe(false)
  })

  it('仅有效正文来源完成节点画实心，计划及无证据完成保持虚线', async () => {
    const { novel, chapter } = planningBook(), { actual, planned, forged } = arcNodes()
    appendEntityRevision(actual, captureEntityRevision('arc_node', undefined, actual, { kind: 'chapter', chapterId: chapter.id, chapterIndex: 0,
      sourceVersionId: buildAnalysisSourceVersionId(chapter.content), evidence: [{ quote: chapter.content, startOffset: 0, endOffset: chapter.content.length }] }, now, 'actual-source'))
    novel.storyArcs = [{ id: 'arc1', title: '渡口旧案', description: '', type: 'main', importance: 5, status: 'active', reactivateAt: '', characterIds: [], nodes: [actual, planned, forged], createdAt: now, updatedAt: now }]
    await mountPlan()
    expect(wrapper!.get('[data-node-id="actual"]').classes()).toContain('actual')
    expect(wrapper!.get('[data-node-id="planned"]').classes()).toContain('planned')
    expect(wrapper!.get('[data-node-id="forged"]').classes()).not.toContain('actual')
    expect(wrapper!.get('[data-node-id="forged"]').classes()).toContain('uncertain')
    await wrapper!.get('[data-node-id="planned"]').trigger('click')
    expect(wrapper!.get('.plan-detail h2').text()).toBe('灯座之下')
    novel.chapters.find(item => item.id === chapter.id)!.content = '正文已改，不再支持原节点。'; await nextTick()
    expect(wrapper!.find('[data-node-id="actual"]').exists()).toBe(false)
    expect(wrapper!.get('.projection-notice').text()).toContain('待核对')
    expect(actual.status).toBe('completed')
  })

  it('伏笔只画真实埋设、一次最近推进和计划节点，不按 hintCount 补造历史', async () => {
    const { novel } = planningBook(); novel.eventLog = [event()]
    await mountPlan()
    const row = wrapper!.get('[data-event-id="fs1"]')
    expect(row.findAll('.fs-point')).toHaveLength(3)
    expect(row.findAll('[data-point-kind="progress"]')).toHaveLength(1)
    expect(row.find('[data-point-kind="planned"]').classes()).toContain('planned')
    expect(row.find('[data-point-kind="resolved"]').exists()).toBe(false)
    expect(row.text()).toContain('已推进')
  })

  it('纯预计伏笔不伪装成已埋设，缺少回收章也不画实际回收', async () => {
    const { novel } = planningBook()
    novel.eventLog = [event({ id: 'future', chapterIndex: -1, status: 'planted', lastProgressChapterIndex: undefined }), event({ id: 'no-payoff-chapter', status: 'resolved', resolvedChapterIndex: undefined })]
    await mountPlan()
    const future = wrapper!.get('[data-event-id="future"]')
    expect(future.findAll('.fs-point')).toHaveLength(1)
    expect(future.find('[data-point-kind="planted"]').exists()).toBe(false)
    expect(future.text()).toContain('待埋设')
    const missing = wrapper!.get('[data-event-id="no-payoff-chapter"]')
    expect(missing.find('[data-point-kind="resolved"]').exists()).toBe(false)
    expect(missing.text()).toContain('回收章未记录')
  })

  it('来源无效的伏笔保留核对入口，但不绘制原始已发生状态', async () => {
    const { novel } = planningBook()
    novel.eventLog = [event({ source: 'ai', status: 'resolved', resolvedChapterIndex: 1 })]
    await mountPlan()
    const row = wrapper!.get('[data-event-id="fs1"]')
    expect(row.findAll('.fs-point')).toHaveLength(0)
    expect(row.text()).toContain('来源待核对')
    await row.get('.fs-name').trigger('click')
    expect(wrapper!.get('.planner-stub').attributes('data-selection')).toBe('fs1')
  })

  it('总纲保存失败仍保留输入和重试入口，成功调用既有影响事务', async () => {
    const { novels, novel } = book()
    const save = vi.spyOn(novels, 'updateOutlineWithImpact').mockRejectedValueOnce(new Error('保存被阻止')).mockResolvedValueOnce(true)
    await mountPlan(); await button('总纲编辑').trigger('click'); await button('编辑').trigger('click')
    await wrapper!.get('textarea').setValue('作者未丢失的新总纲')
    await button('保存总纲').trigger('click'); await flushPromises()
    expect(wrapper!.get('[role="alert"]').text()).toContain('输入已保留')
    expect(wrapper!.get('textarea').element).toHaveProperty('value', '作者未丢失的新总纲')
    await button('保存总纲').trigger('click'); await flushPromises()
    expect(save).toHaveBeenLastCalledWith(novel.id, '作者未丢失的新总纲')
    expect(wrapper!.find('textarea').exists()).toBe(false)
  })

  it('弧线索引在来源正文等长变化后只保留核对入口，不展示旧完成结论', async () => {
    const { novel, chapter } = planningBook()
    const liveChapter = novel.chapters.find(item => item.id === chapter.id)!
    const arc: StoryArc = { id: 'sourced-arc', title: '雨夜线索', description: '来自旧正文的结论', type: 'sub',
      importance: 3, status: 'completed', reactivateAt: '', characterIds: [], nodes: [], createdAt: now, updatedAt: now }
    appendEntityRevision(arc, captureEntityRevision('arc', undefined, arc, { kind: 'chapter', chapterId: chapter.id, chapterIndex: 0,
      sourceVersionId: buildAnalysisSourceVersionId(chapter.content), evidence: [{ quote: chapter.content, startOffset: 0, endOffset: chapter.content.length }] }, now, 'arc-source'))
    novel.storyArcs = [arc]
    const originalArc = JSON.stringify(arc)
    route.query.view = 'arcs'
    await mountPlan()
    expect(wrapper!.get('.planning-card').text()).toContain('来自旧正文的结论')
    const length = liveChapter.content.length
    liveChapter.content = liveChapter.content.replace('雨夜', '晴夜')
    await nextTick()
    expect(liveChapter.content.length).toBe(length)
    expect(wrapper!.get('.planning-card').text()).toContain('来源待核对')
    expect(wrapper!.get('.planning-card').text()).not.toContain('来自旧正文的结论')
    expect(wrapper!.get('.planning-card').text()).not.toContain('已完成')
    expect(wrapper!.get('.planning-card h2').text()).toBe('雨夜线索')
    await button('编辑弧线').trigger('click')
    expect(wrapper!.get('.planner-stub').attributes('data-selection')).toBe(arc.id)
    expect(JSON.stringify(arc)).toBe(originalArc)
  })
})
