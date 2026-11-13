import { describe, expect, it } from 'vitest'
import { derivePipeline, deriveBudget, deriveLedger, stopConditions, lengthRange, checkpointOf } from './autoRun'
import type { Chapter, Novel } from '@/types/novel'
import type { AiRun, AiChapterDraft, AiRunRequest } from '@/types/reconstruction'

const chapter = (index: number, over: Partial<Chapter> = {}): Chapter => ({ id: 'c' + index, volumeIndex: 0, chapterIndex: index, title: '章' + (index + 1), content: '', summary: '', wordCount: 0, status: 'draft', createdAt: '', updatedAt: '', ...over })
const novel = (chapters: Chapter[], plans: Array<[number, number]> = []): Novel => ({ id: 'n', title: '书', chapters, chapterPlans: plans.map(([s, e], i) => ({ id: 'p' + i, targetChapterStart: s, targetChapterEnd: e })) as unknown as Novel['chapterPlans'], chapterLengthPolicy: { minWords: 2000, targetWords: 2200, maxWords: 6500 } } as unknown as Novel)
const draft = (index: number, over: Partial<AiChapterDraft> = {}): AiChapterDraft => ({ id: 'd' + index, chapterId: 'c' + index, chapterIndex: index, baseContent: '', content: '候选 正文', contextVersion: 'v', status: 'pending', stage: 'analyzed', createdAt: '', updatedAt: '', history: [], ...over })
const run = (over: Partial<AiRun> = {}): AiRun => ({ id: 'r', mode: 'autonomous', taskType: 'draft', chapterStart: 0, chapterEnd: 3, tokenBudget: 600000, requestLimit: 200, usedTokens: 0, requests: [], status: 'running', createdAt: '', updatedAt: '', ...over })
const request = (over: Partial<AiRunRequest> = {}): AiRunRequest => ({ id: 'q' + Math.random(), chapterIndex: 0, phase: 'writing', modelId: 'm', status: 'completed', reservedTokens: 0, inputTokens: 10, outputTokens: 5, usageSource: 'reported', startedAt: '', ...over })

describe('derivePipeline', () => {
  const book = novel([chapter(0), chapter(1), chapter(2), chapter(3)], [[0, 1]])

  it('reads stages from saved drafts and the checkpoint, not from the chapter status', () => {
    const rows = derivePipeline(book, run({
      checkpoint: 'chapter-1:started',
      chapterDrafts: [draft(0, { stage: 'analyzed', review: { findings: [{}, {}] } as unknown as AiChapterDraft['review'] }), draft(1, { stage: 'generated' })],
    }))
    expect(rows.map(row => row.stage)).toEqual(['waiting_author', 'reviewing', 'blocked', 'blocked'])
    expect(rows[0]).toMatchObject({ stage: 'waiting_author', stageLabel: '', steps: ['done', 'done', 'done', 'done', 'waiting'], findingCount: 2, draftWords: 4 })
    expect(rows[1].steps).toEqual(['done', 'done', 'current', '', ''])
    expect(rows[2].stageLabel).toBe('需先确认章纲')
  })

  it('shows generation only for the chapter the run is actually processing', () => {
    const rows = derivePipeline(book, run({ checkpoint: 'chapter-1:started' }))
    expect(rows[1]).toMatchObject({ stage: 'writing', stageLabel: '生成中' })
    expect(rows[0].stage).toBe('queued')
    expect(derivePipeline(book, run({ status: 'paused', checkpoint: 'chapter-1:started' }))[1].stage).toBe('queued')
  })

  it('marks accepted, rejected and review-blocked drafts distinctly', () => {
    const rows = derivePipeline(book, run({
      checkpoint: 'chapter-2:review-needs-author',
      chapterDrafts: [draft(0, { status: 'accepted' }), draft(1, { status: 'rejected' }), draft(2)],
    }))
    expect(rows.slice(0, 3).map(row => row.stageLabel)).toEqual(['已写入正文', '已拒绝', '审校待处理'])
  })

  it('never reports that existing author prose will be generated over', () => {
    const withProse = novel([chapter(0, { content: '作者已经写好的正文', status: 'writing' })], [[0, 0]])
    expect(derivePipeline(withProse, run({ chapterEnd: 0 }))[0]).toMatchObject({ stage: 'existing', stageLabel: '已有正文' })
    expect(derivePipeline(withProse, undefined)[0]).toMatchObject({ stage: 'existing', inRun: false })
  })

  it('limits the visible rows to the run range', () => {
    expect(derivePipeline(book, run({ chapterStart: 1, chapterEnd: 2 })).map(row => row.chapter.chapterIndex)).toEqual([1, 2])
  })
})

