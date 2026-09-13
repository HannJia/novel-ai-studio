const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const { app } = require('electron')
const { NsisUpdater } = require('electron-updater')
const { ElectronHttpExecutor } = require('electron-updater/out/electronHttpExecutor')
const { validateManifest } = require('../app-main/updater.cjs')

async function main() {
  const directory = process.env.AI_NOVEL_UPDATE_TEST_DIR
  if (!directory) throw new Error('Missing isolated test directory')
  app.setPath('userData', directory)
  const payload = Buffer.from('NON_EXECUTABLE_UPDATE_DOWNLOAD_TEST\n'.repeat(2048))
  const sha512 = crypto.createHash('sha512').update(payload).digest('base64')
  let corrupt = false
  let downloads = 0
  const filename = 'AI-Novel-Writer-1.0.3-x64.exe'
  const metadata = { version: '1.0.3', files: [{ url: filename, size: payload.length, sha512 }] }
  const server = http.createServer((request, response) => {
    if (request.url.startsWith('/latest.yml')) {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify(metadata))
    } else if (request.url === `/${filename}`) {
      downloads++
      const bytes = corrupt ? Buffer.from(payload.toString().replace('NON_EXECUTABLE', 'BAD_EXECUTABLE')) : payload
      response.setHeader('Content-Length', bytes.length)
      response.end(bytes)
    } else { response.statusCode = 404; response.end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/`
  try {
    await app.whenReady()
    for (const test of ['valid', 'tampered']) {
      corrupt = test === 'tampered'
      const cache = path.join(directory, test)
      await fs.mkdir(cache)
      const config = path.join(cache, 'app-update.yml')
      await fs.writeFile(config, JSON.stringify({ provider: 'generic', url, updaterCacheDirName: `smoke-${test}` }))
      const adapter = {
        version: '1.0.2', name: 'updater-smoke', isPackaged: true, appUpdateConfigPath: config,
        userDataPath: cache, baseCachePath: cache, whenReady: () => app.whenReady(),
        quit: () => assert.fail('Test must not quit to install'), relaunch: () => assert.fail('Test must not relaunch'),
        onQuit: () => assert.fail('Automatic install on quit must remain disabled'),
      }
      const updater = new NsisUpdater(undefined, adapter)
      updater.httpExecutor = new ElectronHttpExecutor()
      updater.logger = null
      updater.autoDownload = false
      updater.autoInstallOnAppQuit = false
      updater.disableWebInstaller = true
      updater.disableDifferentialDownload = true
      updater.setFeedURL({ provider: 'generic', url })
      updater.on('error', () => undefined)
      const before = downloads
      const result = await updater.checkForUpdates()
      validateManifest(result.updateInfo, { version: '1.0.3', installer: filename })
      assert.equal(downloads, before, 'Checking must not download')
      if (corrupt) {
        await assert.rejects(updater.downloadUpdate(result.cancellationToken), /checksum mismatch/)
      } else {
        const files = await updater.downloadUpdate(result.cancellationToken)
        assert.deepEqual(await fs.readFile(files[0]), payload)
      }
      console.log(`UPDATE_DOWNLOAD_SMOKE ${test}: passed`)
    }
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

async function runIsolated() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'novel-update-smoke-'))
  try {
    const child = spawn(require('electron'), [__filename], {
      env: { ...process.env, AI_NOVEL_UPDATE_TEST_DIR: directory }, stdio: 'inherit', windowsHide: true,
    })
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => child.kill(), 75000)
      child.on('error', error => { clearTimeout(timer); reject(error) })
      child.on('exit', code => { clearTimeout(timer); resolve(code) })
    })
    if (code !== 0) throw new Error(`Update download smoke failed (${code})`)
  } finally {
    const resolved = path.resolve(directory)
    if (!resolved.startsWith(path.join(path.resolve(os.tmpdir()), 'novel-update-smoke-'))) throw new Error('Unsafe test cleanup path')
    await fs.rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

if (process.versions.electron) {
  const timeout = setTimeout(() => { console.error('Update download smoke timed out'); app.exit(1) }, 60000)
  main().then(() => { clearTimeout(timeout); app.exit(0) }).catch(error => {
    clearTimeout(timeout)
    console.error(error)
    app.exit(1)
  })
} else {
  runIsolated().catch(error => { console.error(error); process.exitCode = 1 })
}
