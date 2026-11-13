import { beforeEach, describe, expect, it, vi } from 'vitest'

const memory = new Map<string, string>()

beforeEach(() => {
  vi.resetModules()
  memory.clear()
  vi.stubGlobal('window', {})
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
    removeItem: (key: string) => memory.delete(key),
  })
})

const novelId = 'novel-reconstruction'
const now = '2026-10-26T00:00:00.000Z'

function makeSnapshot() {
  return {
    editorDrafts: [],
    storyMemories: [{ id: 'memory-1', novelId, title: '开篇回顾', scope: { kind: 'book' as const, throughChapterId: 'chapter-1' },
      summary: '主角拿到钥匙。', source: { version: 1 as const, sourceVersionId: 'old-source', value: '主角拿到钥匙。', origin: 'author' as const, confirmedAt: now }, history: [] }],
    creationDraft: {
      id: 'draft-1', entry: 'idea' as const, mode: 'author' as const, stage: 'skeleton' as const,
      contract: { id: 'contract-1', title: '长夜', genre: '玄幻', format: 'serial' as const, worldRules: [], forbiddenTopics: [], authorPreferences: [], approval: 'draft' as const, updatedAt: now },
      skeletons: [], volumes: [], chapterPlans: [], scenePlans: [], approval: {}, updatedAt: now,
    },
    candidates: [{
      id: 'candidate-1', novelId, chapterId: 'chapter-1', type: 'fact' as const,
      proposedValue: '主角获得一枚旧钥匙', evidence: [], status: 'proposed' as const,
      source: 'ai' as const, confidence: 'probable' as const, createdAt: now, updatedAt: now,
    }],
    reviewFindings: [{
      id: 'finding-1', type: 'continuity' as const, severity: 'blocker' as const,
      title: '时间线冲突', explanation: '前后时间不一致', chapterId: 'chapter-1',
      evidence: [], blocksFinalization: true, status: 'open' as const,
    }],
    chapterReviews: [{
      id: 'review-1', chapterId: 'chapter-1', sourceVersionId: 'content:one:3',
      startedAt: now, completedAt: now, deterministicChecksPassed: false,
      semanticChecksPassed: false, findings: [], candidateChanges: [], status: 'needs_revision' as const,
    }],
    aiRuns: [{
      id: 'run-1', mode: 'autonomous' as const, taskType: 'draft' as const, targetId: 'chapter-1',
      chapterStart: 0, chapterEnd: 2, tokenBudget: 1000, usedTokens: 120, status: 'paused' as const,
      checkpoint: 'chapter-1', createdAt: now, updatedAt: now,
    }],
    canonMutations: [{
      id: 'mutation-1', candidateId: 'candidate-1', novelId, chapterId: 'chapter-1',
      type: 'fact' as const, summary: '写入旧钥匙事实', appliedAt: now,
    }],
  }
}

