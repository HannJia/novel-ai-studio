import { describe, expect, it } from 'vitest'
import { chapterHeading, chapterTitleForDisplay, chineseNumber } from './chapterNumber'

describe('chineseNumber', () => {
  it.each([
    [1, '一'], [9, '九'], [10, '十'], [11, '十一'], [12, '十二'], [19, '十九'], [20, '二十'], [21, '二十一'], [42, '四十二'], [99, '九十九'],
    [100, '一百'], [101, '一百零一'], [110, '一百一十'], [120, '一百二十'], [199, '一百九十九'], [200, '二百'], [1000, '一千'], [1001, '一千零一'], [1010, '一千零一十'], [1100, '一千一百'], [9999, '九千九百九十九'],
  ])('%i → %s', (value, expected) => expect(chineseNumber(value)).toBe(expected))

  it('does not guess for values it cannot write', () => {
    expect(chineseNumber(0)).toBe('零')
    expect(chineseNumber(-1)).toBe('-1')
    expect(chineseNumber(1.5)).toBe('1.5')
    expect(chineseNumber(10000)).toBe('10000')
    expect(chineseNumber(Number.NaN)).toBe('NaN')
  })
})

describe('chapterHeading', () => {
  it('spaces the digits out like the paper chapter head', () => {
    expect(chapterHeading(0)).toBe('第 一 章')
    expect(chapterHeading(9)).toBe('第 十 章')
    expect(chapterHeading(11)).toBe('第 十 二 章')
    expect(chapterHeading(41)).toBe('第 四 十 二 章')
    expect(chapterHeading(100)).toBe('第 一 百 零 一 章')
  })
})

describe('chapterTitleForDisplay', () => {
  it.each([
    ['第2章：渡口来信', 1, '渡口来信'],
    ['第二章·旧档案', 1, '旧档案'],
    ['第 二 章 旧档案', 1, '旧档案'],
    ['第12章雨夜', 11, '雨夜'],
    ['第1章 回忆', 1, '第1章 回忆'],
    ['第2章', 1, '未命名章节'],
    ['', 0, '未命名章节'],
  ])('formats %s for chapter %i as %s', (title, index, expected) => {
    expect(chapterTitleForDisplay(title, index)).toBe(expected)
  })
})
