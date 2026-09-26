// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, nextTick, reactive } from 'vue'
import { flushPromises, shallowMount, type VueWrapper } from '@vue/test-utils'
import ChapterEditor from './ChapterEditor.vue'
import ChapterAiStatus from '@/components/chapter-editor/ChapterAiStatus.vue'
import ChapterReviewSidebar from '@/components/chapter-editor/ChapterReviewSidebar.vue'
import ChapterDataPanelSidebar from '@/components/chapter-editor/ChapterDataPanelSidebar.vue'
import { useNovelStore } from '@/stores/novel'
import { useConfigStore, type ModelConfig } from '@/stores/config'
import { callAI, type ChatCompletionOptions } from '@/services/ai'
import { syncSemanticIndexForNovel } from '@/services/semanticIndex'
import { acknowledgeAiActivity, useAiActivities } from '@/services/aiActivity'
import type { ChapterRevision } from '@/types/novel'
import { saveNovelToDb } from '@/services/db/novels'

const { route, push, messages, revisions, confirmFullRepair } = vi.hoisted(() => ({
  route: { params: { novelId: '', chapterId: '' }, query: {} },
  push: vi.fn(),
  messages: { success: vi.fn(), warning: vi.fn(), info: vi.fn(), error: vi.fn() },
  revisions: new Map<string, ChapterRevision>(),
  confirmFullRepair: vi.fn(),
}))
const reactiveRoute = reactive(route)
vi.mock('vue-router', () => ({ useRoute: () => reactiveRoute, useRouter: () => ({ push }) }))
vi.mock('naive-ui', async original => ({
  ...await original<object>(), useMessage: () => messages, useDialog: () => ({ warning: confirmFullRepair }),
}))
vi.mock('@/services/ai', async original => ({ ...await original<object>(), callAI: vi.fn() }))
vi.mock('@/services/semanticIndex', async original => ({
  ...await original<object>(), syncSemanticIndexForNovel: vi.fn(),
}))
vi.mock('@/services/db/novels', () => ({
  saveNovelToDb: vi.fn().mockResolvedValue(undefined),
  loadAllNovelsFromDb: vi.fn().mockResolvedValue([]),
  deleteNovelFromDb: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/services/db/chapterRevisions', () => ({
  createChapterRevision: vi.fn(async (novelId, chapterId, baseContent, proposedContent, source, reason) => {
    const revision: ChapterRevision = {
      id: `revision-${revisions.size}`, novelId, chapterId, baseContent, proposedContent,
      source, reason, diff: 'fixture diff', status: 'pending', createdAt: '2026-01-01', updatedAt: '2026-01-01',
    }
    revisions.set(revision.id, revision)
    return revision
  }),
  getChapterRevision: vi.fn(async id => revisions.get(id) || null),
  updateChapterRevisionStatus: vi.fn(async (id, status) => { revisions.get(id)!.status = status }),
  listChapterRevisions: vi.fn(async () => []),
}))

const passingReview = `## 结论
总体判断：✅可通过
必改数量：0
建议修改数量：4
## 必改问题（只列严重问题）
无。
关键项已逐条演算核对：
- 时间线与设定一致。
## 建议修改
1. 可以补充一些环境细节。`

function reply(options: ChatCompletionOptions, report = passingReview) {
  const content = options.taskName === '章节结尾检查'
    ? JSON.stringify({ isComplete: true, reason: '行动已有结果', isValidCliffhanger: true })
    : options.taskName?.startsWith('内容审查') ? report
      : options.taskName === '更新章节记忆' ? JSON.stringify({ events: [], characters: [], timeAdvanceDays: 0 })
        : !options.taskName && options.skillTask === 'analysis'
          ? JSON.stringify({ title: '重逢之后', summary: '主角寻找失踪的同伴，在小镇发现线索并最终与同伴重逢，结束了当前行动。' })
          : null
  if (content === null) throw new Error(`Unexpected AI request: ${options.taskName}`)
  options.onChunk?.(content)
  return { content }
}

