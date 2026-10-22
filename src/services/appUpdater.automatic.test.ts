import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import path from 'node:path'

const requireLocal = createRequire(path.resolve('app-main/main.js'))
const { createUpdateController } = requireLocal('./updater.cjs')
const controllers: { dispose(): void }[] = []
const installer = 'AI-Novel-Writer-1.0.3-x64.exe'
function setup(autoCheck?: boolean) {
  const token = { cancel: vi.fn() }
  const manifest = { version: '1.0.3', files: [{ url: installer, size: 300, sha512: Buffer.alloc(64, 1).toString('base64') }] }
  const updater = Object.assign(new EventEmitter(), {
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(async () => ({ updateInfo: manifest, cancellationToken: token })),
    downloadUpdate: vi.fn(async () => undefined), quitAndInstall: vi.fn(),
    autoDownload: true, autoInstallOnAppQuit: true,
  })
  const options = {
    supported: true, currentVersion: '1.0.2', autoCheck,
    fetchLatest: vi.fn(async () => ({ tag_name: 'v1.0.3', body: '更新说明', assets: [
      { name: installer, state: 'uploaded', size: 300 }, { name: 'latest.yml', state: 'uploaded', size: 200 },
    ] })),
    getUpdater: () => updater, publish: vi.fn(), prepareInstall: vi.fn(), allowQuit: vi.fn(),
    savePreference: vi.fn(), openExternal: vi.fn(),
  }
  const controller = createUpdateController(options)
  controllers.push(controller)
  return { controller, updater, options, token, manifest }
}
afterEach(() => { for (const controller of controllers.splice(0)) controller.dispose() })

describe('automatic update downloads', () => {
  it('downloads one verified release by default without installing or preparing to quit', async () => {
    const { controller, updater, options } = setup()
    await Promise.all([controller.check(), controller.check(), controller.check()])
    expect(options.fetchLatest).toHaveBeenCalledOnce()
    expect(updater.checkForUpdates).toHaveBeenCalledOnce()
    expect(updater.downloadUpdate).toHaveBeenCalledOnce()
    expect(updater.autoDownload).toBe(false)
    expect(updater.autoInstallOnAppQuit).toBe(false)
    expect(controller.snapshot()).toMatchObject({ phase: 'downloaded', percent: 100, release: { version: '1.0.3' } })
    expect(options.prepareInstall).not.toHaveBeenCalled()
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('respects the saved opt-out while retaining manual check and download', async () => {
    const { controller, updater } = setup(false)
    await controller.check()
    expect(controller.snapshot().phase).toBe('available')
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
    await controller.download()
    expect(controller.snapshot().phase).toBe('downloaded')
    expect(updater.downloadUpdate).toHaveBeenCalledOnce()
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })

  it.each(['release', 'manifest'])('does not start a download when disabled during the %s request', async stage => {
    const { controller, updater, options, token, manifest } = setup()
    let resume!: () => void
    if (stage === 'release') {
      const data = await options.fetchLatest()
      options.fetchLatest.mockClear()
      options.fetchLatest.mockImplementationOnce(() => new Promise(resolve => { resume = () => resolve(data) }))
    } else {
      updater.checkForUpdates.mockImplementationOnce(() => new Promise(resolve => {
        resume = () => resolve({ updateInfo: manifest, cancellationToken: token })
      }))
    }
    const checking = controller.check()
    await vi.waitFor(() => expect(resume).toBeTypeOf('function'))
    controller.setAutoCheck(false)
    resume()
    await checking
    expect(options.savePreference).toHaveBeenCalledWith(false)
    expect(controller.snapshot()).toMatchObject({ autoCheck: false, phase: 'available' })
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('keeps unverified manifests from starting automatic downloads', async () => {
    const { controller, updater, manifest } = setup()
    manifest.files[0].url = 'https://example.test/untrusted.exe'
    await controller.check()
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
    expect(controller.snapshot()).toMatchObject({ phase: 'available', release: { canDownload: false } })
  })

  it('cancels an automatic download without restarting it or installing', async () => {
    const { controller, updater, token } = setup()
    let rejectDownload!: (error: Error) => void
    updater.downloadUpdate.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectDownload = reject }))
    const checking = controller.check()
    await vi.waitFor(() => expect(updater.downloadUpdate).toHaveBeenCalledOnce())
    controller.cancel()
    rejectDownload(new Error('cancelled'))
    await checking
    await controller.wake()
    expect(token.cancel).toHaveBeenCalledOnce()
    expect(updater.downloadUpdate).toHaveBeenCalledOnce()
    expect(controller.snapshot().phase).toBe('idle')
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('keeps the application running on download failure and permits a fresh verified retry', async () => {
    const { controller, updater } = setup()
    updater.downloadUpdate.mockRejectedValueOnce(new Error('sha512 checksum mismatch'))
    await controller.check()
    expect(controller.snapshot().error).toContain('校验失败')
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    await controller.check()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(2)
    expect(controller.snapshot().phase).toBe('downloaded')
  })
})
