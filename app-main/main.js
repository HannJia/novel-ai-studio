// Electron 主进程 - CommonJS 格式
const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell, net, powerMonitor } = require('electron')
const path = require('path')
const fs = require('fs')
const { fileURLToPath } = require('url')
const { writeAtomicFile, preserveRecoveryFiles } = require('./durableFiles.cjs')
const { createUpdateController, LATEST_API } = require('./updater.cjs')
const { createUpdateHandshake } = require('./updateHandshake.cjs')
const { createCloudSessionStorage } = require('./cloudSession.cjs')

// 开发模式下的 Vite 服务器地址
const VITE_DEV_SERVER_URL = 'http://localhost:5173'
const isSmokeTest = process.env.AI_NOVEL_WRITER_SMOKE_TEST === '1'

if (isSmokeTest && process.env.AI_NOVEL_WRITER_SMOKE_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.AI_NOVEL_WRITER_SMOKE_USER_DATA))
}
const hasInstanceLock = app.requestSingleInstanceLock()
if (!hasInstanceLock) app.quit()

// 判断是否为开发模式
const isDev = !app.isPackaged

let mainWindow = null
let closeHandshakeInFlight = false
let closeHandshakeComplete = false
let closeHandshakeTimer = null
let recoveryPrepared = false
let updates = null
const updateHandshake = createUpdateHandshake(requestId => {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
    throw new Error('主窗口不可用，未执行更新。')
  }
  mainWindow.webContents.send('app:before-update', { requestId })
})

function getUpdates() {
  if (updates) return updates
  const supported = app.isPackaged && process.platform === 'win32' && !isSmokeTest
  const preferencePath = supported ? path.join(app.getPath('userData'), 'novel-writer-update.json') : ''
  let autoCheck = true
  if (preferencePath) {
    try { autoCheck = JSON.parse(fs.readFileSync(preferencePath, 'utf8')).autoCheck !== false } catch { /* Default on first launch. */ }
  }
  updates = createUpdateController({
    supported, autoCheck, currentVersion: app.getVersion(), arch: process.arch,
    getUpdater: () => require('electron-updater').autoUpdater,
    fetchLatest: async () => {
      const response = await net.fetch(LATEST_API, {
        headers: { Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(15000),
      })
      if (response.status === 403 || response.status === 429) throw new Error('GitHub 暂时限制了检查频率，请稍后重试。')
      if (!response.ok) throw new Error(`更新服务暂不可用（${response.status}），请稍后重试。`)
      const body = await response.text()
      if (body.length > 1024 * 1024) throw new Error('更新服务返回的数据过大。')
      return JSON.parse(body)
    },
    publish: state => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('update:state', state)
      }
    },
    prepareInstall: () => {
      if (closeHandshakeInFlight) throw new Error('关闭前保存正在进行，请稍后重试。')
      return updateHandshake.request()
    },
    allowQuit: value => { closeHandshakeComplete = value },
    savePreference: value => {
      if (!preferencePath) return
      ensureUserDataDir()
      writeAtomicFile(preferencePath, JSON.stringify({ autoCheck: value }))
    },
    openExternal: url => shell.openExternal(url),
  })
  return updates
}

app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

function isMainWindowSender(event) {
  return !!mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents
}

function assertMainWindowSender(event) {
  if (!isMainWindowSender(event)) throw new Error('拒绝来自非主窗口的 IPC 请求')
}

function isTrustedRendererUrl(rawUrl) {
  try {
    const url = new URL(rawUrl)
    if (isDev) return url.origin === new URL(VITE_DEV_SERVER_URL).origin
    if (url.protocol !== 'file:') return false
    return path.resolve(fileURLToPath(url)) === path.resolve(__dirname, '../dist/index.html')
  } catch {
    return false
  }
}

function clearCloseHandshakeTimer() {
  if (!closeHandshakeTimer) return
  clearTimeout(closeHandshakeTimer)
  closeHandshakeTimer = null
}

async function finishCloseHandshake({ event, ok, error = '' }) {
  if (!isMainWindowSender(event)) return
  clearCloseHandshakeTimer()
  closeHandshakeInFlight = false

  if (ok) {
    closeHandshakeComplete = true
    mainWindow.close()
    return
  }

  const choice = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: '保存未完成',
    message: '关闭前保存未完成。是否仍然退出？',
    detail: error || '请取消退出并重试保存。',
    buttons: ['取消', '仍然退出'],
    defaultId: 0,
    cancelId: 0,
  })
  if (choice.response === 1) {
    closeHandshakeComplete = true
    mainWindow.close()
  }
}

