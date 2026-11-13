import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useNovelStore } from './novel'
import { buildDataMemoryProposals } from '@/services/dataPanelExtraction'
import { equipmentSnapshot, getEquipmentAttributeTotals } from '@/services/dataPanelEquipment'
import type { DataPanelChange } from '@/types/novel'
import * as storyAggregate from '@/services/storyAggregate'

const content = '林澈的基础攻击力是20。他获得铁剑，铁剑攻击力加成10，随后装备了铁剑。'
const newItems = [
  { name: '林澈', category: '角色', fields: [{ name: '攻击力', value: '20' }], reason: '林澈的基础攻击力是20', confidence: 'clear' },
  { name: '铁剑', category: '装备', ownerItemName: '林澈', equipmentState: 'equipped',
    fields: [{ name: '攻击加成', value: '10', modifier: { attribute: '攻击力', operation: 'flat' } }],
    reason: content, confidence: 'clear' },
]

function setup() {
  const store = useNovelStore()
  const novel = store.addNovel({ genre: 'fantasy', subGenre: 'xuanhuan', tags: [], targetWordCountMin: 20, targetWordCountMax: 30,
    settings: store.defaultSettings(), writingStyle: store.defaultWritingStyle(), writingMode: 'manual' })
  const chapter = store.addChapter(novel.id, { title: '获得装备', content })!
  return { store, novel, chapter }
}

async function commitProposals(store: ReturnType<typeof useNovelStore>, novelId: string,
  proposals: ReturnType<typeof buildDataMemoryProposals>) {
  const changes: DataPanelChange[] = []
  for (const proposal of proposals) {
    const change = await store.addDataPanelChange(novelId, proposal)
    if (!change) throw new Error('数据面板提案未创建。')
    changes.push(change)
  }
  return changes
}

