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

const novelId = 'novel-ai-runs'
const otherNovelId = 'novel-other'
const now = '2026-10-26T00:00:00.000Z'

function makeRun(id: string, overrides: Partial<import('@/types/reconstruction').AiRun> = {}): import('@/types/reconstruction').AiRun {
  return {
    id,
    mode: 'autonomous',
    taskType: 'draft',
    targetId: 'chapter-3',
    chapterStart: 3,
    chapterEnd: 5,
    tokenBudget: 1000,
    usedTokens: 420,
    requestLimit: 200,
    requests: [{ id: id + ':request:1', chapterIndex: 3, phase: 'writing', modelId: 'test',
      status: 'completed', reservedTokens: 500, inputTokens: overrides.usedTokens ?? 420, outputTokens: 0,
      usageSource: 'reported', startedAt: now, completedAt: now }],
    status: 'paused',
    checkpoint: 'chapter-3-draft',
    error: '上次请求超时',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('reconstruction AI run persistence', () => {
  it('saves and loads the full run state by novel', async () => {
    const db = await import('../database')
    const { loadReconstructionRuns, saveReconstructionRun } = await import('./reconstructionRuns')
    const run = makeRun('run-1', { chapterDrafts: [{ id: 'draft-1', chapterId: 'chapter-3', chapterIndex: 3,
      baseContent: '', content: '截断后保留的候选正文', contextVersion: 'context-v1', status: 'pending', stage: 'generated',
      generationFinishReason: 'length', createdAt: now, updatedAt: now, history: [] }] })

    await saveReconstructionRun(novelId, run)

    expect(await loadReconstructionRuns(novelId)).toEqual([run])
    expect(await loadReconstructionRuns(otherNovelId)).toEqual([])
    expect(db.queryAll<{ novel_id: string; id: string; status: string }>(
      'SELECT novel_id, id, status FROM reconstruction_ai_runs',
    )).toEqual([{ novel_id: novelId, id: 'run-1', status: 'paused' }])
  })

  it('replaces the same run within one novel without duplicating it', async () => {
    const db = await import('../database')
    const { loadReconstructionRuns, saveReconstructionRun } = await import('./reconstructionRuns')
    await saveReconstructionRun(novelId, makeRun('run-1'))
    const replacement = makeRun('run-1', {
      status: 'failed',
      usedTokens: 777,
      checkpoint: 'failed-after-chapter-4',
      error: '模型返回无效内容',
      updatedAt: '2026-10-26T00:02:00.000Z',
    })

    await saveReconstructionRun(novelId, replacement)

    expect(await loadReconstructionRuns(novelId)).toEqual([replacement])
    expect(db.queryAll<{ count: number }>(
      'SELECT COUNT(*) AS count FROM reconstruction_ai_runs WHERE novel_id = ? AND id = ?',
      [novelId, 'run-1'],
    )).toEqual([{ count: 1 }])
  })

  it('deletes one run and can clear all runs for a novel', async () => {
    const { deleteReconstructionRun, deleteReconstructionRuns, loadReconstructionRuns, saveReconstructionRun } = await import('./reconstructionRuns')
    await saveReconstructionRun(novelId, makeRun('run-1'))
    await saveReconstructionRun(novelId, makeRun('run-2', { createdAt: '2026-10-26T00:01:00.000Z' }))
    await saveReconstructionRun(otherNovelId, makeRun('run-1'))

    await deleteReconstructionRun(novelId, 'run-1')
    expect((await loadReconstructionRuns(novelId)).map(run => run.id)).toEqual(['run-2'])
    expect((await loadReconstructionRuns(otherNovelId)).map(run => run.id)).toEqual(['run-1'])

    await deleteReconstructionRuns(novelId)
    expect(await loadReconstructionRuns(novelId)).toEqual([])
    expect((await loadReconstructionRuns(otherNovelId)).map(run => run.id)).toEqual(['run-1'])
  })

  it('fails closed when a corrupted request ledger row is present', async () => {
    const db = await import('../database')
    const { loadReconstructionRuns, saveReconstructionRun } = await import('./reconstructionRuns')
    await saveReconstructionRun(novelId, makeRun('run-1'))
    db.execute(`
      INSERT INTO reconstruction_ai_runs
        (id, novel_id, mode, task_type, status, created_at, updated_at, value)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, ['broken', novelId, 'autonomous', 'draft', 'paused', now, now, '{broken json'])

    await expect(loadReconstructionRuns(novelId)).rejects.toThrow('请求账本')
  })

  it('restores the old in-memory database when persistence fails', async () => {
    const writer = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { electronAPI: { dbRead: vi.fn().mockResolvedValue(null), dbWrite: writer } })
    const { loadReconstructionRuns, saveReconstructionRun } = await import('./reconstructionRuns')
    const first = makeRun('run-1')
    await saveReconstructionRun(novelId, first)
    const replacement = makeRun('run-1', { status: 'completed', checkpoint: 'done', error: undefined })

    writer.mockRejectedValueOnce(new Error('模拟写盘失败'))
    await expect(saveReconstructionRun(novelId, replacement)).rejects.toThrow('模拟写盘失败')
    expect(await loadReconstructionRuns(novelId)).toEqual([first])
  })

  it('refuses a changed total that would discard charged requests', async () => {
    const { loadReconstructionRun, saveReconstructionRun } = await import('./reconstructionRuns')
    const first = makeRun('run-1')
    await saveReconstructionRun(novelId, first)
    await expect(saveReconstructionRun(novelId, { ...first, usedTokens: 0 })).rejects.toThrow('格式无效')
    expect(await loadReconstructionRun(novelId, first.id)).toEqual(first)
  })
})
