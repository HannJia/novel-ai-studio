const fs = require('fs')
const http = require('http')
const net = require('net')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const projectRoot = path.resolve(__dirname, '..')
const expectedVersion = require('../package.json').version
const devServerUrl = 'http://localhost:5173'

function serverReady(url = devServerUrl) {
  return new Promise(resolve => {
    const request = http.get(url, response => {
      response.resume()
      resolve(response.statusCode >= 200 && response.statusCode < 500)
    })
    request.setTimeout(1_000, () => request.destroy())
    request.on('error', () => resolve(false))
  })
}

async function waitForServer(url = devServerUrl, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await serverReady(url)) return
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('Vite 开发服务器启动超时')
}

function fetchText(url, timeoutMs = 2_000) {
  return new Promise(resolve => {
    let body = ''
    const request = http.get(url, response => {
      response.setEncoding('utf8')
      response.on('data', chunk => { body += chunk })
      response.on('end', () => resolve({ statusCode: response.statusCode, body }))
    })
    request.setTimeout(timeoutMs, () => request.destroy())
    request.on('error', () => resolve(null))
  })
}

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('无法为隔离 Electron smoke 分配本地端口'))
        return
      }
      server.close(error => error ? reject(error) : resolve(address.port))
    })
  })
}

async function waitForWorkflowDependencies(baseUrl, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  let lastState = []
  while (Date.now() < deadline) {
    const editor = await fetchText(new URL('/src/v3/editor/PlainTextEditor.vue', baseUrl))
    lastState = [{ editorStatus: editor?.statusCode ?? 'unavailable' }]
    if (editor?.statusCode === 200) {
      const dependencies = [...new Set([...editor.body.matchAll(/(?:from\s*|import\s*(?:\(\s*)?)["']([^"']+)["']/g)]
        .map(match => match[1]).filter(url => url.startsWith('/node_modules/.vite/deps/') || (url.startsWith('/@fs/') && url.includes('/deps/'))))]
      lastState = [{ optimizedDependencyCount: dependencies.length }]
      if (dependencies.length) {
        const results = await Promise.all(dependencies.map(async dependency => {
          const result = await fetchText(new URL(dependency, baseUrl))
          return { dependency, statusCode: result?.statusCode ?? 'unavailable' }
        }))
        lastState = results.filter(result => result.statusCode !== 200)
        if (!lastState.length) {
          const writeView = await fetchText(new URL('/src/v3/write/WriteView.vue', baseUrl))
          if (writeView?.statusCode === 200) return
        }
      }
    }
    await sleep(400)
  }
  throw new Error('Vite 写作页依赖未就绪：' + JSON.stringify(lastState))
}

function waitForProcessExit(child, timeoutMs = 5_000) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); resolve() }
    const timer = setTimeout(finish, timeoutMs)
    child.once('close', finish)
  })
}

