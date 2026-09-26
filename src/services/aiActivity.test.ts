import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COMPLETED_ACTIVITY_TTL_MS,
  acknowledgeAiActivity,
  activeAiCount,
  aiActivityState,
  finishAiActivity,
  openAiActivity,
  startAiActivity,
  useAiActivities,
} from './aiActivity'

const tasks = useAiActivities()

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-25T00:00:00Z'))
})

afterEach(() => {
  for (const activity of tasks.activities.value) acknowledgeAiActivity(activity.id)
  vi.useRealTimers()
})

describe('AI activity sidebar', () => {
  it('keeps a parent visible and running while its background step is active', () => {
    const parent = startAiActivity('完成本章')
    const child = startAiActivity('故事时间线更新', parent.id)
    finishAiActivity(parent)

    expect(aiActivityState(parent)).toBe('running')
    expect(tasks.runningActivities.value.map(item => item.id)).toEqual([parent.id])
    expect(tasks.childrenOf(parent.id).map(item => item.id)).toEqual([child.id])
    vi.advanceTimersByTime(COMPLETED_ACTIVITY_TTL_MS * 2)
    expect(tasks.activities.value.map(item => item.id)).toEqual([parent.id])

    finishAiActivity(child)
    vi.advanceTimersByTime(COMPLETED_ACTIVITY_TTL_MS - 1)
    expect(tasks.activities.value).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(tasks.activities.value).toHaveLength(0)
    expect(activeAiCount.value).toBe(0)
  })

  it('moves running tasks above completed tasks until completed tasks expire', () => {
    const first = startAiActivity('已完成步骤')
    finishAiActivity(first)
    const second = startAiActivity('等待中的步骤')
    expect(tasks.activities.value.map(item => item.id)).toEqual([second.id, first.id])
    expect(tasks.completedActivities.value.map(item => item.id)).toEqual([first.id])

    vi.advanceTimersByTime(COMPLETED_ACTIVITY_TTL_MS)
    expect(tasks.activities.value.map(item => item.id)).toEqual([second.id])
    finishAiActivity(second)
  })

  it('keeps failures visible until dismissed, including a failed child', () => {
    const parent = startAiActivity('完成本章')
    const child = startAiActivity('违禁词审查', parent.id)
    finishAiActivity(child, new Error('请求失败'))
    finishAiActivity(parent)
    expect(aiActivityState(parent)).toBe('failed')
    vi.advanceTimersByTime(COMPLETED_ACTIVITY_TTL_MS * 2)
    expect(tasks.activities.value.map(item => item.id)).toEqual([parent.id])

    openAiActivity(parent)
    expect(tasks.activities.value).toHaveLength(0)
  })

  it('does not dismiss a still-running group when opened', () => {
    const parent = startAiActivity('完成本章')
    const child = startAiActivity('章节结尾', parent.id)
    finishAiActivity(parent)
    openAiActivity(parent)
    expect(tasks.activities.value).toHaveLength(1)
    finishAiActivity(child)
  })
})
