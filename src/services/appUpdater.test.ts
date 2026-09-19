import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import path from 'node:path'

const requireLocal = createRequire(path.resolve('app-main/main.js'))
const { createUpdateController, parseRelease, validateManifest } = requireLocal('./updater.cjs')
const { createUpdateHandshake } = requireLocal('./updateHandshake.cjs')
const installer = 'AI-Novel-Writer-1.0.3-x64.exe'
function release() {
  return { tag_name: 'v1.0.3', body: '# 修复问题', published_at: '2026-09-13T08:00:00Z',
    assets: [{ name: installer, state: 'uploaded', size: 300 }, { name: 'latest.yml', state: 'uploaded', size: 200 }] }
}
const manifest = () => ({ version: '1.0.3', files: [{ url: installer, size: 300, sha512: Buffer.alloc(64, 1).toString('base64') }] })
function setup(extra: Record<string, unknown> = {}) {
  const token = { cancel: vi.fn() }
  const updater = Object.assign(new EventEmitter(), {
    setFeedURL: vi.fn(), checkForUpdates: vi.fn(async () => ({ updateInfo: manifest(), cancellationToken: token })),
    downloadUpdate: vi.fn(async () => undefined), quitAndInstall: vi.fn(), autoDownload: true,
    autoInstallOnAppQuit: true, allowDowngrade: true, allowPrerelease: true,
  })
  const options = {
    supported: true, currentVersion: '1.0.2', fetchLatest: vi.fn(async () => release()), getUpdater: vi.fn(() => updater),
    publish: vi.fn(), prepareInstall: vi.fn(async () => undefined), allowQuit: vi.fn(), savePreference: vi.fn(),
    openExternal: vi.fn(), ...extra,
  }
  return { controller: createUpdateController(options), options, updater, token }
}
afterEach(() => vi.useRealTimers())

describe('GitHub release validation', () => {
  it('uses semantic versions and ignores equal or older releases', () => {
    expect(parseRelease({ ...release(), tag_name: 'v1.0.10' }, '1.0.2').version).toBe('1.0.10')
    expect(parseRelease(release(), '1.0.3')).toBeNull()
    expect(parseRelease(release(), '2.0.0')).toBeNull()
  })
  it.each(['1.01', 'latest', 'v1.0.4-beta.1', '../../payload', 'https://example.test/a'])('rejects non-release tag %s', tag_name => {
    expect(() => parseRelease({ ...release(), tag_name }, '1.0.2')).toThrow()
  })
  it('rejects drafts and prereleases and derives trusted URLs instead of trusting API URLs', () => {
    expect(() => parseRelease({ ...release(), draft: true }, '1.0.2')).toThrow()
    expect(() => parseRelease({ ...release(), prerelease: true }, '1.0.2')).toThrow()
    expect(parseRelease({ ...release(), html_url: 'https://example.test' }, '1.0.2').url)
      .toBe('https://github.com/HannJia/novel-ai-studio/releases/tag/v1.0.3')
  })
  it('does not offer automatic downloads without both metadata and a matching installer', () => {
    expect(parseRelease({ ...release(), assets: release().assets.slice(0, 1) }, '1.0.2').canDownload).toBe(false)
    expect(parseRelease(release(), '1.0.2', 'arm64').canDownload).toBe(false)
  })
  it('pins the manifest version, payload name and checksum, excluding web installers and external URLs', () => {
    const info = parseRelease(release(), '1.0.2')
    expect(() => validateManifest(manifest(), info)).not.toThrow()
    for (const invalid of [
      { ...manifest(), version: '1.0.4' },
      { ...manifest(), packages: { x64: { path: 'https://example.test/payload' } } },
      { ...manifest(), files: [] },
      { ...manifest(), files: [{ ...manifest().files[0], url: 'https://example.test/payload.exe' }] },
      { ...manifest(), files: [{ ...manifest().files[0], url: '../payload.exe' }] },
      { ...manifest(), files: [{ ...manifest().files[0], sha512: '' }] },
    ]) expect(() => validateManifest(invalid, info)).toThrow()
  })
})

