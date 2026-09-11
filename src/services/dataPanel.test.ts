import { describe, expect, it } from 'vitest'
import {
  buildDataPanelAutomationSuggestions,
  dataPanelsToMarkdown,
  filterDataPanelChanges,
  filterDataPanelItems,
  initializeElapsedRuleBaselines,
  parseDataPanelAutomationRules,
  pruneDataPanelChangeHistory,
  settleDataPanelAutomationRules,
  STORY_CLOCK_SOURCE,
} from './dataPanel'
import type { DataPanelChange, DataPanelField, DataPanelItem } from '@/types/novel'

function field(name: string, value: string, unit = ''): DataPanelField {
  return { id: `field-${name}`, name, value, unit, note: '', type: unit === '天' ? 'days' : 'number' }
}

function item(fields: DataPanelField[]): DataPanelItem {
  return {
    id: 'item-1',
    category: '作物',
    name: '灵稻',
    fields,
    relatedKeywords: ['稻田'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function change(id: string, status: DataPanelChange['status'], chapterIndex: number): DataPanelChange {
  return {
    id,
    itemId: 'item-1',
    fieldId: 'field-已成长',
    itemName: '灵稻',
    fieldName: '已成长',
    oldValue: '0',
    newValue: '1',
    reason: '测试',
    chapterIndex,
    status,
    createdAt: `2026-01-${String(chapterIndex + 1).padStart(2, '0')}T00:00:00.000Z`,
  }
}

describe('数据面板自动规则', () => {
  it('按章节应用百分比变化序列，并保持用户确认前不改原值', () => {
    const fields = parseDataPanelAutomationRules(
      '成长进度｜每章 +5, +4',
      [field('成长进度', '0', '%')],
    )
    const panel = item(fields)

    const first = buildDataPanelAutomationSuggestions([panel], 0, '')
    expect(first).toHaveLength(1)
    expect(first[0].newValue).toBe('5')
    expect(panel.fields[0].value).toBe('0')

    first[0].rules[0].pendingChapterIndex = 0
    settleDataPanelAutomationRules(panel, { ...change('auto-1', 'accepted', 0), fieldId: panel.fields[0].id, fieldName: '成长进度' })
    panel.fields[0].value = first[0].newValue

    const second = buildDataPanelAutomationSuggestions([panel], 1, '')
    expect(second[0].newValue).toBe('9')
  })

  it('每次出现规则只在正文命中对象关键词时产生建议', () => {
    const fields = parseDataPanelAutomationRules('经验｜每次出现 +2', [field('经验', '10')])
    const panel = item(fields)
    expect(buildDataPanelAutomationSuggestions([panel], 0, '天气晴朗')).toHaveLength(0)
    expect(buildDataPanelAutomationSuggestions([panel], 0, '林澈巡视稻田')).toMatchObject([{ newValue: '12' }])
  })

  it('经过天数规则先建立基线，达到间隔后再提出变更', () => {
    const fields = parseDataPanelAutomationRules(
      '产量｜经过 3 天 +1（基于：已成长）',
      [field('已成长', '5', '天'), field('产量', '2')],
    )
    const panel = item(fields)
    expect(initializeElapsedRuleBaselines([panel])).toBe(true)
    expect(buildDataPanelAutomationSuggestions([panel], 0, '')).toHaveLength(0)
    panel.fields[0].value = '8'
    expect(buildDataPanelAutomationSuggestions([panel], 1, '')).toMatchObject([{ newValue: '3' }])
  })

  it('故事时间推进会驱动作物成长，并保留待确认状态', () => {
    const fields = parseDataPanelAutomationRules(
      '已成长｜经过 1 天 +1（基于：故事时间）',
      [field('已成长', '0', '天')],
    )
    const panel = item(fields)
    expect(panel.fields[0].automationRules?.[0].sourceFieldName).toBe(STORY_CLOCK_SOURCE)
    expect(initializeElapsedRuleBaselines([panel], 0)).toBe(true)
    const suggestions = buildDataPanelAutomationSuggestions([panel], 0, '', 20)
    expect(suggestions).toMatchObject([{ oldValue: '0', newValue: '20' }])
    expect(panel.fields[0].value).toBe('0')
  })

  it('新建数据对象时以当前故事日建立基线，不会补算加入前的历史时间', () => {
    const fields = parseDataPanelAutomationRules(
      '已成长｜经过 1 天 +1（基于：故事时间）',
      [field('已成长', '0', '天')],
    )
    const panel = item(fields)
    expect(initializeElapsedRuleBaselines([panel], 20)).toBe(true)
    expect(buildDataPanelAutomationSuggestions([panel], 3, '', 20)).toHaveLength(0)
    expect(buildDataPanelAutomationSuggestions([panel], 4, '', 25)).toMatchObject([{ oldValue: '0', newValue: '5' }])
  })
})

describe('数据面板历史清理', () => {
  const changes = [
    change('pending-old', 'pending', 0),
    change('accepted-old', 'accepted', 0),
    change('rejected-mid', 'rejected', 4),
    change('accepted-new', 'accepted', 9),
  ]

  it('按最近条数清理时始终保留待确认记录', () => {
    const result = pruneDataPanelChangeHistory(changes, { mode: 'count', value: 1 })
    expect(result.changes.map(item => item.id)).toEqual(['pending-old', 'accepted-new'])
    expect(result.removed).toBe(2)
  })

  it('按最近章节清理已处理记录', () => {
    const result = pruneDataPanelChangeHistory(changes, { mode: 'chapters', value: 6 })
    expect(result.changes.map(item => item.id)).toEqual(['pending-old', 'rejected-mid', 'accepted-new'])
  })

  it('清空已处理记录时不会删除待确认记录', () => {
    const result = pruneDataPanelChangeHistory(changes, { mode: 'all' })
    expect(result.changes.map(item => item.id)).toEqual(['pending-old'])
  })
})

describe('数据面板工作台回归', () => {
  it('空数据可以安全导出 Markdown', () => {
    expect(dataPanelsToMarkdown({ title: '空书', dataPanels: [], dataPanelChanges: [] })).toBe('# 空书 - 数据面板\n')
  })

  it('在大量对象和历史记录中按关键词、最近章节与状态筛选', () => {
    const panels = Array.from({ length: 2_000 }, (_, index): DataPanelItem => ({
      ...item([field('库存', String(index))]),
      id: `item-${index}`,
      name: index === 1_999 ? '目标仓库' : `仓库 ${index}`,
      category: '资源',
      lastMentionChapterIndex: index % 100,
    }))
    const filtered = filterDataPanelItems(panels, { query: '目标', category: '资源', recent: 5, latestChapterIndex: 99 })
    expect(filtered.map(panel => panel.id)).toEqual(['item-1999'])

    const changes = Array.from({ length: 10_000 }, (_, index) => ({
      ...change(`change-${index}`, index % 2 ? 'accepted' : 'pending', index % 100),
      itemId: `item-${index % 2}`,
    }))
    const history = filterDataPanelChanges(changes, { itemId: 'item-1', status: 'accepted' })
    expect(history).toHaveLength(5_000)
    expect(history[0].chapterIndex).toBeGreaterThanOrEqual(history[history.length - 1].chapterIndex)
  })
})
