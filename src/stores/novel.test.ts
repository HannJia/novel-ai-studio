import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useNovelStore } from '@/stores/novel'

describe('novel store data panel integration', () => {
  beforeEach(() => setActivePinia(createPinia()))

  function createBook(title: string) {
    const store = useNovelStore()
    const novel = store.addNovel({
      genre: 'fantasy', subGenre: 'xuanhuan', tags: [], targetWordCountMin: 20, targetWordCountMax: 30,
      writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings(),
    })
    store.updateTitle(novel.id, title)
    return novel
  }

  it('keeps each book writing mode independent', () => {
    const store = useNovelStore()
    const first = createBook('AI书')
    const second = createBook('人工书')
    store.setWritingMode(first.id, 'ai')
    store.setWritingMode(second.id, 'manual')
    expect(first.writingMode).toBe('ai')
    expect(second.writingMode).toBe('manual')
    store.setWritingMode(second.id, 'ai')
    store.setWritingMode(first.id, 'manual')
    expect(second.writingMode).toBe('ai')
  })

  it('archives every inspiration message independently from assistant retention and clearing', () => {
    const store = useNovelStore()
    const first = createBook('灵感书')
    const second = createBook('另一本书')
    const messages = Array.from({ length: 65 }, (_, index) => ({
      id: `idea-${index}`, role: 'user' as const, content: `想法${index}`, timestamp: first.createdAt,
    }))
    store.setInspirationHistory(first.id, messages)
    messages[0].content = '调用方后来修改了内容'
    for (let index = 0; index < 60; index++) {
      store.addChatMessage(first.id, { id: `chat-${index}`, role: 'user', content: '正文阶段的问题', timestamp: first.createdAt })
    }
    expect(first.chatHistory).toHaveLength(50)
    expect(first.inspirationHistory).toHaveLength(65)
    expect(first.inspirationHistory?.[0].content).toBe('想法0')
    store.clearChatHistory(first.id)
    expect(first.chatHistory).toHaveLength(0)
    expect(first.inspirationHistory).toHaveLength(65)
    expect(second.inspirationHistory).toHaveLength(0)
    expect(second.chatHistory).toHaveLength(0)
  })

  it('merges repeated character relationship imports without losing existing relationships', () => {
    const store = useNovelStore()
    const book = createBook('关系测试')
    const target = store.addCharacter(book.id, { name: '乙' })!
    const relation = { targetId: target.id, targetName: target.name, relation: '同事' }
    const source = store.addCharacter(book.id, { name: '甲', relationships: [relation] })!
    store.addCharacter(book.id, { name: '甲', relationships: [relation, { ...relation, relation: '合伙人' }] })
    store.addCharacter(book.id, { name: '甲', relationships: [relation] })
    expect(source.relationships.map(item => item.relation)).toEqual(['同事', '合伙人'])
    expect(book.characters).toHaveLength(2)
  })

  it('creates books with an explicit manual mode unless the author selected AI', () => {
    const manual = createBook('默认人工书')
    expect(manual.writingMode).toBe('manual')
    const store = useNovelStore()
    const ai = store.addNovel({ genre: 'fantasy', subGenre: 'xuanhuan', tags: [], targetWordCountMin: 20, targetWordCountMax: 30,
      writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings(), writingMode: 'ai' })
    expect(ai.writingMode).toBe('ai')
    expect(manual.writingMode).toBe('manual')
  })

  it('batch-applies editable changes, rejects others, and keeps books isolated', () => {
    const store = useNovelStore()
    const first = createBook('第一本书')
    const second = createBook('第二本书')
    const panel = store.addDataPanelItem(first.id, {
      name: '主角状态', category: '角色', relatedKeywords: ['主角'], fields: [
        { id: 'level', name: '等级', value: '1', unit: '级', note: '', type: 'number' },
        { id: 'coins', name: '金币', value: '10', unit: '枚', note: '', type: 'number' },
        { id: 'remaining', name: '剩余金币', value: '10', unit: '枚', note: '', type: 'formula', formula: '金币', autoCalculate: true },
      ],
    })!
    const level = store.addDataPanelChange(first.id, {
      itemId: panel.id, fieldId: 'level', itemName: panel.name, fieldName: '等级', oldValue: '1', newValue: '2', reason: '正文明确升级', confidence: 'clear', chapterIndex: 0,
    })!
    const coins = store.addDataPanelChange(first.id, {
      itemId: panel.id, fieldId: 'coins', itemName: panel.name, fieldName: '金币', oldValue: '10', newValue: '15', reason: '正文获得金币', confidence: 'clear', chapterIndex: 0,
    })!

    expect(store.applyDataPanelChanges(first.id, [level.id], { [level.id]: '3' })).toBe(1)
    expect(store.rejectDataPanelChanges(first.id, [coins.id])).toBe(1)
    expect(panel.fields.find(field => field.id === 'level')?.value).toBe('3')
    expect(level.status).toBe('accepted')
    expect(coins.status).toBe('rejected')
    expect(second.dataPanels).toHaveLength(0)
    expect(second.dataPanelChanges).toHaveLength(0)
  })

  it('queues automation for confirmation and advances the rolling next plan', () => {
    const store = useNovelStore()
    const novel = createBook('滚动计划测试')
    novel.chapterPlans = [{
      id: 'current', horizon: 'next', title: '当前章节', objective: '完成当前目标', summary: '当前计划', beats: ['行动'],
      targetChapterStart: 0, targetChapterEnd: 0, relatedArcIds: [], relatedEventIds: [], status: 'active', source: 'user',
      createdAt: novel.createdAt, updatedAt: novel.updatedAt,
    }, {
      id: 'near', horizon: 'near', title: '进入矿区', objective: '找到失踪矿工', summary: '连续调查矿道', beats: ['问询', '入矿'],
      targetChapterStart: 1, targetChapterEnd: 4, relatedArcIds: [], relatedEventIds: [], status: 'planned', source: 'user',
      createdAt: novel.createdAt, updatedAt: novel.updatedAt,
    }]
    expect(store.completeChapterPlans(novel.id, 0)).toBe(1)
    expect(novel.chapterPlans[0].status).toBe('completed')
    const plan = store.ensureNextChapterPlan(novel.id, 0)
    expect(plan?.horizon).toBe('next')
    expect(plan?.targetChapterStart).toBe(1)
    expect(store.ensureNextChapterPlan(novel.id, 0)?.id).toBe(plan?.id)
    expect(novel.chapterPlans.filter(item => item.horizon === 'next' && ['planned', 'active'].includes(item.status))).toHaveLength(1)

    const panel = store.addDataPanelItem(novel.id, {
      name: '任务进度', category: '任务', relatedKeywords: ['矿工'], fields: [{
        id: 'days', name: '已过天数', value: '0', unit: '天', note: '', type: 'days', automationRules: [{
          id: 'rule', trigger: 'per_chapter', amount: 1, interval: 1, enabled: true,
        }],
      }],
    })!
    expect(store.queueAutomaticDataPanelChanges(novel.id, 1, '矿工仍未找到')).toBe(1)
    expect(novel.dataPanelChanges[0].status).toBe('pending')
    expect(panel.fields[0].value).toBe('0')
    store.applyDataPanelChange(novel.id, novel.dataPanelChanges[0].id)
    expect(panel.fields[0].value).toBe('1')
  })

  it('keeps scans idempotent and applies multi-chapter changes in chronological order', () => {
    const store = useNovelStore()
    const novel = createBook('数据顺序测试')
    const panel = store.addDataPanelItem(novel.id, {
      name: '能量核心', category: '资源', relatedKeywords: ['能量'], fields: [
        { id: 'energy', name: '能量', value: '1', unit: '级', note: '', type: 'number' },
      ],
    })!
    const first = store.addDataPanelChange(novel.id, {
      itemId: panel.id, fieldId: 'energy', itemName: panel.name, fieldName: '能量',
      oldValue: '1', newValue: '2', reason: '第一章提升', confidence: 'clear', chapterIndex: 0,
    })!
    const second = store.addDataPanelChange(novel.id, {
      itemId: panel.id, fieldId: 'energy', itemName: panel.name, fieldName: '能量',
      oldValue: '2', newValue: '3', reason: '第二章提升', confidence: 'clear', chapterIndex: 1,
    })!

    expect(store.applyDataPanelChanges(novel.id, [second.id, first.id])).toBe(2)
    expect(panel.fields[0].value).toBe('3')

    store.rejectDataPanelChange(novel.id, store.addDataPanelChange(novel.id, {
      itemId: panel.id, fieldId: 'energy', itemName: panel.name, fieldName: '能量',
      oldValue: '3', newValue: '4', reason: '第三章提升', confidence: 'clear', chapterIndex: 2,
    })!.id)
    expect(store.addDataPanelChange(novel.id, {
      itemId: panel.id, fieldId: 'energy', itemName: panel.name, fieldName: '能量',
      oldValue: '3', newValue: '4', reason: '重复扫描', confidence: 'clear', chapterIndex: 2,
    })).toBeNull()
  })

  it('does not overwrite a field when the pending old value is stale', () => {
    const store = useNovelStore()
    const novel = createBook('数据冲突测试')
    const panel = store.addDataPanelItem(novel.id, {
      name: '库存', category: '资源', relatedKeywords: [], fields: [
        { id: 'stock', name: '数量', value: '5', unit: '', note: '', type: 'number' },
      ],
    })!
    const change = store.addDataPanelChange(novel.id, {
      itemId: panel.id, fieldId: 'stock', itemName: panel.name, fieldName: '数量',
      oldValue: '4', newValue: '6', reason: '过期建议', confidence: 'clear', chapterIndex: 0,
    })!

    expect(store.applyDataPanelChange(novel.id, change.id)).toBe(false)
    expect(panel.fields[0].value).toBe('5')
    expect(change.status).toBe('pending')
  })
})