describe('desktop update lifecycle', () => {
  it('retries failed startup checks after a minute and stops retrying when disabled', async () => {
    vi.useFakeTimers()
    const { controller, options } = setup()
    options.fetchLatest.mockRejectedValueOnce(new Error('fetch failed'))
    controller.start()
    await vi.advanceTimersByTimeAsync(12000)
    expect(controller.snapshot().phase).toBe('error')
    await vi.advanceTimersByTimeAsync(60000)
    expect(options.fetchLatest).toHaveBeenCalledTimes(2)
    expect(controller.snapshot().phase).toBe('available')
    options.fetchLatest.mockRejectedValueOnce(new Error('fetch failed'))
    await controller.check()
    controller.setAutoCheck(false)
    await vi.advanceTimersByTimeAsync(3600000)
    expect(options.fetchLatest).toHaveBeenCalledTimes(3)
    controller.dispose()
  })
  it('keeps the new-version notice if manifest verification fails without allowing unverified downloads', async () => {
    vi.useFakeTimers()
    const { controller, updater } = setup()
    updater.checkForUpdates.mockRejectedValueOnce(new Error('net::ERR_TIMED_OUT'))
    await controller.check()
    expect(controller.snapshot()).toMatchObject({ phase: 'available', release: { version: '1.0.3', canDownload: false } })
    expect(controller.snapshot().error).not.toBe('')
    await controller.download()
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(60000)
    expect(controller.snapshot().release.canDownload).toBe(true)
    controller.dispose()
  })
  it('refreshes stale checks after wake, throttles repeated wake events and respects opt-out', async () => {
    vi.useFakeTimers()
    const { controller, options } = setup({ currentVersion: '1.0.3' })
    await controller.check()
    await controller.wake()
    expect(options.fetchLatest).toHaveBeenCalledOnce()
    vi.setSystemTime(Date.now() + 6 * 60 * 60 * 1000)
    await controller.wake()
    expect(options.fetchLatest).toHaveBeenCalledTimes(2)
    controller.setAutoCheck(false)
    vi.setSystemTime(Date.now() + 7 * 60 * 60 * 1000)
    await controller.wake()
    expect(options.fetchLatest).toHaveBeenCalledTimes(2)
    controller.dispose()
  })
  it('never checks or downloads in development and browser-like environments', async () => {
    const { controller, options } = setup({ supported: false })
    controller.start()
    await controller.check()
    await controller.download()
    await controller.install()
    expect(options.fetchLatest).not.toHaveBeenCalled()
    expect(options.getUpdater).not.toHaveBeenCalled()
    expect(controller.snapshot().phase).toBe('unsupported')
    controller.dispose()
  })
  it('checks at startup and respects a persisted automatic-check preference', async () => {
    vi.useFakeTimers()
    const { controller, options } = setup()
    controller.start()
    await vi.advanceTimersByTimeAsync(11999)
    expect(options.fetchLatest).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(options.fetchLatest).toHaveBeenCalledOnce()
    controller.setAutoCheck(false)
    expect(options.savePreference).toHaveBeenCalledWith(false)
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000)
    expect(options.fetchLatest).toHaveBeenCalledOnce()
    await controller.check()
    expect(options.fetchLatest).toHaveBeenCalledTimes(2)
    expect(() => controller.setAutoCheck('yes')).toThrow()
    controller.dispose()
  })
  it('coalesces repeated checks and does not download without an explicit command', async () => {
    const { controller, updater, options } = setup()
    await Promise.all([controller.check(), controller.check(), controller.check()])
    expect(options.fetchLatest).toHaveBeenCalledOnce()
    expect(updater.checkForUpdates).toHaveBeenCalledOnce()
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
    expect(updater.autoDownload).toBe(false)
    expect(updater.autoInstallOnAppQuit).toBe(false)
    expect(updater.allowDowngrade).toBe(false)
    expect(updater.allowPrerelease).toBe(false)
    expect(updater.setFeedURL.mock.calls[0][0].url).toBe('https://github.com/HannJia/novel-ai-studio/releases/download/v1.0.3/')
    expect(controller.snapshot().phase).toBe('available')
  })
  it('can show old releases without updater metadata as already current', async () => {
    const { controller, options } = setup({ currentVersion: '1.0.3', fetchLatest: vi.fn(async () => ({ ...release(), assets: [] })) })
    await controller.check()
    expect(controller.snapshot().phase).toBe('current')
    expect(options.getUpdater).not.toHaveBeenCalled()
  })
  it('offers a manual release page when files are incomplete', async () => {
    const { controller, options, updater } = setup({ fetchLatest: async () => ({ ...release(), assets: [] }) })
    await controller.check()
    expect(controller.snapshot().phase).toBe('available')
    expect(controller.snapshot().release.canDownload).toBe(false)
    await controller.download()
    controller.openRelease()
    expect(options.openExternal).toHaveBeenCalledWith('https://github.com/HannJia/novel-ai-studio/releases/tag/v1.0.3')
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
  })
  it('requires confirmation, successful download and save before installation', async () => {
    const { controller, updater, options } = setup()
    await controller.install()
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    await controller.check()
    await controller.download()
    expect(controller.snapshot().phase).toBe('downloaded')
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    expect(options.prepareInstall).not.toHaveBeenCalled()
    await Promise.all([controller.install(), controller.install()])
    expect(options.prepareInstall).toHaveBeenCalledOnce()
    expect(options.allowQuit).toHaveBeenCalledWith(true)
    expect(updater.quitAndInstall).toHaveBeenCalledExactlyOnceWith(false, true)
  })
  it('keeps a downloaded update after saving fails and allows retry without another download', async () => {
    const { controller, updater, options } = setup()
    await controller.check()
    await controller.download()
    options.prepareInstall.mockRejectedValueOnce(new Error('正文尚未保存'))
    await controller.install()
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    expect(controller.snapshot()).toMatchObject({ phase: 'downloaded', error: '正文尚未保存' })
    await controller.install()
    expect(updater.downloadUpdate).toHaveBeenCalledOnce()
    expect(updater.quitAndInstall).toHaveBeenCalledOnce()
  })
  it('reports progress, cancels without installing, and requires a fresh check to retry', async () => {
    const { controller, updater, token } = setup()
    await controller.check()
    let rejectDownload!: (error: Error) => void
    updater.downloadUpdate.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectDownload = reject }))
    const download = controller.download()
    await Promise.resolve()
    updater.emit('download-progress', { percent: 41, transferred: 41, total: 100, bytesPerSecond: 25 })
    expect(controller.snapshot().percent).toBe(41)
    controller.cancel()
    expect(token.cancel).toHaveBeenCalledOnce()
    rejectDownload(new Error('cancelled'))
    await download
    expect(controller.snapshot().phase).toBe('idle')
    await controller.install()
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    await controller.check()
    await controller.download()
    expect(controller.snapshot().phase).toBe('downloaded')
  })
  it('leaves the app running on failed checks, downloads, and installer errors', async () => {
    const { controller, updater, options } = setup()
    options.fetchLatest.mockRejectedValueOnce(new Error('fetch failed'))
    await controller.check()
    expect(controller.snapshot().phase).toBe('error')
    await controller.check()
    updater.downloadUpdate.mockRejectedValueOnce(new Error('sha512 checksum mismatch'))
    await controller.download()
    expect(controller.snapshot().error).toContain('校验失败')
    await controller.install()
    expect(options.prepareInstall).not.toHaveBeenCalled()
    await controller.check()
    await controller.download()
    await controller.install()
    updater.emit('error', new Error('installer failed'))
    expect(controller.snapshot().phase).toBe('downloaded')
    expect(options.allowQuit).toHaveBeenLastCalledWith(false)
  })
})

describe('update save handshake', () => {
  it('ignores stale replies and permits only the matching save acknowledgement', async () => {
    const send = vi.fn()
    const handshake = createUpdateHandshake(send)
    const pending = handshake.request()
    const requestId = send.mock.calls[0][0]
    handshake.respond({ requestId: 'old', ok: true })
    expect(handshake.busy).toBe(true)
    await expect(handshake.request()).rejects.toThrow('正在保存')
    handshake.respond({ requestId, ok: true })
    await pending
    expect(handshake.busy).toBe(false)
  })
  it('fails closed on save failure and timeout', async () => {
    vi.useFakeTimers()
    const send = vi.fn()
    const handshake = createUpdateHandshake(send, 100)
    const rejected = expect(handshake.request()).rejects.toThrow('保存失败')
    handshake.respond({ requestId: send.mock.calls[0][0], ok: false, error: '保存失败' })
    await rejected
    const timeout = expect(handshake.request()).rejects.toThrow('超时')
    await vi.advanceTimersByTimeAsync(100)
    await timeout
    expect(handshake.busy).toBe(false)
  })
})
