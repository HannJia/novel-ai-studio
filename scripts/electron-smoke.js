const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const projectRoot = path.resolve(__dirname, '..')
const expectedVersion = require('../package.json').version
const devServerUrl = 'http://localhost:5173'

function serverReady() {
  return new Promise(resolve => {
    const request = http.get(devServerUrl, response => {
      response.resume()
      resolve(response.statusCode >= 200 && response.statusCode < 500)
    })
    request.setTimeout(1_000, () => request.destroy())
    request.on('error', () => resolve(false))
  })
}

async function waitForServer(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await serverReady()) return
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('Vite 开发服务器启动超时')
}

async function main() {
  const packaged = process.argv.includes('--packaged')
  let viteProcess = null
  if (!packaged && !(await serverReady())) {
    viteProcess = spawn(process.execPath, [
      path.join(projectRoot, 'node_modules/vite/bin/vite.js'),
      '--host', 'localhost', '--port', '5173', '--strictPort',
    ], { cwd: projectRoot, stdio: ['ignore', 'pipe', 'pipe'] })
    await waitForServer()
  }

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-novel-writer-smoke-'))
  const electronPath = packaged
    ? path.join(projectRoot, 'release', 'win-unpacked', 'AI Novel Writer.exe')
    : require('electron')
  if (!fs.existsSync(electronPath)) throw new Error(`找不到 Electron 可执行文件：${electronPath}`)
  let output = ''
  try {
    const child = spawn(electronPath, packaged ? [] : [projectRoot], {
      cwd: projectRoot,
      env: {
        ...process.env,
        AI_NOVEL_WRITER_SMOKE_TEST: '1',
        AI_NOVEL_WRITER_SMOKE_USER_DATA: userData,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'false',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', chunk => { output += chunk.toString() })
    child.stderr.on('data', chunk => { output += chunk.toString() })
    const exitCode = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill()
        reject(new Error('Electron 冒烟测试超时'))
      }, 60_000)
      child.on('error', reject)
      child.on('exit', code => {
        clearTimeout(timer)
        resolve(code)
      })
    })
    const match = output.match(/ELECTRON_SMOKE_RESULT (\{[^\n]+\})/)
    if (exitCode !== 0 || !match) throw new Error(`Electron 冒烟测试失败（退出码 ${exitCode}）\n${output}`)
    const result = JSON.parse(match[1])
    if (!result.rendered || !result.bridgeAvailable || !result.nodeIsolated) {
      throw new Error(`Electron 安全检查未通过：${JSON.stringify(result)}`)
    }
    if (result.appVersion !== expectedVersion) {
      throw new Error(`Electron 版本不一致：期望 ${expectedVersion}，实际 ${result.appVersion}`)
    }
    console.log(`Electron smoke passed: ${JSON.stringify(result)}`)
  } finally {
    if (viteProcess) viteProcess.kill()
    fs.rmSync(userData, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
