// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import ChapterDataPanelSidebar from './ChapterDataPanelSidebar.vue'
import type { DataPanelChange } from '@/types/novel'

function changes(count: number): DataPanelChange[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `change-${index}`,
    itemId: 'panel-1',
    fieldId: 'field-1',
    itemName: '灵石库存',
    fieldName: '数量',
    oldValue: String(index),
    newValue: String(index + 1),
    reason: `第 ${index + 1} 章原文`,
    confidence: 'clear',
    chapterIndex: index,
    status: 'accepted',
    createdAt: '2026-01-01T00:00:00.000Z',
  }))
}

function props(history: DataPanelChange[] = []) {
  return {
    open: true,
    items: [],
    pendingChanges: [],
    filteredHistory: history,
    historyCount: history.length,
    selectedItemIds: new Set<string>(),
    selectedChangeIds: new Set<string>(),
    selectedChangeCount: 0,
    allPendingSelected: false,
    drafts: {},
    hasContent: false,
    scanning: false,
    historyChapter: 'all',
    historyItem: 'all',
    historyStatus: 'all',
    historyKeepCount: 100,
    historyKeepChapters: 20,
    historyChapterOptions: [{ label: '全部章节', value: 'all' }],
    historyItemOptions: [{ label: '全部对象', value: 'all' }],
    historyStatusOptions: [{ label: '全部状态', value: 'all' }],
  }
}

describe('ChapterDataPanelSidebar', () => {
  it('没有数据对象时显示明确空状态', () => {
    const wrapper = shallowMount(ChapterDataPanelSidebar, { props: props() })
    expect(wrapper.text()).toContain('暂无数据')
  })

  it('大量历史记录只渲染首批 100 条，避免侧栏 DOM 持续膨胀', () => {
    const wrapper = shallowMount(ChapterDataPanelSidebar, { props: props(changes(150)) })
    expect(wrapper.findAll('.data-history-row')).toHaveLength(100)
    expect(wrapper.text()).toContain('变更历史（150）')
  })
})
