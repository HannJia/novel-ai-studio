import { describe, expect, it } from 'vitest'
import type { DataPanelAutomationRule, DataPanelChange, DataPanelField, DataPanelItem, Novel } from '@/types/novel'
import { equipmentSnapshot } from './dataPanelEquipment'
import { applyDataPanelProposal, rejectDataPanelProposal } from './dataPanelProposalMutations'

const now = '2026-10-31T00:00:00.000Z'

function novel(dataPanels: DataPanelItem[] = [], dataPanelChanges: DataPanelChange[] = []): Novel {
  return {
    id: 'novel-1', title: '合成测试', genre: 'fantasy', subGenre: 'xuanhuan', genreLabel: '幻想', subGenreLabel: '玄幻', tags: [],
    targetWordCountMin: 20, targetWordCountMax: 30, currentWordCount: 0,
    writingStyle: { narrativePov: '', toneStyle: '', descriptionDensity: '', dialogueStyle: '', combatStyle: '', pacingControl: '', emotionExpression: '' },
    settings: {
      protagonist: { name: '', gender: '', age: '', background: '', personality: [], initialPower: '', cheatDescription: '', romanceTendency: '' },
      supportingCharacters: [], worldBuilding: { worldType: '', worldScale: '', socialStructure: '', techLevel: '', specialRules: '' },
      powerSystem: { systemName: '', levelHierarchy: '', combatStyleDesc: '', auxiliarySystems: '' },
      coreConflict: { mainConflict: '', mainVillain: '', factionConflicts: '', coreSuspense: '' },
      romance: { romanceType: '', developmentPace: '', toneChanges: '', emotionalConflict: '' },
      payoff: { faceSlapFrequency: '', levelUpPace: '', patterns: [] }, structure: { foreshadowingDensity: '' }, otherSettings: '',
    },
    outline: '', synopsis: '', volumes: [], chapters: [], characters: [], chatHistory: [], inspirationHistory: [], knowledgeBaseIds: [],
    eventLog: [], storyArcs: [], chapterPlans: [], storyStateProposals: [], dataPanels, dataPanelChanges,
    storyClock: { currentDay: 5, label: '第 6 天', updatedAt: now }, status: 'writing', createdAt: now, updatedAt: now,
  }
}

function field(id: string, name: string, value: string, extra: Partial<DataPanelField> = {}): DataPanelField {
  return { id, name, value, unit: '', note: '', type: 'number', ...extra }
}

function item(id: string, name: string, fields: DataPanelField[], extra: Partial<DataPanelItem> = {}): DataPanelItem {
  return { id, category: '角色', name, fields, relatedKeywords: [], createdAt: now, updatedAt: now, ...extra }
}

function change(id: string, itemId: string, fieldId: string, oldValue: string, newValue: string, chapterIndex: number, mutation?: DataPanelChange['mutation']): DataPanelChange {
  return { id, itemId, fieldId, itemName: '林澈', fieldName: '攻击力', oldValue, newValue, reason: '合成正文证据', chapterIndex, status: 'pending', createdAt: now, mutation }
}

