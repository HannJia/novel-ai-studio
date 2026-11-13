// Electron 主进程 - CommonJS 格式
const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell, net, powerMonitor, nativeImage, clipboard } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { fileURLToPath } = require('url')
const { spawnSync } = require('child_process')
const { writeAtomicFile, preserveRecoveryFiles } = require('./durableFiles.cjs')
const { createUpdateController, LATEST_API } = require('./updater.cjs')
const { createUpdateHandshake } = require('./updateHandshake.cjs')
const { createCloudSessionStorage } = require('./cloudSession.cjs')
const { createProjectKernelHandler, validateBackup } = require('./projectKernelRpc.cjs')
const { createClipboardWriter } = require('./clipboard.cjs')

const isSmokeTest = process.env.AI_NOVEL_WRITER_SMOKE_TEST === '1'
// 开发模式下的 Vite 服务器地址
const VITE_DEV_SERVER_URL = isSmokeTest && process.env.AI_NOVEL_WRITER_SMOKE_VITE_URL
  ? process.env.AI_NOVEL_WRITER_SMOKE_VITE_URL
  : 'http://localhost:5173'
const isClipboardSmoke = isSmokeTest && process.env.AI_NOVEL_WRITER_SMOKE_CLIPBOARD === '1'
const isVisualSmoke = isSmokeTest && ['visual', 'ui'].includes(process.env.AI_NOVEL_WRITER_SMOKE_WORKFLOW_KIND)
const isDeepVisualSmoke = isSmokeTest && process.env.AI_NOVEL_WRITER_SMOKE_WORKFLOW_KIND === 'deep'
const isSelectionSmoke = isSmokeTest && process.env.AI_NOVEL_WRITER_SMOKE_WORKFLOW_KIND === 'selection'
const clipboardSmokeScenario = process.env.AI_NOVEL_WRITER_SMOKE_CLIPBOARD_SCENARIO || 'normal'
const APP_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#8f1d22"/><path d="M12 52c8-5 17-6 26-3 6 2 10 1 14-2-2 8-9 13-17 12-9-1-15-2-23 2z" fill="#31181b" opacity=".48"/><text x="32" y="45" text-anchor="middle" font-family="Microsoft YaHei, SimSun, serif" font-size="34" font-weight="700" fill="#fff8ed">墨</text></svg>'
const appIcon = nativeImage.createFromDataURL('data:image/svg+xml;base64,' + Buffer.from(APP_ICON_SVG).toString('base64'))

if (isSmokeTest) {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-gpu-compositing')
  app.commandLine.appendSwitch('in-process-gpu')
  app.commandLine.appendSwitch('use-angle', 'swiftshader')
}

