import { describe, expect, it } from 'vitest'
import type { AiRun } from '@/types/reconstruction'
import { createAiRun } from './reconstructionAiRun'
import { assertAiRunRequests } from './aiRunRequestValidation'

const now = '2026-10-28T09:00:00.000Z'
function receipt(): AiRun {
  return { ...createAiRun({ id: 'run', mode: 'autonomous', taskType: 'draft', chapterStart: 0, chapterEnd: 2, tokenBudget: 1000, now }),
    status: 'paused', usedTokens: 320, requests: [{ id: 'request-1', chapterIndex: 0, phase: 'writing',
      modelId: 'test', status: 'completed', reservedTokens: 500, inputTokens: 300, outputTokens: 20,
      usageSource: 'reported', startedAt: now, completedAt: now }] }
}

describe('persistent autonomous request ledger integrity', () => {
  it('accepts an actual receipt even when its reported usage exceeds the budget', () => {
    const run = receipt()
    run.tokenBudget = 100
    expect(() => assertAiRunRequests(run)).not.toThrow()
  })

  it('accepts a pending reservation only while the run is active', () => {
    const run = receipt(), row = run.requests![0]
    Object.assign(row, { status: 'pending', usageSource: 'reservation', reservedTokens: 320 })
    delete row.completedAt
    run.status = 'running'
    expect(() => assertAiRunRequests(run)).not.toThrow()
    run.status = 'paused'
    expect(() => assertAiRunRequests(run)).toThrow('pending')
  })

  it.each([
    ['total differs from receipts', (run: AiRun) => { run.usedTokens = 0 }],
    ['missing ledger', (run: AiRun) => { delete run.requests }],
    ['missing limit', (run: AiRun) => { delete run.requestLimit }],
    ['empty model identity', (run: AiRun) => { run.requests![0].modelId = '' }],
    ['duplicate receipt', (run: AiRun) => { run.requests!.push({ ...run.requests![0] }); run.usedTokens = 640 }],
    ['request outside task range', (run: AiRun) => { run.requests![0].chapterIndex = 3 }],
    ['invalid timestamp', (run: AiRun) => { run.requests![0].startedAt = 'not-a-date' }],
    ['receipt predates reservation', (run: AiRun) => { run.requests![0].completedAt = '2026-10-27T09:00:00.000Z' }],
    ['missing receipt timestamp', (run: AiRun) => { delete run.requests![0].completedAt }],
    ['fractional usage', (run: AiRun) => { run.requests![0].inputTokens = 0.5 }],
    ['negative usage', (run: AiRun) => { run.requests![0].outputTokens = -1 }],
    ['failure pretending to have provider usage', (run: AiRun) => { run.requests![0].status = 'failed' }],
    ['undercharged unknown usage', (run: AiRun) => { run.requests![0].usageSource = 'estimated' }],
  ] as const)('rejects %s rather than restoring a misleading balance', (_name, mutate) => {
    const run = receipt(); mutate(run)
    expect(() => assertAiRunRequests(run)).toThrow('AI 请求账本无效')
  })
})
