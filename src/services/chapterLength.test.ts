import { describe, expect, it } from 'vitest'
import { chapterLengthPrompt, DEFAULT_CHAPTER_LENGTH_POLICY, inspectChapterLength, resolveChapterLengthPolicy } from './chapterLength'

describe('chapter length policy', () => {
  it('keeps existing non-whitespace counts including punctuation and UTF-16 units', () => {
    expect(inspectChapterLength(' 你好，AI！\n😀', { minWords: 6, targetWords: 7, maxWords: 8 })).toMatchObject({ words: 8, status: 'within' })
  })
  it.each([2000, 2200, 2400])('accepts boundary/target %s without cutting text', words => {
    expect(inspectChapterLength('甲'.repeat(words)).status).toBe('within')
  })
  it('reports precise deficit and excess', () => {
    expect(inspectChapterLength('甲'.repeat(1998))).toMatchObject({ status: 'short', deficit: 2, excess: 0 })
    expect(inspectChapterLength('甲'.repeat(2401))).toMatchObject({ status: 'long', deficit: 0, excess: 1 })
  })
  it.each([{ minWords: 0 }, { targetWords: NaN }, { maxWords: Infinity }, { maxWords: 100000 }, { minWords: 3000 }, { targetWords: 2100.5 }])('falls back as a whole for invalid input %j', input => {
    expect(resolveChapterLengthPolicy(input)).toEqual(DEFAULT_CHAPTER_LENGTH_POLICY)
  })
  it('supports a book policy and cannot mutate the shared default through its result', () => {
    const policy = resolveChapterLengthPolicy({ minWords: 3000, targetWords: 3500, maxWords: 4000 })
    expect(inspectChapterLength('甲'.repeat(3200), policy).status).toBe('within')
    const fallback = resolveChapterLengthPolicy()
    fallback.minWords = 1
    expect(resolveChapterLengthPolicy().minWords).toBe(2000)
    expect(chapterLengthPrompt(policy)).toContain('3000~4000')
  })
})
