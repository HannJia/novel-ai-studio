import { describe, expect, it } from 'vitest'
import { isPlaceholderChapterTitle, normalizeChapterTitle, parseChapterMetadata } from './chapterMetadata'

describe('章节元数据校验', () => {
  it('识别各种占位章节名', () => {
    expect(isPlaceholderChapterTitle('第一章')).toBe(true)
    expect(isPlaceholderChapterTitle('第 12 章')).toBe(true)
    expect(isPlaceholderChapterTitle('第一章 雨夜来客')).toBe(false)
  })

  it('清理模型返回的序号、Markdown 和书名号', () => {
    expect(normalizeChapterTitle('## 第十二章 《雨夜来客》')).toBe('雨夜来客')
  })

  it('拒绝没有有效总结的结构化结果', () => {
    expect(parseChapterMetadata('{"title":"雨夜来客","summary":"太短"}', true)).toBeNull()
    expect(parseChapterMetadata('{"title":"雨夜来客","summary":"沈砚在雨夜追踪失窃线索，并确认密库守卫证词存在矛盾，为下一步调查建立明确方向。"}', true))
      .toMatchObject({ title: '雨夜来客' })
  })
})
