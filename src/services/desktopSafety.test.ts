import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { Buffer } from 'node:buffer'

const mainPath = path.resolve('app-main/main.js')
const requireLocal = createRequire(mainPath)
const files = requireLocal('./durableFiles.cjs')
const temporary: string[] = []
function temp() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-safety-test-'))
  temporary.push(directory)
  return directory
}
afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of temporary.splice(0)) {
    if (!path.resolve(directory).startsWith(path.join(path.resolve(os.tmpdir()), 'novel-safety-test-'))) throw new Error('Unsafe test cleanup path')
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
describe('desktop file and instance safety', () => {
  it.each(['packaged', 'development', 'smoke'] as const)('preserves the V3 profile before locking in %s mode', mode => {
    const appData = temp()
    const smokeData = path.join(os.tmpdir(), 'ai-novel-writer-smoke-brand-test')
    let userData = path.join(appData, mode === 'packaged' ? 'mobish' : 'ai-novel-writer')
    const setPath = vi.fn((name: string, value: string) => {
      expect(name).toBe('userData')
      userData = value
    })
    const lock = vi.fn(() => {
      expect(userData).toBe(mode === 'smoke' ? smokeData
        : path.join(appData, mode === 'packaged' ? 'AI Novel Writer' : 'ai-novel-writer'))
      return true
    })
    const source = fs.readFileSync(mainPath, 'utf8')
    vm.runInNewContext(source.slice(0, source.indexOf('// 判断是否为开发模式')), {
      require: (name: string) => name === 'electron' ? {
        app: { isPackaged: mode !== 'development', getPath: () => appData, setPath,
          requestSingleInstanceLock: lock, commandLine: { appendSwitch: vi.fn() } },
        nativeImage: { createFromDataURL: () => ({}) },
      } : requireLocal(name),
      process: { env: mode === 'smoke'
        ? { AI_NOVEL_WRITER_SMOKE_TEST: '1', AI_NOVEL_WRITER_SMOKE_USER_DATA: smokeData } : {} },
      Buffer,
    })
    expect(lock).toHaveBeenCalledOnce()
    expect(setPath).toHaveBeenCalledTimes(mode === 'development' ? 0 : 1)
  })
  it('retains original data if Windows rejects the final replacement', () => {
    const directory = temp()
    const target = path.join(directory, 'book.db')
    fs.writeFileSync(target, 'original')
    const rename = fs.renameSync
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(from) === `${target}.tmp` && String(to) === target) throw new Error('模拟 Windows 文件占用')
      return rename(from, to)
    })
    expect(() => files.writeAtomicFile(target, 'new')).toThrow('文件占用')
    expect(fs.readFileSync(target, 'utf8')).toBe('original')
  })
  it('creates separate recovery copies without changing the original or backup', () => {
    const directory = temp()
    const target = path.join(directory, 'book.db')
    fs.writeFileSync(target, 'broken')
    fs.writeFileSync(`${target}.bak`, 'valid')
    files.preserveRecoveryFiles(target)
    expect(fs.readFileSync(target, 'utf8')).toBe('broken')
    expect(fs.readFileSync(`${target}.bak`, 'utf8')).toBe('valid')
    expect(fs.readdirSync(directory).filter(file => file.includes('.recovery-'))).toHaveLength(2)
  })
  it.each([true, false])('uses a single-instance lock (%s) and restores the existing window', async locked => {
    const events = new Map<string, (...args: unknown[]) => void>()
    const handlers = new Map<string, (event: unknown, request: unknown) => Promise<any>>()
    const userData = temp()
    const ready = Promise.resolve()
    const app = { requestSingleInstanceLock: vi.fn(() => locked), quit: vi.fn(), isPackaged: false,
      getPath: () => userData,
      whenReady: () => ready, on: (event: string, callback: (...args: unknown[]) => void) => events.set(event, callback) }
    const nativeImage = { createFromDataURL: vi.fn(() => ({})) }
    const restore = vi.fn()
    const focus = vi.fn()
    const Window = vi.fn(function () { return { on: vi.fn(), loadURL: vi.fn(), isDestroyed: () => false, isMinimized: () => true,
      restore, show: vi.fn(), focus, webContents: { mainFrame: { url: 'http://localhost:5173/' }, openDevTools: vi.fn(), setWindowOpenHandler: vi.fn(), on: vi.fn() } } })
    Object.assign(Window, { getAllWindows: () => [] })
    const powerMonitor = { on: vi.fn() }
    vm.runInNewContext(fs.readFileSync(mainPath, 'utf8'), {
      require: (name: string) => name === 'electron' ? { app, BrowserWindow: Window, powerMonitor, nativeImage,
        ipcMain: { handle: (name: string, fn: (event: unknown, request: unknown) => Promise<any>) => handlers.set(name, fn), on: vi.fn() } } : requireLocal(name),
      process: { env: {}, platform: 'win32' }, __dirname: path.dirname(mainPath), Buffer, console, setTimeout, clearTimeout, URL,
    })
    await ready
    expect(Window).toHaveBeenCalledTimes(locked ? 1 : 0)
    if (locked) {
      expect(powerMonitor.on).toHaveBeenCalledWith('resume', expect.any(Function))
      events.get('second-instance')?.()
      expect(restore).toHaveBeenCalledOnce()
      expect(focus).toHaveBeenCalledOnce()
      const projectRequest = handlers.get('project:request')!
      const sender = Window.mock.results[0].value.webContents
      for (const event of [{ sender: {}, senderFrame: sender.mainFrame },
        { sender, senderFrame: { url: sender.mainFrame.url } }]) {
        expect(await projectRequest(event, { method: 'read' })).toMatchObject({ ok: false })
      }
      sender.mainFrame.url = 'https://untrusted.example/'
      expect(await projectRequest({ sender, senderFrame: sender.mainFrame }, { method: 'read' })).toMatchObject({ ok: false })
      expect(fs.existsSync(path.join(userData, 'projects-v3'))).toBe(false)
      sender.mainFrame.url = 'http://localhost:5173/'
      expect(await projectRequest({ sender, senderFrame: sender.mainFrame }, { method: 'read' })).toMatchObject({ ok: true, value: { backup: null } })
    } else expect(app.quit).toHaveBeenCalledOnce()
  })
  it('allows only the explicit local vector port without enabling unsafe script evaluation', () => {
    const html = fs.readFileSync(path.resolve('index.html'), 'utf8')
    expect(html).toContain('http://127.0.0.1:11434')
    expect(html).toContain('http://localhost:11434')
    expect(html).not.toContain("'unsafe-eval'")
    expect(html).not.toMatch(/connect-src[^;]*\shttp:(?:\s|;)/)
  })
})
