// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { useConfigStore } from '@/stores/config'
import { useNovelStore } from '@/stores/novel'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { readStoryAggregate } from '@/services/storyAggregate'
import CreateView from './CreateView.vue'
import CreateFlowView from './CreateFlowView.vue'
import WriteView from '../write/WriteView.vue'
import { endings, skeletons, volume, outline, planResponse } from '@/test/fixtures/creationPipeline'

const { messages } = vi.hoisted(() => ({
  messages: { success: vi.fn(), warning: vi.fn(), info: vi.fn(), error: vi.fn() },
}))
vi.mock('naive-ui', async original => ({ ...await original<object>(), useMessage: () => messages,
  useDialog: () => ({ warning: vi.fn() }) }))

const endpoint = 'http://127.0.0.1:1/offline-create-pipeline'

let pinia: ReturnType<typeof createPinia>
let wrapper: ReturnType<typeof mount> | undefined
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('indexedDB', undefined)
  vi.clearAllMocks()
  pinia = createPinia()
  setActivePinia(pinia)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
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
  await vi.waitFor(() => expect(button!.attributes('disabled')).toBeUndefined())
  await button!.trigger('click')
  await flushPromises()
}

it('generates and mixes directions, confirms AI outline and plans, then opens one durable empty chapter through ordinary controls', async () => {
  const requests: Array<{ stream?: boolean; messages: Array<{ content: string }> }> = []
  const outputs = [JSON.stringify({ skeletons }), outline, volume, planResponse]
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    expect(url).toBe(endpoint + '/v1/chat/completions')
    const payload = JSON.parse(String(init?.body))
    const content = outputs[requests.length]
    expect(content, '出现了未授权的额外请求').toBeDefined()
    requests.push(payload)
    const usage = { prompt_tokens: 200, completion_tokens: 150, total_tokens: 350 }
    if (payload.stream) {
      const middle = Math.floor(content.length / 2)
      return new Response([
        ...[content.slice(0, middle), content.slice(middle)].map(chunk =>
          'data: ' + JSON.stringify({ choices: [{ delta: { content: chunk }, finish_reason: null }] })),
        'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage }),
        'data: [DONE]', '',
      ].join('\n\n'), { headers: { 'Content-Type': 'text/event-stream' } })
    }
    return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage }),
      { headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetch)
  useConfigStore().addModel({ name: '离线创建响应', baseUrl: endpoint, apiKey: '', modelName: 'synthetic-create',
    maxTokens: 4096, temperature: 0, topP: 1, contextWindow: 32000 })
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/', component: { template: '<p>书架入口</p>' } },
    { path: '/create', component: CreateView },
    { path: '/generate/:novelId', component: CreateFlowView },
    { path: '/write/:novelId/:chapterId', component: WriteView },
  ] })
  await router.push('/create')
  wrapper = mount(defineComponent({ template: '<router-view />' }), { attachTo: document.body, global: {
    plugins: [pinia, router], stubs: { Teleport: true, InspirationChat: true },
  } })
  await flushPromises()
  await wrapper.get('input[name="creation-setup-method"][value="blank"]').setValue()
  await click('准备空白作品 →')
  await wrapper.get('[aria-label="新作品名称"] input').setValue('合成AI创建·旧码头')
  await click('保存输入并创建，进入作品契约')
  await vi.waitFor(() => expect(wrapper!.find('.story-contract').exists()).toBe(true), { timeout: 10000 })
  const novels = useNovelStore()
  const workspace = useReconstructionWorkspaceStore()
  const novelId = String(router.currentRoute.value.params.novelId)
  await wrapper.get('[aria-label="编辑类型与读者"]').trigger('click')
  await wrapper.get('textarea[aria-label="作品类型"]').setValue('悬疑')
  await wrapper.get('[aria-label="编辑主线冲突"]').trigger('click')
  await wrapper.get('textarea[aria-label="主线冲突"]').setValue('黎安追查码头失踪木箱的来源。')
  await wrapper.get('textarea[aria-label="结局方向"]').setValue(endings[1])
  for (const button of wrapper.findAll('.card-heading button')) {
    await button.trigger('click')
    await flushPromises()
  }
  expect(wrapper.get('.confirmation-count').text()).toContain('8 / 8')
  await click('确认契约并继续')
  await vi.waitFor(() => expect(wrapper!.find('.manual-outline').exists()).toBe(true), { timeout: 10000 })
  expect(fetch).not.toHaveBeenCalled()
  await click('生成故事骨架候选')
  await vi.waitFor(() => expect(workspace.getCreationDraft(novelId)?.skeletons).toHaveLength(3), { timeout: 10000 })
  expect(requests).toHaveLength(1)
  const generated = await readStoryAggregate(novelId)
  const attempt = generated.workspace.creationDraft!.skeletonAttempts![0]
  expect(attempt).toMatchObject({ status: 'completed', finishReason: 'stop', output: outputs[0] })
  expect(attempt.candidateIds).toHaveLength(3)
  expect(generated.novel!.outline).toBe('')
  expect(generated.workspace.creationDraft!.approval.skeleton).not.toBe('approved')
  const [first, second] = generated.workspace.creationDraft!.skeletons
  await wrapper.get('[aria-label="整列选用：收据追查"]').trigger('click')
  await wrapper.get('[aria-label="结局方向 · 双册对照"]').trigger('click')
  await click('组合为新的可编辑候选')
  await vi.waitFor(() => expect(workspace.getCreationDraft(novelId)?.skeletons).toHaveLength(4), { timeout: 10000 })
  await wrapper.get('.skeleton-edit textarea[aria-label="方案名称"]').setValue('作者混合·共同核对')
  await click('保存作者版本')
  await click('确认此方案为正式方向')
  const confirmed = await readStoryAggregate(novelId)
  const direction = confirmed.workspace.creationDraft!
  const mixed = direction.skeletons.find(row => row.id === direction.selectedSkeletonId)!
  expect(mixed).toMatchObject({ title: '作者混合·共同核对', premise: first.premise, ending: second.ending, approval: 'approved' })
  const mixedRevision = direction.skeletonHistory!.find(row => row.kind === 'mixed')!
  expect(mixedRevision.sources.find(row => row.field === 'ending')?.revisionId).toBe(second.revisionId)
  expect(mixedRevision.sources.filter(row => row.field === 'beat')).toHaveLength(first.beats.length)
  expect(mixedRevision.sources.filter(row => row.field !== 'ending').every(row => row.revisionId === first.revisionId)).toBe(true)
  expect(confirmed.novel!.outline).toBe('')
  expect(requests).toHaveLength(1)
  await click('按已确认方向生成大纲')
  await vi.waitFor(() => expect(workspace.getCreationDraft(novelId)?.outlineCandidate?.complete).toBe(true), { timeout: 10000 })
  expect(requests).toHaveLength(2)
  const outlinePrompt = requests[1].messages.map(row => row.content).join('\n')
  expect(outlinePrompt).toContain(mixed.title)
  expect(outlinePrompt).toContain(second.ending)
  expect(outlinePrompt).not.toContain(first.ending)
  expect((await readStoryAggregate(novelId)).novel!.outline).toBe('')
  await click('确认并规划分卷')
  await vi.waitFor(() => expect(wrapper!.find('.creation-planning').exists()).toBe(true), { timeout: 10000 })
  expect(novels.getNovel(novelId)?.outline).toBe(outline)
  expect(novels.getNovel(novelId)?.volumes).toHaveLength(1)
  expect(novels.getNovel(novelId)?.chapters).toHaveLength(0)
  expect(requests).toHaveLength(2)
  await click('AI 生成分卷规划')
  await vi.waitFor(() => expect(requests).toHaveLength(3), { timeout: 10000 })
  await vi.waitFor(() => expect(novels.getNovel(novelId)?.volumes[0].theme).toBe('共同核对证据'), { timeout: 10000 })
  await click('编辑章节计划')
  await click('AI 生成计划')
  await vi.waitFor(() => expect(wrapper!.find('[aria-label="待确认章节计划建议"]').exists()).toBe(true), { timeout: 10000 })
  expect(novels.getNovel(novelId)?.chapterPlans).toHaveLength(0)
  expect(novels.getNovel(novelId)?.chapterPlanConfirmed).toBeFalsy()
  await click('确认这些章节计划')
  await vi.waitFor(() => expect(novels.getNovel(novelId)?.chapterPlans).toHaveLength(1), { timeout: 10000 })
  expect(novels.getNovel(novelId)?.chapters).toHaveLength(0)
  await click('确认分卷与章节计划')
  await vi.waitFor(() => expect(wrapper!.find('.ready-card').exists()).toBe(true), { timeout: 10000 })
  await click('开始写第一章')
  await vi.waitFor(() => expect(wrapper!.find('.pte-doc[aria-label="正文"]').exists()).toBe(true), { timeout: 10000 })
  expect((wrapper.get('input[aria-label="章节标题"]').element as HTMLInputElement).value).toBe('清点木箱')
  expect(wrapper.get('.pte-doc').text()).toBe('')
  const chapterId = String(router.currentRoute.value.params.chapterId)
  const stored = await readStoryAggregate(novelId)
  expect(stored.novel!.chapters).toHaveLength(1)
  expect(stored.novel!.chapters[0]).toMatchObject({ id: chapterId, title: '清点木箱', content: '' })
  expect(stored.novel!.chapterPlans?.[0]).toMatchObject({ title: '清点木箱', source: 'ai' })
  expect(stored.novel!.chapterPlanConfirmed).toBe(true)
  expect(stored.workspace.creationDraft?.approval).toMatchObject({ contract: 'approved', skeleton: 'approved', 'chapter-outline': 'approved' })
  expect(stored.workspace.canonMutations).toHaveLength(0)
  await wrapper.get('input[aria-label="章节标题"]').setValue('清点木箱·作者核对')
  await wrapper.get('input[aria-label="章节标题"]').trigger('blur')
  await vi.waitFor(async () => expect((await readStoryAggregate(novelId)).novel!.chapters[0])
    .toMatchObject({ id: chapterId, title: '清点木箱·作者核对', content: '' }), { timeout: 10000 })
  await router.push('/')
  await flushPromises()
  workspace.clearNovel(novelId)
  await novels.initStore()
  await router.push('/generate/' + novelId)
  await vi.waitFor(() => expect(wrapper!.find('.ready-card').exists()).toBe(true), { timeout: 10000 })
  await click('打开写作台')
  await vi.waitFor(() => expect(router.currentRoute.value.params.chapterId).toBe(chapterId))
  await vi.waitFor(() => expect(wrapper!.find('.pte-doc').exists()).toBe(true), { timeout: 10000 })
  expect((wrapper.get('input[aria-label="章节标题"]').element as HTMLInputElement).value).toBe('清点木箱·作者核对')
  expect(wrapper.get('.pte-doc').text()).toBe('')
  expect(novels.getNovel(novelId)?.chapters).toHaveLength(1)
  expect(fetch).toHaveBeenCalledTimes(4)
  expect(requests.map(row => Boolean(row.stream))).toEqual([true, true, true, false])
  expect(messages.error).not.toHaveBeenCalled()
})
