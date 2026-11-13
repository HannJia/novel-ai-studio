// @vitest-environment node
import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'
const require = createRequire(import.meta.url)
const { createClipboardWriter } = require('../../app-main/clipboard.cjs')

describe('desktop clipboard write boundary', () => {
  it('checks the sender before touching the clipboard and rejects invalid payloads', () => {
    const clipboard = { writeText: vi.fn(), readText: vi.fn() }
    const denied = createClipboardWriter(clipboard, () => { throw new Error('denied') })
    expect(() => denied({}, 'fixed-test-text')).toThrow('denied')
    expect(clipboard.writeText).not.toHaveBeenCalled()
    const write = createClipboardWriter(clipboard, () => {})
    for (const value of [null, {}, 'x'.repeat(1_000_001)]) expect(() => write({}, value)).toThrow('无效')
    expect(clipboard.writeText).not.toHaveBeenCalled()
  })
  it('confirms system readback without exposing clipboard contents to the renderer', () => {
    const clipboard = { writeText: vi.fn(), readText: vi.fn().mockReturnValue('fixed-test-text') }
    const write = createClipboardWriter(clipboard, () => {})
    expect(write({}, 'fixed-test-text')).toBeUndefined()
    expect(clipboard.writeText).toHaveBeenCalledWith('fixed-test-text', 'clipboard')
    clipboard.readText.mockReturnValueOnce('previous-text')
    expect(() => write({}, 'fixed-test-text')).toThrow('系统剪贴板未保存')
  })
})