function removeSmokeViteCache(cacheDir) {
  const absolutePath = path.resolve(cacheDir)
  if (path.dirname(absolutePath) !== path.resolve(os.tmpdir())
    || !path.basename(absolutePath).startsWith('mojian-vite-smoke-')) {
    throw new Error('Unexpected smoke Vite cache root')
  }
  fs.rmSync(absolutePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}

async function main() {
  const packaged = process.argv.includes('--packaged')
  const clipboardScenario = process.argv.find(argument => argument.startsWith('--clipboard-scenario='))?.slice('--clipboard-scenario='.length) || 'normal'
  if (!['normal', 'custom-format', 'changed-during-test'].includes(clipboardScenario)) throw new Error('Unsupported clipboard smoke scenario')
  if (packaged && clipboardScenario === 'custom-format') throw new Error('Custom-format clipboard smoke is development-only')
  const clipboard = process.argv.includes('--clipboard') || clipboardScenario !== 'normal'
  const workflow = process.argv.includes('--workflow')
  const workflowKind = process.argv.find(argument => argument.startsWith('--workflow-kind='))?.slice('--workflow-kind='.length) || 'integrated'
  if (!['integrated', 'creation', 'visual', 'deep', 'selection', 'shelf-resume'].includes(workflowKind) || (!workflow && workflowKind !== 'integrated')) throw new Error('Unsupported smoke workflow kind')
  const requestedEvidencePrefix = process.env.AI_NOVEL_WRITER_SMOKE_EVIDENCE_PREFIX?.trim()
  if (requestedEvidencePrefix && !/^[a-z0-9._-]+$/i.test(requestedEvidencePrefix)) throw new Error('Invalid smoke evidence prefix')
  const workflowPhase = process.argv.find(argument => argument.startsWith('--workflow-phase='))?.slice('--workflow-phase='.length)
  const workflowPhases = workflow
    ? (workflowPhase ? [workflowPhase]
      : workflowKind === 'shelf-resume' ? ['resume']
        : workflowKind === 'selection' ? ['selection']
        : workflowKind === 'visual' ? ['visual']
          : workflowKind === 'deep' ? ['deep']
          : ['write', 'reopen', 'verify-stale'])
    : ['']
  if (workflowKind === 'visual' && (!workflow || (workflowPhase && workflowPhase !== 'visual'))) throw new Error('Visual smoke requires --workflow-phase=visual')
  if (workflowKind === 'deep' && (!workflow || (workflowPhase && workflowPhase !== 'deep'))) throw new Error('Deep visual smoke requires --workflow-phase=deep')
  if (workflowKind === 'selection' && (!workflow || (workflowPhase && workflowPhase !== 'selection'))) throw new Error('Selection smoke requires --workflow-phase=selection')
  if (workflowKind === 'shelf-resume' && (!workflow || (workflowPhase && workflowPhase !== 'resume'))) throw new Error('Shelf resume smoke requires --workflow-phase=resume')
  const timeoutMs = Number(process.env.AI_NOVEL_WRITER_SMOKE_TIMEOUT_MS) || (workflow ? 120_000 : 60_000)
  if (workflow && packaged) throw new Error('V2 workflow fixtures are development-only')
  let viteProcess = null
  let viteCacheDir = null
  let smokeViteUrl = devServerUrl
  if (!packaged && workflow) {
    const port = await findAvailablePort()
    smokeViteUrl = `http://127.0.0.1:${port}`
    viteCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mojian-vite-smoke-'))
    viteProcess = spawn(process.execPath, [
      path.join(projectRoot, 'node_modules/vite/bin/vite.js'),
      '--host', '127.0.0.1', '--port', String(port), '--strictPort',
    ], {
      cwd: projectRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, MOJIAN_VITE_CACHE_DIR: viteCacheDir },
    })
    viteProcess.stdout.resume()
    viteProcess.stderr.resume()
    try {
      await waitForServer(smokeViteUrl)
      await waitForWorkflowDependencies(smokeViteUrl, Number(process.env.AI_NOVEL_WRITER_SMOKE_TIMEOUT_MS) || 180_000)
    } catch (error) {
      viteProcess.kill()
      await waitForProcessExit(viteProcess)
      removeSmokeViteCache(viteCacheDir)
      throw error
    }
  } else if (!packaged && !(await serverReady())) {
    viteProcess = spawn(process.execPath, [
      path.join(projectRoot, 'node_modules/vite/bin/vite.js'),
      '--host', 'localhost', '--port', '5173', '--strictPort',
    ], { cwd: projectRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    viteProcess.stdout.resume()
    viteProcess.stderr.resume()
    try { await waitForServer() } catch (error) { viteProcess.kill(); await waitForProcessExit(viteProcess); throw error }
  }

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-novel-writer-smoke-'))
  const electronPath = packaged
    ? path.join(projectRoot, 'release', 'win-unpacked', 'AI Novel Writer.exe')
    : require('electron')
  if (!fs.existsSync(electronPath)) throw new Error(`找不到 Electron 可执行文件：${electronPath}`)
  let output = ''
  let creationIdentity = null
  try {
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    delete env.AI_NOVEL_WRITER_SMOKE_WORKFLOW
    delete env.AI_NOVEL_WRITER_SMOKE_WORKFLOW_KIND
    for (const phase of workflowPhases) {
      output = ''
      const child = spawn(electronPath, packaged ? [] : [projectRoot], {
        cwd: projectRoot,
        windowsHide: true,
        env: {
          ...env,
          AI_NOVEL_WRITER_SMOKE_TEST: '1',
          AI_NOVEL_WRITER_SMOKE_USER_DATA: userData,
          AI_NOVEL_WRITER_SMOKE_VITE_URL: smokeViteUrl,
          AI_NOVEL_WRITER_SMOKE_CLIPBOARD: clipboard ? '1' : '0',
          AI_NOVEL_WRITER_SMOKE_CLIPBOARD_SCENARIO: clipboardScenario,
          ...(phase ? { AI_NOVEL_WRITER_SMOKE_WORKFLOW: phase, AI_NOVEL_WRITER_SMOKE_WORKFLOW_KIND: workflowKind } : {}),
          ELECTRON_DISABLE_SECURITY_WARNINGS: 'false',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      child.stdout.on('data', chunk => { output += chunk.toString() })
      child.stderr.on('data', chunk => { output += chunk.toString() })
      const exitCode = await new Promise((resolve, reject) => {
        let timedOut = false
        const timer = setTimeout(() => {
          timedOut = true
          child.kill()
        }, timeoutMs)
        child.on('error', error => { clearTimeout(timer); reject(error) })
        child.on('close', code => {
          clearTimeout(timer)
          if (timedOut) reject(new Error(`Electron 冒烟测试超时\n${output}`))
          else resolve(code)
        })
      })
      let match = output.match(/ELECTRON_SMOKE_RESULT (\{[^\n]+\})/)
      if (!match) {
        const resultPath = path.join(userData, 'electron-smoke-result.json')
        try {
          const saved = JSON.parse(fs.readFileSync(resultPath, 'utf8'))
          match = ['ELECTRON_SMOKE_RESULT ' + JSON.stringify(saved), JSON.stringify(saved)]
        } catch { /* The renderer failed before producing a smoke result. */ }
      }
      if (exitCode !== 0 || !match) throw new Error(`Electron 冒烟测试失败（退出码 ${exitCode}）\n${output}`)
      const result = JSON.parse(match[1])
      const cloudSessionCheckPassed = result.cloudSession === true
        || (result.cloudSessionUnavailable === true && result.security?.encryptionAvailable === false)
      if (!result.rendered || !result.bridgeAvailable || !result.nodeIsolated || !cloudSessionCheckPassed || !result.projectStorage) {
        throw new Error(`Electron 安全检查未通过：${JSON.stringify(result)}`)
      }
      if (result.appVersion !== expectedVersion) {
        throw new Error(`Electron 版本不一致：期望 ${expectedVersion}，实际 ${result.appVersion}`)
      }
      if (result.update?.currentVersion !== expectedVersion || result.update?.supported !== false) {
        throw new Error('更新桥接或冒烟测试的安装隔离未通过')
      }
      if (process.env.AI_NOVEL_WRITER_SMOKE_CLOUD === '1' && result.cloudHealth !== true) {
        throw new Error('安装版 HTTPS 云同步连接检查未通过')
      }
      if (phase && (result.workflow?.phase !== phase || result.workflow?.passed !== true)) {
        throw new Error(`V2 workflow did not complete: ${JSON.stringify(result.workflow)}`)
      }
      if (phase && workflowKind === 'creation' && result.workflow?.kind !== 'creation') throw new Error('Creation workflow did not execute')
      if (phase && workflowKind === 'shelf-resume') {
        const state = result.workflow
        const expectedPath = `/write/${state?.novelId}/${state?.chapterId}`
        if (state?.kind !== 'shelf-resume' || state.beforePath !== '/' || state.afterPath !== expectedPath
          || state.pageMarker !== 'write-page' || state.runtimeErrors !== 0 || state.modelRequests !== 0) {
          throw new Error('Shelf resume navigation failed: ' + JSON.stringify(state))
        }
        const evidence = path.join(projectRoot, '.local-recovery', 'verification')
        fs.mkdirSync(evidence, { recursive: true })
        const prefix = requestedEvidencePrefix || 'v3-shelf-resume-electron'
        fs.writeFileSync(path.join(evidence, `${prefix}-result.json`), JSON.stringify(state, null, 2))
      }
      if (phase && workflowKind === 'selection') {
        const states = result.workflow?.states
        if (result.workflow?.kind !== 'selection' || states?.length !== 9) throw new Error('Selection workflow did not capture all theme and viewport states')
        for (const state of states) {
          if (state.selectedText !== '雨是从黄昏开始下的，'
            || state.viewportWidth !== state.documentWidth || state.viewportWidth !== state.bodyWidth
            || state.toolbar.left < state.writingColumn.left - 1 || state.toolbar.right > state.writingColumn.right + 1
            || !state.toolbarText.includes('润色') || !state.toolbarText.includes('改写') || !state.toolbarText.includes('问 AI')) {
            throw new Error('Selection toolbar geometry failed: ' + JSON.stringify(state))
          }
          const evidence = path.join(projectRoot, '.local-recovery', 'verification')
          fs.mkdirSync(evidence, { recursive: true })
          const prefix = requestedEvidencePrefix || 'v3-selection'
          fs.copyFileSync(path.join(userData, state.fileName), path.join(evidence, `${prefix}-${state.theme}-${state.viewportWidth}.png`))
        }
        const evidence = path.join(projectRoot, '.local-recovery', 'verification')
        fs.writeFileSync(path.join(evidence, (requestedEvidencePrefix || 'v3-selection') + '-geometry-20261111.json'), JSON.stringify({
          date: '2026-11-11', expectedStates: 9, actualStates: states.length, states,
        }, null, 2))
      }
      if (phase && workflowKind === 'visual') {
        const states = result.workflow?.states
        if (result.workflow?.kind !== 'visual' || states?.length !== 18) throw new Error('Dense visual workflow did not capture all 18 states')
        for (const state of states) {
          if (state.viewportWidth !== state.documentWidth || state.viewportWidth !== state.bodyWidth
            || state.viewportWidth !== state.screenshotWidth || state.chapters !== 64 || state.renderedChapters < 1
            || state.pageMarker !== (state.route === 'plan' ? '结构与规划三栏总览' : '审校中心')
            || state.onboardingOpen || state.runtimeErrors !== 0 || state.modelRequests !== 0
            || (state.route === 'plan' && state.volumeGroups !== 4)
            || (state.route === 'review' && state.renderedChapters !== 64)
            || (state.route === 'plan' && (state.arcLanes < 4 || state.foreshadowRows < 4))
            || (state.route === 'review' && state.staleChapterCount !== 3)) {
            throw new Error('Dense visual state failed: ' + JSON.stringify(state))
          }
        }
        const evidence = path.join(projectRoot, '.local-recovery', 'verification')
        fs.mkdirSync(evidence, { recursive: true })
        for (const state of states) {
          const name = (requestedEvidencePrefix || 'v3-dense') + '-' + state.route + '-' + state.theme + '-' + state.viewportWidth + '-20261111.png'
          fs.copyFileSync(path.join(userData, state.fileName), path.join(evidence, name))
        }
        fs.writeFileSync(path.join(evidence, (requestedEvidencePrefix || 'v3-dense') + '-state-matrix-20261111.json'), JSON.stringify({
          date: '2026-11-11',
          fixture: result.workflow.fixture,
          expectedStates: 18,
          actualStates: states.length,
          states,
        }, null, 2))
      }
      if (phase && workflowKind === 'deep') {
        const now = new Date()
        const evidenceDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
        const evidenceDateStamp = evidenceDate.replace(/-/g, '')
        const states = result.workflow?.states
        if (result.workflow?.kind !== 'deep' || states?.length !== 36) throw new Error('Deep visual workflow did not capture all 36 states')
        for (const state of states) {
          if (state.viewportWidth !== state.documentWidth || state.viewportWidth !== state.bodyWidth
            || state.viewportWidth !== state.screenshotWidth || state.modalOpen !== (state.route === 'write')
            || state.runtimeErrors !== 0 || state.modelRequests !== 0 || !state.pageMarker) {
            throw new Error('Deep visual state failed: ' + JSON.stringify(state))
          }
          const expectedMarker = { 'auto-running': '运行中', 'auto-checkpoint': '等待作者确认',
            'gate-modal': '完成本章前核对', 'canon-modal': '定稿前核对' }[state.state]
          if (!expectedMarker || !state.pageMarker.startsWith(expectedMarker)) throw new Error('Deep visual state marker mismatch: ' + JSON.stringify(state))
          if (state.state === 'canon-modal' && (state.canonHistoryCount !== 1 || state.pendingCandidateCount !== 1
            || ['故事时间', '全章审校', '章节总结'].some(label => !state.gateRows?.some(row => row.label === label && row.state === 'ok')))) {
            throw new Error('Deep finalization state lacks current sources or Canon decisions: ' + JSON.stringify(state))
          }
        }
        const evidence = path.join(projectRoot, '.local-recovery', 'verification')
        fs.mkdirSync(evidence, { recursive: true })
        const evidenceStates = states.map(state => {
          const name = (requestedEvidencePrefix || 'v3-deep-current') + '-' + state.state + '-' + state.theme + '-' + state.viewportWidth + '-' + evidenceDateStamp + '.png'
          fs.copyFileSync(path.join(userData, state.fileName), path.join(evidence, name))
          return { ...state, fileName: name }
        })
        fs.writeFileSync(path.join(evidence, (requestedEvidencePrefix || 'v3-deep-current') + '-state-matrix-' + evidenceDateStamp + '.json'), JSON.stringify({
          date: evidenceDate, fixture: result.workflow.fixture, expectedStates: 36, actualStates: evidenceStates.length, states: evidenceStates,
        }, null, 2))
      }
      if (phase && workflowKind === 'creation') {
        const creation = result.workflow
        if (typeof creation.novelId !== 'string' || typeof creation.chapterId !== 'string') throw new Error('Creation identity evidence missing')
        if (phase === 'write') creationIdentity = { novelId: creation.novelId, chapterId: creation.chapterId }
        else if (!creationIdentity || creation.novelId !== creationIdentity.novelId || creation.chapterId !== creationIdentity.chapterId) {
          throw new Error('Creation project or chapter identity changed across processes')
        }
      }
      if (clipboard) {
        const clipboardResult = result.clipboard
        if (clipboardScenario === 'custom-format') {
          if (clipboardResult?.skipped !== true
            || clipboardResult?.limitationCodes?.includes('unsupported-custom-formats') !== true
            || clipboardResult?.customFormatInjected !== true
            || clipboardResult?.customFormatReadback !== true
            || clipboardResult?.restored !== true) {
            throw new Error(`Electron 自定义剪贴板格式保护未通过：${JSON.stringify(clipboardResult)}`)
          }
        } else {
          const restorationWasSafe = clipboardResult?.restored === true
            || clipboardResult?.restorationSkipped === 'clipboard-changed-during-test'
          if (clipboardResult?.rendererToPreloadIpc !== true
            || clipboardResult?.mainReadback !== true
            || clipboardResult?.writeVerified !== true
            || (clipboardScenario === 'changed-during-test' && clipboardResult?.externalChangeInjected !== true)
            || !restorationWasSafe
            || (clipboardScenario === 'changed-during-test'
              && (clipboardResult?.restorationSkipped !== 'clipboard-changed-during-test'
                || clipboardResult?.restored !== true))) {
            throw new Error(`Electron 剪贴板冒烟未通过：${JSON.stringify({
              scenario: clipboardScenario,
              rendererToPreloadIpc: clipboardResult?.rendererToPreloadIpc,
              mainReadback: clipboardResult?.mainReadback,
              writeVerified: clipboardResult?.writeVerified,
              restored: clipboardResult?.restored,
              restorationSkipped: clipboardResult?.restorationSkipped,
              limitationCodes: clipboardResult?.limitationCodes,
            })}`)
          }
        }
      }
      if (phase && !['visual', 'deep'].includes(workflowKind)) {
        const evidence = path.join(projectRoot, '.local-recovery', 'verification')
        fs.mkdirSync(evidence, { recursive: true })
        const evidencePrefix = requestedEvidencePrefix || (workflowKind === 'creation' ? 'v3-creation-desktop' : workflowKind === 'selection' ? 'v3-selection-desktop' : workflowKind === 'shelf-resume' ? 'v3-shelf-resume-electron' : 'v2-desktop')
        fs.copyFileSync(path.join(userData, `workflow-${phase}.png`), path.join(evidence, `${evidencePrefix}-${phase}.png`))
      }
      console.log(`Electron smoke passed: ${JSON.stringify(result)}`)
    }
  } finally {
    if (viteProcess) {
      viteProcess.kill()
      await waitForProcessExit(viteProcess)
    }
    if (viteCacheDir) removeSmokeViteCache(viteCacheDir)
    if (path.dirname(userData) !== os.tmpdir() || !path.basename(userData).startsWith('ai-novel-writer-smoke-')) throw new Error('Unexpected smoke data root')
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
