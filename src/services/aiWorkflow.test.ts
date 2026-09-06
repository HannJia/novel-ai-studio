import { describe, expect, it } from 'vitest'
import { getAiWorkflowPolicy, normalizeAiWorkflowMode } from './aiWorkflow'

describe('AI 工作流策略', () => {
  it('未知配置回退到均衡模式', () => {
    expect(normalizeAiWorkflowMode('legacy')).toBe('balanced')
  })

  it('快速模式仍保留结尾补写门禁', () => {
    const policy = getAiWorkflowPolicy('fast')
    expect(policy.createWritingPlan).toBe(false)
    expect(policy.selfCheckDraft).toBe(false)
    expect(policy.endingContinuationAttempts).toBeGreaterThan(0)
  })

  it('严谨模式允许更多复核轮次', () => {
    expect(getAiWorkflowPolicy('strict').reviewRewriteCycles)
      .toBeGreaterThan(getAiWorkflowPolicy('balanced').reviewRewriteCycles)
  })
})
