import { describe, expect, it } from 'vitest'
import { chapterEndingPasses, cleanEndingContinuation, normalizeChapterEndingCheck } from './chapterEnding'

describe('章节结尾完整性', () => {
  it('只有明确完成当前剧情节拍才通过', () => {
    const check = normalizeChapterEndingCheck({
      isComplete: true,
      isValidCliffhanger: true,
      openAction: '',
      reason: '导航已经启动并产生结果，新的信号构成下一章悬念',
      continuationInstruction: '',
    })
    expect(chapterEndingPasses(check)).toBe(true)
  })

  it('有效悬念标记不能掩盖未完成动作', () => {
    const check = normalizeChapterEndingCheck({
      isComplete: false,
      isValidCliffhanger: true,
      openAction: '林澈尚未启动手动导航',
      reason: '停在执行关键动作之前',
      continuationInstruction: '完成导航并交代结果',
    })
    expect(chapterEndingPasses(check)).toBe(false)
  })

  it('无法识别的结果按不完整处理', () => {
    const check = normalizeChapterEndingCheck(null)
    expect(check.isComplete).toBe(false)
    expect(check.reason).toContain('未返回可识别')
  })

  it('清理续写包装和误带的章节标题', () => {
    expect(cleanEndingContinuation('```markdown\n自然收尾：\n第1章 航标\n林澈按下启动键。\n```'))
      .toBe('林澈按下启动键。')
  })
})