describe('data panel proposal mutations', () => {
  it('binds a newly created owner when equipping an existing item', () => {
    const sword = item('sword', '铁剑', [], { category: '装备', equipmentState: 'stored' })
    const proposal = change('equip', sword.id, '__equipment__', equipmentSnapshot(sword, [sword]), '已装备', 0,
      { kind: 'equipment', ownerItemName: '林澈', state: 'equipped' })
    const book = novel([sword], [proposal])
    let sequence = 0
    expect(applyDataPanelProposal(book, proposal.id, undefined, now, () => 'owner-test-' + ++sequence)).toBe(true)
    expect(sword.ownerItemId).toBe(book.dataPanels.find(row => row.category === '角色')?.id)
    expect(sword.ownerItemId).toBeTruthy()
  })
  it('accepts a value proposal without consuming unbound automation, recalculates formulas, and records history once', () => {
    const attack = field('attack', '攻击力', '10')
    const next = field('next', '显示攻击力', '10', { type: 'formula', formula: '攻击力 + 2', autoCalculate: true })
    const rule: DataPanelAutomationRule = { id: 'rule', trigger: 'per_chapter', amount: 1, interval: 1, enabled: true, pendingChapterIndex: 0 }
    attack.automationRules = [rule]
    const proposal = change('value-1', 'hero', 'attack', '10', '12', 0)
    const book = novel([item('hero', '林澈', [attack, next])], [proposal])
    const ids = ['version-1']

    expect(applyDataPanelProposal(book, proposal.id, undefined, now, () => ids.shift()!)).toBe(true)
    expect(attack.value).toBe('12')
    expect(next.value).toBe('14')
    expect(rule.pendingChapterIndex).toBe(0)
    expect(rule.lastEvaluatedChapterIndex).toBeUndefined()
    expect(book.dataPanels[0].versions).toHaveLength(1)
    expect(proposal.status).toBe('accepted')
    expect((proposal as DataPanelChange & { updatedAt?: string }).updatedAt).toBe(now)
    expect(applyDataPanelProposal(book, proposal.id, '13', now, () => { throw new Error('重复接受不应取 ID') })).toBe(false)
    expect(book.dataPanels[0].versions).toHaveLength(1)
    expect(rule.appliedCount).toBeUndefined()
  })

  it('creates an owner and equipment atomically, cloning fields and rules from the proposal', () => {
    const sourceField = field('bonus', '攻击加成', '10', { automationRules: [{ id: 'r', trigger: 'on_mention', amount: 1, interval: 1, enabled: true }] })
    const mutation = { kind: 'create' as const, item: { name: '铁剑', category: '装备' as const, fields: [sourceField], relatedKeywords: ['剑'], ownerItemName: '林澈', equipmentState: 'equipped' as const } }
    const proposal = change('create-1', 'new:装备:铁剑', '__create__', '未记录', '装备', 2, mutation)
    const book = novel([], [proposal])
    expect(applyDataPanelProposal(book, proposal.id, undefined, now, (() => { let n = 0; return () => `id-${++n}` })())).toBe(true)
    expect(book.dataPanels.map(panel => panel.name)).toEqual(['林澈', '铁剑'])
    const created = book.dataPanels[1]
    expect(created.ownerItemId).toBe(book.dataPanels[0].id)
    expect(created.lastMentionChapterIndex).toBe(2)
    expect(created.fields).not.toBe(mutation.item.fields)
    expect(created.fields[0].automationRules).not.toBe(sourceField.automationRules)
    sourceField.value = '999'
    sourceField.automationRules![0].amount = 99
    expect(created.fields[0].value).toBe('10')
    expect(created.fields[0].automationRules![0].amount).toBe(1)
  })

  it('rejects duplicate owners without creating an owner, changing equipment, or resolving the proposal', () => {
    const first = item('hero-1', '林澈', [])
    const second = item('hero-2', '林澈', [])
    const sword = item('sword', '铁剑', [], { category: '装备', equipmentState: 'stored' })
    const proposal = change('equipment-1', sword.id, '__equipment__', '未指定 · 持有 / 未装备', '林澈 · 已装备 / 持续生效', 1,
      { kind: 'equipment', ownerItemName: '林澈', state: 'equipped' })
    const book = novel([first, second, sword], [proposal])
    const before = JSON.stringify(book)
    expect(applyDataPanelProposal(book, proposal.id, undefined, now, () => { throw new Error('拒绝时不应取 ID') })).toBe(false)
    expect(JSON.stringify(book)).toBe(before)
    expect(proposal.status).toBe('pending')
  })

  it('accepts a new field only when the missing old value and chapter baseline still match', () => {
    const added = field('resistance', '抗性', '3')
    const proposal = change('field-1', 'hero', 'new:抗性', '未记录', '3', 3, { kind: 'field', field: added })
    const book = novel([item('hero', '林澈', [field('level', '等级', '2')])], [proposal])
    expect(applyDataPanelProposal(book, proposal.id, undefined, now, () => 'field-version')).toBe(true)
    expect(book.dataPanels[0].fields.find(value => value.name === '抗性')?.value).toBe('3')
    const stale = change('field-stale', 'hero', 'new:速度', '错误旧值', '4', 3, { kind: 'field', field: field('speed', '速度', '4') })
    book.dataPanelChanges.push(stale)
    expect(applyDataPanelProposal(book, stale.id, undefined, now, () => { throw new Error('旧值不匹配不应取 ID') })).toBe(false)
    expect(book.dataPanels[0].fields.some(value => value.name === '速度')).toBe(false)
  })

  it('rejects stale value proposals and leaves unbound rule progress untouched', () => {
    const target = field('stock', '库存', '5')
    target.automationRules = [{ id: 'rule', trigger: 'per_chapter', amount: 1, interval: 1, enabled: true, pendingChapterIndex: 1 }]
    const proposal = change('stale', 'hero', 'stock', '4', '6', 1)
    const book = novel([item('hero', '林澈', [target], { lastMentionChapterIndex: 2 })], [proposal])
    expect(applyDataPanelProposal(book, proposal.id, undefined, now, () => { throw new Error('过期提案不应取 ID') })).toBe(false)
    expect(target.value).toBe('5')
    expect(proposal.status).toBe('pending')
    expect(rejectDataPanelProposal(book, proposal.id, now)).toBe(true)
    expect(target.automationRules![0].pendingChapterIndex).toBe(1)
    expect(target.automationRules![0].lastEvaluatedChapterIndex).toBeUndefined()
    expect(rejectDataPanelProposal(book, proposal.id, now,)).toBe(false)
  })
})
