// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { useNovelStore } from '@/stores/novel'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { captureDataClockBaseline, confirmDataChapterTime } from '@/services/dataPanelTransactions'
import { projectStoryTime, recordStoryTime } from '@/services/storyTime'
import ChapterTimePanel from './ChapterTimePanel.vue'

describe('V3 chapter time confirmation', () => {
  let pinia: ReturnType<typeof createPinia>
  let wrapper: ReturnType<typeof mount>
  let novel: ReturnType<ReturnType<typeof useNovelStore>['addNovel']>
  let confirmTime: ReturnType<typeof vi.spyOn>
  const now = '2026-11-08T12:00:00.000Z'
  const nextId = () => crypto.randomUUID()

  beforeEach(() => {
    pinia = createPinia(); setActivePinia(pinia)
    const novels = useNovelStore()
    novel = novels.addNovel({ genre: 'urban', subGenre: 'mystery', tags: [], targetWordCountMin: 20, targetWordCountMax: 30,
      settings: novels.defaultSettings(), writingStyle: novels.defaultWritingStyle() })
    novels.addChapter(novel.id, { title: '渡口', content: '傍晚抵达渡口，当夜住进客栈。' })
    novel.storyClock = undefined
    confirmTime = vi.spyOn(novels, 'confirmChapterStoryTime').mockImplementation(async (_id, input, baseline) => {
      const result = confirmDataChapterTime({ novel, workspace: { candidates: [], reviewFindings: [], canonMutations: [] } },
        { ...input, source: 'author' }, baseline, now, nextId)
      return result.clock
    })
  })
  afterEach(() => { wrapper?.unmount(); disposePinia(pinia); vi.restoreAllMocks() })
  function open() {
    wrapper = mount(ChapterTimePanel, { props: { novel, chapter: novel.chapters[0], busy: false,
      saveContent: vi.fn().mockResolvedValue(true) }, global: { stubs: { RouterLink: true } } })
  }
  async function enter(start: string, end: string) {
    await wrapper.get('input[type="number"]').setValue(start)
    await wrapper.findAll('input[type="number"]')[1].setValue(end)
  }

  it('requires explicit numbers without an origin and accepts an independent same-day anchor', async () => {
    open()
    expect(wrapper.get('select').element.value).toBe('absolute')
    expect(wrapper.get<HTMLInputElement>('input[type="number"]').element.value).toBe('')
    await wrapper.get('form').trigger('submit')
    expect(confirmTime).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toContain('明确填写')
    await enter('0', '0')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(projectStoryTime(novel, novel.chapters[0])).toMatchObject({ known: true, startDay: 0, endDay: 0, elapsedDays: 0 })
    expect(wrapper.emitted('saved')).toHaveLength(1)
  })

  it('keeps entered numbers when the transaction fails and lets the author retry', async () => {
    open(); await enter('0', '2')
    confirmTime.mockRejectedValueOnce(new Error('磁盘写入失败'))
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('磁盘写入失败')
    expect(wrapper.findAll<HTMLInputElement>('input[type="number"]')[1].element.value).toBe('2')
    expect(projectStoryTime(novel, novel.chapters[0]).known).toBe(false)
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(projectStoryTime(novel, novel.chapters[0]).endDay).toBe(2)
  })

  it('rejects a changed manuscript until its source is explicitly reloaded', async () => {
    open(); await enter('0', '0')
    novel.chapters[0].content = '三天后才抵达渡口。'
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(confirmTime).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toContain('重新读取来源')
  })

  it('requires replacement consent for an invalid old source and preserves its history', async () => {
    const chapter = novel.chapters[0]
    recordStoryTime(novel, { chapterId: chapter.id, chapterIndex: 0, content: chapter.content,
      mode: 'absolute', startDay: 0, endDay: 0, source: 'author' }, now, nextId)
    chapter.content = '三天后，林澈抵达渡口，当夜住进客栈。'
    open(); await enter('3', '3')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(projectStoryTime(novel, chapter)).toMatchObject({ known: true, startDay: 3, endDay: 3 })
    expect(novel.storyClock?.history).toHaveLength(2)
    expect(novel.storyClock?.history?.[0].status).toBe('superseded')
  })

  it('does not bypass an existing time candidate', async () => {
    const chapter = novel.chapters[0]
    useReconstructionWorkspaceStore().addCandidateChanges(novel.id, [{ id: 'time-candidate', novelId: novel.id,
      chapterId: chapter.id, type: 'timeline', proposedValue: '{}', evidence: [], status: 'proposed', createdAt: now, updatedAt: now }])
    open(); await enter('0', '0')
    const baseline = captureDataClockBaseline(novel)
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(confirmTime).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toContain('已有时间候选')
    expect(captureDataClockBaseline(novel)).toBe(baseline)
  })
})
