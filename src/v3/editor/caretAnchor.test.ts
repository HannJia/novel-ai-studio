import { describe, expect, it } from 'vitest'
import { caretAnchorScrollTop } from './caretAnchor'

describe('caretAnchorScrollTop', () => {
  it('keeps the caret at two thirds of the editor viewport', () => {
    const viewport = { scrollTop: 300, scrollHeight: 1400, clientHeight: 600 }

    expect(caretAnchorScrollTop(viewport, 100, 510)).toBe(310)
  })

  it('clamps the scroll position at the start and end of the document', () => {
    const atStart = { scrollTop: 0, scrollHeight: 1400, clientHeight: 600 }
    const atEnd = { scrollTop: 800, scrollHeight: 1400, clientHeight: 600 }

    expect(caretAnchorScrollTop(atStart, 100, 400)).toBe(0)
    expect(caretAnchorScrollTop(atEnd, 100, 700)).toBe(800)
  })
})
