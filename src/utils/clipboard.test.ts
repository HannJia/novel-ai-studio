// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText } from './clipboard'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('clipboard destination', () => {
  it('uses the verified desktop channel instead of an isolated browser clipboard', async () => {
    const writeNative = vi.fn().mockResolvedValue(undefined)
    const writeBrowser = vi.fn()
    vi.stubGlobal('window', { electronAPI: { clipboardWriteText: writeNative } })
    vi.stubGlobal('navigator', { clipboard: { writeText: writeBrowser } })
    expect(await copyText('fixed-test-text')).toBe('system')
    expect(writeNative).toHaveBeenCalledExactlyOnceWith('fixed-test-text')
    expect(writeBrowser).not.toHaveBeenCalled()
    writeNative.mockRejectedValueOnce(new Error('unavailable'))
    await expect(copyText('fixed-test-text')).rejects.toThrow('unavailable')
    expect(writeBrowser).not.toHaveBeenCalled()
  })
  it('labels browser writes honestly and surfaces unavailable clipboard errors', async () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
    expect(await copyText('fixed-test-text')).toBe('browser')
    vi.stubGlobal('navigator', {})
    await expect(copyText('fixed-test-text')).rejects.toThrow('剪贴板不可用')
  })

  it('uses the synchronous selection fallback before an embedded browser loses click activation', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', {})
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(() => new Promise<void>(() => {})) } })
    const execCommand = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })

    await expect(copyText('fixed-test-text')).resolves.toBe('browser')
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1500)
  })
})
