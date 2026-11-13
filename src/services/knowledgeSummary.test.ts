import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { KnowledgeBase } from '@/types/knowledge'
import type { ModelConfig } from '@/stores/config'
import { callAI } from './ai'
import { activeAiCount, acknowledgeAiActivity, useAiActivities } from './aiActivity'
import { createKnowledgeSummaryBudget, estimateKnowledgeSummaryTokens, generateKnowledgeSummary, planKnowledgeSummary, type KnowledgeSummaryProgress } from './knowledgeSummary'
import { coverageMatchesSources } from './knowledgeSummaryCoverage'
import { entrySourceVersion } from './knowledgeSources'
vi.mock('./ai', async original => ({ ...await original<object>(), callAI: vi.fn() }))
const model = { id: 'test', name: 'test', baseUrl: 'http://test.invalid', apiKey: 'test', modelName: 'test', maxTokens: 6000, contextWindow: 64000, temperature: 0, topP: 1 } as ModelConfig
const now = '2026-10-28T00:00:00Z'
function base(contents: string[] = ['完整原文。']): KnowledgeBase {
  return { id: 'kb', name: '测试库', description: '覆盖测试', createdAt: now, entries: contents.map((content, index) => ({
    id: 'entry-' + index, title: '资料' + index, category: '其他', tags: ['标签'], content, summary: '', createdAt: now, updatedAt: now,
  })) }
}
const budget = () => createKnowledgeSummaryBudget(4096, 50_000_000)
beforeEach(() => { vi.mocked(callAI).mockReset() })
afterEach(() => { for (const activity of useAiActivities().activities.value) acknowledgeAiActivity(activity.id) })

