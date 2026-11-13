// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ReviewView from './ReviewView.vue'
import { useNovelStore } from '@/stores/novel'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'

const { route, push } = vi.hoisted(() => ({
  route: { params: { novelId: '' } },
  push: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => ({ push }),
}))

function seedNovel() {
  const novels = useNovelStore()
  const novel = novels.addNovel({
    genre: 'fantasy', subGenre: 'xuanhuan', tags: [], targetWordCountMin: 20, targetWordCountMax: 30,
    writingStyle: novels.defaultWritingStyle(), settings: novels.defaultSettings(),
  })
  route.params.novelId = novel.id
  const workspace = useReconstructionWorkspaceStore()
  vi.spyOn(workspace, 'hydrateFromPersistence').mockResolvedValue({
    candidates: [], reviewFindings: [], canonMutations: [], chapterReviews: [], aiRuns: [],
  })
  return { novels, novel }
}

async function mountView() {
  const wrapper = mount(ReviewView, { global: { stubs: { Teleport: true, RouterLink: true } } })
  await flushPromises()
  return wrapper
}

describe('V3 review center', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    route.params.novelId = ''
    push.mockReset()
  })

  afterEach(() => vi.restoreAllMocks())

  it('shows a never-reviewed chapter as pending review, not as an invalidated review', async () => {
    const { novels, novel } = seedNovel()
    novels.addChapter(novel.id, { title: '雾中渡口', content: '正文内容' })

    const wrapper = await mountView()

    expect(wrapper.get('.review-head h1').text()).toBe('审校中心')
    expect(wrapper.get('.review-sub').text()).toContain('全书 1 章')
    // 入典（逐条记录数）固定显示，其余胶囊只出现有章节的状态。
    expect(wrapper.findAll('.review-pill').map(pill => pill.text().replace(/\s+/g, ' '))).toEqual(['入典 0', '待审校 1'])
    expect(wrapper.find('.stale-banner').exists()).toBe(false)
    expect(wrapper.get('.heat-cell').classes()).toContain('h-drafting')
    expect(wrapper.get('.review-guide').text()).toContain('五层审校')
    expect(wrapper.get('.author-stats').text()).toContain('采纳修改 0')

    const row = wrapper.get('.qtable tbody tr')
    expect(row.text()).toContain('重审')
    expect(row.text()).toContain('本章尚未审校')
    await row.get('.chapter-link').trigger('click')
    expect(push).toHaveBeenCalledWith(`/write/${novel.id}/${novel.chapters[0].id}`)
    wrapper.unmount()
  })

  it('reports only chapters that were reviewed before as invalidated and scopes batch re-review to them', async () => {
    const { novels, novel } = seedNovel()
    novels.addChapter(novel.id, { title: '第一章', content: '从未审校的正文' })
    novels.addChapter(novel.id, { title: '第二章', content: '审校过但已失效的正文' })
    novels.updateChapter(novel.id, novel.chapters[1].id, { contentReviewSignature: 'signature-of-an-older-version' })

    const wrapper = await mountView()

    const banner = wrapper.get('.stale-banner')
    expect(banner.text()).toContain('1 章审核已失效')
    expect(banner.text()).toContain('第 2 章')
    expect(banner.get('button').text()).toBe('批量重审 1 章')
    expect(wrapper.findAll('.heat-cell').map(cell => cell.classes().find(name => name.startsWith('h-')))).toEqual(['h-drafting', 'h-stale'])
    expect(wrapper.findAll('.review-pill').map(pill => pill.text().replace(/\s+/g, ' '))).toEqual(['入典 0', '审核失效 1', '待审校 1'])
    // 没有配置审校模型时，批量操作必须禁用而不是静默无动作。
    expect(banner.get('button').attributes('disabled')).toBeDefined()
    expect(wrapper.findAll('.qtable tbody tr').map(item => item.text())).toEqual([
      expect.stringContaining('本章尚未审校'), expect.stringContaining('审核已失效，需要重新审校'),
    ])
    wrapper.unmount()
  })

  it('does not invent a stale banner or queue rows when there is nothing to do', async () => {
    const { novels, novel } = seedNovel()
    novels.addChapter(novel.id, { title: '空章', content: '' })

    const wrapper = await mountView()

    expect(wrapper.find('.stale-banner').exists()).toBe(false)
    expect(wrapper.get('.empty-card').text()).toBe('当前没有待处理项目。')
    expect(wrapper.get('.heat-cell').classes()).toContain('h-idea')
    wrapper.unmount()
  })
})
