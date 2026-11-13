// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { useNovelStore } from '@/stores/novel'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { readStoryAggregate } from '@/services/storyAggregate'
import CreateView from './CreateView.vue'
import CreateFlowView from './CreateFlowView.vue'

const { messages } = vi.hoisted(() => ({
  messages: { success: vi.fn(), warning: vi.fn(), info: vi.fn(), error: vi.fn() },
}))
vi.mock('naive-ui', async original => ({ ...await original<object>(), useMessage: () => messages,
  useDialog: () => ({ warning: vi.fn() }) }))

let pinia: ReturnType<typeof createPinia>
let wrapper: ReturnType<typeof mount> | undefined
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('indexedDB', undefined)
  vi.clearAllMocks()
  pinia = createPinia()
  setActivePinia(pinia)
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn()
})
afterEach(async () => {
  wrapper?.unmount()
  await flushPromises()
  await useNovelStore().flushPendingSaves()
  await useReconstructionWorkspaceStore().flushPendingSaves(useNovelStore().novels.map(novel => novel.id))
  disposePinia(pinia)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
async function click(text: string) {
  const button = wrapper!.findAll('button').find(item => item.text().trim() === text)
  expect(button, '按钮不存在 ' + text).toBeDefined()
  expect(button!.attributes('disabled')).toBeUndefined()
  await button!.trigger('click')
  await flushPromises()
}

it('creates a blank project, confirms contract and manual direction, saves a plan and opens one durable blank chapter', async () => {
  const fetch = vi.fn(() => { throw new Error('手工创建流程不应请求网络') })
  vi.stubGlobal('fetch', fetch)
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/', component: { template: '<p>书架入口</p>' } },
    { path: '/create', component: CreateView },
    { path: '/generate/:novelId', component: CreateFlowView },
    { path: '/write/:novelId/:chapterId', component: { template: '<p data-test="writing-destination">写作台入口</p>' } },
  ] })
  await router.push('/create')
  wrapper = mount(defineComponent({ template: '<router-view />' }), { attachTo: document.body, global: {
    plugins: [pinia, router], stubs: { Teleport: true, InspirationChat: true },
  } })
  await flushPromises()
  await wrapper.get('input[name="creation-setup-method"][value="blank"]').setValue()
  await click('准备空白作品 →')
  await wrapper.get('[aria-label="新作品名称"] input').setValue('合成创建·旧码头')
  await click('保存输入并创建，进入作品契约')
  await vi.waitFor(() => expect(wrapper!.find('.story-contract').exists()).toBe(true), { timeout: 10000 })
  const novels = useNovelStore()
  const novelId = String(router.currentRoute.value.params.novelId)
  expect(novels.novels).toHaveLength(1)
  expect(novels.getNovel(novelId)?.writingMode).toBe('manual')
  await wrapper.get('[aria-label="编辑类型与读者"]').trigger('click')
  await wrapper.get('textarea[aria-label="作品类型"]').setValue('悬疑')
  await wrapper.get('[aria-label="编辑主线冲突"]').trigger('click')
  await wrapper.get('textarea[aria-label="主线冲突"]').setValue('黎安追查码头失踪木箱的来源。')
  await wrapper.get('textarea[aria-label="结局方向"]').setValue('黎安公开交接记录，找回木箱。')
  for (const button of wrapper.findAll('.card-heading button')) {
    await button.trigger('click')
    await flushPromises()
  }
  expect(wrapper.get('.confirmation-count').text()).toContain('8 / 8')
  await click('确认契约并继续')
  await vi.waitFor(() => expect(wrapper!.find('.manual-outline').exists()).toBe(true), { timeout: 10000 })
  await wrapper.get('[aria-label="手写或粘贴大纲"] textarea').setValue([
    '## 推荐书名', '合成创建·旧码头', '## 小说简介', '黎安在码头清点木箱，发现交接册中的编号被涂改，决定追查原始记录。',
    '## 第一卷：追查', '预估章节数：1章', '预估字数：0.3万字', '黎安沿交接记录寻找原始收据。',
    '## 结局方向', '黎安公开交接记录，找回木箱。',
  ].join('\n'))
  await click('保存大纲并核对骨架')
  await vi.waitFor(() => expect(wrapper!.find('.skeleton-picker').exists()).toBe(true), { timeout: 10000 })
  await wrapper.get('.skeleton-edit textarea[aria-label="读者承诺"]').setValue('解开旧码头交接记录的谜团。')
  await click('保存作者版本')
  await click('确认此方案为正式方向')
  await click('确认并规划分卷')
  await vi.waitFor(() => expect(wrapper!.find('.creation-planning').exists()).toBe(true), { timeout: 10000 })
  expect(novels.getNovel(novelId)?.volumes).toHaveLength(1)
  expect(novels.getNovel(novelId)?.chapters).toHaveLength(0)
  await click('编辑章节计划')
  await click('新建计划')
  await wrapper.get('input[placeholder="例如：抵达锚点七号"]').setValue('清点木箱')
  await wrapper.get('input[placeholder="完成后必须发生什么变化"]').setValue('发现编号被涂改并保留原始收据。')
  await click('确认并保存')
  await vi.waitFor(() => expect(novels.getNovel(novelId)?.chapterPlans).toHaveLength(1), { timeout: 10000 })
  await click('确认分卷与章节计划')
  await vi.waitFor(() => expect(wrapper!.find('.ready-card').exists()).toBe(true), { timeout: 10000 })
  await click('开始写第一章')
  await vi.waitFor(() => expect(wrapper!.find('[data-test="writing-destination"]').exists()).toBe(true), { timeout: 10000 })
  const chapterId = String(router.currentRoute.value.params.chapterId)
  const stored = await readStoryAggregate(novelId)
  expect(stored.novel!.chapters).toHaveLength(1)
  expect(stored.novel!.chapters[0]).toMatchObject({ id: chapterId, title: '清点木箱', content: '' })
  expect(stored.novel!.chapterPlanConfirmed).toBe(true)
  expect(stored.workspace.creationDraft?.approval).toMatchObject({ contract: 'approved', skeleton: 'approved', 'chapter-outline': 'approved' })
  expect(stored.workspace.canonMutations).toHaveLength(0)
  const workspace = useReconstructionWorkspaceStore()
  workspace.clearNovel(novelId)
  await novels.initStore()
  await router.push('/generate/' + novelId)
  await vi.waitFor(() => expect(wrapper!.find('.ready-card').exists()).toBe(true), { timeout: 10000 })
  await click('打开写作台')
  await vi.waitFor(() => expect(router.currentRoute.value.params.chapterId).toBe(chapterId))
  expect(novels.getNovel(novelId)?.chapters).toHaveLength(1)
  expect(fetch).not.toHaveBeenCalled()
  expect(messages.error).not.toHaveBeenCalled()
})
