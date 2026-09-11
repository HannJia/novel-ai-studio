import type { DataPanelChange, DataPanelField, DataPanelItem, DataPanelItemDraft, EquipmentState, Novel } from '@/types/novel'
import { createDataPanelId } from './dataPanel'
import { equipmentSnapshot, equipmentStateLabel } from './dataPanelEquipment'

type Proposal = Omit<DataPanelChange, 'id' | 'createdAt' | 'status'>
type RecordValue = Record<string, unknown>
const record = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {}
const text = (value: unknown): string => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
const rows = (value: unknown): RecordValue[] => Array.isArray(value) ? value.slice(0, 200).map(record) : []
const categories: DataPanelItem['category'][] = ['角色', '装备', '道具', '作物', '资源', '建筑', '任务', '自定义']
const states: EquipmentState[] = ['stored', 'equipped', 'consumed', 'lost']

function parseFields(value: unknown): DataPanelField[] {
  const fields: DataPanelField[] = []
  for (const raw of rows(value)) {
    const name = text(raw.name)
    const value = text(raw.value)
    if (!name || name.length > 100 || !value || fields.some(field => field.name === name)) continue
    const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(value)
    const rawModifier = record(raw.modifier)
    const modifier: DataPanelField['modifier'] = numeric && text(rawModifier.attribute)
      && ['flat', 'percent'].includes(text(rawModifier.operation))
      ? { attribute: text(rawModifier.attribute), operation: rawModifier.operation as 'flat' | 'percent' } : undefined
    fields.push({
      id: createDataPanelId(), name, value, unit: text(raw.unit), note: text(raw.note),
      type: numeric ? (text(raw.unit).includes('%') ? 'percent' : 'number') : 'text', modifier,
    })
  }
  return fields
}

export function buildDataMemoryProposals(novel: Novel, chapterIndex: number, content: string, payload: unknown): Proposal[] {
  const parsed = record(payload)
  const proposals: Proposal[] = []
  const panels = novel.dataPanels || []
  const normalizedContent = content.replace(/\s/g, '')
  const evidenced = (raw: RecordValue): boolean => {
    const evidence = text(raw.reason).replace(/\s/g, '')
    return raw.confidence === 'clear' && evidence.length >= 2 && normalizedContent.includes(evidence)
  }
  const findItem = (raw: RecordValue) => {
    const matches = panels.filter(item => raw.itemId ? item.id === raw.itemId : item.name === text(raw.itemName || raw.name))
    return matches.length === 1 ? matches[0] : undefined
  }
  for (const raw of rows(parsed.newItems)) {
    const name = text(raw.name)
    if (!evidenced(raw) || !name || name.length > 100 || !content.includes(name)) continue
    const category = categories.includes(raw.category as DataPanelItem['category']) ? raw.category as DataPanelItem['category'] : '自定义'
    if (panels.some(item => item.name === name && item.category === category)) continue
    if (proposals.some(proposal => proposal.mutation?.kind === 'create' && proposal.itemName === name)) continue
    const owner = text(raw.ownerItemName)
    const owned = ['装备', '道具'].includes(category) && owner !== name && content.includes(owner) ? owner : ''
    const draft: DataPanelItemDraft = {
      name, category, fields: parseFields(raw.fields),
      relatedKeywords: Array.isArray(raw.relatedKeywords) ? raw.relatedKeywords.filter((value): value is string => typeof value === 'string' && !!value && content.includes(value)).slice(0, 30) : [],
      ownerItemName: owned || undefined,
      equipmentState: states.includes(raw.equipmentState as EquipmentState) ? raw.equipmentState as EquipmentState : 'stored',
    }
    if (!owned && draft.equipmentState === 'equipped') draft.equipmentState = 'stored'
    const fields = draft.fields.map(field => `${field.name} ${field.value}${field.unit}${field.modifier ? ` → ${field.modifier.attribute}（${field.modifier.operation === 'flat' ? '固定' : '基础百分比'}加成）` : ''}`).join('；')
    proposals.push({
      itemId: `new:${category}:${name}`, fieldId: '__create__', itemName: name, fieldName: '新增对象',
      oldValue: '未记录', newValue: `${category} · ${fields || '属性未记录'}${owned ? ` · ${owned} · ${equipmentStateLabel(draft.equipmentState)}` : ''}`,
      reason: text(raw.reason), confidence: 'clear', chapterIndex, mutation: { kind: 'create', item: draft },
    })
  }
  for (const raw of rows(parsed.equipmentChanges)) {
    const item = findItem(raw)
    if (!item || !['装备', '道具'].includes(item.category) || !evidenced(raw) || !states.includes(raw.state as EquipmentState)) continue
    const owner = raw.ownerItemName === undefined
      ? panels.find(candidate => candidate.id === item.ownerItemId)?.name || '' : text(raw.ownerItemName)
    if (owner === item.name || (owner && !content.includes(owner) && !panels.some(candidate => candidate.id === item.ownerItemId && candidate.name === owner))) continue
    const state = raw.state as EquipmentState
    if (state === 'equipped' && !owner) continue
    const newValue = `${owner || '未指定'} · ${equipmentStateLabel(state)}`
    const oldValue = equipmentSnapshot(item, panels)
    if (newValue === oldValue) continue
    proposals.push({
      itemId: item.id, itemName: item.name, fieldId: '__equipment__', fieldName: '归属与装备状态',
      oldValue, newValue, reason: text(raw.reason), confidence: 'clear', chapterIndex,
      mutation: { kind: 'equipment', ownerItemName: owner, state },
    })
  }
  for (const raw of rows(Array.isArray(payload) ? payload : parsed.dataChanges)) {
    if (raw.confidence && raw.confidence !== 'clear') continue
    const item = findItem(raw)
    if (!item) continue
    const fieldName = text(raw.fieldName)
    const field = item.fields.find(candidate => candidate.name === fieldName)
    if (field?.formula || field?.autoCalculate) continue
    // Effective totals cannot overwrite a character's base value.
    const equipmentAttribute = panels.some(source => source.ownerItemId === item.id && source.fields.some(candidate => candidate.modifier?.attribute === fieldName))
      || proposals.some(proposal => proposal.mutation?.kind === 'create'
        && proposal.mutation.item.ownerItemName === item.name && proposal.mutation.item.fields.some(candidate => candidate.modifier?.attribute === fieldName))
    if (item.category === '角色' && equipmentAttribute && raw.valueKind !== 'base') continue
    const newValue = text(raw.newValue)
    if (!newValue) continue
    const oldValue = text(raw.oldValue) || field?.value || '未记录'
    if (newValue === oldValue) continue
    if (!field) {
      if (!evidenced(raw)) continue
      const addedField = parseFields([{ ...raw, name: fieldName, value: newValue }])[0]
      if (!addedField) continue
      proposals.push({
        itemId: item.id, fieldId: `new:${fieldName}`, itemName: item.name, fieldName,
        oldValue: '未记录', newValue, reason: text(raw.reason), confidence: 'clear', chapterIndex,
        mutation: { kind: 'field', field: addedField },
      })
    } else {
      proposals.push({
        itemId: item.id, fieldId: field.id, itemName: item.name, fieldName,
        oldValue, newValue, reason: text(raw.reason), confidence: 'clear', chapterIndex,
      })
    }
  }
  return proposals
}