describe('budget and ledger', () => {
  it('separates settled usage from pending reservations and never exceeds the cap', () => {
    const view = deriveBudget(run({ usedTokens: 298000, requests: [request({ status: 'pending', reservedTokens: 48000, inputTokens: 48000, outputTokens: 0, usageSource: 'reservation' })] }))
    expect(view).toMatchObject({ cap: 600000, settled: 250000, reserved: 48000, remaining: 302000, requests: 1, requestLimit: 200 })
    expect(view.settledPercent + view.reservedPercent).toBeLessThanOrEqual(100)
    expect(deriveBudget(run({ usedTokens: 700000 })).remaining).toBe(0)
    expect(deriveBudget(undefined)).toMatchObject({ cap: undefined, settled: 0, remaining: undefined })
  })

  it('sums requests by chapter and phase and marks unsettled reservations', () => {
    const rows = deriveLedger(run({ requests: [
      request({ chapterIndex: 0, phase: 'writing', inputTokens: 100, outputTokens: 50 }),
      request({ chapterIndex: 0, phase: 'writing', inputTokens: 10, outputTokens: 5 }),
      request({ chapterIndex: 1, phase: 'review', status: 'pending', reservedTokens: 900, inputTokens: 0, outputTokens: 0 }),
      request({ chapterIndex: 2, phase: 'review', status: 'not_sent', reservedTokens: 999 }),
    ] }))
    expect(rows).toEqual([
      { key: '0:writing', label: '1 · 生成', tokens: 165, reserved: false },
      { key: '1:review:pending', label: '2 · 审校', tokens: 900, reserved: true },
    ])
  })

  it('shows completed usage and a retry reservation separately for the same phase', () => {
    const current = run({ usedTokens: 1200, requests: [
      request({ chapterIndex: 0, phase: 'review', inputTokens: 200, outputTokens: 100 }),
      request({ chapterIndex: 0, phase: 'review', status: 'pending', reservedTokens: 900, inputTokens: 900, outputTokens: 0, usageSource: 'reservation' }),
    ] })
    expect(deriveBudget(current)).toMatchObject({ settled: 300, reserved: 900, remaining: 598800 })
    expect(deriveLedger(current)).toEqual([
      { key: '0:review', label: '1 · 审校', tokens: 300, reserved: false },
      { key: '0:review:pending', label: '1 · 审校', tokens: 900, reserved: true },
    ])
  })
})

describe('configuration text', () => {
  it('derives stop conditions and the length range from real settings', () => {
    expect(stopConditions(run({ checkpointEvery: 2 }))).toContain('每 2 章设检查点')
    expect(stopConditions(run())).toContain('未设检查点，连续执行')
    expect(lengthRange(novel([]))).toBe('2,000 – 6,500 字（目标 2,200）')
    expect(lengthRange({ ...novel([]), chapterLengthPolicy: undefined })).toBe('2,000 – 2,400 字（目标 2,200）')
  })

  it('parses only well-formed checkpoints', () => {
    expect(checkpointOf(run({ checkpoint: 'chapter-4:completed' }))).toEqual({ chapterIndex: 4, phase: 'completed' })
    expect(checkpointOf(run({ checkpoint: 'author-paused' }))).toBeNull()
    expect(checkpointOf(undefined)).toBeNull()
  })
})
