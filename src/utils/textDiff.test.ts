import { describe, expect, it } from 'vitest'
import { createTextDiff } from './textDiff'

describe('createTextDiff', () => {
  it('keeps context and reports changed lines', () => {
    const result = createTextDiff('a\nb\nc', 'a\nchanged\nc')
    expect(result.addedLines).toBe(1)
    expect(result.removedLines).toBe(1)
    expect(result.diff).toContain('-b')
    expect(result.diff).toContain('+changed')
  })

  it('handles a new document', () => {
    const result = createTextDiff('', 'new')
    expect(result.addedLines).toBe(1)
    expect(result.removedLines).toBe(0)
  })
})