if (isSmokeTest) {
  const smokeData = process.env.AI_NOVEL_WRITER_SMOKE_USER_DATA
  if (!smokeData || !path.isAbsolute(smokeData)
    || path.dirname(path.resolve(smokeData)) !== path.resolve(require('os').tmpdir())
    || !path.basename(smokeData).startsWith('ai-novel-writer-smoke-')) {
    throw new Error('Smoke tests require a dedicated temporary userData directory')
  }
  app.setPath('userData', path.resolve(smokeData))
} else if (app.isPackaged) {
  // Keep the current V3 data root when the Windows product name changes.
  app.setPath('userData', path.join(app.getPath('appData'), 'AI Novel Writer'))
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

function hasClipboardFormat(formats, name) {
  return formats.some(format => format === name || format.startsWith(`${name};`))
}

function isPreservableClipboardFormat(format) {
  return format.startsWith('image/')
    || hasClipboardFormat([format], 'text/plain')
    || hasClipboardFormat([format], 'text/html')
    || hasClipboardFormat([format], 'text/rtf')
}

const smokeCustomClipboardFormat = 'Mojian Smoke Custom Format'

function hashClipboardValue(value) {
  return crypto.createHash('sha256')
    .update(Buffer.isBuffer(value) ? value : String(value ?? ''))
    .digest('hex')
}

function readClipboardSnapshot(extraFormats = []) {
  const formats = clipboard.availableFormats('clipboard')
    .map(format => String(format).toLowerCase())
    .sort()
  const hasText = hasClipboardFormat(formats, 'text/plain')
  const hasHtml = hasClipboardFormat(formats, 'text/html')
  const hasRtf = hasClipboardFormat(formats, 'text/rtf')
  const imageFormats = formats.filter(format => format.startsWith('image/'))
  let image = null
  let imageReadFailed = false
  if (imageFormats.length > 0) {
    try {
      const candidate = clipboard.readImage('clipboard')
      if (candidate.isEmpty()) imageReadFailed = true
      else image = candidate
    } catch {
      imageReadFailed = true
    }
  }
  const text = hasText ? clipboard.readText('clipboard') : null
  const html = hasHtml ? clipboard.readHTML('clipboard') : null
  const rtf = hasRtf ? clipboard.readRTF('clipboard') : null
  const imageHash = image ? hashClipboardValue(image.toPNG()) : null
  const readableExtraFormats = extraFormats.filter(format => {
    try { return clipboard.readBuffer(format).byteLength > 0 } catch { return false }
  })
  const unsupportedFormatCount = formats.filter(format => !isPreservableClipboardFormat(format)).length
    + readableExtraFormats.filter(format => !formats.includes(format.toLowerCase())).length
  const fingerprint = hashClipboardValue(JSON.stringify({
    formats,
    text: hasText ? hashClipboardValue(text) : null,
    html: hasHtml ? hashClipboardValue(html) : null,
    rtf: hasRtf ? hashClipboardValue(rtf) : null,
    image: imageHash,
  }))
  return {
    formats,
    hasText,
    text,
    hasHtml,
    html,
    hasRtf,
    rtf,
    hasImage: imageFormats.length > 0,
    image,
    imageHash,
    imageReadFailed,
    unsupportedFormatCount,
    readableExtraFormats,
    fingerprint,
  }
}

function sameClipboardContent(left, right) {
  return left.hasText === right.hasText
    && (!left.hasText || left.text === right.text)
    && left.hasHtml === right.hasHtml
    && (!left.hasHtml || left.html === right.html)
    && left.hasRtf === right.hasRtf
    && (!left.hasRtf || left.rtf === right.rtf)
    && left.hasImage === right.hasImage
    && (!left.hasImage || left.imageHash === right.imageHash)
}

function restoreClipboardSnapshot(snapshot) {
  const data = {}
  if (snapshot.hasText) data.text = snapshot.text
  if (snapshot.hasHtml) data.html = snapshot.html
  if (snapshot.hasRtf) data.rtf = snapshot.rtf
  if (snapshot.image) data.image = snapshot.image
  if (Object.keys(data).length === 0) clipboard.clear('clipboard')
  else clipboard.write(data, 'clipboard')
}

async function runClipboardSmoke(scenario = 'normal') {
  const original = readClipboardSnapshot()
  const result = {
    requested: true,
    scenario,
    skipped: false,
    attempted: false,
    rendererToPreloadIpc: false,
    mainReadback: false,
    writeVerified: false,
    restored: false,
    restorationSkipped: null,
    customFormatInjected: false,
    customFormatMethod: null,
    customFormatReadback: false,
    externalChangeInjected: false,
    unsupportedFormatCount: original.unsupportedFormatCount,
    originalFormats: {
      text: original.hasText,
      html: original.hasHtml,
      rtf: original.hasRtf,
      image: original.hasImage,
    },
    limitationCodes: [],
  }
  let scenarioChangedClipboard = false
  let expectedExternalChange = null
  if (scenario === 'custom-format' && original.unsupportedFormatCount === 0) {
    try {
      const fixturePath = path.join(__dirname, '../scripts/windows-clipboard-fixture.ps1')
      if (!fs.existsSync(fixturePath)) throw new Error('Windows clipboard fixture is unavailable')
      const fixture = spawnSync('powershell.exe', [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fixturePath,
      ], { windowsHide: true, encoding: 'utf8' })
      if (fixture.status !== 0) throw new Error((fixture.stderr || fixture.stdout || '').trim() || 'Windows clipboard fixture failed')
      scenarioChangedClipboard = true
      result.customFormatInjected = true
      result.customFormatMethod = 'windows-native-fixture'
    } catch {
      try {
        clipboard.clear('clipboard')
        clipboard.writeBuffer(smokeCustomClipboardFormat, Buffer.from('custom-format-test'), 'clipboard')
        scenarioChangedClipboard = true
        result.customFormatInjected = true
        result.customFormatMethod = 'main-write-buffer'
      } catch {
        result.limitationCodes.push('custom-format-write-unavailable')
      }
    }
  }
  const scenarioSnapshot = scenarioChangedClipboard
    ? readClipboardSnapshot([smokeCustomClipboardFormat])
    : original
  result.customFormatReadback = scenarioSnapshot.readableExtraFormats.includes(smokeCustomClipboardFormat)
  result.unsupportedFormatCount = scenarioSnapshot.unsupportedFormatCount
  if (original.unsupportedFormatCount > 0 || scenarioSnapshot.unsupportedFormatCount > 0) {
    result.limitationCodes.push('unsupported-custom-formats')
  }
  if (scenario === 'custom-format' && !result.limitationCodes.includes('unsupported-custom-formats')) {
    result.limitationCodes.push('custom-format-not-exposed')
  }
  if (original.imageReadFailed) result.limitationCodes.push('image-format-not-readable')
  if (result.limitationCodes.length > 0) {
    result.skipped = true
    if (scenarioChangedClipboard) {
      restoreClipboardSnapshot(original)
      result.restored = sameClipboardContent(readClipboardSnapshot(), original)
      if (!result.restored) result.limitationCodes.push('clipboard-restore-verification-failed')
    } else {
      result.restored = true
    }
    return result
  }

  const recoveryCode = `MOJIAN-SMOKE-RECOVERY-${crypto.randomBytes(24).toString('hex')}`
  let writeAttempted = false
  let expectedAfterWrite = null
  try {
    writeAttempted = true
    result.attempted = true
    await mainWindow.webContents.executeJavaScript(
      `window.electronAPI.clipboardWriteText(${JSON.stringify(recoveryCode)})`,
    )
    result.rendererToPreloadIpc = true
    expectedAfterWrite = readClipboardSnapshot()
    result.mainReadback = expectedAfterWrite.hasText && expectedAfterWrite.text === recoveryCode
    result.writeVerified = result.mainReadback
    if (!result.writeVerified) throw new Error('系统剪贴板主进程读回校验失败')
    if (scenario === 'changed-during-test') {
      clipboard.writeText(`MOJIAN-SMOKE-EXTERNAL-CHANGE-${crypto.randomBytes(8).toString('hex')}`, 'clipboard')
      expectedExternalChange = readClipboardSnapshot()
      result.externalChangeInjected = true
    }
  } finally {
    const current = readClipboardSnapshot()
    if (!expectedAfterWrite && current.hasText && current.text === recoveryCode) expectedAfterWrite = current
    if (!writeAttempted || !expectedAfterWrite) {
      result.restored = sameClipboardContent(current, original)
      if (!result.restored) result.restorationSkipped = 'clipboard-write-not-confirmed'
    } else if (current.fingerprint !== expectedAfterWrite.fingerprint) {
      result.restorationSkipped = 'clipboard-changed-during-test'
      result.limitationCodes.push('clipboard-changed-during-test')
      // The smoke scenario created this exact random text itself. Restore the
      // original snapshot only while that synthetic value is still present.
      if (result.externalChangeInjected && current.fingerprint === expectedExternalChange?.fingerprint) {
        restoreClipboardSnapshot(original)
        result.restored = sameClipboardContent(readClipboardSnapshot(), original)
        if (!result.restored) result.limitationCodes.push('clipboard-restore-verification-failed')
      }
    } else {
      restoreClipboardSnapshot(original)
      result.restored = sameClipboardContent(readClipboardSnapshot(), original)
      if (!result.restored) result.limitationCodes.push('clipboard-restore-verification-failed')
    }
  }
  return result
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
    if (isSmokeTest && process.env.AI_NOVEL_WRITER_SMOKE_WORKFLOW) setImmediate(() => app.exit(0))
    return
  }

  // 发送到渲染进程显示自定义对话框
  mainWindow.webContents.send('app:exit-confirm', {
    errorDetail: error || '本地数据保存失败。建议：取消退出，重试保存。',
  })
}

