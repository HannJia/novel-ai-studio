// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import WritingHeatmap from './WritingHeatmap.vue'

describe('V3 writing heatmap', () => {
  afterEach(() => vi.useRealTimers())

  it('renders the current month with faded adjacent dates and preserved weekday alignment', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-08T12:00:00'))
    const wrapper = mount(WritingHeatmap, { props: { month: true } })

    const days = wrapper.findAll('.month-day:not(.adjacent)')
    expect(days).toHaveLength(30)
    expect(days.map(day => day.text())).toEqual(Array.from({ length: 30 }, (_, index) => String(index + 1)))
    const adjacent = wrapper.findAll('.month-day.adjacent')
    expect(adjacent).toHaveLength(12)
    expect(adjacent.map(day => day.text())).toEqual(['26', '27', '28', '29', '30', '31', '1', '2', '3', '4', '5', '6'])
    expect(adjacent.every(day => day.attributes('aria-hidden') === 'true')).toBe(true)
    expect(adjacent.every(day => !day.attributes('aria-label') && !day.attributes('title'))).toBe(true)
    expect(adjacent.every(day => !/[.]?l[0-4](?:\s|$)/.test(day.attributes('class') || ''))).toBe(true)
    expect(days.every(day => day.attributes('aria-label')?.startsWith('11月'))).toBe(true)
    wrapper.unmount()
  })
})
