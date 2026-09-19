const semver = require('semver')

const RELEASES_URL = 'https://github.com/HannJia/novel-ai-studio/releases'
const LATEST_API = 'https://api.github.com/repos/HannJia/novel-ai-studio/releases/latest'

function parseRelease(data, currentVersion, arch = 'x64') {
  const tag = data?.tag_name
  const version = typeof tag === 'string' && /^v?\d+\.\d+\.\d+$/.test(tag) ? semver.valid(tag) : null
  if (!version || data.draft || data.prerelease) throw new Error('发布版本号无效，或不是正式版本。')
  if (!semver.gt(version, currentVersion)) return null
  const installer = `AI-Novel-Writer-${version}-${arch}.exe`
  const assets = Array.isArray(data.assets) ? data.assets : []
  const hasAsset = name => assets.some(asset => asset.name === name && asset.state === 'uploaded' && asset.size > 0)
  return {
    version,
    url: `${RELEASES_URL}/tag/${tag}`,
    feedUrl: `${RELEASES_URL}/download/${tag}/`,
    installer,
    notes: typeof data.body === 'string' ? data.body.slice(0, 24000) : '',
    publishedAt: typeof data.published_at === 'string' ? data.published_at : '',
    canDownload: hasAsset(installer) && hasAsset('latest.yml'),
  }
}

function validateManifest(info, release) {
  if (!info || info.version !== release.version || !Array.isArray(info.files) || info.files.length !== 1) {
    throw new Error('更新清单与发布版本不一致，请稍后重新检查。')
  }
  const file = info.files[0]
  if (file.url !== release.installer || typeof file.sha512 !== 'string'
    || !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512) || !(file.size > 0)
    || info.packages) {
    throw new Error('更新清单缺少有效校验信息，或包含不受支持的安装地址。')
  }
}

function publicRelease(release) {
  if (!release) return null
  const { feedUrl: _feedUrl, installer: _installer, ...visible } = release
  return visible
}

