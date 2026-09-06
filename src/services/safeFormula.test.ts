import { describe, expect, it } from 'vitest'
import { evaluateFormula } from './safeFormula'
import { calculateDataPanelFieldValues } from './dataPanel'
import type { DataPanelField } from '@/types/novel'

const field = (name: string, value = '99', formula = ''): DataPanelField => ({
  id: name, name, value, formula, autoCalculate: !!formula, unit: '', note: '',
})
describe('CSP-safe formula evaluation', () => {
  it('supports precedence, unary operators, parentheses and explicit field references', () => {
    expect(evaluateFormula('-(.5 + 2) * -4 / 2 + [已成长 天数]', () => 3)).toBe(8)
    const results = calculateDataPanelFieldValues([
      field('剩余', '99', '总周期 - 已成长'), field('总周期', '99', '基础 * 2'),
      field('已成长', '3'), field('基础', '5'),
    ])
    expect(results.map(item => item.value)).toEqual(['7', '10', '3', '5'])
  })
  it.each([
    ['A / 0', '不能除以零'], ['未知 + 1', '未知字段'], ['A +', '缺少'],
    ['Math.max(1,2)', '未知字段'], ['globalThis["alert"](1)', '未知字段'],
    ['(1 + 2', '右括号'], ['1; alert(1)', '无法解析'],
  ])('reports %s and retains the original value', (formula, error) => {
    const [result] = calculateDataPanelFieldValues([field('B', '99', formula), field('A', '1')])
    expect(result.value).toBe('99')
    expect(result.calculationError).toContain(error)
  })
  it('detects circular dependencies, duplicate names, and nonnumeric input', () => {
    const circular = calculateDataPanelFieldValues([field('A', '1', 'B+1'), field('B', '2', 'A+1')])
    expect(circular.every(item => item.calculationError?.includes('循环依赖'))).toBe(true)
    expect(calculateDataPanelFieldValues([field('B', '99', 'A+1'), field('A', '1'), field('A', '2')])[0].calculationError).toContain('重复')
    expect(calculateDataPanelFieldValues([field('B', '99', 'A+1'), field('A', '未知')])[0].calculationError).toContain('有效数字')
  })
})
