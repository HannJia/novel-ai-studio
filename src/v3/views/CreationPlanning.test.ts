// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { shallowMount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useNovelStore } from '@/stores/novel'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { createEmptyCreationDraft } from '@/types/reconstruction'
import CreationPlanning from './CreationPlanning.vue'
const { route, push } = vi.hoisted(() => ({ route: { params: { novelId: '' } }, push: vi.fn() }))
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ push }) }))
beforeEach(() => { setActivePinia(createPinia()); push.mockReset() })
afterEach(() => vi.restoreAllMocks())
function setup(confirmed = true) {
  const novels = useNovelStore(), ws = useReconstructionWorkspaceStore()
  const n = novels.addNovel({ genre: 'urban', subGenre: 'mystery', tags: [], targetWordCountMin: 1, targetWordCountMax: 2, writingStyle: novels.defaultWritingStyle(), settings: novels.defaultSettings() })
  n.chapterPlanConfirmed = confirmed
  n.chapterPlans = [{ id: 'p1', title: '渡口来信', objective: '找到信件', summary: '', horizon: 'next', status: 'planned', source: 'user', targetChapterStart: 0, targetChapterEnd: 0, beats: [], relatedArcIds: [], relatedEventIds: [], createdAt: '', updatedAt: '' }]
  const d = createEmptyCreationDraft({ id: 'd', now: '', entry: 'blank', mode: 'author' })
  d.approval.contract = 'approved'; d.approval.skeleton = 'approved'
  d.approval['chapter-outline'] = confirmed ? 'approved' : 'draft'
  ws.setCreationDraft(n.id, d); route.params.novelId = n.id
  const wrapper = shallowMount(CreationPlanning, { global: { stubs: { RouterLink: true } } })
  return { wrapper, n, novels }
}
it('only presents readiness after the saved planning confirmation', () => {
  const { wrapper } = setup(false)
  expect(wrapper.find('.ready-card').exists()).toBe(false)
  expect(wrapper.get('.planning-actions button').attributes('disabled')).toBeDefined()
  wrapper.unmount()
})
it('retains one empty chapter after a failed save and reuses it on retry', async () => {
  const { wrapper, n, novels } = setup()
  vi.spyOn(novels, 'saveNovelNow').mockRejectedValueOnce(new Error('保存失败')).mockResolvedValue(undefined)
  await wrapper.get('.ready-actions button').trigger('click'); await flushPromises()
  expect(n.chapters).toHaveLength(1); expect(n.chapters[0].content).toBe('')
  expect(push).not.toHaveBeenCalled(); expect(wrapper.get('[role="alert"]').text()).toContain('保存失败')
  await wrapper.get('.ready-actions button').trigger('click'); await flushPromises()
  expect(n.chapters).toHaveLength(1)
  expect(push).toHaveBeenCalledWith('/write/' + n.id + '/' + n.chapters[0].id)
  wrapper.unmount()
})
it('opens an existing chapter without creating or replacing text', async () => {
  const { wrapper, n, novels } = setup()
  novels.addChapter(n.id, { content: '已有正文' })
  vi.spyOn(novels, 'saveNovelNow').mockResolvedValue(undefined)
  await wrapper.get('.ready-actions button').trigger('click'); await flushPromises()
  expect(n.chapters).toHaveLength(1); expect(n.chapters[0].content).toBe('已有正文')
  wrapper.unmount()
})