function createUpdateController(options) {
  const { supported, currentVersion, fetchLatest, getUpdater, publish, prepareInstall,
    allowQuit, savePreference, openExternal, arch = 'x64' } = options
  let release = null
  let updater = null
  let operation = null
  let downloadToken = null
  let ready = false
  let cancelled = false
  let startupTimer = null
  let intervalTimer = null
  let retryTimer = null
  let retryCount = 0
  let lastAttempt = 0
  let disposed = false
  let revision = 0
  let state = {
    supported, currentVersion, phase: supported ? 'idle' : 'unsupported',
    autoCheck: options.autoCheck !== false, release: null, checkedAt: '', error: '',
    percent: 0, transferred: 0, total: 0, bytesPerSecond: 0, revision,
  }
  const snapshot = () => ({ ...state, release: state.release ? { ...state.release } : null })
  function set(patch) {
    state = { ...state, ...patch, revision: ++revision }
    publish(snapshot())
  }
  function fail(error, fallback = 'error') {
    const raw = error instanceof Error ? error.message : String(error)
    const detail = /(?:sha512|checksum|signature|校验)/i.test(raw)
      ? '安装包校验失败，未安装。请重新下载或到发布页核对文件。'
      : /(?:ERR_|https?:|net::|ECONN|ETIMEDOUT|fetch)/i.test(raw)
        ? '无法连接更新服务或下载中断。请检查网络后重试，也可打开发布页手动下载。'
        : raw.slice(0, 240)
    set({ phase: fallback, error: detail })
  }
  function ensureUpdater() {
    if (updater) return updater
    updater = getUpdater()
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.allowPrerelease = false
    updater.allowDowngrade = false
    updater.disableWebInstaller = true
    updater.disableDifferentialDownload = true
    updater.on('download-progress', progress => {
      if (state.phase !== 'downloading' || cancelled) return
      set({
        percent: Math.min(100, Math.max(0, Number(progress.percent) || 0)),
        transferred: Math.max(0, Number(progress.transferred) || 0),
        total: Math.max(0, Number(progress.total) || 0),
        bytesPerSecond: Math.max(0, Number(progress.bytesPerSecond) || 0),
      })
    })
    // Check/download promises handle their errors; installation can report errors asynchronously.
    updater.on('error', error => {
      if (state.phase === 'installing') {
        allowQuit(false)
        fail(error, 'downloaded')
      }
    })
    return updater
  }
  function exclusive(work) {
    if (operation) return operation
    operation = Promise.resolve().then(work).finally(() => { operation = null })
    return operation
  }
  async function check() {
    if (!supported || state.phase === 'downloaded' || state.phase === 'installing') return snapshot()
    return exclusive(async () => {
      clearTimeout(retryTimer)
      retryTimer = null
      lastAttempt = Date.now()
      set({ phase: 'checking', error: '' })
      ready = false
      release = null
      try {
        release = parseRelease(await fetchLatest(), currentVersion, arch)
        if (release?.canDownload) {
          const client = ensureUpdater()
          // Pin metadata and payload to the exact release inspected above.
          client.setFeedURL({ provider: 'generic', url: release.feedUrl, useMultipleRangeRequest: false })
          const result = await client.checkForUpdates()
          validateManifest(result?.updateInfo, release)
          downloadToken = result.cancellationToken
          ready = true
        }
        set({
          phase: release ? 'available' : 'current', release: publicRelease(release),
          checkedAt: new Date().toISOString(), percent: 0,
        })
        retryCount = 0
        if (release && !ready) scheduleRetry()
      } catch (error) {
        set({ release: publicRelease(release ? { ...release, canDownload: false } : null),
          checkedAt: new Date().toISOString() })
        fail(error, release ? 'available' : 'error')
        scheduleRetry()
      }
      return snapshot()
    })
  }
  async function download() {
    if (!supported || !ready || !release?.canDownload || state.phase !== 'available') return snapshot()
    return exclusive(async () => {
      cancelled = false
      set({ phase: 'downloading', percent: 0, error: '', transferred: 0, total: 0, bytesPerSecond: 0 })
      try {
        await ensureUpdater().downloadUpdate(downloadToken)
        if (cancelled) {
          ready = false
          set({ phase: 'idle', percent: 0 })
        } else {
          set({ phase: 'downloaded', percent: 100 })
        }
      } catch (error) {
        ready = false
        if (cancelled) set({ phase: 'idle', percent: 0, error: '' })
        else fail(error)
      }
      return snapshot()
    })
  }
  function cancel() {
    if (state.phase === 'downloading' && downloadToken) {
      cancelled = true
      downloadToken.cancel()
    }
    return snapshot()
  }
  async function install() {
    if (!supported || state.phase !== 'downloaded') return snapshot()
    return exclusive(async () => {
      set({ phase: 'installing', error: '' })
      try {
        await prepareInstall()
        allowQuit(true)
        ensureUpdater().quitAndInstall(false, true)
      } catch (error) {
        allowQuit(false)
        fail(error, 'downloaded')
      }
      return snapshot()
    })
  }
  function stopTimers() {
    clearTimeout(startupTimer)
    clearInterval(intervalTimer)
    clearTimeout(retryTimer)
    startupTimer = intervalTimer = retryTimer = null
  }
  function scheduleRetry() {
    if (disposed || !supported || !state.autoCheck) return
    const minutes = [1, 5, 15, 30, 60][Math.min(retryCount++, 4)]
    retryTimer = setTimeout(() => { retryTimer = null; void check() }, minutes * 60000)
    retryTimer.unref?.()
  }
  function wake() {
    if (disposed || !supported || !state.autoCheck || !lastAttempt || operation) return snapshot()
    const retryable = state.phase === 'error' || (state.phase === 'available' && !ready)
    const stale = ['idle', 'current'].includes(state.phase)
    if ((retryable || stale) && Date.now() - lastAttempt >= (retryable ? 60000 : 6 * 60 * 60 * 1000)) return check()
    return snapshot()
  }
  function start() {
    stopTimers()
    disposed = false
    retryCount = 0
    if (!supported || !state.autoCheck) return
    startupTimer = setTimeout(() => { void check() }, 12000)
    intervalTimer = setInterval(() => {
      if (['idle', 'current', 'error'].includes(state.phase) || (state.phase === 'available' && !ready)) void check()
    }, 6 * 60 * 60 * 1000)
    startupTimer.unref?.()
    intervalTimer.unref?.()
  }
  function setAutoCheck(value) {
    if (typeof value !== 'boolean') throw new TypeError('自动检查设置必须为布尔值')
    savePreference(value)
    set({ autoCheck: value })
    start()
    return snapshot()
  }
  return {
    snapshot, check, download, cancel, install, start, wake,
    dispose: () => { disposed = true; stopTimers() }, setAutoCheck,
    openRelease: () => openExternal(release?.url || RELEASES_URL),
  }
}

module.exports = { createUpdateController, parseRelease, validateManifest, RELEASES_URL, LATEST_API }
