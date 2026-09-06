import { describe, expect, it } from 'vitest'
import { buildChapterAnalysisPrompt, buildChapterEndingCheckPrompt, buildChapterEndingContinuationPrompt } from './prompts'
import type { ChapterEndingCheck } from './chapterEnding'

describe('章节结构化分析 Prompt', () => {
  it('要求一次返回事件、角色、全书规划和数据变化', () => {
    const messages = buildChapterAnalysisPrompt('正文', '数据面板', '全书规划')
    const content = messages[1].content
    expect(content).toContain('"events"')
    expect(content).toContain('"characters"')
    expect(content).toContain('"globalPlans"')
    expect(content).toContain('"dataChanges"')
  })
})

describe('章节结尾 Prompt', () => {
  it('不把字数或完整句误判为完整章节', () => {
    const content = buildChapterEndingCheckPrompt('林澈准备启动手动导航。', '启动导航并确认结果')[1].content
    expect(content).toContain('达到目标字数或末尾有句号，都不能单独证明章节完整')
    expect(content).toContain('有效悬念')
    expect(content).toContain('强行截断')
    expect(content).toContain('"isComplete"')
  })

  it('收尾续写只完成当前剧情节拍', () => {
    const check: ChapterEndingCheck = {
      isComplete: false,
      isValidCliffhanger: false,
      openAction: '导航尚未启动',
      reason: '动作停在执行之前',
      continuationInstruction: '启动导航并形成结果',
    }
    const content = buildChapterEndingContinuationPrompt('他抬起手。', check)[1].content
    expect(content).toContain('导航尚未启动')
    expect(content).toContain('约 150~400 字')
    expect(content).toContain('不开启新场景')
  })
})
