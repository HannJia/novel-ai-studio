import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useReconstructionWorkspaceStore } from './reconstructionWorkspace'
import type { CandidateChange, ChapterReview } from '@/types/reconstruction'
import { createAiRun } from '@/services/reconstructionAiRun'
import { saveReconstructionRun } from '@/services/db/reconstructionRuns'

vi.mock('@/services/db/reconstructionRuns', () => ({ saveReconstructionRun: vi.fn().mockResolvedValue(undefined) }))

describe('reconstruction workspace candidate store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('deduplicates candidates and filters pending candidates by chapter', () => {
    const store = useReconstructionWorkspaceStore()
    const candidate: CandidateChange = {
      id: 'candidate-1',
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      type: 'fact',
      proposedValue: '新增事实',
      evidence: [],
      status: 'proposed',
      createdAt: '2026-10-26T00:00:00.000Z',
      updatedAt: '2026-10-26T00:00:00.000Z',
    }

    expect(store.addCandidateChanges('novel-1', [candidate, candidate])).toBe(1)
    expect(store.addCandidateChanges('novel-1', [candidate])).toBe(0)
    expect(store.getPendingCandidates('novel-1', 'chapter-1')).toHaveLength(1)
    expect(store.pendingCount).toBe(1)
  })

  it('invalidates pending candidates from an older chapter source version', () => {
    const store = useReconstructionWorkspaceStore()
    const candidate = (id: string, sourceVersionId: string): CandidateChange => ({
      id,
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      type: 'fact',
      sourceVersionId,
      proposedValue: '{}',
      evidence: [],
      status: 'proposed',
      createdAt: '2026-10-26T00:00:00.000Z',
      updatedAt: '2026-10-26T00:00:00.000Z',
    })

    store.addCandidateChanges('novel-1', [candidate('candidate-v1', 'content:v1')])
    store.markChapterCandidatesStale('novel-1', 'chapter-1', 'content:v2')
    expect(store.getCandidates('novel-1')[0].status).toBe('stale')
    expect(store.getPendingCandidates('novel-1', 'chapter-1', 'content:v2')).toEqual([])

    store.addCandidateChanges('novel-1', [candidate('candidate-v2', 'content:v2')])
    expect(store.getPendingCandidates('novel-1', 'chapter-1', 'content:v2').map(item => item.id)).toEqual(['candidate-v2'])
  })

  it('marks older candidates stale when a new analysis is added', () => {
    const store = useReconstructionWorkspaceStore()
    const base: CandidateChange = {
      id: 'candidate-v1', novelId: 'novel-1', chapterId: 'chapter-1', type: 'fact',
      sourceVersionId: 'content:v1', proposedValue: '{}', evidence: [], status: 'proposed',
      createdAt: '2026-10-26T00:00:00.000Z', updatedAt: '2026-10-26T00:00:00.000Z',
    }
    const next = { ...base, id: 'candidate-v2', sourceVersionId: 'content:v2' }
    store.addCandidateChanges('novel-1', [base])
    store.addCandidateChanges('novel-1', [next])
    expect(store.getCandidates('novel-1').find(item => item.id === 'candidate-v1')?.status).toBe('stale')
    expect(store.getPendingCandidates('novel-1', 'chapter-1', 'content:v2')).toEqual([next])
  })

  it('records each Canon mutation once per candidate', () => {
    const store = useReconstructionWorkspaceStore()
    const mutation = {
      id: 'canon-mutation-1', candidateId: 'candidate-1', novelId: 'novel-1',
      chapterId: 'chapter-1', type: 'fact' as const, summary: '新增角色',
      appliedAt: '2026-10-26T00:00:00.000Z',
    }

    expect(store.recordCanonMutation('novel-1', mutation)).toBe(true)
    expect(store.recordCanonMutation('novel-1', mutation)).toBe(false)
    expect(store.hasCanonMutation('novel-1', 'candidate-1')).toBe(true)
    expect(store.getCanonMutations('novel-1')).toHaveLength(1)
  })

  it('keeps a creation draft separate from candidate history', () => {
    const store = useReconstructionWorkspaceStore()
    const draft = { id: 'creation:novel-1', entry: 'idea', mode: 'author', stage: 'contract', contract: {} as any, skeletons: [], volumes: [], chapterPlans: [], scenePlans: [], approval: {}, updatedAt: '2026-10-26T00:00:00.000Z' } as any
    store.setCreationDraft('novel-1', draft)
    expect(store.getCreationDraft('novel-1')).toMatchObject({ id: draft.id, stage: 'contract' })
    expect(store.updateCreationDraft('novel-1', { stage: 'skeleton' })?.stage).toBe('skeleton')
    expect(store.getCreationDraft('novel-1')?.stage).toBe('skeleton')
  })

  it('replaces only the same chapter review source version and keeps history', () => {
    const store = useReconstructionWorkspaceStore()
    const review = (id: string, sourceVersionId: string, startedAt: string, status: ChapterReview['status']): ChapterReview => ({
      id,
      chapterId: 'chapter-1',
      sourceVersionId,
      startedAt,
      completedAt: startedAt,
      deterministicChecksPassed: true,
      semanticChecksPassed: status === 'ready_to_finalize',
      findings: [],
      candidateChanges: [],
      status,
    })

    store.replaceChapterReview('novel-1', review('review-v1-old', 'content:v1', '2026-10-26T00:00:00.000Z', 'needs_revision'))
    store.replaceChapterReview('novel-1', review('review-v1-new', 'content:v1', '2026-10-26T00:01:00.000Z', 'ready_to_finalize'))
    store.replaceChapterReview('novel-1', review('review-v2', 'content:v2', '2026-10-26T00:02:00.000Z', 'ready_to_finalize'))

    expect(store.getChapterReviews('novel-1', 'chapter-1')).toHaveLength(2)
    expect(store.getLatestChapterReview('novel-1', 'chapter-1')?.id).toBe('review-v2')
    expect(store.getChapterReviews('novel-1', 'chapter-1').map(item => item.sourceVersionId).sort()).toEqual(['content:v1', 'content:v2'])
  })

  it('clears chapter reviews with the rest of a novel workspace', () => {
    const store = useReconstructionWorkspaceStore()
    store.replaceChapterReview('novel-1', {
      id: 'review-1', chapterId: 'chapter-1', sourceVersionId: 'content:v1',
      startedAt: '2026-10-26T00:00:00.000Z', deterministicChecksPassed: true,
      findings: [], candidateChanges: [], status: 'ready_to_finalize',
    })
    store.clearNovel('novel-1')
    expect(store.getChapterReviews('novel-1')).toEqual([])
  })

  it('upserts and removes persisted AI runs by novel', () => {
    const store = useReconstructionWorkspaceStore()
    const run = {
      id: 'run-1', mode: 'autonomous' as const, taskType: 'draft' as const, targetId: 'chapter-1',
      chapterStart: 0, chapterEnd: 2, tokenBudget: 1000, usedTokens: 10, status: 'queued' as const,
      createdAt: '2026-10-26T00:00:00.000Z', updatedAt: '2026-10-26T00:00:00.000Z',
    }
    store.replaceAiRun('novel-1', run)
    store.replaceAiRun('novel-1', { ...run, status: 'paused', usedTokens: 50, updatedAt: '2026-10-26T00:01:00.000Z' })
    expect(store.getAiRuns('novel-1')).toHaveLength(1)
    expect(store.getAiRun('novel-1', 'run-1')?.status).toBe('paused')
    expect(store.removeAiRun('novel-1', 'run-1')).toBe(true)
    expect(store.removeAiRun('novel-1', 'run-1')).toBe(false)
    expect(store.getAiRuns('novel-1')).toEqual([])
  })

  it('publishes a run only after the exact captured ledger is durable', async () => {
    const store = useReconstructionWorkspaceStore()
    const run = createAiRun({ id: 'run', mode: 'autonomous', taskType: 'draft', chapterStart: 0, chapterEnd: 1,
      tokenBudget: 1000, now: '2026-10-28T09:00:00.000Z' })
    let release!: () => void
    vi.mocked(saveReconstructionRun).mockImplementationOnce(async () => new Promise<void>(resolve => { release = resolve }))
    const saving = store.saveAiRun('novel-1', run)
    run.tokenBudget = 9999
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    expect(store.getAiRuns('novel-1')).toEqual([])
    release(); await saving
    expect(store.getAiRun('novel-1', run.id)?.tokenBudget).toBe(1000)
    vi.mocked(saveReconstructionRun).mockRejectedValueOnce(new Error('账本写盘失败'))
    await expect(store.saveAiRun('novel-1', { ...run, status: 'running' })).rejects.toThrow('写盘失败')
    expect(store.getAiRun('novel-1', run.id)).toMatchObject({ status: 'queued', tokenBudget: 1000 })
  })

  it('saves explicit quota changes without overwriting a concurrent run update', async () => {
    const store = useReconstructionWorkspaceStore()
    const run = { ...createAiRun({ id: 'limits-run', mode: 'autonomous', taskType: 'draft', chapterStart: 0, chapterEnd: 1,
      tokenBudget: 1000, now: '2026-10-28T09:00:00.000Z' }), status: 'paused' as const }
    store.replaceAiRun('novel-1', run)
    vi.mocked(saveReconstructionRun).mockRejectedValueOnce(new Error('额度写盘失败'))
    await expect(store.saveAiRunLimits('novel-1', run, { tokenBudget: 3000, requestLimit: 10 })).rejects.toThrow('写盘失败')
    expect(store.getAiRun('novel-1', run.id)).toEqual(run)
    await store.saveAiRunLimits('novel-1', run, { tokenBudget: 3000, requestLimit: 10 })
    expect(store.getAiRun('novel-1', run.id)).toMatchObject({ status: 'paused', tokenBudget: 3000, requestLimit: 10 })
    await expect(store.saveAiRunLimits('novel-1', run, { tokenBudget: 9000, requestLimit: 20 })).rejects.toThrow('任务记录已经变化')
    expect(store.getAiRun('novel-1', run.id)?.tokenBudget).toBe(3000)
  })
})
