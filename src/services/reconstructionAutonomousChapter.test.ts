import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Novel } from '@/types/novel'
import type { ModelConfig } from '@/stores/config'
import type { CandidateChange } from '@/types/reconstruction'
import { executeAutonomousRun } from './reconstructionAutonomous'
import { createAiRun } from './reconstructionAiRun'

const mocks = vi.hoisted(() => ({
  callAI: vi.fn(),
  buildWritingContext: vi.fn(),
  augmentWritingContextWithVectorMemory: vi.fn(),
  buildChapterFactCard: vi.fn(),
  buildReviewContext: vi.fn(),
  buildChapterPrompt: vi.fn(),
  requestCoveredContentReview: vi.fn(),
  contentReviewVerdict: vi.fn(),
}))

vi.mock('@/services/ai', () => ({ callAI: mocks.callAI }))
vi.mock('@/services/context', () => ({
  buildWritingContext: mocks.buildWritingContext,
  augmentWritingContextWithVectorMemory: mocks.augmentWritingContextWithVectorMemory,
  buildChapterFactCard: mocks.buildChapterFactCard,
  buildReviewContext: mocks.buildReviewContext,
}))
vi.mock('@/services/prompts', () => ({ buildChapterPrompt: mocks.buildChapterPrompt }))
vi.mock('@/services/chapterReview', () => ({ requestCoveredContentReview: mocks.requestCoveredContentReview }))
vi.mock('@/services/chapterGeneration', () => ({ chapterOutputTokenBudget: vi.fn(() => 4000) }))
vi.mock('@/services/chapterLength', () => ({ resolveChapterLengthPolicy: vi.fn(() => ({ targetWords: 1200 })) }))
vi.mock('@/services/contentReview', () => ({ contentReviewVerdict: mocks.contentReviewVerdict }))

import { createAutonomousEmptyChapterProcessor } from './reconstructionAutonomousChapter'

const model = { id: 'model', modelName: 'test', maxTokens: 8000, contextWindow: 16000 } as ModelConfig

function makeNovel(content = ''): Novel {
  return {
    id: 'novel-1',
    title: '测试小说',
    genre: 'fantasy',
    subGenre: '',
    genreLabel: '奇幻',
    subGenreLabel: '',
    tags: [],
    targetWordCountMin: 10,
    targetWordCountMax: 20,
    currentWordCount: content.length,
    writingStyle: {} as Novel['writingStyle'],
    writingMode: 'ai',
    settings: {} as Novel['settings'],
    outline: '',
    synopsis: '',
    volumes: [],
    chapters: [{
      id: 'chapter-1', volumeIndex: 0, chapterIndex: 0, title: '第一章', content, summary: '',
      wordCount: content.length, status: 'draft', sceneNotes: [], versions: [],
      createdAt: '2026-10-26T00:00:00.000Z', updatedAt: '2026-10-26T00:00:00.000Z',
    }],
    characters: [],
    chatHistory: [],
    knowledgeBaseIds: [],
    eventLog: [],
    dataPanels: [],
    dataPanelChanges: [],
    status: 'writing',
    createdAt: '2026-10-26T00:00:00.000Z',
    updatedAt: '2026-10-26T00:00:00.000Z',
  }
}

function makeRuntime(novel: Novel) {
  const saved: string[] = []
  const progress: unknown[] = []
  const structuredReviews: Array<{ review: any; findings: unknown[]; candidates: CandidateChange[] }> = []
  const runtime = {
    novelId: novel.id,
    getNovel: () => novel,
    updateChapter: (_novelId: string, chapterId: string, updates: Record<string, unknown>) => {
      const chapter = novel.chapters.find(item => item.id === chapterId)
      if (!chapter || chapter.status === 'locked') return false
      Object.assign(chapter, updates)
      return true
    },
    saveNovel: async (novelId: string) => { saved.push(novelId) },
    writingModel: model,
    reviewModel: model,
    extractCandidates: vi.fn(async () => ({ candidates: [] as CandidateChange[], usedTokens: 0 })),
    saveStructuredReview: async (input: { review: any; findings: unknown[]; candidates: CandidateChange[] }) => {
      structuredReviews.push(input)
    },
    onReviewProgress: (_novelId: string, _chapterId: string, coverage: unknown) => progress.push(coverage),
  }
  return { runtime, saved, progress, structuredReviews }
}

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.buildWritingContext.mockReturnValue({ outlineContext: '大纲', chapterGuidance: '完成冲突', previousSummary: '', lastParagraph: '' })
  mocks.augmentWritingContextWithVectorMemory.mockImplementation(async (_novel: Novel, _chapter: unknown, context: unknown) => context)
  mocks.buildChapterFactCard.mockReturnValue('事实卡')
  mocks.buildReviewContext.mockImplementation((await vi.importActual<typeof import('./context')>('./context')).buildReviewContext)
  mocks.buildChapterPrompt.mockReturnValue([])
  mocks.requestCoveredContentReview.mockImplementation(async (input: { ensureCurrent: () => void; onProgress?: (value: unknown) => void }) => {
    input.onProgress?.({ status: 'complete', totalChunks: 1, completedChunks: 1 })
    input.ensureCurrent()
    return '审核通过'
  })
  mocks.contentReviewVerdict.mockReturnValue('passed')
})