const Button = defineComponent({
  props: ['disabled', 'loading'],
  template: '<button :disabled="disabled || loading"><slot /></button>',
})
let wrapper: VueWrapper | undefined
beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  revisions.clear()
  vi.mocked(saveNovelToDb).mockReset().mockResolvedValue()
  vi.mocked(callAI).mockImplementation(async options => reply(options))
  vi.mocked(syncSemanticIndexForNovel).mockResolvedValue({} as Awaited<ReturnType<typeof syncSemanticIndexForNovel>>)
  const config = useConfigStore()
  config.aiWorkflowMode = 'fast'
  vi.spyOn(config, 'getModelForTask').mockReturnValue({ id: 'test', modelName: 'test' } as ModelConfig)
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  for (const task of useAiActivities().activities.value) acknowledgeAiActivity(task.id)
  vi.restoreAllMocks()
})

async function setup(writingMode: 'ai' | 'manual' = 'manual', source = '甲'.repeat(2100) + '。') {
  const store = useNovelStore()
  const createdBook = store.addNovel({
    genre: 'fantasy', subGenre: '', tags: [], targetWordCountMin: 10, targetWordCountMax: 20,
    writingMode, settings: store.defaultSettings(), writingStyle: store.defaultWritingStyle(),
  })
  const book = store.getNovel(createdBook.id)!
  const createdChapter = store.addChapter(book.id, { title: '重逢', content: source })!
  const chapter = book.chapters.find(item => item.id === createdChapter.id)!
  reactiveRoute.params.novelId = book.id
  reactiveRoute.params.chapterId = chapter.id
  const save = vi.spyOn(store, 'saveNovelNow').mockResolvedValue()
  vi.spyOn(store, 'getChapterRevisions').mockResolvedValue([])
  wrapper = shallowMount(ChapterEditor, { global: { stubs: { Button }, renderStubDefaultSlot: true } })
  await flushPromises()
  return { store, book, chapter, save }
}

async function click(label: string) {
  const button = wrapper!.findAll('button').find(item => item.text() === label)
  expect(button, `missing button: ${label}`).toBeDefined()
  await button!.trigger('click')
  await flushPromises()
}
function calls(task: string) {
  return vi.mocked(callAI).mock.calls.filter(([options]) => options.taskName === task)
}