function createWindow() {
  closeHandshakeInFlight = false
  closeHandshakeComplete = false
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: isVisualSmoke || isDeepVisualSmoke || isSelectionSmoke ? 480 : 1024,
    minHeight: 700,
    title: '墨笔生花 · AI 小说写作',
    icon: appIcon,
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
  if (isSmokeTest) {
    mainWindow.webContents.on('did-start-loading', () => process.stdout.write('ELECTRON_SMOKE_STAGE did-start-loading\n'))
    mainWindow.webContents.on('did-stop-loading', () => process.stdout.write('ELECTRON_SMOKE_STAGE did-stop-loading\n'))
    mainWindow.webContents.on('console-message', event => {
      if (event.level === 'warning' || event.level === 'error') {
        process.stdout.write(`ELECTRON_SMOKE_CONSOLE ${JSON.stringify({ level: event.level, message: event.message, line: event.lineNumber, sourceId: event.sourceId })}\n`)
      }
    })
    const smokeOrigin = new URL(VITE_DEV_SERVER_URL).origin
    mainWindow.webContents.session.webRequest.onErrorOccurred({ urls: [`${smokeOrigin}/*`] }, details => {
      if (details.resourceType !== 'font') {
        process.stdout.write(`ELECTRON_SMOKE_RESOURCE_ERROR ${JSON.stringify({ url: details.url, method: details.method, resourceType: details.resourceType, error: details.error })}\n`)
      }
    })
    const writeModuleFilter = { urls: [`${smokeOrigin}/src/v3/write/WriteView.vue*`] }
    mainWindow.webContents.session.webRequest.onBeforeRequest(writeModuleFilter, (details, callback) => {
      process.stdout.write(`ELECTRON_SMOKE_WRITE_MODULE_REQUEST ${JSON.stringify({ url: details.url, method: details.method, resourceType: details.resourceType })}\n`)
      callback({})
    })
    mainWindow.webContents.session.webRequest.onCompleted(writeModuleFilter, details => {
      process.stdout.write(`ELECTRON_SMOKE_WRITE_MODULE_RESPONSE ${JSON.stringify({ url: details.url, statusCode: details.statusCode, fromCache: details.fromCache, resourceType: details.resourceType })}\n`)
    })
    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      process.stdout.write(`ELECTRON_SMOKE_LOAD_ERROR ${JSON.stringify({ errorCode, errorDescription, validatedURL, isMainFrame })}\n`)
    })
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      process.stdout.write(`ELECTRON_SMOKE_RENDERER_GONE ${JSON.stringify(details)}\n`)
    })
  }
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
        const clipboardResult = isClipboardSmoke ? await runClipboardSmoke(clipboardSmokeScenario) : null
        if (isVisualSmoke || isDeepVisualSmoke) await mainWindow.webContents.executeJavaScript('window.__v3VisualSmoke = true')
        if (process.env.AI_NOVEL_WRITER_SMOKE_WORKFLOW_KIND === 'shelf-resume') {
          process.stdout.write('ELECTRON_SMOKE_SHELF_RESUME_STAGE startup-check-start\n')
        }
        const result = await mainWindow.webContents.executeJavaScript(`(async () => {
          let project;
          for (let attempt = 0; attempt < 100; attempt++) {
            project = await window.electronAPI.projectRequest({ method: 'read' });
            if (!project.ok) throw new Error(project.error.message);
            if (project.value.backup && document.querySelector('#app')?.children.length) break;
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          if (!project?.value?.backup) throw new Error('项目存储未完成启动');
          const visualSmoke = window.__v3VisualSmoke === true;
          const projectSaved = visualSmoke
            ? { ok: true, value: { revision: project.value.revision } }
            : await window.electronAPI.projectRequest({ method: 'commit', baseRevision: project.value.revision, backup: project.value.backup });
          const projectReopened = await window.electronAPI.projectRequest({ method: 'read' });
          const projectHistory = await window.electronAPI.projectRequest({ method: 'history' });
          const projectStorage = visualSmoke
            ? projectReopened.ok && projectHistory.ok && Boolean(projectReopened.value.backup)
            : projectSaved.ok && projectReopened.ok && projectHistory.ok
              && projectSaved.value.revision !== project.value.revision
              && projectReopened.value.revision === projectSaved.value.revision
              && JSON.stringify(projectReopened.value.backup) === JSON.stringify(project.value.backup)
              && projectHistory.value.length >= 2;
          const security = await window.electronAPI?.configSecurityStatus?.();
          const cloudEmpty = await window.electronAPI.cloudSessionRead();
          const testSession = { endpoint: 'https://154.94.227.164', token: 'smoke-session-token-not-a-real-account-1234567890',
            expiresAt: Date.now() + 60000, user: { id: 'smoke', username: 'smoke', role: 'user', quotaBytes: 1, usedBytes: 0 } };
          let cloudRestored = null;
          let cloudSessionUnavailable = false;
          try {
            await window.electronAPI.cloudSessionWrite(testSession);
            cloudRestored = await window.electronAPI.cloudSessionRead();
            await window.electronAPI.cloudSessionWrite(null);
          } catch (error) {
            if (security?.encryptionAvailable === false) cloudSessionUnavailable = true;
            else throw error;
          }
          const cloudHealth = ${process.env.AI_NOVEL_WRITER_SMOKE_CLOUD === '1'
            ? "(await (await fetch('https://154.94.227.164/v1/health', { headers: { Authorization: 'Bearer smoke-no-account' }, signal: AbortSignal.timeout(15000) })).json()).protocol === 1"
            : 'null'};
          return {
            rendered: Boolean(document.querySelector('#app')?.children.length),
            bridgeAvailable: typeof window.electronAPI?.configSecurityStatus === 'function',
            nodeIsolated: typeof window.require === 'undefined' && typeof window.process === 'undefined',
            projectStorage,
            security,
            update: await window.electronAPI?.updateGetState?.(),
            cloudSession: cloudEmpty === null && cloudRestored?.token === testSession.token
              && await window.electronAPI.cloudSessionRead() === null,
            cloudSessionUnavailable,
            cloudHealth,
          };
        })()`)
        if (process.env.AI_NOVEL_WRITER_SMOKE_WORKFLOW_KIND === 'shelf-resume') {
          process.stdout.write('ELECTRON_SMOKE_SHELF_RESUME_STAGE startup-check-complete\n')
        }
        result.appVersion = app.getVersion()
        if (clipboardResult) result.clipboard = clipboardResult
        const workflow = process.env.AI_NOVEL_WRITER_SMOKE_WORKFLOW
        if (workflow === 'resume' && process.env.AI_NOVEL_WRITER_SMOKE_WORKFLOW_KIND === 'shelf-resume') {
          if (!isDev) throw new Error('Shelf resume smoke requires the development renderer')
          mainWindow.showInactive()
          const runStep = (promise, label) => {
            let timer
            const timeout = new Promise((_, reject) => {
              timer = setTimeout(async () => {
                let diagnostic = null
                try {
                  diagnostic = await mainWindow.webContents.executeJavaScript(`({
                    stage: window.__shelfResumeStage,
                    hash: window.location.hash,
                    page: document.body.innerText.slice(0, 800),
                  })`)
                } catch (error) { diagnostic = String(error) }
                reject(new Error('Electron smoke step timed out: ' + label + ' ' + JSON.stringify(diagnostic)))
              }, 30000)
            })
            return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
          }
          process.stdout.write('ELECTRON_SMOKE_SHELF_RESUME_STAGE fixture-start\n')
          const fixture = await runStep(mainWindow.webContents.executeJavaScript(
            "import('/src/test/desktopShelfResumeWorkflow.ts').then(module => module.seedDesktopShelfResumeWorkflow())",
          ), 'fixture setup')
          process.stdout.write('ELECTRON_SMOKE_SHELF_RESUME_STAGE fixture-complete ' + fixture.novelId + '\n')
          const state = await runStep(mainWindow.webContents.executeJavaScript(`(async () => {
            window.__shelfResumeStage = 'router-import'
            const router = (await import('/src/router/index.ts')).default
            window.__shelfResumeStage = 'route-inspected'
            if (router.currentRoute.value.path !== '/') {
              window.__shelfResumeStage = 'route-replace'
              await router.replace('/')
            }
            window.__shelfResumeStage = 'close-onboarding'
            document.querySelector('.m-modal.guide [aria-label="关闭"]')?.click()
            const waitFor = async (check, label) => {
              for (let attempt = 0; attempt < 240; attempt++) {
                if (await check()) return
                await new Promise(resolve => setTimeout(resolve, 25))
              }
              throw new Error(label + ': ' + JSON.stringify({
                path: router.currentRoute.value.fullPath,
                page: document.body.innerText.slice(0, 800),
              }))
            }
            window.__shelfResumeStage = 'wait-shelf'
            await waitFor(() => router.currentRoute.value.path === '/'
              && document.querySelector('.hero-acts button.m-btn.pri.lg')
              && !document.querySelector('.m-modal.guide'), '书架或引导层未就绪')
            window.__shelfResumeErrors = []
            window.addEventListener('error', event => window.__shelfResumeErrors.push(String(event.message || 'runtime error')))
            window.addEventListener('unhandledrejection', event => window.__shelfResumeErrors.push(String(event.reason || 'unhandled rejection')))
            const button = document.querySelector('.hero-acts button.m-btn.pri.lg')
            const beforePath = router.currentRoute.value.path
            const expectedPath = '/write/' + ${JSON.stringify(fixture.novelId)} + '/' + ${JSON.stringify(fixture.chapterId)}
            const transitions = []
            const removeHook = router.afterEach((to, from, failure) => transitions.push({ from: from.fullPath, to: to.fullPath, failed: !!failure }))
            window.__shelfResumeStage = 'resume-click'
            button.click()
            try {
              window.__shelfResumeStage = 'wait-write-route'
              await waitFor(() => router.currentRoute.value.fullPath === expectedPath
                && document.querySelector('.write-page'), '书架继续写作没有进入目标章节')
            } catch (error) {
              removeHook()
              throw new Error(String(error) + ' ' + JSON.stringify({ expectedPath,
                actualPath: router.currentRoute.value.fullPath, transitions,
                buttonText: button.textContent?.trim(), errors: window.__shelfResumeErrors }))
            }
            removeHook()
            window.__shelfResumeStage = 'wait-fonts'
            await document.fonts.ready
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
            window.__shelfResumeStage = 'complete'
            return {
              phase: 'resume', kind: 'shelf-resume', passed: true,
              novelId: ${JSON.stringify(fixture.novelId)}, chapterId: ${JSON.stringify(fixture.chapterId)},
              beforePath, afterPath: router.currentRoute.value.fullPath, transitions,
              pageMarker: document.querySelector('.write-page') ? 'write-page' : '',
              runtimeErrors: window.__shelfResumeErrors.length, modelRequests: 0,
            }
          })()`), 'shelf navigation')
          process.stdout.write('ELECTRON_SMOKE_SHELF_RESUME_STAGE navigation-complete ' + JSON.stringify(state) + '\n')
          result.workflow = state
          fs.writeFileSync(path.join(app.getPath('userData'), 'workflow-resume.png'), (await mainWindow.webContents.capturePage()).toPNG())
        }
        if (workflow === 'ui' && process.env.AI_NOVEL_WRITER_SMOKE_WORKFLOW_KIND === 'ui') {
          if (!isDev) throw new Error('UI workflow requires the development renderer')
          mainWindow.showInactive()
          const fixture = await mainWindow.webContents.executeJavaScript("import('/src/test/v3FinalUiWorkflow.ts').then(module => module.seedFinalUiState())")
          const states = []
          for (const theme of ['fanqie', 'eyecare', 'dark']) {
            for (const width of [1440, 860, 540]) {
              mainWindow.setContentSize(width, width === 1440 ? 900 : 1000)
              for (const page of fixture.pages) {
                const state = await mainWindow.webContents.executeJavaScript("import('/src/test/v3FinalUiWorkflow.ts').then(module => module.openFinalUiPage(" + JSON.stringify(fixture) + ',' + JSON.stringify(page) + ',' + JSON.stringify(theme) + '))')
                const image = await mainWindow.webContents.capturePage()
                const fileName = 'v3-ui-' + page + '-' + theme + '-' + width + '.png'
                fs.writeFileSync(path.join(app.getPath('userData'), fileName), image.toPNG())
                states.push({ ...state, fileName, screenshotWidth: image.getSize().width, screenshotHeight: image.getSize().height })
                fs.writeFileSync(path.join(app.getPath('userData'), 'ui-progress.json'), JSON.stringify(states))
                process.stdout.write('UI_CAPTURE ' + page + ' ' + theme + ' ' + width + '\n')
              }
            }
          }
          result.workflow = { phase: workflow, kind: 'ui', passed: true, fixture, states }
          const snapshot = await mainWindow.webContents.executeJavaScript("window.electronAPI.projectRequest({method:'read'})")
          if (!snapshot.ok) throw new Error('Cannot export synthetic UI fixture')
          fs.writeFileSync(path.join(app.getPath('userData'), 'offline-writing-fixture.json'), JSON.stringify(snapshot.value.backup))
        }
        if (workflow === 'visual' && process.env.AI_NOVEL_WRITER_SMOKE_WORKFLOW_KIND === 'visual') {
          if (!isDev) throw new Error('Dense visual smoke requires the development renderer')
          mainWindow.showInactive()
          const fixture = await mainWindow.webContents.executeJavaScript(
            "import('/src/test/v3DenseVisualWorkflow.ts').then(module => module.seedV3DenseVisualState())",
          )
          await mainWindow.webContents.executeJavaScript(
            "document.querySelector('.m-modal.guide [aria-label=\"关闭\"]')?.click(); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
          )
          await mainWindow.webContents.executeJavaScript("window.__v3DenseVisualErrors = []; window.addEventListener('error', event => window.__v3DenseVisualErrors.push(String(event.message || 'runtime error'))); window.addEventListener('unhandledrejection', event => window.__v3DenseVisualErrors.push(String(event.reason || 'unhandled rejection')));")
          const states = []
          for (const route of ['plan', 'review']) {
            for (const theme of ['fanqie', 'eyecare', 'dark']) {
              for (const width of [540, 860, 1440]) {
                mainWindow.setContentSize(width, 1000)
                const fileName = 'v3-dense-' + route + '-' + theme + '-' + width + '.png'
                const selector = route === 'plan' ? '.plan-layout' : '.review-page'
                const destination = '#/' + route + '/' + fixture.novelId
                const script = [
                  '(async () => {',
                  "const { useThemeStore } = await import('/src/stores/theme.ts');",
                  "const { useNovelStore } = await import('/src/stores/novel.ts');",
                  'useThemeStore().switchTheme(' + JSON.stringify(theme) + ');',
                  'const destination = ' + JSON.stringify(destination) + ';',
                  'if (window.location.hash !== destination) window.location.hash = destination;',
                  'for (let attempt = 0; attempt < 120; attempt++) {',
                  'if (window.location.hash === destination && document.querySelector(' + JSON.stringify(selector) + ')) break;',
                  'await new Promise(resolve => setTimeout(resolve, 50));',
                  '}',
                  'if (!document.querySelector(' + JSON.stringify(selector) + ')) throw new Error("视觉页面未就绪：" + ' + JSON.stringify(route) + ');',
                  'window.scrollTo(0, 0); await document.fonts.ready;',
                  'await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));',
                  'await new Promise(resolve => setTimeout(resolve, 120));',
                  'const currentNovel = useNovelStore().getNovel(' + JSON.stringify(fixture.novelId) + ');',
                  "const text = document.querySelector('.stale-banner')?.textContent || '';",
                  'return { route: ' + JSON.stringify(route) + ', theme: ' + JSON.stringify(theme) + ', viewportWidth: window.innerWidth,',
                  'documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth,',
                  'pageMarker: ' + (route === 'plan'
                    ? "document.querySelector('.plan-layout')?.getAttribute('aria-label') || ''"
                    : "document.querySelector('.review-head h1')?.textContent.trim() || ''") + ',',
                  'chapters: currentNovel?.chapters.length || 0,',
                  'renderedChapters: document.querySelectorAll(' + JSON.stringify(route === 'plan' ? '.tree-chapter' : '.heat-cell') + ').length,',
                  "volumeGroups: document.querySelectorAll('.tree-group').length,",
                  "onboardingOpen: !!document.querySelector('.m-modal.guide'),",
                  "arcLanes: document.querySelectorAll('.lane-name').length, foreshadowRows: document.querySelectorAll('.fs-row').length,",
                  "staleBanner: text.replace(/\\s+/g, ' ').trim(), staleChapterCount: Number(text.match(/\\d+/)?.[0] || 0),",
                  'runtimeErrors: window.__v3DenseVisualErrors.length, modelRequests: 0 };',
                  '})()',
                ].join('')
                const state = await mainWindow.webContents.executeJavaScript(script)
                const image = await mainWindow.webContents.capturePage()
                fs.writeFileSync(path.join(app.getPath('userData'), fileName), image.toPNG())
                states.push({ ...state, fileName, screenshotWidth: image.getSize().width, screenshotHeight: image.getSize().height })
              }
            }
          }
          mainWindow.setContentSize(1280, 800)
          result.workflow = { phase: workflow, kind: 'visual', passed: true, fixture, states }
        }
        if (workflow === 'deep' && process.env.AI_NOVEL_WRITER_SMOKE_WORKFLOW_KIND === 'deep') {
          if (!isDev) throw new Error('Deep visual smoke requires the development renderer')
          mainWindow.showInactive()
          const fixture = await mainWindow.webContents.executeJavaScript(
            "import('/src/test/v3DeepVisualWorkflow.ts').then(module => module.seedV3DeepVisualState())",
          )
          await mainWindow.webContents.executeJavaScript(
            "document.querySelector('.m-modal.guide [aria-label=\"关闭\"]')?.click(); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
          )
          await mainWindow.webContents.executeJavaScript("window.__v3DeepVisualErrors = []; window.addEventListener('error', event => window.__v3DeepVisualErrors.push(String(event.message || 'runtime error'))); window.addEventListener('unhandledrejection', event => window.__v3DeepVisualErrors.push(String(event.reason || 'unhandled rejection')));")
          const states = []
          const stateRoutes = [
            ['auto-running', 'auto'], ['auto-checkpoint', 'auto'], ['gate-modal', 'write'], ['canon-modal', 'write'],
          ]
          for (const theme of ['fanqie', 'eyecare', 'dark']) {
            for (const [width, height] of [[540, 1000], [860, 1000], [1440, 900]]) {
              mainWindow.setContentSize(width, height)
              for (const [state, route] of stateRoutes) {
                const stateResult = await mainWindow.webContents.executeJavaScript(`(async () => {
                  const deep = await import('/src/test/v3DeepVisualWorkflow.ts')
                  document.querySelector('.completion-overlay [aria-label^=\"关闭\"]')?.click()
                  document.querySelector('nav.rail .rail-seal')?.click()
                  const shelfSelector = '.page[data-keep="shelf"]'
                  for (let attempt = 0; attempt < 160; attempt++) {
                    if (window.location.hash === '#/' && document.querySelector(shelfSelector)) break
                    await new Promise(resolve => setTimeout(resolve, 50))
                  }
                  if (window.location.hash !== '#/' || !document.querySelector(shelfSelector)) {
                    throw new Error('深层视觉书架路由未就绪：' + JSON.stringify({ hash: window.location.hash, title: document.title }))
                  }
                  const lifecycle = await import('/src/services/appLifecycle.ts')
                  for (let attempt = 0; attempt < 160 && (lifecycle.cloudApplyBusy.value || lifecycle.projectTransferBusy.value); attempt++) {
                    await new Promise(resolve => setTimeout(resolve, 50))
                  }
                  if (lifecycle.cloudApplyBusy.value || lifecycle.projectTransferBusy.value) {
                    throw new Error('深层视觉路由被项目操作锁定：' + JSON.stringify({ cloudApplyBusy: lifecycle.cloudApplyBusy.value, projectTransferBusy: lifecycle.projectTransferBusy.value }))
                  }
                  if (${JSON.stringify(route)} === 'write') {
                    const resumeButton = document.querySelector('.hero-acts button.m-btn.pri.lg')
                    if (!resumeButton) throw new Error('深层视觉书架未找到继续写作入口')
                    resumeButton.click()
                  } else {
                    const targetPath = '/auto/' + ${JSON.stringify(fixture.novelId)}
                    const targetLink = Array.from(document.querySelectorAll('nav.rail a.rail-btn'))
                      .find(link => new URL(link.href).hash === '#' + targetPath)
                    if (!targetLink) throw new Error('深层视觉侧栏入口未找到：' + JSON.stringify({ targetPath,
                      links: Array.from(document.querySelectorAll('nav.rail a.rail-btn'), link => new URL(link.href).hash) }))
                    targetLink.click()
                  }
                  const selector = ${JSON.stringify(route === 'auto' ? '.auto-page' : '.write-page')}
                  for (let attempt = 0; attempt < 160; attempt++) {
                    if (document.querySelector(selector)) break
                    await new Promise(resolve => setTimeout(resolve, 50))
                  }
                  if (!document.querySelector(selector)) throw new Error('深层视觉页面未就绪：' + JSON.stringify({
                    state: ${JSON.stringify(state)}, hash: window.location.hash, title: document.title,
                    link: ${JSON.stringify(route)} === 'auto'
                      ? Array.from(document.querySelectorAll('nav.rail a.rail-btn')).map(link => ({ href: link.href, disabled: link.getAttribute('aria-disabled') }))
                      : document.querySelector('.hero-acts button.m-btn.pri.lg')?.textContent,
                    locks: { cloudApplyBusy: lifecycle.cloudApplyBusy.value, projectTransferBusy: lifecycle.projectTransferBusy.value },
                    body: (document.body?.innerText || '').slice(0, 500),
                  }))
                  if (${JSON.stringify(route)} === 'write') {
                    const expectedChapterHash = '#/write/' + ${JSON.stringify(fixture.novelId)} + '/' + ${JSON.stringify(fixture.chapterId)}
                    const novelModule = await import('/src/stores/novel.ts')
                    const expectedChapter = novelModule.useNovelStore().getNovel(${JSON.stringify(fixture.novelId)})
                      ?.chapters.find(chapter => chapter.id === ${JSON.stringify(fixture.chapterId)})
                    for (let attempt = 0; attempt < 160; attempt++) {
                      const title = document.querySelector('.chapter-title')?.value
                      const selected = document.querySelector('.chapter-tree .tree-item[aria-current="page"]')
                      if (window.location.hash === expectedChapterHash && title === expectedChapter?.title
                        && (window.innerWidth <= 800 || selected)) break
                      await new Promise(resolve => setTimeout(resolve, 50))
                    }
                    const title = document.querySelector('.chapter-title')?.value
                    const currentChapter = document.querySelector('.chapter-tree .tree-item[aria-current="page"]')
                    if (window.location.hash !== expectedChapterHash || !expectedChapter || title !== expectedChapter.title
                      || (window.innerWidth > 800 && !currentChapter)) {
                      throw new Error('深层视觉恢复到了错误章节：' + JSON.stringify({ expectedChapterHash, hash: window.location.hash,
                        expectedTitle: expectedChapter?.title, actualTitle: title, currentChapter: currentChapter?.textContent,
                        chapters: Array.from(document.querySelectorAll('.chapter-tree .tree-item'), item => ({ text: item.textContent?.trim(), current: item.getAttribute('aria-current') })) }))
                    }
                  }
                  const themeStore = await import('/src/stores/theme.ts')
                  themeStore.useThemeStore().switchTheme(${JSON.stringify(theme)})
                  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
                  await deep.applyV3DeepVisualState(${JSON.stringify(fixture.novelId)}, ${JSON.stringify(state)})
                  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
                  if (${JSON.stringify(route)} === 'write') {
                    const action = document.querySelector('.chapter-gate .gate-actions button.zhu')
                    if (!action) throw new Error('写作台未找到定稿核对按钮：' + ${JSON.stringify(state)})
                    action.click()
                    for (let attempt = 0; attempt < 80 && !document.querySelector('.completion-overlay'); attempt++) await new Promise(resolve => setTimeout(resolve, 25))
                    if (!document.querySelector('.completion-overlay')) throw new Error('写作台核对弹窗未打开：' + ${JSON.stringify(state)})
                  }
                  window.scrollTo(0, 0); await document.fonts.ready
                  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
                  return { state: ${JSON.stringify(state)}, route: ${JSON.stringify(route)}, theme: ${JSON.stringify(theme)},
                    viewportWidth: window.innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth,
                    pageMarker: ${route === 'auto' ? "document.querySelector('.runbar')?.textContent.trim() || ''" : "document.querySelector('.completion-overlay h3')?.textContent.trim() || ''"},
                    gateRows: Array.from(document.querySelectorAll('.completion-overlay .gate-row'), row => ({ label: row.querySelector('span')?.textContent, state: row.querySelector('i')?.className })),
                    canonHistoryCount: document.querySelectorAll('.completion-overlay .completion-changes:last-of-type p .m-tag').length,
                    pendingCandidateCount: document.querySelectorAll('.completion-overlay .completion-changes:first-of-type p .m-tag').length,
                    modalOpen: Boolean(document.querySelector('.completion-overlay')), runtimeErrors: window.__v3DeepVisualErrors.length, modelRequests: 0 };
                })()`)
                const image = await mainWindow.webContents.capturePage()
                const fileName = 'v3-deep-current-' + state + '-' + theme + '-' + width + '.png'
                fs.writeFileSync(path.join(app.getPath('userData'), fileName), image.toPNG())
                states.push({ ...stateResult, fileName, screenshotWidth: image.getSize().width, screenshotHeight: image.getSize().height })
                process.stdout.write('ELECTRON_SMOKE_DEEP_STATE ' + JSON.stringify({ state, theme, width, marker: stateResult.pageMarker }) + '\n')
              }
            }
          }
          mainWindow.setContentSize(1280, 800)
          result.workflow = { phase: workflow, kind: 'deep', passed: true, fixture, states }
        }
        if (workflow && !['visual', 'deep', 'ui', 'shelf-resume'].includes(process.env.AI_NOVEL_WRITER_SMOKE_WORKFLOW_KIND)) {
          const workflowKind = process.env.AI_NOVEL_WRITER_SMOKE_WORKFLOW_KIND || 'integrated'
          if (!isDev || (workflowKind === 'selection'
            ? workflow !== 'selection'
            : !['write', 'reopen', 'verify-stale'].includes(workflow))) throw new Error('Unsupported development smoke workflow')
          if (!['integrated', 'creation', 'selection'].includes(workflowKind)) throw new Error('Unsupported development smoke workflow kind')
          mainWindow.showInactive()
          if (workflowKind === 'selection') {
            const states = []
            for (const theme of ['fanqie', 'eyecare', 'dark']) {
              for (const [index, viewport] of [
                [1440, 900], [860, 1000], [540, 1000],
              ].entries()) {
                mainWindow.setContentSize(viewport[0], viewport[1])
                await mainWindow.webContents.executeJavaScript(`import('/src/stores/theme.ts').then(module => module.useThemeStore().switchTheme(${JSON.stringify(theme)}))`)
                await new Promise(resolve => setTimeout(resolve, 250))
                const selection = await mainWindow.webContents.executeJavaScript(
                  `import('/src/test/desktopSelectionWorkflow.ts').then(module => module.runDesktopSelectionWorkflow({ seed: ${theme === 'fanqie' && index === 0} }))`,
                )
                await mainWindow.webContents.executeJavaScript(`(async () => {
                  await document.fonts.ready;
                  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                })()`)
                const image = await mainWindow.webContents.capturePage()
                const fileName = 'v3-selection-' + theme + '-' + selection.states[0].viewportWidth + '.png'
                fs.writeFileSync(path.join(app.getPath('userData'), fileName), image.toPNG())
                states.push({ ...selection.states[0], theme, fileName, screenshotWidth: image.getSize().width, screenshotHeight: image.getSize().height })
              }
            }
            mainWindow.setContentSize(1280, 800)
            result.workflow = { phase: workflow, kind: 'selection', passed: true, states }
          } else {
            result.workflow = await mainWindow.webContents.executeJavaScript(
              `import('/src/test/desktopWorkflow.ts').then(module => module.runDesktopWorkflow(${JSON.stringify(workflow)}, ${JSON.stringify(workflowKind)}))`,
            )
          }
          await mainWindow.webContents.executeJavaScript(`(async () => {
            await document.fonts.ready;
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
              .map(animation => animation.finished.catch(() => {})));
            for (let attempt = 0; attempt < 60 && document.querySelector('.n-message'); attempt++) {
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          })()`)
          fs.writeFileSync(path.join(app.getPath('userData'), `workflow-${workflow}.png`), (await mainWindow.webContents.capturePage()).toPNG())
        }
        if (['1', 'verify'].includes(process.env.AI_NOVEL_WRITER_SMOKE_LOCAL_WRITING)) {
          result.localWriting = await require('./offlineWritingSmoke.cjs').run(mainWindow, app.getPath('userData'), process.env.AI_NOVEL_WRITER_SMOKE_LOCAL_WRITING)
        }
        const smokeLine = `ELECTRON_SMOKE_RESULT ${JSON.stringify(result)}`
        fs.writeFileSync(path.join(app.getPath('userData'), 'electron-smoke-result.json'), JSON.stringify(result))
        process.stdout.write(smokeLine + '\n')
        // Exercise the real renderer save barrier and window-close handshake.
        if (workflow) { setTimeout(() => mainWindow?.close(), 50); return }
        const clipboardPassed = !isClipboardSmoke || (clipboardSmokeScenario === 'custom-format'
          ? result.clipboard?.skipped === true
            && result.clipboard?.customFormatInjected === true
            && result.clipboard?.customFormatReadback === true
            && result.clipboard?.limitationCodes?.includes('unsupported-custom-formats')
            && result.clipboard?.restored === true
          : result.clipboard?.rendererToPreloadIpc === true
            && result.clipboard?.mainReadback === true
            && result.clipboard?.writeVerified === true
            && (result.clipboard?.restored === true
              || result.clipboard?.restorationSkipped === 'clipboard-changed-during-test'))
        app.exit(result.rendered && result.bridgeAvailable && result.nodeIsolated && result.projectStorage
          && result.update?.currentVersion === app.getVersion() && clipboardPassed ? 0 : 1)
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
  return path.join(app.getPath('userData'), 'mojian-v3.db')
}