describe('isolated autonomous chapter drafts', () => {
  it('reports empty charged output with safe diagnostics and stops before review', async () => {
    const novel = makeNovel(), runtime = makeRuntime(novel).runtime
    mocks.callAI.mockResolvedValueOnce({ content: '', finishReason: 'length', usage: { completion_tokens: 6012, completion_tokens_details: { reasoning_tokens: 6012 } } })
    const result = await execute(novel, runtime)
    expect(result.status).toBe('needs_author')
    expect(result.error).toContain('结束原因：length')
    expect(result.error).toContain('正文长度：0')
    expect(result.error).toContain('推理用量：6012')
    expect(result.chapterDrafts || []).toEqual([])
    expect(mocks.requestCoveredContentReview).not.toHaveBeenCalled()
    expect(novel.chapters[0].content).toBe('')
  })
  it('persists a failed middle review segment and resumes without regenerating prose or rechecking the first segment', async () => {
    const { requestChapterReviewWithCoverage } = await import('./chapterReviewCoverage')
    const novel = makeNovel(), runtime = makeRuntime(novel).runtime
    mocks.callAI.mockResolvedValue({ content: '甲'.repeat(6500) })
    const phases: Array<string | number> = []
    let failMiddle = true
    mocks.requestCoveredContentReview.mockImplementation(async (input: any) => requestChapterReviewWithCoverage(input.source, async (part, kind) => {
      phases.push(kind === 'global' ? 'global' : part.index)
      if (part.index === 1 && failMiddle) { failMiddle = false; throw new Error('第二段中断') }
      return '总体判断：可通过\n必改数量：0\n## 本段事实摘要\n主角到达渡口。'
    }, input.onProgress, { binding: input.checkpointKey, checkpoint: input.checkpoint, onCheckpoint: input.onCheckpoint }))
    const interrupted = await execute(novel, runtime)
    expect(interrupted).toMatchObject({ status: 'failed', chapterDrafts: [{ stage: 'generated', reviewCoverage: { status: 'failed', completedChunks: 1 } }] })
    const resumed = await execute(novel, runtime, JSON.parse(JSON.stringify(interrupted)))
    expect(resumed).toMatchObject({ status: 'completed', chapterDrafts: [{ stage: 'analyzed', reviewCoverage: { status: 'complete', completedChunks: 3, globalStatus: 'complete' } }] })
    expect(phases).toEqual([0, 1, 1, 2, 'global'])
    expect(mocks.callAI).toHaveBeenCalledOnce()
    expect(novel.chapters[0].content).toBe('')
  })
  async function execute(novel: Novel, runtime = makeRuntime(novel).runtime, run = createAiRun({ id: 'run', mode: 'autonomous',
    taskType: 'draft', targetId: novel.id, chapterStart: 0, chapterEnd: novel.chapters.length - 1, tokenBudget: 100000, now: novel.createdAt })) {
    return executeAutonomousRun({ run, persist: async () => undefined, processChapter: createAutonomousEmptyChapterProcessor(runtime) })
  }
  it('keeps a candidate for every non-stop writing finish reason without reviewing it', async () => {
    for (const finishReason of ['length', 'content_filter', 'tool_error', 'unknown']) {
      const novel = makeNovel(), runtime = makeRuntime(novel).runtime
      mocks.callAI.mockResolvedValueOnce({ content: '未完成候选', finishReason })
      const result = await execute(novel, runtime)
      expect(result.status).toBe('needs_author')
      expect(result.chapterDrafts?.[0]).toMatchObject({ stage: 'generated', content: '未完成候选', status: 'pending', generationFinishReason: finishReason })
      expect(mocks.requestCoveredContentReview).not.toHaveBeenCalled()
      const resumed = await execute(novel, runtime, result)
      expect(resumed.status).toBe('needs_author')
      expect(resumed.error).toContain('尚未进入审校')
      expect(mocks.requestCoveredContentReview).not.toHaveBeenCalled()
      expect(mocks.callAI).toHaveBeenCalledTimes(1)
      mocks.callAI.mockClear()
      mocks.requestCoveredContentReview.mockClear()
    }
  })
  it('keeps exact generated content and review in the run without changing the formal manuscript', async () => {
    const novel = makeNovel(), before = JSON.stringify(novel), { runtime, saved, structuredReviews } = makeRuntime(novel)
    const content = String.fromCharCode(10) + '这是生成的正文。' + String.fromCharCode(10)
    mocks.callAI.mockResolvedValue({ content })
    const result = await execute(novel, runtime)
    expect(result.status).toBe('completed')
    expect(result.chapterDrafts?.[0]).toMatchObject({ content, status: 'pending', stage: 'analyzed', report: '审核通过', review: { status: 'ready_to_finalize' } })
    expect(JSON.stringify(novel)).toBe(before)
    expect(saved).toEqual([]); expect(structuredReviews).toEqual([])
    const extraction = runtime.extractCandidates.mock.calls as unknown as Array<[{ novel: Novel }]>
    expect(extraction[0][0].novel.chapters[0].content).toBe(content)
  })
  it('resumes failed review using the durable draft without generating again', async () => {
    const novel = makeNovel(), { runtime } = makeRuntime(novel)
    mocks.callAI.mockResolvedValue({ content: '已经生成的候选稿。' })
    mocks.requestCoveredContentReview.mockRejectedValueOnce(new Error('审核网络失败'))
    const interrupted = await execute(novel, runtime)
    expect(interrupted).toMatchObject({ status: 'failed', chapterDrafts: [{ stage: 'generated', content: '已经生成的候选稿。' }] })
    const resumed = await execute(novel, runtime, interrupted)
    expect(resumed.status).toBe('completed')
    expect(mocks.callAI).toHaveBeenCalledTimes(1)
    expect(mocks.requestCoveredContentReview).toHaveBeenCalledTimes(2)
    expect(novel.chapters[0].content).toBe('')
  })
  it('uses the shared prompt input and blocks local time errors even when the model reports success', async () => {
    const novel = makeNovel(), { runtime } = makeRuntime(novel)
    const content = '距月底还有三天。次日，离月底还有三天。'
    mocks.callAI.mockResolvedValue({ content })
    const result = await execute(novel, runtime)
    expect(result.status).toBe('needs_author')
    expect(result.chapterDrafts?.[0].report).toContain('本地硬伤预检')
    expect(result.chapterDrafts?.[0].review).toMatchObject({ deterministicChecksPassed: false, status: 'needs_revision' })
    expect(novel.chapters[0].content).toBe('')
    const request = mocks.requestCoveredContentReview.mock.calls[0][0]
    expect(request.buildContext(content).chapterContent).toBe(content)
    expect(mocks.buildReviewContext.mock.calls.slice(-1)[0]?.slice(1, 5)).toEqual([
      expect.objectContaining({ id: novel.chapters[0].id, content }), content, undefined, undefined,
    ])
    const repeated = await execute(novel, runtime, result)
    expect(repeated.status).toBe('needs_author')
    expect(mocks.callAI).toHaveBeenCalledOnce()
    expect(mocks.requestCoveredContentReview).toHaveBeenCalledOnce()
  })
  it('retries extraction without repeating completed generation and review', async () => {
    const novel = makeNovel(), { runtime } = makeRuntime(novel)
    mocks.callAI.mockResolvedValue({ content: '候选正文。' })
    runtime.extractCandidates.mockResolvedValueOnce({ candidates: [], usedTokens: 0, error: '暂时不可用' } as never)
    const interrupted = await execute(novel, runtime)
    expect(interrupted.status).toBe('needs_author')
    expect(interrupted.chapterDrafts?.[0].stage).toBe('reviewed')
    const resumed = await execute(novel, runtime, interrupted)
    expect(resumed.status).toBe('completed')
    expect(mocks.callAI).toHaveBeenCalledTimes(1)
    expect(mocks.requestCoveredContentReview).toHaveBeenCalledTimes(1)
    expect(runtime.extractCandidates).toHaveBeenCalledTimes(2)
  })
  it('uses earlier task drafts only in the task view when completing a range', async () => {
    const novel = makeNovel()
    novel.chapters.push({ ...novel.chapters[0], id: 'chapter-2', chapterIndex: 1 })
    mocks.callAI.mockResolvedValueOnce({ content: '第一章的候选正文。' }).mockResolvedValueOnce({ content: '第二章的候选正文。' })
    const result = await execute(novel)
    expect(result.chapterDrafts).toHaveLength(2)
    expect(mocks.buildWritingContext.mock.calls[1][0].chapters[0].content).toBe('第一章的候选正文。')
    expect(novel.chapters.map(chapter => chapter.content)).toEqual(['', ''])
  })
  it('preserves a saved draft when the author changes the manuscript', async () => {
    const novel = makeNovel(), { runtime } = makeRuntime(novel)
    mocks.callAI.mockResolvedValue({ content: '候选稿。' })
    mocks.requestCoveredContentReview.mockRejectedValueOnce(new Error('审核失败'))
    const interrupted = await execute(novel, runtime)
    novel.chapters[0].content = '作者的新正文'
    const result = await execute(novel, runtime, interrupted)
    expect(result.status).toBe('failed')
    expect(result.chapterDrafts?.[0].content).toBe('候选稿。')
    expect(novel.chapters[0].content).toBe('作者的新正文')
    expect(mocks.callAI).toHaveBeenCalledTimes(1)
  })
  it('rejects stale generation when planning changes during the request', async () => {
    const novel = makeNovel()
    mocks.callAI.mockImplementation(async () => { novel.outline = '新主线'; return { content: '旧方向正文' } })
    const result = await execute(novel)
    expect(result.status).toBe('failed')
    expect(result.chapterDrafts).toBeUndefined()
    expect(novel.chapters[0].content).toBe('')
  })
  it('leaves locked and populated chapters untouched', async () => {
    expect((await execute(makeNovel('作者正文'))).status).toBe('needs_author')
    const locked = makeNovel(); locked.chapters[0].status = 'locked'
    expect((await execute(locked)).status).toBe('needs_author')
    expect(mocks.callAI).not.toHaveBeenCalled()
  })
  it('retains paid output when a provider reports more usage than the task budget', async () => {
    const novel = makeNovel()
    mocks.callAI.mockImplementation(async (options: import('./ai').ChatCompletionOptions) => {
      await options.requestLifecycle!.beforeRequest(options)
      const result = { content: '已经支付的候选正文。', usage: { prompt_tokens: 90000, completion_tokens: 20000, total_tokens: 110000 } }
      await options.requestLifecycle!.afterRequest({ result })
      return result
    })
    const result = await execute(novel)
    expect(result.status).toBe('needs_author')
    expect(result.usedTokens).toBe(110000)
    expect(result.chapterDrafts?.[0].content).toBe('已经支付的候选正文。')
    expect(novel.chapters[0].content).toBe('')
  })
  it('keeps the generated stage when cancellation arrives immediately after saving it', async () => {
    const novel = makeNovel(), controller = new AbortController(), runtime = makeRuntime(novel).runtime
    mocks.callAI.mockResolvedValue({ content: '可恢复的候选稿。' })
    const result = await executeAutonomousRun({ run: createAiRun({ id: 'cancel-run', mode: 'autonomous', taskType: 'draft', chapterStart: 0, chapterEnd: 0, tokenBudget: 100000, now: novel.createdAt }),
      signal: controller.signal, processChapter: createAutonomousEmptyChapterProcessor(runtime), persist: async run => {
        if (run.chapterDrafts?.[0]?.stage === 'generated') controller.abort()
      } })
    expect(result).toMatchObject({ status: 'paused', chapterDrafts: [{ content: '可恢复的候选稿。', stage: 'generated' }] })
    expect(mocks.requestCoveredContentReview).not.toHaveBeenCalled()
    const resumed = await execute(novel, runtime, result)
    expect(resumed.status).toBe('completed')
    expect(mocks.callAI).toHaveBeenCalledTimes(1)
  })
  it('includes received draft content in the final failure save after an initial disk failure', async () => {
    const novel = makeNovel(), saved: import('@/types/reconstruction').AiRun[] = []
    mocks.callAI.mockResolvedValue({ content: '不能丢失的候选稿。' })
    let fail = true
    const result = await executeAutonomousRun({ run: createAiRun({ id: 'disk-run', mode: 'autonomous', taskType: 'draft', chapterStart: 0, chapterEnd: 0, tokenBudget: 100000, now: novel.createdAt }),
      processChapter: createAutonomousEmptyChapterProcessor(makeRuntime(novel).runtime), persist: async run => {
        if (fail && run.chapterDrafts?.length) { fail = false; throw new Error('候选首次写盘失败') }
        saved.push(JSON.parse(JSON.stringify(run)))
      } })
    expect(result.status).toBe('failed')
    expect(saved.slice(-1)[0].chapterDrafts?.[0].content).toBe('不能丢失的候选稿。')
    expect(novel.chapters[0].content).toBe('')
  })
})