describe('reconstruction workspace persistence', () => {
  it('saves and reloads every V2 workspace collection', async () => {
    const db = await import('../database')
    const { loadReconstructionWorkspace, saveReconstructionWorkspace } = await import('./reconstruction')
    const snapshot = makeSnapshot()

    await saveReconstructionWorkspace(novelId, snapshot)
    const loaded = await loadReconstructionWorkspace(novelId)

    expect(loaded).toEqual(snapshot)
    expect(db.queryAll<{ novel_id: string }>('SELECT novel_id FROM reconstruction_creation_drafts')).toEqual([{ novel_id: novelId }])
  })

  it('replaces a novel workspace instead of duplicating rows', async () => {
    const db = await import('../database')
    const { loadReconstructionWorkspace, saveReconstructionWorkspace } = await import('./reconstruction')
    const first = makeSnapshot()
    await saveReconstructionWorkspace(novelId, first)
    const second = { ...makeSnapshot(), candidates: [], reviewFindings: [], chapterReviews: [], aiRuns: [], canonMutations: [], storyMemories: [], creationDraft: undefined }

    await saveReconstructionWorkspace(novelId, second)

    expect(await loadReconstructionWorkspace(novelId)).toEqual(second)
    expect(db.queryAll<{ count: number }>('SELECT COUNT(*) AS count FROM reconstruction_creation_drafts WHERE novel_id = ?', [novelId])).toEqual([{ count: 0 }])
    expect(db.queryAll<{ count: number }>('SELECT COUNT(*) AS count FROM reconstruction_candidates WHERE novel_id = ?', [novelId])).toEqual([{ count: 0 }])
    expect(db.queryAll<{ count: number }>('SELECT COUNT(*) AS count FROM reconstruction_review_findings WHERE novel_id = ?', [novelId])).toEqual([{ count: 0 }])
    expect(db.queryAll<{ count: number }>('SELECT COUNT(*) AS count FROM reconstruction_chapter_reviews WHERE novel_id = ?', [novelId])).toEqual([{ count: 0 }])
    expect(db.queryAll<{ count: number }>('SELECT COUNT(*) AS count FROM reconstruction_ai_runs WHERE novel_id = ?', [novelId])).toEqual([{ count: 0 }])
    expect(db.queryAll<{ count: number }>('SELECT COUNT(*) AS count FROM reconstruction_canon_mutations WHERE novel_id = ?', [novelId])).toEqual([{ count: 0 }])
  })

  it('keeps the old workspace in memory when persistence fails after the transaction', async () => {
    const writer = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { electronAPI: { dbRead: vi.fn().mockResolvedValue(null), dbWrite: writer } })
    const db = await import('../database')
    const { loadReconstructionWorkspace, saveReconstructionWorkspace } = await import('./reconstruction')
    const first = makeSnapshot()
    await saveReconstructionWorkspace(novelId, first)
    const second = { ...first, candidates: [] }

    writer.mockRejectedValueOnce(new Error('模拟写盘失败'))
    await expect(saveReconstructionWorkspace(novelId, second)).rejects.toThrow('模拟写盘失败')
    expect(await loadReconstructionWorkspace(novelId)).toEqual(first)
    expect(db.queryAll<{ count: number }>('SELECT COUNT(*) AS count FROM reconstruction_candidates WHERE novel_id = ?', [novelId])).toEqual([{ count: 1 }])
  })

  it('deletes every workspace table for a novel', async () => {
    const db = await import('../database')
    const { deleteReconstructionWorkspace, loadReconstructionWorkspace, saveReconstructionWorkspace } = await import('./reconstruction')
    await saveReconstructionWorkspace(novelId, makeSnapshot())

    await deleteReconstructionWorkspace(novelId)

    expect(await loadReconstructionWorkspace(novelId)).toEqual({ editorDrafts: [], candidates: [], reviewFindings: [], chapterReviews: [], aiRuns: [], canonMutations: [], storyMemories: [] })
    expect(db.queryAll<{ count: number }>('SELECT COUNT(*) AS count FROM reconstruction_story_memories WHERE novel_id = ?', [novelId])).toEqual([{ count: 0 }])
    expect(db.queryAll<{ count: number }>('SELECT COUNT(*) AS count FROM reconstruction_creation_drafts WHERE novel_id = ?', [novelId])).toEqual([{ count: 0 }])
  })

  it('keeps chapter reviews from different source versions distinct', async () => {
    const db = await import('../database')
    const { loadReconstructionWorkspace, saveReconstructionWorkspace } = await import('./reconstruction')
    const first = makeSnapshot()
    const secondReview = {
      ...first.chapterReviews[0],
      id: 'review-2',
      sourceVersionId: 'content:two:3',
      startedAt: '2026-10-26T00:01:00.000Z',
      completedAt: '2026-10-26T00:01:00.000Z',
      status: 'ready_to_finalize' as const,
    }

    await saveReconstructionWorkspace(novelId, {
      ...first,
      chapterReviews: [...first.chapterReviews, secondReview],
    })

    expect((await loadReconstructionWorkspace(novelId)).chapterReviews).toHaveLength(2)
    expect(db.queryAll<{ count: number }>('SELECT COUNT(*) AS count FROM reconstruction_chapter_reviews WHERE novel_id = ?', [novelId])).toEqual([{ count: 2 }])
  })
})
