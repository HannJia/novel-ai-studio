// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import StoryImpactHistory from './StoryImpactHistory.vue'
import { characterStateFixture, stateTestTime as now } from '@/test/characterStateFixture'
import { captureStoryImpact, buildStoryImpactReport } from '@/services/storyImpactAnalysis'
import { storyImpactLocation } from '@/services/storyImpactLocation'
import type { StoryImpactChange } from '@/types/storyImpact'

beforeEach(() => setActivePinia(createPinia()))
function fixture() {
  const { novel } = characterStateFixture()
  novel.eventLog = [{ id: 'event', title: '获得铜钥匙', description: '', type: '伏笔', chapterIndex: 0, characters: ['person-0'], timestamp: now }]
  const workspace = { candidates: [], reviewFindings: [], canonMutations: [] }
  const snapshot = captureStoryImpact(novel, workspace)
  const change: StoryImpactChange = { target: { kind: 'character', id: 'person-0', label: '林澈' }, action: 'update', fields: ['identity'] }
  const report = buildStoryImpactReport(snapshot, snapshot, [change], novel.chapters.map(chapter => chapter.id), now, 'report')
  return { novel, report }
}
const global = { stubs: { RouterLink: { props: ['to'], template: '<a :data-route="JSON.stringify(to)"><slot /></a>' } } }

describe('persisted impact history', () => {
  it('shows the saved input-based or empty review scope without claiming whole-book invalidation', async () => {
    const { novel, report } = fixture()
    report.reviewPolicy = 'changed-inputs'
    const wrapper = mount(StoryImpactHistory, { props: { novel, reports: [report] }, global })
    expect(wrapper.text()).toContain('实际审核输入的差异')
    expect(wrapper.text()).not.toContain('全部已写章节的旧审核失效')
    await wrapper.setProps({ reports: [{ ...report, reviewChapterIds: [] }] })
    expect(wrapper.text()).toContain('未使已有章节的审核失效')
    wrapper.unmount()
  })
  it('distinguishes recorded structural references, literal hints and conservative review scope', () => {
    const { novel, report } = fixture()
    const wrapper = mount(StoryImpactHistory, { props: { novel, reports: [report] }, global })
    expect(wrapper.text()).toContain('全书保守审核策略')
    expect(wrapper.text()).toContain('仅字面匹配')
    expect(wrapper.text()).toContain('仅关联，不继续传播')
    expect(wrapper.text()).toContain('修改前：林澈 → 事件参与人物编号')
    expect(wrapper.text()).toContain('修改后：林澈 → 事件参与人物编号')
    expect(wrapper.text()).toContain('章节可能已在之后重新审核')
    const routes = wrapper.findAll('a').map(link => JSON.parse(link.attributes('data-route') || 'null'))
    expect(routes).toContainEqual({ name: 'V3Characters', params: { novelId: novel.id }, query: { character: 'person-0' } })
    expect(routes).toContainEqual({ name: 'V3Plan', params: { novelId: novel.id }, query: { view: 'workbench', plannerTab: 'timeline', event: 'event', plannerSelection: 'event' } })
    expect(routes).toContainEqual({ name: 'V3Write', params: { novelId: novel.id, chapterId: novel.chapters[0].id } })
    wrapper.unmount()
  })

  it('retains old labels after deletion without offering links to missing objects', async () => {
    const { novel, report } = fixture()
    novel.characters = []; novel.eventLog = []; novel.chapters = []
    const wrapper = mount(StoryImpactHistory, { props: { novel, reports: [report] }, global })
    expect(wrapper.text()).toContain('林澈（当前已不存在）')
    expect(wrapper.text()).toContain('获得铜钥匙（当前已不存在）')
    expect(wrapper.findAll('a')).toHaveLength(0)
    await wrapper.get('input').setValue('铜钥匙')
    expect(wrapper.text()).toContain('获得铜钥匙')
    await wrapper.get('input').setValue('没有这个对象')
    expect(wrapper.text()).toContain('没有匹配的变更记录')
    await wrapper.get('input').setValue('林澈')
    expect(wrapper.text()).toContain('获得铜钥匙')
    wrapper.unmount()
  })

  it('pages immutable report history, filters root kinds and hides foreign-book records', async () => {
    const { novel, report } = fixture()
    const reports = Array.from({ length: 12 }, (_, i) => ({ ...report, id: 'report-' + i }))
    reports.push({ ...report, id: 'foreign', novelId: 'foreign' })
    const wrapper = mount(StoryImpactHistory, { props: { novel, reports, rootKind: 'character' }, global })
    expect(wrapper.findAll('.impact-report')).toHaveLength(10)
    expect(wrapper.text()).toContain('12 次变更')
    await wrapper.findAll('button').find(button => button.text() === '显示更早的变更')!.trigger('click')
    expect(wrapper.findAll('.impact-report')).toHaveLength(12)
    await wrapper.setProps({ rootKind: 'event' })
    expect(wrapper.findAll('.impact-report')).toHaveLength(0)
    wrapper.unmount()
  })

  it('pages large chapter lists and resolves nodes only to their existing parent arc', async () => {
    const { novel, report } = fixture()
    const chapter = novel.chapters[0]
    novel.chapters = Array.from({ length: 61 }, (_, i) => ({ ...chapter, id: 'chapter-' + i, chapterIndex: i }))
    report.reviewChapterIds = novel.chapters.map(chapter => chapter.id)
    const wrapper = mount(StoryImpactHistory, { props: { novel, reports: [report] }, global })
    const section = wrapper.findAll('details').find(details => details.find('summary').text().startsWith('当时审核失效'))!
    expect(section.findAll('li')).toHaveLength(30)
    await section.get('button').trigger('click')
    expect(section.findAll('li')).toHaveLength(60)
    expect(storyImpactLocation(novel, { kind: 'node', id: 'deleted', label: '旧节点', parentId: 'forged' })).toBeUndefined()
    wrapper.unmount()
  })
})