describe('数据记忆提取与确认', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(storyAggregate, 'readStoryAggregate').mockResolvedValue({ novel: null, workspace: {
      candidates: [], reviewFindings: [], canonMutations: [], chapterReviews: [], aiRuns: [],
    } })
    vi.spyOn(storyAggregate, 'saveStoryAggregate').mockResolvedValue(undefined)
  })
  afterEach(() => vi.restoreAllMocks())

  it('空面板从正文创建待确认对象，确认后只计算一次加成，不改正文', async () => {
    const { store, novel, chapter } = setup()
    const proposals = buildDataMemoryProposals(novel, 0, content, { newItems })
    expect(proposals).toHaveLength(2)
    const changes = await commitProposals(store, novel.id, proposals)
    expect(novel.dataPanels).toHaveLength(0)
    expect(await store.applyDataPanelChanges(novel.id, changes.map(change => change.id).reverse())).toBe(2)
    const hero = novel.dataPanels.find(item => item.name === '林澈')!
    const sword = novel.dataPanels.find(item => item.name === '铁剑')!
    expect(sword.ownerItemId).toBe(hero.id)
    expect(getEquipmentAttributeTotals(novel.dataPanels, hero.id)[0].total).toBe(30)
    expect(hero.fields[0].value).toBe('20')
    expect(chapter.content).toBe(content)
    expect(buildDataMemoryProposals(novel, 0, content, { newItems })).toEqual([])
    expect(await store.applyDataPanelChanges(novel.id, changes.map(change => change.id))).toBe(0)
  })

  it('重复扫描和忽略后不重复提议，不同书彼此隔离', async () => {
    const { store, novel } = setup()
    const second = setup().novel
    const [proposal] = buildDataMemoryProposals(novel, 0, content, { newItems })
    const change = (await store.addDataPanelChange(novel.id, proposal))!
    expect(await store.addDataPanelChange(novel.id, proposal)).toBeNull()
    await store.rejectDataPanelChange(novel.id, change.id)
    expect(await store.addDataPanelChange(novel.id, proposal)).toBeNull()
    expect(novel.dataPanels).toHaveLength(0)
    expect(second.dataPanelChanges).toHaveLength(0)
  })

  it('持有物品不加成，穿戴和卸下需确认，旧状态不会覆盖最新状态', async () => {
    const { store, novel } = setup()
    const payload = { newItems: newItems.map(item => ({ ...item, equipmentState: 'stored' })) }
    const changes = await commitProposals(store, novel.id, buildDataMemoryProposals(novel, 0, content, payload))
    await store.applyDataPanelChanges(novel.id, changes.map(change => change.id))
    const hero = novel.dataPanels.find(item => item.name === '林澈')!
    const sword = novel.dataPanels.find(item => item.name === '铁剑')!
    expect(getEquipmentAttributeTotals(novel.dataPanels, hero.id)).toEqual([])
    const equipText = '林澈装备铁剑。'
    const [equip] = buildDataMemoryProposals(novel, 1, equipText, {
      equipmentChanges: [{ itemId: sword.id, state: 'equipped', ownerItemName: '林澈', reason: equipText, confidence: 'clear' }],
    })
    const equipChange = (await store.addDataPanelChange(novel.id, equip))!
    expect(sword.equipmentState).toBe('stored')
    expect(await store.applyDataPanelChange(novel.id, equipChange.id)).toBe(true)
    expect(getEquipmentAttributeTotals(novel.dataPanels, hero.id)[0].total).toBe(30)
    const oldValue = equipmentSnapshot(sword, novel.dataPanels)
    const remove = (await store.addDataPanelChange(novel.id, { ...equip, oldValue, chapterIndex: 2,
      mutation: { kind: 'equipment', ownerItemName: '林澈', state: 'stored' } }))!
    expect(await store.applyDataPanelChange(novel.id, remove.id)).toBe(true)
    expect(getEquipmentAttributeTotals(novel.dataPanels, hero.id)).toEqual([])
    const stale = (await store.addDataPanelChange(novel.id, { ...equip, oldValue, chapterIndex: 3 }))!
    expect(await store.applyDataPanelChange(novel.id, stale.id)).toBe(false)
    expect(sword.equipmentState).toBe('stored')
  })

  it('没有依据、不明确或无效的新对象不会入库；不会把有效总值回写基础值', async () => {
    const { store, novel } = setup()
    expect(buildDataMemoryProposals(novel, 0, content, {
      newItems: [...newItems.map(item => ({ ...item, confidence: 'possible' })), { ...newItems[1], reason: '不存在的原文' }],
    })).toEqual([])
    const proposals = buildDataMemoryProposals(novel, 0, content, { newItems })
    const changes = await commitProposals(store, novel.id, proposals)
    await store.applyDataPanelChanges(novel.id, changes.map(change => change.id))
    const hero = novel.dataPanels.find(item => item.category === '角色')!
    expect(buildDataMemoryProposals(novel, 1, '总攻击力30', { dataChanges: [
      { itemId: hero.id, fieldName: '攻击力', newValue: '30' },
    ] })).toEqual([])
  })

  it('支持已有角色补基础字段；未记录基础属性不猜零', async () => {
    const { store, novel } = setup()
    const [proposal] = buildDataMemoryProposals(novel, 0, content, { newItems: [newItems[1]] })
    const change = (await store.addDataPanelChange(novel.id, proposal))!
    await store.applyDataPanelChange(novel.id, change.id)
    const hero = novel.dataPanels.find(item => item.category === '角色')!
    expect(hero.fields).toHaveLength(0)
    expect(getEquipmentAttributeTotals(novel.dataPanels, hero.id)[0].total).toBeNull()
    const [base] = buildDataMemoryProposals(novel, 1, content, { dataChanges: [
      { itemId: hero.id, fieldName: '攻击力', newValue: '20', valueKind: 'base', reason: '林澈的基础攻击力是20', confidence: 'clear' },
    ] })
    const baseChange: DataPanelChange = (await store.addDataPanelChange(novel.id, base))!
    expect(await store.applyDataPanelChange(novel.id, baseChange.id)).toBe(true)
    expect(getEquipmentAttributeTotals(novel.dataPanels, hero.id)[0].total).toBe(30)
  })
})
