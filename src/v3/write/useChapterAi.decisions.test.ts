import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { ref, type Ref } from 'vue'
import { buildAnalysisSourceVersionId } from '@/services/reconstructionCandidates'
import type { ReviewFinding } from '@/types/reconstruction'
import { useNovelStore } from '@/stores/novel'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { useChapterAi } from './useChapterAi'
import type { useChapterSession } from './useChapterSession'
import type { CandidateChange } from '@/types/reconstruction'
import { useConfigStore, type ModelConfig } from '@/stores/config'

const replacement = vi.hoisted(() => vi.fn())
vi.mock('@/services/selectionAssistant', () => ({ requestSelectionReplacement: replacement }))
vi.mock('@/services/context', async importOriginal => ({ ...await importOriginal<typeof import('@/services/context')>(),
  buildWritingContext: () => ({ outlineContext: '', previousSummary: '', lastParagraph: '', chapterGuidance: '', semanticEvidence: '' }),
  augmentWritingContextWithVectorMemory: async (_novel: unknown, _chapter: unknown, context: unknown) => context,
  buildChapterFactCard: () => '合成事实卡',
}))

describe('V3 author decision submission', () => {
  let pinia: ReturnType<typeof createPinia>
  beforeEach(() => { pinia = createPinia(); setActivePinia(pinia) })
  afterEach(() => { disposePinia(pinia); vi.restoreAllMocks() })
  function setup() {
    const novels = useNovelStore()
    const novel = novels.addNovel({ genre: '', subGenre: '', tags: [], targetWordCountMin: 1, targetWordCountMax: 2,
      settings: novels.defaultSettings(), writingStyle: novels.defaultWritingStyle() })
    const chapter = novels.addChapter(novel.id, { content: '林澈没有拆信。' })!
    const reviewVersion = ref('review-version')
    const session = { novel: ref(novel), chapter: ref(chapter), content: ref(chapter.content), title: ref(chapter.title), saved: ref(true),
      contentVersion: ref('body-version'), contextVersion: ref('ctx'), reviewSourceVersion: reviewVersion, findings: ref([]), candidates: ref([]),
      workflow: ref({ reviewCurrent: true }), pendingRevision: ref(undefined),
      saveNow: vi.fn().mockResolvedValue(true), markChanged: vi.fn() } as unknown as ReturnType<typeof useChapterSession>
    const ai = useChapterAi({ session, editor: ref() })
    const workspace = useReconstructionWorkspaceStore()
    const accept = vi.spyOn(workspace, 'acceptStoryCandidate').mockResolvedValue({} as any)
    const candidate: CandidateChange = { id: 'candidate-1', novelId: novel.id, chapterId: chapter.id, type: 'knowledge',
      sourceVersionId: 'body-version', status: 'proposed', proposedValue: '{}', evidence: [],
      createdAt: '2026-11-08T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z' }
    return { ai, session, workspace, accept, candidate, reviewVersion }
  }
  it('forwards the exact viewed record, source version, author note and identity decision', async () => {
    const { ai, accept, candidate } = setup()
    const memory = { action: 'new' as const, confirmed: true as const }
    await ai.acceptCandidate(candidate, '{"fact":"信件内容"}', '已核对引文', memory, 'review-version')
    expect(accept).toHaveBeenCalledWith(candidate.novelId, candidate.id, expect.any(String), '{"fact":"信件内容"}',
      { expectedRecord: candidate, expectedSourceVersionId: 'review-version', authorNote: '已核对引文', characterMemoryDecision: memory })
  })
  it('rejects a changed source during saving and leaves the candidate untouched', async () => {
    const { ai, session, accept, candidate, reviewVersion } = setup()
    vi.mocked(session.saveNow).mockImplementationOnce(async () => { reviewVersion.value = 'changed-version'; return true })
    await expect(ai.acceptCandidate(candidate)).rejects.toThrow('正文或审核依据已经变化')
    expect(accept).not.toHaveBeenCalled()
    expect(candidate.status).toBe('proposed')
  })
  it('binds rejection to the viewed record and preserves the author explanation', async () => {
    const { ai, workspace, candidate } = setup()
    const reject = vi.spyOn(workspace, 'rejectStoryCandidate').mockResolvedValue(undefined)
    await ai.rejectCandidate(candidate, '证据不足')
    expect(reject).toHaveBeenCalledWith(candidate.novelId, candidate.id, expect.any(String),
      { expectedRecord: candidate, expectedSourceVersionId: 'review-version', authorNote: '证据不足' })
  })
  it('正文标记复用准确引文定位，审核上下文失效后移除旧标记', () => {
    const { ai, session } = setup()
    ;(session.findings as Ref<ReviewFinding[]>).value = [{ id: 'finding', chapterId: session.chapter.value!.id, type: 'foreshadowing', severity: 'suggestion',
      title: '信件伏笔', explanation: '', evidence: [], blocksFinalization: false, status: 'open',
      sourceVersionId: buildAnalysisSourceVersionId(session.content.value), quotedText: '没有拆信', startOffset: 0, endOffset: 4 }]
    expect(ai.currentMarks.value).toEqual([expect.objectContaining({ id: 'f:finding', start: 2, end: 6, cls: 'mk-fs' })])
    session.workflow.value!.reviewCurrent = false
    expect(ai.currentMarks.value).toEqual([])
  })
  it('正文候选只添加装饰，不写正文；上下文变化后撤下候选标记', () => {
    const { ai, session } = setup()
    const before = session.content.value
    session.pendingRevision.value = { id: 'r', chapterId: session.chapter.value!.id, novelId: session.novel.value!.id,
      baseContent: before, proposedContent: before + '他走了。', diff: '', reason: '', source: 'ai', status: 'pending', createdAt: '', updatedAt: '',
      selection: { mode: 'continue', startOffset: before.length, endOffset: before.length, contextVersion: 'ctx' } }
    expect(ai.currentMarks.value).toEqual([expect.objectContaining({ id: 'r:r', start: before.length, end: before.length, cls: 'mk-cand' })])
    expect(session.content.value).toBe(before)
    ;(session.contextVersion as Ref<string>).value = 'changed'
    expect(ai.currentMarks.value).toEqual([])
    expect(session.content.value).toBe(before)
  })
  it('选区续写插在选区之后，不删除作者选中的原文', async () => {
    const { ai, session } = setup()
    vi.spyOn(useConfigStore(), 'getModelForTask').mockReturnValue({ id: 'synthetic', contextWindow: 8000 } as ModelConfig)
    replacement.mockResolvedValueOnce('他把信放回桌上。')
    const propose = vi.spyOn(useNovelStore(), 'proposeChapterRevision').mockResolvedValue(null)
    session.refreshRevision = vi.fn().mockResolvedValue(undefined)
    const original = session.content.value
    await ai.generateSelection('continue', '', { start: 0, end: 2 })
    expect(propose).toHaveBeenCalledWith(session.novel.value!.id, session.chapter.value!.id,
      original.slice(0, 2) + '他把信放回桌上。' + original.slice(2), 'ai', '选区候选：continue', expect.any(Object))
    expect(session.content.value).toBe(original)
    expect(session.refreshRevision).toHaveBeenCalledOnce()
  })
})
