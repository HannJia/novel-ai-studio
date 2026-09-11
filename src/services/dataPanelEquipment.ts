import type { DataPanelItem, EquipmentState } from '@/types/novel'

export const equipmentStateOptions: Array<{ label: string; value: EquipmentState }> = [
  { label: '持有 / 未装备', value: 'stored' },
  { label: '已装备 / 持续生效', value: 'equipped' },
  { label: '已消耗', value: 'consumed' },
  { label: '已丢失 / 转出', value: 'lost' },
]

export function equipmentStateLabel(state?: EquipmentState): string {
  return equipmentStateOptions.find(option => option.value === (state || 'stored'))!.label
}

export function equipmentSnapshot(item: DataPanelItem, items: DataPanelItem[]): string {
  const owner = items.find(candidate => candidate.id === item.ownerItemId)?.name || '未指定'
  return `${owner} · ${equipmentStateLabel(item.equipmentState)}`
}

export interface EquipmentAttributeTotal {
  attribute: string
  base: number | null
  flat: number
  percent: number
  total: number | null
  sources: string[]
}

function numeric(value: string): number | null {
  const text = value.trim()
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[%％])?$/.test(text)) return null
  const number = Number.parseFloat(text)
  return Number.isFinite(number) ? number : null
}

// Read-only totals: ownership alone never activates a bonus, and base fields stay intact.
export function getEquipmentAttributeTotals(items: DataPanelItem[], targetId: string): EquipmentAttributeTotal[] {
  const target = items.find(item => item.id === targetId)
  if (!target) return []
  const totals = new Map<string, EquipmentAttributeTotal>()
  for (const source of items) {
    if (source.id === targetId || source.ownerItemId !== targetId || source.equipmentState !== 'equipped'
      || !['装备', '道具'].includes(source.category)) continue
    for (const field of source.fields) {
      const modifier = field.modifier
      const amount = numeric(field.value)
      if (!modifier?.attribute || amount === null || field.calculationError) continue
      let row = totals.get(modifier.attribute)
      if (!row) {
        const candidates = target.fields.filter(candidate => candidate.name === modifier.attribute)
        const base = candidates.length === 1 && !candidates[0].calculationError ? numeric(candidates[0].value) : null
        row = { attribute: modifier.attribute, base, flat: 0, percent: 0, total: null, sources: [] }
        totals.set(modifier.attribute, row)
      }
      row[modifier.operation] += amount
      if (!row.sources.includes(source.name)) row.sources.push(source.name)
    }
  }
  return [...totals.values()].map(row => {
    const value = row.base === null ? NaN : row.base * (1 + row.percent / 100) + row.flat
    return { ...row, total: Number.isFinite(value) ? Math.round(value * 100) / 100 : null }
  })
}

export function formatEquipmentTotals(items: DataPanelItem[], targetId: string): string {
  return getEquipmentAttributeTotals(items, targetId).map(row =>
    `${row.attribute}：基础 ${row.base ?? '未记录'}，固定加成 ${row.flat}，基础百分比加成 ${row.percent}%，生效值 ${row.total ?? '待补基础值'}（${row.sources.join('、')}）`,
  ).join('\n')
}
