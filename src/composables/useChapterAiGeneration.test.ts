import { describe, expect, it } from 'vitest'
import { getChapterGenerationStatus } from '@/composables/useChapterAiGeneration'

describe('chapter AI generation status', () => {
  it('keeps word targets advisory and reserves the hard limit for finishing the current beat', () => {
    expect(getChapterGenerationStatus(1999, 2000, 2500, 3000)).toBe('AI 正在生成中...')
    expect(getChapterGenerationStatus(2500, 2000, 2500, 3000)).toContain('自然收束本章')
    expect(getChapterGenerationStatus(3000, 2000, 2500, 3000)).toContain('不会按字数强行截断')
  })
})
