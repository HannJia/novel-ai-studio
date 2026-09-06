import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import vm from 'node:vm'
import { createRequire } from 'node:module'

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
    const ready = Promise.resolve()
    const app = { requestSingleInstanceLock: vi.fn(() => locked), quit: vi.fn(), isPackaged: false,
      whenReady: () => ready, on: (event: string, callback: (...args: unknown[]) => void) => events.set(event, callback) }
    const restore = vi.fn()
    const focus = vi.fn()
    const Window = vi.fn(function () { return { on: vi.fn(), loadURL: vi.fn(), isDestroyed: () => false, isMinimized: () => true,
      restore, show: vi.fn(), focus, webContents: { openDevTools: vi.fn(), setWindowOpenHandler: vi.fn(), on: vi.fn() } } })
    Object.assign(Window, { getAllWindows: () => [] })
    vm.runInNewContext(fs.readFileSync(mainPath, 'utf8'), {
      require: (name: string) => name === 'electron' ? { app, BrowserWindow: Window, ipcMain: { handle: vi.fn(), on: vi.fn() } } : requireLocal(name),
      process: { env: {}, platform: 'win32' }, __dirname: path.dirname(mainPath), console, setTimeout, clearTimeout, URL,
    })
    await ready
    expect(Window).toHaveBeenCalledTimes(locked ? 1 : 0)
    if (locked) {
      events.get('second-instance')?.()
      expect(restore).toHaveBeenCalledOnce()
      expect(focus).toHaveBeenCalledOnce()
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
