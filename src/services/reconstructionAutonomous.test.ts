import { describe, expect, it, vi } from 'vitest'
import { createAiRun } from './reconstructionAiRun'
import { executeAutonomousRun, recoverInterruptedAiRun, type AutonomousChapterContext } from './reconstructionAutonomous'
import type { AiRun, AiRunRequest } from '@/types/reconstruction'
import type { ChatCompletionOptions } from './ai'
import { reserveRequestTokens, reviseAiRunLimits } from './reconstructionAiBudget'

const now = '2026-10-28T00:00:00.000Z'
const options: ChatCompletionOptions = { model: { modelName: 'test', maxTokens: 20 } as ChatCompletionOptions['model'], messages: [{ role: 'user', content: '中文输入' }] }
const reserved = Object.values(reserveRequestTokens(options)).reduce((a, b) => a + b, 0)
function makeRun(tokenBudget = 1000, requestLimit = 200) {
  return createAiRun({ id: 'run-1', mode: 'autonomous', taskType: 'draft', chapterStart: 1, chapterEnd: 3, tokenBudget, requestLimit, now })
}
async function request(context: AutonomousChapterContext, tokens = 100, phase: AiRunRequest['phase'] = 'writing') {
  const lifecycle = context.requestLifecycle(phase)
  await lifecycle.beforeRequest(options)
  await lifecycle.afterRequest({ result: { content: '结果', usage: { prompt_tokens: tokens - 10, completion_tokens: 10, total_tokens: tokens } } })
}

