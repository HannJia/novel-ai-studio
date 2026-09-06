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
})
