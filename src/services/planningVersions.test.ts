import { describe, expect, it } from 'vitest'
import { appendPlanningVersion, comparePlanningVersions, createPlanningSnapshot } from '@/services/planningVersions'
import type { ChapterPlan } from '@/types/novel'

function plan(): ChapterPlan {
  return {
    id: 'p1', horizon: 'next', title: '潜入旧塔', objective: '取得坐标', summary: '避开守卫进入塔顶', beats: ['观察', '潜入'],
    targetChapterStart: 0, targetChapterEnd: 0, relatedArcIds: [], relatedEventIds: [], status: 'planned', source: 'user',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('planning versions', () => {
  it('keeps bounded snapshots and reports field-level differences', () => {
    const current = plan()
    const version = appendPlanningVersion([], createPlanningSnapshot(current), '编辑前版本', current.createdAt)[0]
    current.objective = '取得坐标并安全撤离'
    current.beats.push('撤离')
    const diff = comparePlanningVersions(version, current)
    expect(diff.map(item => item.field)).toEqual(expect.arrayContaining(['阶段目标', '写作节拍']))
  })

  it('does not append an identical snapshot twice', () => {
    const current = plan()
    const snapshot = createPlanningSnapshot(current)
    const once = appendPlanningVersion([], snapshot, '首次')
    expect(appendPlanningVersion(once, snapshot, '重复')).toBe(once)
  })
})