export const DATA_MEMORY_OUTPUT = `{
  "newItems": [{"name":"物品或角色名","category":"角色|装备|道具|作物|资源|建筑|任务|自定义",
    "fields":[{"name":"攻击加成","value":"10","unit":"","modifier":{"attribute":"攻击力","operation":"flat"}}],
    "relatedKeywords":[],"ownerItemName":"明确持有者姓名，无则留空","equipmentState":"stored|equipped|consumed|lost",
    "confidence":"clear|possible","reason":"连续原文摘录"}],
  "equipmentChanges": [{"itemId":"已有装备ID","itemName":"装备名","ownerItemName":"持有者姓名","state":"stored|equipped|consumed|lost","confidence":"clear|possible","reason":"连续原文摘录"}],
  "dataChanges": [{"itemId":"已有对象ID","itemName":"对象名","fieldName":"字段名","oldValue":"旧值","newValue":"新值","unit":"","valueKind":"base","confidence":"clear|possible","reason":"连续原文摘录"}]
}`

export const DATA_MEMORY_RULES = `只提取已发生的事实，不记录愿望、未来计划、举例、回忆中已失效的装备状态或角色猜想。
newItems 允许发现新对象，即使当前数据面板为空；只填正文明确给出的属性，绝不编造角色基础数值。已有对象的新字段放入 dataChanges。
获得/拾取不等于装备：stored 只表示持有，不加属性；明确穿戴/装备或持续生效才是 equipped；卸下变 stored；消耗是 consumed；丢失/转出是 lost。
ownerItemName 使用实际角色姓名，不用“主角”；newItems 中归属和状态也需要原文依据。reason 必须是正文中可逐字找到的连续原文。
modifier 仅用于装备/道具明确提供的加成。attribute 必须精确匹配角色基础字段；flat 为固定值，percent 为基础值的百分比（+10% 填 10）。没有加成的价格、耐久、数量等字段不填 modifier。
生效值 = 基础值 * (1 + 所有基础百分比加成之和/100) + 固定加成之和；最终总值百分比、乘算、条件加成等不同规则不可硬套此公式，只记录说明，不填 modifier。
角色字段始终表示基础值。装备后的总攻击力不是基础攻击力，禁止再次写入 dataChanges 造成双重加成。明确永久提升基础属性才输出 valueKind=base。
消耗品只在明确使用后提出消耗和基础数值变更，不因获得就生效，不把一次性提升当成永久装备加成。
没有变化的数组输出 []；不明确的项 confidence=possible，不得填 clear。`
