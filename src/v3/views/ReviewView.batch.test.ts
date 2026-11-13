// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { useConfigStore } from '@/stores/config'
import { useNovelStore } from '@/stores/novel'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { buildChapterReviewInput } from '@/services/chapterReviewInput'
import { readStoryAggregate } from '@/services/storyAggregate'
import ReviewView from './ReviewView.vue'

const { route } = vi.hoisted(() => ({ route: { params: { novelId: '' } } }))
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ push: vi.fn() }) }))

const report = '## 审核结论\n总体判断：可通过\n必改数量：0\n## 必改问题\n无'
const endpoint = 'http://127.0.0.1:1/offline-batch-review'
let pinia: ReturnType<typeof createPinia>
let wrapper: ReturnType<typeof mount> | undefined

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('indexedDB', undefined)
  pinia = createPinia()
  setActivePinia(pinia)
})

afterEach(async () => {
  wrapper?.unmount()
  await useNovelStore().flushPendingSaves()
  await useReconstructionWorkspaceStore().flushPendingSaves(useNovelStore().novels.map(novel => novel.id))
  disposePinia(pinia)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('runs the batch button through real review requests and SQL commits, restores reports and detects edited sources', async () => {
  const requests: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    expect(url).toBe(endpoint + '/v1/chat/completions')
    const payload = JSON.parse(String(init?.body))
    expect(payload.stream).toBe(true)
    requests.push(payload.messages[1].content)
    const body = [
      'data: ' + JSON.stringify({ choices: [{ delta: { content: report }, finish_reason: null }] }),
      'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
      'data: [DONE]',
      '',
    ].join('\n\n')
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
  }))
  useConfigStore().addModel({ name: '离线审校替身', baseUrl: endpoint, apiKey: '', modelName: 'synthetic-review',
    maxTokens: 4096, temperature: 0, topP: 1, contextWindow: 32000 })
  const novels = useNovelStore()
  const created = novels.addNovel({ workingTitle: '批量审校合成作品', genre: 'urban', subGenre: 'mystery', tags: [],
    targetWordCountMin: 1, targetWordCountMax: 2, settings: novels.defaultSettings(), writingStyle: novels.defaultWritingStyle() })
  route.params.novelId = created.id
  const first = novels.addChapter(created.id, { title: '码头', content: '黎安在清晨走到旧码头，先检查木箱上的蓝色封条，又把编号抄在防潮纸上。' })!
  const second = novels.addChapter(created.id, { title: '仓库', content: '周岚关上仓库侧门，带着两张木牌沿石阶返回住处，决定晚上整理交接记录。' })!
  const empty = novels.addChapter(created.id, { title: '空正文', content: '' })!
  const locked = novels.addChapter(created.id, { title: '锁定章', content: '锁定正文保留。' })!
  novels.updateChapter(created.id, locked.id, { status: 'locked' })
  await novels.saveNovelNow(created.id)
  const original = created.chapters.map(chapter => chapter.content)
  const workspace = useReconstructionWorkspaceStore()
  const mountView = async () => {
    wrapper = mount(ReviewView, { global: { stubs: { Teleport: true, RouterLink: true } } })
    await flushPromises()
  }
  await mountView()
  const batch = wrapper!.findAll('button').find(button => button.text() === '批量审校 2 章')!
  expect(batch.attributes('disabled')).toBeUndefined()
  await batch.trigger('click')
  await vi.waitFor(() => {
    expect(wrapper!.find('.batch-error').exists()).toBe(false)
    expect(workspace.getChapterReviews(created.id)).toHaveLength(2)
    expect(wrapper!.findAll('.h-ready')).toHaveLength(2)
  }, { timeout: 10000 })
  expect(requests).toHaveLength(2)
  expect(requests[0]).toContain('以下第 1 章')
  expect(requests[1]).toContain('以下第 2 章')
  const stored = await readStoryAggregate(created.id)
  expect(stored.novel!.chapters.map(chapter => chapter.content)).toEqual(original)
  for (const id of [first.id, second.id]) {
    const chapter = stored.novel!.chapters.find(row => row.id === id)!
    const input = buildChapterReviewInput(stored.novel!, chapter)
    expect(chapter.contentReview).toBe(`覆盖范围：原文 1/1 段（${chapter.content.length}/${chapter.content.length} 字符）· 单段全文。\n\n${report}`)
    expect(chapter.contentReviewSignature).toBe(input.signature)
    expect(chapter.contentReviewCoverage).toMatchObject({ status: 'complete', signature: input.signature,
      coveredCharacters: chapter.content.length, totalCharacters: chapter.content.length })
    expect(stored.workspace.chapterReviews).toContainEqual(expect.objectContaining({ chapterId: id,
      sourceVersionId: input.sourceVersionId, status: 'ready_to_finalize' }))
  }
  for (const id of [empty.id, locked.id]) {
    expect(stored.novel!.chapters.find(row => row.id === id)?.contentReviewSignature).toBeFalsy()
    expect(workspace.getChapterReviews(created.id, id)).toHaveLength(0)
  }
  expect(stored.novel!.chapters.find(row => row.id === locked.id)?.status).toBe('locked')

  wrapper!.unmount()
  workspace.clearNovel(created.id)
  await novels.initStore()
  await mountView()
  expect(wrapper!.findAll('.h-ready')).toHaveLength(2)
  expect(requests).toHaveLength(2)
  novels.updateChapter(created.id, first.id, { content: original[0] + '她补记了封条颜色。' })
  await novels.saveNovelNow(created.id)
  await flushPromises()
  expect(wrapper!.find('.stale-banner').text()).toContain('第 1')
  expect(wrapper!.findAll('.h-stale').length).toBeGreaterThanOrEqual(1)
  expect(requests).toHaveLength(2)
})
