import { describe, expect, it } from 'vitest'
import { applySkillInstructions } from './ai'

describe('AI Skill 注入', () => {
  it('将 Skill 追加到已有 system 消息且不修改原数组', () => {
    const messages = [
      { role: 'system' as const, content: '基础规则' },
      { role: 'user' as const, content: '开始写作' },
    ]
    const result = applySkillInstructions(messages, '保持场景因果。')
    expect(result[0].content).toContain('基础规则')
    expect(result[0].content).toContain('保持场景因果')
    expect(messages[0].content).toBe('基础规则')
  })

  it('没有 system 消息时创建一条', () => {
    const result = applySkillInstructions([{ role: 'user', content: '分析' }], '只使用明确证据。')
    expect(result[0].role).toBe('system')
    expect(result[0].content).toContain('只使用明确证据')
  })
})
