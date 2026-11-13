import { describe, expect, it } from 'vitest'
import { assertAiRunCanProcessChapter, cancelAiRun, checkpointAiRun, createAiRun, finishAiRun, pauseAiRun, startAiRun, validateAiRunScope } from './reconstructionAiRun'

const now = '2026-10-26T00:00:00.000Z'

describe('bounded reconstruction AI runs', () => {
  it('requires an explicit chapter range and token budget for autonomous mode', () => {
    expect(validateAiRunScope({ mode: 'autonomous' })).toEqual(['自动模式必须指定章节范围', '自动模式必须指定正数 Token 预算'])
    expect(() => createAiRun({ id: 'run-1', mode: 'autonomous', taskType: 'draft', now })).toThrow('章节范围')
  })

  it('enforces the chapter range and does not execute an author checkpoint', () => {
    let run = createAiRun({ id: 'run-1', mode: 'autonomous', taskType: 'draft', chapterStart: 3, chapterEnd: 5, tokenBudget: 1000, now })
    run = startAiRun(run, now)
    expect(() => assertAiRunCanProcessChapter(run, 2)).toThrow('早于')
    expect(() => assertAiRunCanProcessChapter(run, 6)).toThrow('超出')
    run = finishAiRun(run, 'needs_author', now)
    expect(run.status).toBe('needs_author')
    expect(() => assertAiRunCanProcessChapter(run, 3)).toThrow('执行状态')
  })

  it('keeps a checkpoint and records a terminal status', () => {
    let run = createAiRun({ id: 'run-1', mode: 'collaborative', taskType: 'review', targetId: 'chapter-1', now })
    run = checkpointAiRun(run, 'chapter-review-complete', now)
    run = finishAiRun(run, 'completed', now)
    expect(run).toMatchObject({ checkpoint: 'chapter-review-complete', status: 'completed' })
  })

  it('supports explicit pause, resume and cancellation boundaries', () => {
    let run = createAiRun({ id: 'run-1', mode: 'autonomous', taskType: 'draft', chapterStart: 1, chapterEnd: 2, tokenBudget: 1000, now })
    run = startAiRun(run, now)
    run = pauseAiRun(run, now, 'chapter-1-review')
    expect(run).toMatchObject({ status: 'paused', checkpoint: 'chapter-1-review' })
    run = startAiRun(run, now)
    run = cancelAiRun(run, now, '作者取消自动任务')
    expect(run).toMatchObject({ status: 'cancelled', error: '作者取消自动任务' })
    expect(() => cancelAiRun(run, now)).toThrow('已经结束')
  })
})