describe('full-source hierarchical knowledge summaries', () => {
  it('reads a million characters and includes every leaf in the final merge without prefix clipping', async () => {
    const kb = base(['原文'.repeat(500000) + '尾部唯一事实', '', '另一条资料也必须阅读。'])
    const plan = planKnowledgeSummary(kb), reports: KnowledgeSummaryProgress[] = []
    let leaf = 0
    vi.mocked(callAI).mockImplementation(async options => {
      expect(options.noAutomaticRetry).toBe(true)
      expect(options.skillTask).toBeUndefined()
      expect(options.activityParentId).toBeTruthy()
      expect(activeAiCount.value).toBe(1)
      const user = options.messages[options.messages.length - 1].content
      const content = user.includes('原文区间：') ? 'LEAF' + (++leaf) : [...new Set(user.match(/LEAF\d+/g))].join(' ')
      return { content, finishReason: 'stop', usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 } }
    })
    const result = await generateKnowledgeSummary(plan, { model, budget: budget(), onProgress: progress => reports.push(progress) })
    const inputs = vi.mocked(callAI).mock.calls.map(([options]) => options.messages[options.messages.length - 1].content)
    for (const entry of kb.entries) {
      const texts = inputs.filter(text => text.includes('来源：' + entry.id + '｜')).map(text => text.slice(text.indexOf('\n', text.indexOf('原文区间：')) + 1))
      expect(texts.join('')).toBe(entry.content)
    }
    expect(inputs.some(text => text.endsWith('尾部唯一事实'))).toBe(true)
    for (let index = 1; index <= plan.chunks.length; index++) expect(result.summary.split(' ')).toContain('LEAF' + index)
    expect(callAI).toHaveBeenCalledTimes(plan.plannedRequests)
    expect(result.coverage.requestCount).toBe(plan.plannedRequests)
    expect(result.coverage.inputTokens).toBe(plan.plannedRequests * 100)
    expect(result.coverage.outputTokens).toBe(plan.plannedRequests * 30)
    expect(result.coverage.usageEstimated).toBe(false)
    expect(coverageMatchesSources(result.coverage, kb.entries.map(entry => ({ entryId: entry.id, sourceVersionId: entrySourceVersion(kb.id, entry), contentLength: entry.content.length })))).toBe(true)
    expect(reports[reports.length - 1]).toMatchObject({ phase: 'complete', completedChunks: plan.chunks.length })
    expect(activeAiCount.value).toBe(0)
  })

  it('rejects request or token budgets before spending and includes enabled instructions in its estimate', async () => {
    const plan = planKnowledgeSummary(base(['长'.repeat(16000)]))
    await expect(generateKnowledgeSummary(plan, { model, budget: createKnowledgeSummaryBudget(1, 1000000) })).rejects.toThrow('请求预算')
    const plain = estimateKnowledgeSummaryTokens(plan, model)
    const withSkill = estimateKnowledgeSummaryTokens(plan, model, '技能'.repeat(1000))
    expect(withSkill).toBeGreaterThan(plain)
    await expect(generateKnowledgeSummary(plan, { model, instructions: '技能'.repeat(1000), budget: createKnowledgeSummaryBudget(64, plain) })).rejects.toThrow('超过剩余预算')
    expect(callAI).not.toHaveBeenCalled()
  })

  it('shares an import budget across jobs and reserves missing usage conservatively', async () => {
    const shared = createKnowledgeSummaryBudget(2, 100000)
    vi.mocked(callAI).mockResolvedValue({ content: '资料摘要', finishReason: 'stop' })
    const plan = planKnowledgeSummary(base())
    const result = await generateKnowledgeSummary(plan, { model, budget: shared })
    expect(result.coverage.usageEstimated).toBe(true)
    expect(shared.usageEstimated).toBe(true)
    expect(shared.outputTokens).toBe(8000)
    await expect(generateKnowledgeSummary(plan, { model, budget: shared })).rejects.toThrow('请求预算')
    expect(callAI).toHaveBeenCalledTimes(2)
  })

  it('rejects a declared context window that cannot hold a full request before spending', async () => {
    await expect(generateKnowledgeSummary(planKnowledgeSummary(base(['长'.repeat(7000)])), { model: { ...model, contextWindow: 4000 }, budget: budget() })).rejects.toThrow('模型上下文窗口')
    expect(callAI).not.toHaveBeenCalled()
  })

  it.each(['cancel', 'source'] as const)('rejects a late reply after %s and retains its usage', async mode => {
    const controller = new AbortController(), shared = budget(), reports: KnowledgeSummaryProgress[] = []
    let current = true
    vi.mocked(callAI).mockImplementation(async () => {
      if (mode === 'cancel') controller.abort(new Error('作者取消'))
      else current = false
      return { content: '迟到摘要', finishReason: 'stop', usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }
    })
    await expect(generateKnowledgeSummary(planKnowledgeSummary(base(['原'.repeat(13000)])), {
      model, budget: shared, signal: controller.signal, isCurrent: () => current, onProgress: progress => reports.push(progress),
    })).rejects.toThrow(mode === 'cancel' ? '作者取消' : '发生变化')
    expect(callAI).toHaveBeenCalledOnce()
    expect(shared.inputTokens + shared.outputTokens).toBe(120)
    expect(reports[reports.length - 1]?.phase).toBe(mode === 'cancel' ? 'cancelled' : 'failed')
    expect(activeAiCount.value).toBe(0)
  })

  it.each(['empty-merge', 'truncated', 'oversized', 'network'] as const)('does not return a complete result after %s', async fault => {
    const plan = planKnowledgeSummary(base(['原'.repeat(7000)])), shared = budget()
    if (fault === 'empty-merge') vi.mocked(callAI).mockResolvedValueOnce({ content: '第一段', finishReason: 'stop' }).mockResolvedValueOnce({ content: '第二段', finishReason: 'stop' }).mockResolvedValueOnce({ content: '', finishReason: 'stop' })
    if (fault === 'truncated') vi.mocked(callAI).mockResolvedValue({ content: '半段', finishReason: 'length' })
    if (fault === 'oversized') vi.mocked(callAI).mockResolvedValue({ content: '长'.repeat(1501), finishReason: 'stop' })
    if (fault === 'network') vi.mocked(callAI).mockRejectedValue(new Error('网络失败'))
    await expect(generateKnowledgeSummary(plan, { model, budget: shared })).rejects.toThrow()
    expect(shared.requests).toBe(fault === 'empty-merge' ? 3 : 1)
    expect(shared.inputTokens + shared.outputTokens).toBeGreaterThan(0)
    expect(shared.usageEstimated).toBe(true)
  })

  it('stops when reported usage exceeds the local allowance and never sends the next request', async () => {
    const shared = createKnowledgeSummaryBudget(64, 100000)
    vi.mocked(callAI).mockResolvedValue({ content: '摘要', finishReason: 'stop', usage: { prompt_tokens: 100000, completion_tokens: 1, total_tokens: 100001 } })
    await expect(generateKnowledgeSummary(planKnowledgeSummary(base(['原'.repeat(7000)])), { model, budget: shared })).rejects.toThrow('实际用量超过预算')
    expect(callAI).toHaveBeenCalledOnce()
    expect(shared.inputTokens + shared.outputTokens).toBe(100001)
  })
})