function getConfigPath() {
  return path.join(app.getPath('userData'), 'mojian-v3-config.json')
}

function hasValidSqliteHeader(data) {
  return data.length >= 16 && data.subarray(0, 16).toString('utf8') === 'SQLite format 3\u0000'
}

// Project storage owns its files and indexes. No SQL or arbitrary filesystem
// operation is exposed to the renderer through this channel.
ipcMain.handle('project:request', createProjectKernelHandler({
  root: path.join(app.getPath('userData'), 'projects-v3'),
  authorize: event => {
    assertMainWindowSender(event)
    if (event.senderFrame !== mainWindow.webContents.mainFrame || !isTrustedRendererUrl(event.senderFrame.url)) {
      throw new Error('拒绝来自非受信任主页面的项目请求')
    }
  },
}))

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
  validateBackup(parsed)
  ensureUserDataDir()
  writeAtomicFile(path.join(app.getPath('userData'), 'mojian-v3-before-import.json'), serialized)
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

ipcMain.on('app:exit-choice', (event, confirmed) => {
  if (!isMainWindowSender(event) || event.senderFrame !== mainWindow.webContents.mainFrame
    || !isTrustedRendererUrl(event.senderFrame?.url)) return
  if (confirmed === true) {
    closeHandshakeComplete = true
    mainWindow.close()
  } else {
    closeHandshakeInFlight = false
  }
})

function assertUpdateSender(event) {
  assertMainWindowSender(event)
  if (event.senderFrame !== mainWindow.webContents.mainFrame || !isTrustedRendererUrl(event.senderFrame?.url)) {
    throw new Error('拒绝来自非受信任页面的更新请求')
  }
}

ipcMain.handle('clipboard:write-text', createClipboardWriter(clipboard, event => {
  assertMainWindowSender(event)
  if (event.senderFrame !== mainWindow.webContents.mainFrame || !isTrustedRendererUrl(event.senderFrame?.url)) {
    throw new Error('拒绝来自非受信任页面的剪贴板请求')
  }
}))

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
  if (!value) return value
  if (!value.startsWith('enc:')) throw new Error('只接受 V3 加密配置。')
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
    const storage = createCloudSessionStorage(path.join(app.getPath('userData'), 'mojian-v3-cloud-session'), safeStorage)
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