describe('autonomous request admission and execution', () => {
  it('persists admission before dispatch and receipt before advancing', async () => {
    const saved: AiRun[] = [], processed: number[] = []
    const result = await executeAutonomousRun({ run: makeRun(), persist: async run => { saved.push(structuredClone(run)) }, now: () => now,
      processChapter: async context => {
        processed.push(context.chapterIndex)
        const lifecycle = context.requestLifecycle('writing')
        await lifecycle.beforeRequest(options)
        expect(saved.slice(-1)[0].requests?.slice(-1)[0]).toMatchObject({ status: 'pending', reservedTokens: reserved })
        await lifecycle.afterRequest({ result: { content: '正文', usage: { prompt_tokens: 90, completion_tokens: 10, total_tokens: 100 } } })
        expect(saved.slice(-1)[0].requests?.slice(-1)[0].usageSource).toBe('reported')
        return { status: 'completed' }
      } })
    expect(processed).toEqual([1, 2, 3])
    expect(result).toMatchObject({ status: 'completed', usedTokens: 300, checkpoint: 'chapter-3:completed' })
    expect(result.requests).toHaveLength(3)
    expect(JSON.stringify(result)).not.toContain('中文输入')
  })

  it('refuses the next request without spending it and keeps the chapter checkpoint', async () => {
    const sent: number[] = []
    const result = await executeAutonomousRun({ run: makeRun(reserved + 50), persist: async () => undefined, now: () => now,
      processChapter: async context => {
        const lifecycle = context.requestLifecycle('writing')
        await lifecycle.beforeRequest(options); sent.push(context.chapterIndex)
        await lifecycle.afterRequest({ result: { content: '正文', usage: { prompt_tokens: 90, completion_tokens: 10, total_tokens: 100 } } })
        return { status: 'completed' }
      } })
    expect(sent).toEqual([1])
    expect(result).toMatchObject({ status: 'needs_author', usedTokens: 100, checkpoint: 'chapter-2:started' })
    expect(result.error).toContain('超过剩余预算')
    expect(result.requests).toHaveLength(1)
  })

  it('counts writing, review attempts and extraction against one request cap', async () => {
    const result = await executeAutonomousRun({ run: makeRun(2000, 3), persist: async () => undefined, now: () => now,
      processChapter: async context => {
        await request(context, 20, 'writing'); await request(context, 30, 'review'); await request(context, 40, 'review')
        await request(context, 50, 'analysis')
        return { status: 'completed' }
      } })
    expect(result).toMatchObject({ status: 'needs_author', usedTokens: 90 })
    expect(result.requests?.map(row => row.phase)).toEqual(['writing', 'review', 'review'])
    expect(result.error).toContain('次数上限')
  })

  it('retains provider-reported overspend without clamping it or losing position', async () => {
    const result = await executeAutonomousRun({ run: makeRun(150), persist: async () => undefined, now: () => now,
      processChapter: async context => { await request(context, 900); return { status: 'completed' } } })
    expect(result).toMatchObject({ status: 'needs_author', usedTokens: 900, checkpoint: 'chapter-1:started' })
    expect(result.error).toContain('实际用量超过预算')
  })

  it.each(['missing', 'invalid', 'failure', 'abort'] as const)('keeps a conservative allowance for %s usage', async mode => {
    const controller = new AbortController()
    const result = await executeAutonomousRun({ run: makeRun(1000, 1), persist: async () => undefined, now: () => now, signal: controller.signal,
      processChapter: async context => {
        const lifecycle = context.requestLifecycle('review')
        await lifecycle.beforeRequest(options)
        if (mode === 'failure' || mode === 'abort') {
          const error = new Error('请求中断')
          if (mode === 'abort') controller.abort(error)
          await lifecycle.afterRequest({ error }); throw error
        }
        await lifecycle.afterRequest({ result: { content: '报告', ...(mode === 'invalid' ? { usage: { prompt_tokens: -1, completion_tokens: 10, total_tokens: 9 } } : {}) } })
        return { status: 'needs_author', message: '作者检查' }
      } })
    expect(result.usedTokens).toBe(reserved)
    expect(result.requests?.[0]).toMatchObject({ usageSource: 'estimated', status: mode === 'failure' || mode === 'abort' ? 'failed' : 'completed' })
    expect(result.status).toBe(mode === 'abort' ? 'paused' : mode === 'failure' ? 'failed' : 'needs_author')
  })

  it('does not dispatch if reservation persistence fails', async () => {
    const dispatched = vi.fn()
    const result = await executeAutonomousRun({ run: makeRun(), now: () => now,
      persist: async run => { if (run.requests?.some(row => row.status === 'pending')) throw new Error('磁盘写入失败') },
      processChapter: async context => { await context.requestLifecycle('writing').beforeRequest(options); dispatched(); return { status: 'completed' } } })
    expect(dispatched).not.toHaveBeenCalled()
    expect(result).toMatchObject({ status: 'failed', usedTokens: 0, requests: [] })
  })

  it('retains actual usage for the final failure save when receipt persistence fails once', async () => {
    let fail = true
    const saved: AiRun[] = []
    const result = await executeAutonomousRun({ run: makeRun(), now: () => now, persist: async run => {
      if (fail && run.status === 'running' && run.requests?.[0]?.status === 'completed') { fail = false; throw new Error('回执保存失败') }
      saved.push(structuredClone(run))
    }, processChapter: async context => { await request(context, 210); return { status: 'completed' } } })
    expect(result).toMatchObject({ status: 'failed', usedTokens: 210 })
    expect(saved.slice(-1)[0].requests?.[0]).toMatchObject({ usageSource: 'reported', inputTokens: 200, outputTokens: 10 })
  })

  it('resumes after a completed chapter and retains charges before cancellation', async () => {
    const controller = new AbortController(), processed: number[] = []
    const paused = await executeAutonomousRun({ run: makeRun(), persist: async () => undefined, now: () => now, signal: controller.signal,
      processChapter: async context => { await request(context); controller.abort(); return { status: 'completed' } } })
    expect(paused).toMatchObject({ status: 'paused', usedTokens: 100, checkpoint: 'chapter-1:completed' })
    const resumed = await executeAutonomousRun({ run: paused, persist: async () => undefined, now: () => now,
      processChapter: async context => { processed.push(context.chapterIndex); await request(context); return { status: 'completed' } } })
    expect(processed).toEqual([2, 3])
    expect(resumed).toMatchObject({ status: 'completed', usedTokens: 300 })
  })

  it('pauses at the configured author checkpoint interval', async () => {
    const run = createAiRun({ id: 'checkpoint-run', mode: 'autonomous', taskType: 'draft', chapterStart: 1, chapterEnd: 3,
      tokenBudget: 2000, requestLimit: 10, checkpointEvery: 1, now })
    const processed: number[] = []
    const result = await executeAutonomousRun({ run, persist: async () => undefined, now: () => now,
      processChapter: async context => { processed.push(context.chapterIndex); await request(context); return { status: 'completed' } } })
    expect(processed).toEqual([1])
    expect(result).toMatchObject({ status: 'needs_author', checkpoint: 'chapter-1:checkpoint', usedTokens: 100 })
    expect(result.error).toContain('每 1 章')
  })

  it('pauses at the configured interval when a processor reports a reviewed checkpoint', async () => {
    const run = createAiRun({ id: 'reviewed-checkpoint-run', mode: 'autonomous', taskType: 'draft', chapterStart: 1, chapterEnd: 3,
      tokenBudget: 2000, requestLimit: 10, checkpointEvery: 1, now })
    const processed: number[] = []
    const result = await executeAutonomousRun({ run, persist: async () => undefined, now: () => now,
      processChapter: async context => {
        processed.push(context.chapterIndex)
        await request(context)
        return { status: 'completed', checkpoint: `chapter-${context.chapterIndex}:reviewed` }
      } })
    expect(processed).toEqual([1])
    expect(result).toMatchObject({ status: 'needs_author', checkpoint: 'chapter-1:checkpoint', usedTokens: 100 })
    expect(result.error).toContain('每 1 章')
  })

  it('does not treat a completed checkpoint for another chapter as a stop point', async () => {
    const run = createAiRun({ id: 'mismatched-checkpoint-run', mode: 'autonomous', taskType: 'draft', chapterStart: 1, chapterEnd: 3,
      tokenBudget: 2000, requestLimit: 10, checkpointEvery: 1, now })
    const processed: number[] = []
    const result = await executeAutonomousRun({ run, persist: async () => undefined, now: () => now,
      processChapter: async context => {
        processed.push(context.chapterIndex)
        await request(context)
        const checkpoint = context.chapterIndex === 1
          ? 'chapter-2:reviewed'
          : `chapter-${context.chapterIndex}:reviewed`
        return { status: 'completed', checkpoint }
      } })
    expect(processed).toEqual([1, 2])
    expect(result).toMatchObject({ status: 'needs_author', checkpoint: 'chapter-2:checkpoint', usedTokens: 200 })
  })

  it('preserves the author-review checkpoint and resumes at the same chapter', async () => {
    const paused = await executeAutonomousRun({ run: makeRun(), persist: async () => undefined, now: () => now,
      processChapter: async context => { await request(context); return { status: 'needs_author', checkpoint: 'chapter-1:review-needs-author' } } })
    const seen: string[] = []
    const resumed = await executeAutonomousRun({ run: paused, persist: async () => undefined, now: () => now,
      processChapter: async context => { seen.push(context.run.checkpoint!); await request(context); return { status: 'completed' } } })
    expect(seen[0]).toBe('chapter-1:review-needs-author')
    expect(resumed.usedTokens).toBe(400)
  })

  it('recovers in-flight charges explicitly without resending the request', () => {
    const running: AiRun = { ...makeRun(), status: 'running', usedTokens: reserved, checkpoint: 'chapter-1:started', requests: [{
      id: 'pending', chapterIndex: 1, phase: 'writing', modelId: 'test', status: 'pending', reservedTokens: reserved,
      inputTokens: reserved - 20, outputTokens: 20, usageSource: 'reservation', startedAt: now,
    }] }
    const recovered = recoverInterruptedAiRun(running, now)
    expect(recovered).toMatchObject({ status: 'paused', usedTokens: reserved, checkpoint: 'chapter-1:started' })
    expect(recovered.requests?.[0]).toMatchObject({ status: 'interrupted', usageSource: 'estimated', completedAt: now })
    expect(running.requests?.[0].status).toBe('pending')
  })

  it('rejects duplicate execution and recovery of an active task', async () => {
    const run = makeRun()
    const result = await executeAutonomousRun({ run, persist: async () => undefined, now: () => now, processChapter: async context => {
      await expect(executeAutonomousRun({ run, persist: async () => undefined, processChapter: vi.fn() })).rejects.toThrow('已经在执行')
      expect(() => recoverInterruptedAiRun(context.run, now)).toThrow('仍在执行')
      return { status: 'needs_author' }
    } })
    expect(result.status).toBe('needs_author')
  })

  it('serializes concurrent admission so only one request can reserve the same balance', async () => {
    const result = await executeAutonomousRun({ run: makeRun(reserved), now: () => now,
      persist: async () => { await Promise.resolve() },
      processChapter: async context => {
        const first = context.requestLifecycle('writing'), second = context.requestLifecycle('review')
        const admitted = await Promise.allSettled([first.beforeRequest(options), second.beforeRequest(options)])
        expect(admitted.map(item => item.status)).toEqual(['fulfilled', 'rejected'])
        expect((admitted[1] as PromiseRejectedResult).reason.message).toContain('尚未记账')
        await first.afterRequest({ result: { content: '候选稿' } })
        return { status: 'needs_author' }
      } })
    expect(result).toMatchObject({ status: 'needs_author', usedTokens: reserved })
    expect(result.requests).toHaveLength(1)
  })

  it('does not advance a chapter while an admitted request lacks a receipt', async () => {
    const result = await executeAutonomousRun({ run: makeRun(), now: () => now, persist: async () => undefined,
      processChapter: async context => {
        await context.requestLifecycle('writing').beforeRequest(options)
        return { status: 'completed' }
      } })
    expect(result).toMatchObject({ status: 'failed', checkpoint: 'chapter-1:started', usedTokens: reserved })
    expect(result.error).toContain('未结算请求')
    expect(result.requests?.[0].status).toBe('interrupted')
  })

  it('continues after an explicit quota increase without resetting usage or replaying completed chapters', async () => {
    const processChapter = vi.fn(async (context: AutonomousChapterContext) => { await request(context); return { status: 'completed' as const } })
    const paused = await executeAutonomousRun({ run: makeRun(1000, 1), now: () => now, persist: async () => undefined, processChapter })
    expect(paused).toMatchObject({ status: 'needs_author', usedTokens: 100, checkpoint: 'chapter-2:started' })
    const adjusted = reviseAiRunLimits(paused, { tokenBudget: 2000, requestLimit: 3 }, now)
    expect(adjusted.requests).toEqual(paused.requests)
    expect(paused.requestLimit).toBe(1)
    processChapter.mockClear()
    const result = await executeAutonomousRun({ run: adjusted, now: () => now, persist: async () => undefined, processChapter })
    expect(processChapter.mock.calls.map(([context]) => context.chapterIndex)).toEqual([2, 3])
    expect(result).toMatchObject({ status: 'completed', usedTokens: 300 })
    expect(result.requests).toHaveLength(3)
    expect(() => reviseAiRunLimits(paused, { tokenBudget: 99, requestLimit: 3 }, now)).toThrow('不能低于')
    expect(() => reviseAiRunLimits({ ...paused, status: 'running' }, { tokenBudget: 2000, requestLimit: 3 }, now)).toThrow('先暂停')
  })
})
