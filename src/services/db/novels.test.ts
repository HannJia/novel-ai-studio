import { describe, expect, it } from 'vitest'
import { eventCategoryToType, eventTypeToCategory } from './novels'

describe('事件类型映射', () => {
  it('将中文事件类型转换为数据库分类', () => {
    expect(eventTypeToCategory('伏笔')).toBe('foreshadowing')
    expect(eventTypeToCategory('主线')).toBe('main_plot')
  })

  it('将数据库分类转换回中文事件类型', () => {
    expect(eventCategoryToType('foreshadowing')).toBe('伏笔')
    expect(eventCategoryToType('turning_point')).toBe('转折')
  })

  it('未知分类回退为其他', () => {
    expect(eventCategoryToType('unknown')).toBe('其他')
    expect(eventTypeToCategory(undefined)).toBe('other')
  })
})
