import { describe, expect, it } from 'vitest'
import { parseAiJsonArray, parseAiJsonObject } from '@/utils/aiJson'

describe('AI JSON parsing', () => {
  it('ignores provider thinking blocks and markdown fences', () => {
    const parsed = parseAiJsonObject<{ plans: Array<{ horizon: string }> }>(
      '<thinking>先分析 {不完整内容}</thinking>\n```json\n{"plans":[{"horizon":"next"}]}\n```',
    )
    expect(parsed?.plans[0].horizon).toBe('next')
  })

  it('selects the largest valid balanced payload', () => {
    const parsed = parseAiJsonObject<{ values: number[] }>('说明 {bad}\n结果：{"values":[1,2,3]}')
    expect(parsed).toEqual({ values: [1, 2, 3] })
    expect(parseAiJsonArray<number>('prefix [1,2,3] suffix')).toEqual([1, 2, 3])
  })

  it('preserves Chinese dialogue and comma/bracket text inside valid JSON strings', () => {
    const value = { reason: '他说“今晚不开门”，保留原样 ,} 和 ,]。', dialogue: '她说‘不知道’。' }
    expect(parseAiJsonObject(JSON.stringify(value))).toEqual(value)
    expect(parseAiJsonArray(JSON.stringify([value]))).toEqual([value])
  })

  it('only repairs structural trailing commas, preserving quoted text', () => {
    expect(parseAiJsonObject('{"reason":"保留 ,} 和 ,] 以及“引号”", "values":[1,2,],}'))
      .toEqual({ reason: '保留 ,} 和 ,] 以及“引号”', values: [1, 2] })
  })

  it('accepts typographic delimiters without changing valid string content', () => {
    expect(parseAiJsonObject('{“reason”: “已经结束”, “valid”: true}'))
      .toEqual({ reason: '已经结束', valid: true })
  })
})
