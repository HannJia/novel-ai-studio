// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { useConfigStore } from '@/stores/config'
import { useNovelStore } from '@/stores/novel'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { readStoryAggregate } from '@/services/storyAggregate'
import AutoView from './AutoView.vue'

const { route, messages } = vi.hoisted(() => ({
  route: { params: { novelId: '' }, query: {} },
  messages: { success: vi.fn(), warning: vi.fn(), info: vi.fn(), error: vi.fn() },
}))
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ push: vi.fn() }) }))
vi.mock('naive-ui', async original => ({ ...await original<object>(), useMessage: () => messages }))

const endpoint = 'http://127.0.0.1:1/offline-auto-pipeline'
const prose = [
  '合成自动第1章。黎安在清晨走到旧码头，先检查木箱上的蓝色封条，又把封条编号抄在防潮纸上。她发现木箱边缘留着新鲜泥痕，便叫住值守人，询问昨夜谁从北岸进出。值守人翻出交接册，确认木箱来自北岸渡船，随后把货物交给她重新封存。黎安记下泥痕和交接时间，决定午后去北岸查问船夫。',
  '合成自动第2章。周岚在仓库门口核对名单，确认三件货物都在原位。她逐一检查封绳和木牌，发现第三件货物的编号比交接册少了一笔，便请搬运工停下手里的活。搬运工回忆说，昨晚有人把旧木牌换成了新牌，却没有改册。周岚关上侧门，带着两张木牌沿石阶返回住处，决定晚上整理记录并追查换牌的人。',
]
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

it('starts, checkpoints, pauses an active request and resumes from the run center controls with durable SQL state', async () => {
  const requests: Array<{ phase: string; chapter: number }> = []
  let activeChapter = 0
  let pausedOnce = false
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    expect(url).toBe(endpoint + '/v1/chat/completions')
    const payload = JSON.parse(String(init?.body))
    const prompt = payload.messages.map((message: { content: string }) => message.content).join('\n')
    const phase = payload.stream ? 'review' : prompt.includes('knowledgeChanges') ? 'analysis' : 'writing'
    if (phase === 'writing') {
      const match = prompt.match(/【本章写作事实卡】[\s\S]*?(?:^|\r?\n)章节：第\s*(\d+)\s*章/m)
      expect(match).not.toBeNull()
      activeChapter = Number(match![1])
    }
    expect(activeChapter).toBeGreaterThan(0)
    requests.push({ phase, chapter: activeChapter })
    if (phase === 'writing' && activeChapter === 2 && !pausedOnce) {
      pausedOnce = true
      return new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true })
      })
    }
    const content = phase === 'writing' ? prose[activeChapter - 1] : phase === 'review'
      ? '## 审核结论\n总体判断：可通过\n必改数量：0\n## 必改问题\n无'
      : JSON.stringify({ events: [{ title: '合成收货记录', description: '核对货物来源', type: '主线', characters: [],
        evidence: `合成自动第${activeChapter}章` }], characters: [], globalPlans: [], eventCausalityChanges: [],
      timeAdvanceDays: 0, knowledgeChanges: [], relationshipChanges: [] })
    const usage = { prompt_tokens: 220, completion_tokens: 90, total_tokens: 310 }
    if (payload.stream) {
      return new Response([
        'data: ' + JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] }),
        'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage }),
        'data: [DONE]', '',
      ].join('\n\n'), { headers: { 'Content-Type': 'text/event-stream' } })
    }
    return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage }),
      { headers: { 'Content-Type': 'application/json' } })
  }))
  useConfigStore().addModel({ name: '离线自动任务替身', baseUrl: endpoint, apiKey: '', modelName: 'synthetic-auto',
    maxTokens: 4096, temperature: 0, topP: 1, contextWindow: 32000 })
  const novels = useNovelStore()
  const novel = novels.addNovel({ workingTitle: '自动任务合成作品', genre: 'urban', subGenre: 'mystery', tags: [],
    targetWordCountMin: 1, targetWordCountMax: 2, settings: novels.defaultSettings(), writingStyle: novels.defaultWritingStyle(),
    storyTimeOrigin: { day: 0, label: '起点' } })
  novels.setChapterLengthPolicy(novel.id, { minWords: 100, targetWords: 250, maxWords: 600 })
  for (const title of ['码头', '仓库']) novels.addChapter(novel.id, { title, content: '' })
  await novels.saveNovelNow(novel.id)
  route.params.novelId = novel.id
  const workspace = useReconstructionWorkspaceStore()
  const latest = () => workspace.getAiRuns(novel.id)[0]
  const mountControls = async () => {
    wrapper = mount(AutoView, { attachTo: document.body, global: { stubs: { Teleport: true, RouterLink: true } } })
    await flushPromises()
    await click(latest() ? '任务控制' : '设置并开始任务')
    await click('自动写作任务')
  }
  await mountControls()
  const fields = wrapper!.findAll('.autonomous-run-form input')
  expect(fields).toHaveLength(5)
  await fields[1].setValue('2')
  await fields[1].trigger('blur')
  await fields[4].setValue('1')
  await fields[4].trigger('blur')
  await click('开始自动写作')
  await vi.waitFor(() => expect(latest()).toMatchObject({ status: 'needs_author', checkpoint: 'chapter-0:checkpoint' }), { timeout: 10000 })
  expect(requests.map(row => row.phase)).toEqual(['writing', 'review', 'analysis'])
  expect(wrapper!.find('.ckpt').text()).toContain('每 1 章暂停')
  const completedIds = latest().requests!.map(request => request.id)
  await click('继续任务')
  await vi.waitFor(() => expect(requests).toHaveLength(4), { timeout: 10000 })
  await click('暂停')
  await vi.waitFor(() => expect(latest().status).toBe('paused'), { timeout: 10000 })
  expect(latest().requests!.slice(0, 3).map(request => request.id)).toEqual(completedIds)
  expect((await readStoryAggregate(novel.id)).workspace.aiRuns?.[0]?.status).toBe('paused')

  wrapper!.unmount()
  wrapper = undefined
  workspace.clearNovel(novel.id)
  await novels.initStore()
  await mountControls()
  expect(latest().status).toBe('paused')
  expect(requests).toHaveLength(4)
  await click('继续任务')
  await vi.waitFor(() => expect(latest().status).toBe('completed'), { timeout: 10000 })
  const stored = await readStoryAggregate(novel.id)
  const run = stored.workspace.aiRuns![0]
  expect(run.requests).toHaveLength(7)
  expect(run.requests!.slice(0, 3).map(request => request.id)).toEqual(completedIds)
  expect(requests.filter(request => request.chapter === 1)).toHaveLength(3)
  expect(run.chapterDrafts?.map(draft => draft.stage)).toEqual(['analyzed', 'analyzed'])
  expect(run.chapterDrafts?.every(draft => draft.reviewCoverage?.status === 'complete'
    && draft.review?.status === 'ready_to_finalize' && draft.review.candidateChanges.length > 0)).toBe(true)
  expect(stored.novel!.chapters.map(chapter => chapter.content)).toEqual(['', ''])
  expect(stored.workspace.canonMutations).toHaveLength(0)
  expect(messages.error).not.toHaveBeenCalled()
})