describe('chapter review and completion', () => {
  it('keeps data and review sidebars mutually exclusive', async () => {
    await setup()
    const dataPanel = wrapper!.findComponent(ChapterDataPanelSidebar)
    const reviewPanel = wrapper!.findComponent(ChapterReviewSidebar)

    await wrapper!.get('[title="数据面板"]').trigger('click')
    expect(dataPanel.props('open')).toBe(true)
    expect(reviewPanel.props('open')).toBe(false)

    reviewPanel.vm.$emit('toggle')
    await flushPromises()
    expect(reviewPanel.props('open')).toBe(true)
    expect(dataPanel.props('open')).toBe(false)

    await wrapper!.get('[title="数据面板"]').trigger('click')
    expect(dataPanel.props('open')).toBe(true)
    expect(reviewPanel.props('open')).toBe(false)
  })

  it('selects chapter-related data automatically and respects manual changes without a confirmation dialog', async () => {
    const { store, book } = await setup('ai', '叶沉走进终端室。')
    const character = store.addDataPanelItem(book.id, { name: '叶沉', category: '角色', fields: [], relatedKeywords: [] })!
    const terminal = store.addDataPanelItem(book.id, { name: '终端', category: '资源', fields: [], relatedKeywords: [] })!
    const manual = store.addDataPanelItem(book.id, { name: '备用物资', category: '资源', fields: [], relatedKeywords: [] })!
    store.addDataPanelItem(book.id, { name: '无关仓库', category: '建筑', fields: [], relatedKeywords: [] })
    const dataPanel = wrapper!.findComponent(ChapterDataPanelSidebar)
    dataPanel.vm.$emit('toggle-item', terminal.id)
    dataPanel.vm.$emit('toggle-item', terminal.id)
    dataPanel.vm.$emit('toggle-item', manual.id)
    await flushPromises()

    const generated = '甲'.repeat(2100) + '。'
    vi.mocked(callAI).mockImplementation(async options => {
      if (options.taskName === '正文生成') {
        options.onChunk?.(generated)
        return { content: generated, finishReason: 'stop' }
      }
      return reply(options)
    })
    await wrapper!.get('[title="AI 生成正文"]').trigger('click')
    await flushPromises()

    const selected = dataPanel.props('selectedItemIds') as Set<string>
    expect([...selected].sort()).toEqual([character.id, manual.id].sort())
    const messages = calls('正文生成')[0][0].messages
    const prompt = messages[messages.length - 1].content
    expect(prompt).toContain('叶沉')
    expect(prompt).toContain('备用物资')
    expect(prompt).not.toContain('无关仓库')
    expect(prompt).not.toContain('终端（')
    expect(wrapper!.html()).not.toContain('确认本章关联数据')
  })

  it('reuses the current review and completes memory in one action without rewriting a passing report', async () => {
    const { chapter } = await setup('ai')
    await wrapper!.get('[title="内容审查（6维度）"]').trigger('click')
    await flushPromises()
    expect(chapter.contentReview).toContain('可通过')
    await click('完成本章')
    expect(chapter.status).toBe('finalized')
    expect(calls('内容审查')).toHaveLength(1)
    expect(calls('章节结尾检查')).toHaveLength(1)
    expect(calls('更新章节记忆')).toHaveLength(1)
    expect(vi.mocked(callAI).mock.calls).toHaveLength(4)
    expect(wrapper!.text()).toContain('生成下一章')
    expect(wrapper!.text()).not.toContain('定稿入库')
    expect(wrapper!.findComponent(ChapterReviewSidebar).props('actionLabel')).toBe('生成下一章')
    expect(push).not.toHaveBeenCalled()
  })

  it('resumes only the unfinished memory step after a failure', async () => {
    const { chapter } = await setup()
    let memoryAttempts = 0
    vi.mocked(callAI).mockImplementation(async options => {
      if (options.taskName === '更新章节记忆' && memoryAttempts++ === 0) throw new Error('网络故障')
      return reply(options)
    })
    await click('完成本章')
    expect(chapter.status).toBe('completed')
    expect(wrapper!.text()).not.toContain('新建下一章')
    await click('继续完成本章')
    expect(chapter.status).toBe('finalized')
    expect(calls('章节结尾检查')).toHaveLength(1)
    expect(calls('内容审查')).toHaveLength(1)
    expect(calls('更新章节记忆')).toHaveLength(2)
    expect(vi.mocked(callAI).mock.calls.filter(([options]) => !options.taskName)).toHaveLength(1)
  })

  it('keeps completing the original chapter after navigating to the chapter list', async () => {
    const { chapter } = await setup()
    let releaseReview!: () => void
    const reviewGate = new Promise<void>(resolve => { releaseReview = resolve })
    let reviewSignal: AbortSignal | undefined
    vi.mocked(callAI).mockImplementation(async options => {
      if (options.taskName === '内容审查') {
        reviewSignal = options.signal
        await reviewGate
        options.signal?.throwIfAborted()
      }
      return reply(options)
    })

    const button = wrapper!.findAll('button').find(item => item.text() === '完成本章')!
    await button.trigger('click')
    await flushPromises()
    expect(reviewSignal).toBeDefined()
    reactiveRoute.params.chapterId = ''
    await nextTick()
    expect(reviewSignal?.aborted).toBe(false)

    releaseReview()
    await flushPromises()
    expect(chapter.status).toBe('finalized')
    expect(calls('更新章节记忆')).toHaveLength(1)
    expect(messages.error).not.toHaveBeenCalled()
    reactiveRoute.params.chapterId = chapter.id
    await nextTick()
    expect(wrapper!.text()).toContain('新建下一章')
  })

  it('continues writing the original chapter after navigating away', async () => {
    const { chapter } = await setup('ai', '开端。')
    const generated = '甲'.repeat(2100) + '。'
    let releaseWriting!: () => void
    const writingGate = new Promise<void>(resolve => { releaseWriting = resolve })
    vi.mocked(callAI).mockImplementation(async options => {
      if (options.taskName === '正文生成') {
        await writingGate
        options.signal?.throwIfAborted()
        options.onChunk?.(generated)
        return { content: generated, finishReason: 'stop' }
      }
      return reply(options)
    })

    await wrapper!.get('[title="AI 生成正文"]').trigger('click')
    await flushPromises()
    const writingSignal = calls('正文生成')[0]?.[0].signal
    expect(writingSignal).toBeDefined()
    reactiveRoute.params.chapterId = ''
    await nextTick()
    expect(writingSignal?.aborted).toBe(false)

    releaseWriting()
    await flushPromises()
    expect(chapter.content).toBe('开端。' + generated)
    expect(messages.error).not.toHaveBeenCalled()
  })

  it('blocks a genuinely failing review without changing manual prose', async () => {
    const { chapter } = await setup()
    const original = chapter.content
    vi.mocked(callAI).mockImplementation(async options => reply(options, '总体判断：必须修改\n必改数量：1'))
    await click('完成本章')
    expect(chapter.status).toBe('writing')
    expect(chapter.content).toBe(original)
    expect(calls('更新章节记忆')).toHaveLength(0)
    expect(syncSemanticIndexForNovel).not.toHaveBeenCalled()
    expect(wrapper!.text()).not.toContain('新建下一章')
  })

  it('invalidates the old review when the body changes', async () => {
    await setup()
    await wrapper!.get('[title="内容审查（6维度）"]').trigger('click')
    await flushPromises()
    await wrapper!.get('textarea').setValue('乙'.repeat(2100) + '。')
    expect(wrapper!.findComponent(ChapterReviewSidebar).props('reviewStatus')).toContain('待更新')
    await click('完成本章')
    expect(calls('内容审查')).toHaveLength(2)
  })

  it('does not mark an empty memory response as a successfully completed chapter', async () => {
    const { chapter } = await setup()
    vi.mocked(callAI).mockImplementation(async options => {
      if (options.taskName === '更新章节记忆') { options.onChunk?.('{}'); return { content: '{}' } }
      return reply(options)
    })
    await click('完成本章')
    expect(chapter.status).toBe('completed')
    expect(syncSemanticIndexForNovel).not.toHaveBeenCalled()
    expect(messages.error).toHaveBeenCalledWith(expect.stringContaining('记忆未返回有效结果'))
  })

  it('retains completed steps on save failure without exposing next-chapter prematurely', async () => {
    const { chapter, save } = await setup()
    save.mockImplementation(async () => {
      if (chapter.status === 'finalized') throw new Error('磁盘写入失败')
    })
    await click('完成本章')
    expect(chapter.status).toBe('completed')
    expect(wrapper!.text()).not.toContain('新建下一章')
    save.mockResolvedValue()
    await click('继续完成本章')
    expect(chapter.status).toBe('finalized')
    expect(calls('更新章节记忆')).toHaveLength(1)
    expect(calls('内容审查')).toHaveLength(1)
  })

  it('can stop a waiting review without advancing the chapter', async () => {
    const { chapter } = await setup()
    vi.mocked(callAI).mockImplementation(async options => {
      if (options.taskName === '内容审查') {
        options.onChunk?.('总体判断：可通过\n')
        return new Promise((_resolve, reject) => {
          options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true })
        })
      }
      return reply(options)
    })
    await click('完成本章')
    expect(wrapper!.findComponent(ChapterAiStatus).props('completing')).toBe(true)
    wrapper!.findComponent(ChapterAiStatus).vm.$emit('stop')
    await flushPromises()
    expect(chapter.status).toBe('writing')
    expect(calls('更新章节记忆')).toHaveLength(0)
    expect(wrapper!.findComponent(ChapterAiStatus).props('completing')).toBe(false)
    expect(wrapper!.findComponent(ChapterReviewSidebar).props('contentReview')).toBe('')
    vi.mocked(callAI).mockImplementation(async options => reply(options))
    await click('完成本章')
    expect(calls('内容审查')).toHaveLength(2)
    expect(calls('章节结尾检查')).toHaveLength(1)
    expect(chapter.status).toBe('finalized')
  })

  it('opens an existing next chapter instead of creating a duplicate', async () => {
    const { store, book } = await setup()
    const existing = store.addChapter(book.id, { title: '再出发', content: '已有内容' })!
    await click('完成本章')
    await click('进入下一章')
    expect(book.chapters).toHaveLength(2)
    expect(push).toHaveBeenCalledWith(`/workspace/${book.id}/editor/${existing.id}`)
  })

  it('creates the next chapter once and preserves finalized state when saving unchanged prose', async () => {
    const { book, chapter } = await setup()
    await click('完成本章')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }))
    await flushPromises()
    expect(chapter.status).toBe('finalized')
    await click('新建下一章')
    expect(book.chapters).toHaveLength(2)
    await click('进入下一章')
    expect(book.chapters).toHaveLength(2)
  })

  it('rejects a stale review when the stored chapter changes during the request', async () => {
    const { chapter } = await setup()
    vi.mocked(callAI).mockImplementation(async options => {
      if (options.taskName === '内容审查') chapter.content = '外部修改后的正文'
      return reply(options)
    })
    await click('完成本章')
    expect(chapter.status).not.toBe('finalized')
    expect(chapter.contentReview).toBe('')
    expect(calls('更新章节记忆')).toHaveLength(0)
    expect(messages.error).toHaveBeenCalledWith(expect.stringContaining('正文已变化'))
  })

  it('retries an incomplete review at most once without proceeding to completion', async () => {
    const { chapter } = await setup()
    vi.mocked(callAI).mockImplementation(async options => reply(options, '# 全维度审查报告\n正在分析'))
    await click('完成本章')
    expect(calls('内容审查')).toHaveLength(1)
    expect(calls('内容审查（重试）')).toHaveLength(1)
    expect(chapter.status).toBe('writing')
    expect(calls('更新章节记忆')).toHaveLength(0)
  })

  it('requires fresh checks and memory after editing a completed chapter', async () => {
    const { chapter } = await setup()
    await click('完成本章')
    expect(chapter.status).toBe('finalized')
    await wrapper!.get('textarea').setValue('乙'.repeat(2100) + '。')
    expect(wrapper!.text()).not.toContain('新建下一章')
    await click('完成本章')
    expect(calls('章节结尾检查')).toHaveLength(2)
    expect(calls('内容审查')).toHaveLength(2)
    expect(calls('更新章节记忆')).toHaveLength(2)
    expect(chapter.status).toBe('finalized')
  })

  it('supports completion and next-chapter actions directly from the review panel', async () => {
    const { book, chapter } = await setup()
    await wrapper!.get('[title="内容审查（6维度）"]').trigger('click')
    await flushPromises()
    const panel = wrapper!.findComponent(ChapterReviewSidebar)
    panel.vm.$emit('proceed')
    await flushPromises()
    expect(chapter.status).toBe('finalized')
    expect(panel.props('actionLabel')).toBe('新建下一章')
    panel.vm.$emit('proceed')
    await flushPromises()
    expect(book.chapters).toHaveLength(2)
    expect(push).toHaveBeenCalledOnce()
  })

  it('reuses the ending check from generation and keeps the natural ending beyond the word target', async () => {
    const { chapter } = await setup('ai', '开端。')
    const generated = '甲'.repeat(2100) + '。剧情至此才收束。'
    vi.mocked(callAI).mockImplementation(async options => {
      if (options.taskName === '正文生成') {
        options.onChunk?.(generated)
        return { content: generated, finishReason: 'stop' }
      }
      return reply(options)
    })
    await wrapper!.get('[title="AI 生成正文"]').trigger('click')
    await flushPromises()
    expect(chapter.content).toBe('开端。' + generated)
    expect(calls('章节结尾检查')).toHaveLength(1)
    await click('完成本章')
    expect(chapter.status).toBe('finalized')
    expect(calls('章节结尾检查')).toHaveLength(1)
  })

  it('bounds repeated short generations without discarding the draft', async () => {
    const { chapter } = await setup('ai', '开端。')
    vi.mocked(callAI).mockImplementation(async options => {
      if (options.taskName === '正文生成') { options.onChunk?.('短句。'); return { content: '短句。', finishReason: 'stop' } }
      return reply(options)
    })
    await wrapper!.get('[title="AI 生成正文"]').trigger('click')
    await flushPromises()
    expect(calls('正文生成')).toHaveLength(3)
    expect(chapter.content).toBe('开端。短句。短句。短句。')
    expect(calls('章节结尾检查')).toHaveLength(0)
  })

  it('preserves an unfinished tail when the generation connection fails', async () => {
    const { chapter } = await setup('ai', '开端。')
    vi.mocked(callAI).mockImplementation(async options => {
      options.onChunk?.('他刚要说')
      throw new Error('连接断开')
    })
    await wrapper!.get('[title="AI 生成正文"]').trigger('click')
    await flushPromises()
    expect(chapter.content).toBe('开端。他刚要说')
  })

  it('invalidates a stored review when established settings change', async () => {
    const { book } = await setup()
    await wrapper!.get('[title="内容审查（6维度）"]').trigger('click')
    await flushPromises()
    book.settings.protagonist.name = '新的主角设定'
    await flushPromises()
    expect(wrapper!.findComponent(ChapterReviewSidebar).props('reviewStatus')).toContain('待更新')
    await click('完成本章')
    expect(calls('内容审查')).toHaveLength(2)
  })

  it('checks a local candidate before applying it, preserves history, and does not repeat candidate checks', async () => {
    const original = '甲'.repeat(2100) + '。他在五月三日抵达。'
    const { chapter } = await setup('ai', original)
    let reviews = 0
    vi.mocked(callAI).mockImplementation(async options => {
      if (options.taskName === '局部修正候选稿') {
        expect(chapter.content).toBe(original)
        expect((wrapper!.get('textarea').element as HTMLTextAreaElement).value).toBe(original)
        return { content: JSON.stringify({ edits: [{ original: '五月三日', replacement: '五月四日' }] }) }
      }
      if (options.taskName === '内容审查') {
        expect(chapter.content).toBe(original)
        return reply(options, reviews++ === 0 ? '总体判断：必须修改\n必改数量：1' : passingReview)
      }
      return reply(options)
    })
    await click('完成本章')
    expect(chapter.content).toBe(original.replace('五月三日', '五月四日'))
    expect(chapter.status).toBe('finalized')
    expect(calls('局部修正候选稿')).toHaveLength(1)
    expect(calls('整章修订候选稿')).toHaveLength(0)
    expect(calls('内容审查')).toHaveLength(2)
    expect(calls('章节结尾检查')).toHaveLength(2)
    expect([...revisions.values()][0]).toMatchObject({ baseContent: original, status: 'accepted' })
    expect(chapter.versions?.some(version => version.snapshot.includes('五月三日'))).toBe(true)
  })

  it.each(['unmatched', 'failed-review', 'length'])('keeps original text when a repair is %s', async failure => {
    const original = '甲'.repeat(2100) + '。五月三日抵达。'
    const { chapter } = await setup('ai', original)
    vi.mocked(callAI).mockImplementation(async options => {
      if (options.taskName === '局部修正候选稿') return {
        content: JSON.stringify({ edits: [{ original: failure === 'unmatched' ? '不存在的原文' : '五月三日', replacement: '五月四日' }] }),
        finishReason: failure === 'length' ? 'length' : 'stop',
      }
      return reply(options, '总体判断：必须修改\n必改数量：1')
    })
    await click('完成本章')
    expect(chapter.content).toBe(original)
    expect(chapter.status).not.toBe('finalized')
    expect(calls('更新章节记忆')).toHaveLength(0)
    if (failure === 'failed-review') {
      expect([...revisions.values()][0].status).toBe('pending')
      expect(wrapper!.findComponent(ChapterReviewSidebar).props('pendingRevision')).not.toBeNull()
    } else expect(revisions.size).toBe(0)
  })

  it('keeps full revision behind an explicit confirmation', async () => {
    await setup('ai')
    wrapper!.findComponent(ChapterReviewSidebar).vm.$emit('rewrite', passingReview, 'full')
    await flushPromises()
    expect(confirmFullRepair).toHaveBeenCalledOnce()
    expect(callAI).not.toHaveBeenCalled()
  })

  it('preserves the original when a pending repair is stopped', async () => {
    const original = '甲'.repeat(2100) + '。五月三日抵达。'
    const { chapter } = await setup('ai', original)
    vi.mocked(callAI).mockImplementation(async options => {
      if (options.taskName === '局部修正候选稿') return new Promise((_resolve, reject) => {
        options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true })
      })
      return reply(options, '总体判断：必须修改\n必改数量：1')
    })
    await click('完成本章')
    wrapper!.findComponent(ChapterAiStatus).vm.$emit('stop')
    await flushPromises()
    expect(chapter.content).toBe(original)
    expect(revisions.size).toBe(0)
    expect(wrapper!.findComponent(ChapterAiStatus).props('completing')).toBe(false)
  })

  it('restores the original when applying a validated repair cannot be saved', async () => {
    const original = '甲'.repeat(2100) + '。五月三日抵达。'
    const { chapter } = await setup('ai', original)
    let reviews = 0
    vi.mocked(callAI).mockImplementation(async options => {
      if (options.taskName === '局部修正候选稿') return { content: JSON.stringify({ edits: [{ original: '五月三日', replacement: '五月四日' }] }) }
      return reply(options, options.taskName === '内容审查' && reviews++ === 0 ? '总体判断：必须修改\n必改数量：1' : passingReview)
    })
    vi.mocked(saveNovelToDb).mockRejectedValueOnce(new Error('磁盘写入失败'))
    await click('完成本章')
    expect(chapter.content).toBe(original)
    expect([...revisions.values()][0].status).toBe('pending')
    expect(chapter.status).not.toBe('finalized')
  })
})