function createWindow() {
  closeHandshakeInFlight = false
  closeHandshakeComplete = false
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    title: 'AI 长篇小说写作软件',
    autoHideMenuBar: true,
    show: !isSmokeTest,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  mainWindow.on('close', (event) => {
    if (closeHandshakeComplete || mainWindow.webContents.isDestroyed()) return
    event.preventDefault()
    if (updateHandshake.busy || updates?.snapshot().phase === 'installing') return
    if (closeHandshakeInFlight) return
    closeHandshakeInFlight = true
    mainWindow.webContents.send('app:before-close')
    closeHandshakeTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      void finishCloseHandshake({
        event: { sender: mainWindow.webContents },
        ok: false,
        error: '保存响应超时。',
      })
    }, 30_000)
  })
  mainWindow.webContents.on('did-finish-load', () => getUpdates().start())
  mainWindow.on('focus', () => { void updates?.wake() })

  if (isDev) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
    if (!isSmokeTest) mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  if (isSmokeTest) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        const result = await mainWindow.webContents.executeJavaScript(`(async () => {
          await new Promise(resolve => setTimeout(resolve, 300));
          const cloudEmpty = await window.electronAPI.cloudSessionRead();
          const testSession = { endpoint: 'https://154.94.227.164', token: 'smoke-session-token-not-a-real-account-1234567890',
            expiresAt: Date.now() + 60000, user: { id: 'smoke', username: 'smoke', role: 'user', quotaBytes: 1, usedBytes: 0 } };
          await window.electronAPI.cloudSessionWrite(testSession);
          const cloudRestored = await window.electronAPI.cloudSessionRead();
          await window.electronAPI.cloudSessionWrite(null);
          const cloudHealth = ${process.env.AI_NOVEL_WRITER_SMOKE_CLOUD === '1'
            ? "(await (await fetch('https://154.94.227.164/v1/health', { headers: { Authorization: 'Bearer smoke-no-account' }, signal: AbortSignal.timeout(15000) })).json()).protocol === 1"
            : 'null'};
          return {
            rendered: Boolean(document.querySelector('#app')?.children.length),
            bridgeAvailable: typeof window.electronAPI?.configSecurityStatus === 'function',
            nodeIsolated: typeof window.require === 'undefined' && typeof window.process === 'undefined',
            security: await window.electronAPI?.configSecurityStatus?.(),
            update: await window.electronAPI?.updateGetState?.(),
            cloudSession: cloudEmpty === null && cloudRestored?.token === testSession.token
              && await window.electronAPI.cloudSessionRead() === null,
            cloudHealth,
          };
        })()`)
        result.appVersion = app.getVersion()
        console.log(`ELECTRON_SMOKE_RESULT ${JSON.stringify(result)}`)
        app.exit(result.rendered && result.bridgeAvailable && result.nodeIsolated && result.update?.currentVersion === app.getVersion() ? 0 : 1)
      } catch (error) {
        console.error('ELECTRON_SMOKE_ERROR', error)
        app.exit(1)
      }
    })
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault()
  })
}

function ensureUserDataDir() {
  fs.mkdirSync(app.getPath('userData'), { recursive: true })
}

// 数据库文件存储路径
function getDbPath() {
  return path.join(app.getPath('userData'), 'novel-writer.db')
}

function getConfigPath() {
  return path.join(app.getPath('userData'), 'novel-writer-config.json')
}

function hasValidSqliteHeader(data) {
  return data.length >= 16 && data.subarray(0, 16).toString('utf8') === 'SQLite format 3\u0000'
}

// IPC: 读取数据库文件
ipcMain.handle('db:read', async (event) => {
  assertMainWindowSender(event)
  const dbPath = getDbPath()
  const backupPath = `${dbPath}.bak`
  if (fs.existsSync(dbPath)) return fs.readFileSync(dbPath)
  if (fs.existsSync(backupPath)) throw new Error('主数据库缺失，请在恢复界面选择备份')
  return null
})

ipcMain.handle('db:readBackup', async (event) => {
  assertMainWindowSender(event)
  const backup = `${getDbPath()}.bak`
  return fs.existsSync(backup) ? fs.readFileSync(backup) : null
})

ipcMain.handle('db:prepareRecovery', async (event) => {
  assertMainWindowSender(event)
  ensureUserDataDir()
  preserveRecoveryFiles(getDbPath())
  recoveryPrepared = true
})

ipcMain.handle('db:retainProjectBackup', async (event, serialized) => {
  assertMainWindowSender(event)
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') > 256 * 1024 * 1024) throw new Error('恢复点超过 256 MB 上限')
  const parsed = JSON.parse(serialized)
  if (parsed?.format !== 'ai-novel-writer-backup' || !Array.isArray(parsed.novels) || !Array.isArray(parsed.knowledgeBases)) throw new Error('恢复点格式无效')
  ensureUserDataDir()
  writeAtomicFile(path.join(app.getPath('userData'), 'novel-writer-before-import.json'), serialized)
})

