// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, reactive, ref } from 'vue'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { applyEditorDraftCommand } from '@/services/editorRecovery'
import type { EditorDraft, EditorDraftCommand } from '@/types/editorRecovery'
import { useChapterSession } from './useChapterSession'

const stores = vi.hoisted(() => ({ novels: {} as any, workspace: {} as any }))
vi.mock('@/stores/novel', () => ({ useNovelStore: () => stores.novels }))
vi.mock('@/stores/knowledge', () => ({ useKnowledgeStore: () => ({ knowledgeBases: [] }) }))
vi.mock('@/stores/reconstructionWorkspace', () => ({ useReconstructionWorkspaceStore: () => stores.workspace }))

describe('V3 chapter session recovery lifecycle', () => {
  let pinia: ReturnType<typeof createPinia>
  let wrapper: ReturnType<typeof mount>
  let session: ReturnType<typeof useChapterSession>
  let rows: EditorDraft[]
  let chapter: any
  let saveFormal: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.useFakeTimers()
    pinia = createPinia(); setActivePinia(pinia)
    rows = []
    chapter = reactive({ id: 'chapter-1', title: '渡口', content: '林澈在渡口等候。', chapterIndex: 0, status: 'writing', wordCount: 8 })
    const novel = reactive({ id: 'novel-1', chapters: [chapter], chapterPlans: [], settings: {}, writingStyle: {} })
    saveFormal = vi.fn().mockResolvedValue(undefined)
    stores.novels = {
      getNovel: () => novel,
      getChapterRevisions: vi.fn().mockResolvedValue([]),
      updateChapter: vi.fn((_owner, _id, patch) => { Object.assign(chapter, patch); return true }),
      saveNovelNow: saveFormal,
    }
    stores.workspace = {
      hydrateFromPersistence: vi.fn().mockResolvedValue(undefined),
      getCreationDraft: () => undefined, getCanonMutations: () => [], getStoryMemories: () => [],
      getReviewFindings: () => [], getCandidates: () => [], getLatestChapterReview: () => undefined,
      getEditorDrafts: () => rows.filter(row => row.status === 'active'),
      trackEditorDraftWork: (work: Promise<unknown>) => work,
      saveEditorDraft: vi.fn(async (command: EditorDraftCommand) => {
        const result = applyEditorDraftCommand(rows, command, '2026-11-08T12:00:00.000Z')
        rows = result.drafts
        return result.draft
      }),
    }
    wrapper = mount(defineComponent({
      setup() { session = useChapterSession({ novelId: ref('novel-1'), chapterId: ref('chapter-1') }); return () => null },
    }))
    await flushPromises()
  })

  afterEach(() => { wrapper.unmount(); disposePinia(pinia); vi.useRealTimers(); vi.restoreAllMocks() })

  it('载入未改动章节时不制造可恢复草稿或安排自动保存', async () => {
    await vi.advanceTimersByTimeAsync(6000)
    expect(rows).toEqual([])
    expect(saveFormal).not.toHaveBeenCalled()
    expect(session.drafts.value).toEqual([])
  })

  it('can save repeatedly and persist the next edit after retiring a draft', async () => {
    session.content.value = '林澈在渡口等候陈伯。'
    await flushPromises()
    const firstId = rows.find(row => row.status === 'active')!.id
    await expect(session.saveNow()).resolves.toBe(true)
    await expect(session.saveNow()).resolves.toBe(true)
    session.content.value = '林澈与陈伯一同离开渡口。'
    await flushPromises()
    const next = rows.find(row => row.status === 'active')!
    expect(next.id).not.toBe(firstId)
    expect(next.payload?.content).toBe(session.content.value)
    await expect(session.saveNow()).resolves.toBe(true)
    await expect(session.saveNow()).resolves.toBe(true)
    expect(chapter.content).toBe('林澈与陈伯一同离开渡口。')
    expect(rows.filter(row => row.status === 'active')).toEqual([])
    expect(session.saveError.value).toBe('')
  })

  it('retains the recovery input when the formal save fails, then supports retry', async () => {
    session.content.value = '未落盘的作者修改。'
    await flushPromises()
    saveFormal.mockRejectedValueOnce(new Error('磁盘写入失败'))
    await expect(session.saveNow()).rejects.toThrow('磁盘写入失败')
    expect(rows.find(row => row.status === 'active')?.payload?.content).toBe('未落盘的作者修改。')
    await expect(session.saveNow()).resolves.toBe(true)
    await expect(session.saveNow()).resolves.toBe(true)
    expect(rows.filter(row => row.status === 'active')).toEqual([])
  })

  it('does not retire newer input typed while the formal save is pending', async () => {
    session.content.value = '开始保存的正文。'
    await flushPromises()
    let release!: () => void
    saveFormal.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
    const saving = session.saveNow()
    await flushPromises()
    session.content.value = '保存期间继续写下的新正文。'
    await flushPromises()
    release()
    await expect(saving).resolves.toBe(true)
    expect(rows.find(row => row.status === 'active')?.payload?.content).toBe('保存期间继续写下的新正文。')
    await expect(session.saveNow()).resolves.toBe(true)
    await expect(session.saveNow()).resolves.toBe(true)
    expect(chapter.content).toBe('保存期间继续写下的新正文。')
    expect(rows.filter(row => row.status === 'active')).toEqual([])
  })

  it('serializes an automatic save overlapping a manual save', async () => {
    session.content.value = '自动与手动保存重叠的正文。'
    await flushPromises()
    let release!: () => void
    saveFormal.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
    const automatic = session.saveNow()
    await flushPromises()
    const manual = session.saveNow()
    await flushPromises()
    release()
    await expect(Promise.all([automatic, manual])).resolves.toEqual([true, true])
    expect(saveFormal).toHaveBeenCalledTimes(1)
    expect(rows.filter(row => row.status === 'active')).toEqual([])
  })
})
