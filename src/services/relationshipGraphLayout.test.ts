import { describe, expect, it } from 'vitest'
import { boxesOverlap, fitGraphText, placeGraphLabel, type GraphBox } from './relationshipGraphLayout'

describe('relationship graph label placement', () => {
  it('keeps measured captions inside their space, including non-BMP names', () => {
    const measure = (text: string) => Array.from(text).length * 12
    expect(fitGraphText('好友', 72, measure)).toBe('好友')
    expect(fitGraphText('𠮷某某的长期合作伙伴', 72, measure)).toBe('𠮷某某的长…')
  })
  it('avoids portraits, captions and previously placed labels', () => {
    const occupied: GraphBox[] = [{ x: 175, y: 180, width: 95, height: 140 }]
    for (let index = 0; index < 6; index++) {
      const label = placeGraphLabel({ x: 100, y: 240 }, { x: 500, y: 240 }, 110, occupied, { x: 700, y: 600 })
      if (!label) break
      expect(occupied.some(box => boxesOverlap(label, box))).toBe(false)
      expect(label.x).toBeGreaterThanOrEqual(8)
      expect(label.x + label.width).toBeLessThanOrEqual(692)
      occupied.push(label)
    }
    expect(occupied.length).toBeGreaterThan(1)
  })
  it('omits crowded edge captions instead of overprinting them', () => {
    expect(placeGraphLabel({ x: 100, y: 100 }, { x: 300, y: 100 }, 100,
      [{ x: 0, y: 0, width: 600, height: 600 }], { x: 600, y: 600 })).toBeUndefined()
  })
})