// IPC: 写入数据库文件
ipcMain.handle('db:write', async (event, data) => {
  assertMainWindowSender(event)
  ensureUserDataDir()
  if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data) && !Buffer.isBuffer(data)) {
    throw new TypeError('db:write expects binary database data')
  }
  const bytes = Buffer.isBuffer(data)
    ? data
    : data instanceof ArrayBuffer
      ? Buffer.from(data)
      : Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  if (bytes.byteLength > 512 * 1024 * 1024) throw new RangeError('数据库文件超过 512 MB 安全上限')
  const dbPath = getDbPath()
  const backupPath = `${dbPath}.bak`
  if (!hasValidSqliteHeader(bytes)) {
    throw new TypeError('db:write received an invalid SQLite database')
  }
  writeAtomicFile(dbPath, bytes, recoveryPrepared ? '' : backupPath)
  recoveryPrepared = false
})

// IPC: 获取数据库文件路径（供调试/备份用）
ipcMain.handle('db:getPath', async (event) => {
  assertMainWindowSender(event)
  return getDbPath()
})

// IPC: 读取模型配置
ipcMain.handle('config:read', async (event) => {
  assertMainWindowSender(event)
  const configPath = getConfigPath()
  if (!fs.existsSync(configPath)) return null
  return fs.readFileSync(configPath, 'utf-8')
})

// IPC: 写入模型配置
ipcMain.handle('config:write', async (event, data) => {
  assertMainWindowSender(event)
  ensureUserDataDir()
  if (typeof data !== 'string') throw new TypeError('config:write expects a string')
  if (Buffer.byteLength(data, 'utf8') > 2 * 1024 * 1024) throw new RangeError('配置文件超过 2 MB 安全上限')
  let parsed
  try {
    parsed = JSON.parse(data)
  } catch {
    throw new TypeError('config:write expects valid JSON')
  }
  const keys = [
    ...(Array.isArray(parsed?.models) ? parsed.models.map(model => model?.apiKey) : []),
    parsed?.embedding?.apiKey,
  ].filter(value => typeof value === 'string' && value.length > 0)
  if (keys.some(value => !value.startsWith('enc:'))) {
    throw new Error('拒绝把明文 API Key 写入配置文件')
  }
  const configPath = getConfigPath()
  writeAtomicFile(configPath, data)
})

ipcMain.on('app:close-ready', (event, result = {}) => {
  if (!isMainWindowSender(event)) return
  void finishCloseHandshake({ event, ok: result.ok === true, error: String(result.error || '') })
})

function assertUpdateSender(event) {
  assertMainWindowSender(event)
  if (event.senderFrame !== mainWindow.webContents.mainFrame || !isTrustedRendererUrl(event.senderFrame?.url)) {
    throw new Error('拒绝来自非受信任页面的更新请求')
  }
}

for (const [channel, method] of [
  ['update:state', 'snapshot'], ['update:check', 'check'], ['update:download', 'download'],
  ['update:cancel', 'cancel'], ['update:install', 'install'], ['update:open-release', 'openRelease'],
  ['update:wake', 'wake'],
]) {
  ipcMain.handle(channel, event => {
    assertUpdateSender(event)
    return getUpdates()[method]()
  })
}
ipcMain.handle('update:auto-check', (event, enabled) => {
  assertUpdateSender(event)
  return getUpdates().setAutoCheck(enabled)
})
ipcMain.on('app:update-ready', (event, result) => {
  if (!isMainWindowSender(event) || event.senderFrame !== mainWindow.webContents.mainFrame
    || !isTrustedRendererUrl(event.senderFrame?.url)) return
  updateHandshake.respond(result)
})
app.on('before-quit', () => updates?.dispose())

ipcMain.handle('config:encrypt', async (event, value) => {
  assertMainWindowSender(event)
  if (typeof value !== 'string') throw new TypeError('config:encrypt expects a string')
  if (!value) return ''
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用，拒绝明文保存 API Key')
  return `enc:${safeStorage.encryptString(value).toString('base64')}`
})

ipcMain.handle('config:decrypt', async (event, value) => {
  assertMainWindowSender(event)
  if (typeof value !== 'string') throw new TypeError('config:decrypt expects a string')
  if (!value || !value.startsWith('enc:')) return value
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用，无法解密 API Key')
  return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'))
})

ipcMain.handle('config:security-status', async (event) => {
  assertMainWindowSender(event)
  return { encryptionAvailable: safeStorage.isEncryptionAvailable() }
})

for (const method of ['read', 'write']) {
  ipcMain.handle(`cloud-session:${method}`, (event, value) => {
    assertUpdateSender(event)
    ensureUserDataDir()
    const storage = createCloudSessionStorage(path.join(app.getPath('userData'), 'novel-writer-cloud-session'), safeStorage)
    return method === 'read' ? storage.read() : storage.write(value)
  })
}

if (hasInstanceLock) app.whenReady().then(() => {
  powerMonitor.on('resume', () => { void updates?.wake() })
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    mainWindow = null
  }
})

app.on('activate', () => {
  if (hasInstanceLock && BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
