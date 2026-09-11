import { describe, expect, it } from 'vitest'
import { getEquipmentAttributeTotals } from './dataPanelEquipment'
import type { DataPanelField, DataPanelItem } from '@/types/novel'

const field = (id: string, value: string, modifier?: DataPanelField['modifier']): DataPanelField =>
  ({ id, name: id, value, unit: '', note: '', type: 'number', modifier })
const item = (id: string, fields: DataPanelField[], extra: Partial<DataPanelItem> = {}): DataPanelItem =>
  ({ id, name: id, category: '角色', fields, relatedKeywords: [], createdAt: '2026-09-11', updatedAt: '2026-09-11', ...extra })
const equipment = (id: string, value: string, operation: 'flat' | 'percent' = 'flat') =>
  item(id, [field('攻击加成', value, { attribute: '攻击力', operation })],
    { category: '装备', ownerItemId: '林澈', equipmentState: 'equipped' })

describe('装备属性合计', () => {
  it('固定和基础百分比加成按规则合计，不污染基础值，重复计算不累加', () => {
    const panels = [item('林澈', [field('攻击力', '100')]), equipment('剑', '10'), equipment('戒指', '20', 'percent'), equipment('项链', '5')]
    for (let i = 0; i < 5; i++) {
      expect(getEquipmentAttributeTotals(panels, '林澈')).toMatchObject([{ base: 100, flat: 15, percent: 20, total: 135 }])
    }
    expect(panels[0].fields[0].value).toBe('100')
  })

  it('仅获得、卸下、消耗和丢失都不加属性，重新装备也不会重复叠加', () => {
    const panels = [item('林澈', [field('攻击力', '20')]), equipment('剑', '10')]
    for (const state of ['stored', 'consumed', 'lost'] as const) {
      panels[1].equipmentState = state
      expect(getEquipmentAttributeTotals(panels, '林澈')).toEqual([])
    }
    panels[1].equipmentState = 'equipped'
    expect(getEquipmentAttributeTotals(panels, '林澈')[0].total).toBe(30)
    panels[1].fields[0].value = '15'
    expect(getEquipmentAttributeTotals(panels, '林澈')[0].total).toBe(35)
  })

  it('同名普通数值、价格和耐久不自动成为角色加成', () => {
    const panels = [item('林澈', [field('攻击力', '20')]), item('剑', [field('攻击力', '999'), field('价格', '99')],
      { category: '装备', equipmentState: 'equipped', ownerItemId: '林澈' })]
    expect(getEquipmentAttributeTotals(panels, '林澈')).toEqual([])
  })

  it('未知基础值显示未记录，不当作零；不同角色和不同书隔离', () => {
    const panels = [item('林澈', []), item('阿宁', [field('攻击力', '80')]), equipment('剑', '10')]
    expect(getEquipmentAttributeTotals(panels, '林澈')).toMatchObject([{ base: null, total: null, flat: 10 }])
    panels[2].ownerItemId = '阿宁'
    expect(getEquipmentAttributeTotals(panels, '林澈')).toEqual([])
    expect(getEquipmentAttributeTotals(panels, '阿宁')[0].total).toBe(90)
    expect(getEquipmentAttributeTotals([panels[0]], '林澈')).toEqual([])
  })

  it('公式基础值、负加成和失效公式都明确处理', () => {
    const panels = [item('林澈', [{ ...field('攻击力', '40'), formula: '力量*2', autoCalculate: true }]), equipment('诅咒', '-10')]
    expect(getEquipmentAttributeTotals(panels, '林澈')[0].total).toBe(30)
    panels[0].fields[0].calculationError = '未知字段'
    expect(getEquipmentAttributeTotals(panels, '林澈')[0].total).toBeNull()
  })
})
