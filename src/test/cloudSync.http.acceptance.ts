// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { AsyncLocalStorage } from 'node:async_hooks'
import { request as httpsRequest } from 'node:https'
import { basename, delimiter, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { useNovelStore } from '@/stores/novel'
import { useCloudSyncStore } from '@/stores/cloudSync'
import { createProjectBackup, type ProjectBackup } from '@/services/projectBackup'
import { emptyProjectWorkspace } from '@/test/projectBackupFixture'
import { hashPayload } from '@/services/cloudSyncModel'

const fixture = vi.hoisted(() => ({
  projects: new Map<string, ProjectBackup>(),
  novelIds: new Map<string, string>(),
  states: new Map<string, any>(),
  conflicts: new Map<string, any[]>(),
}))

const clientContext = new AsyncLocalStorage<string>()

function currentClient(): string {
  const id = clientContext.getStore()
  if (!id) throw new Error('cloud HTTP fixture accessed outside a client context')
  return id
}

vi.mock('@/services/db/cloudSync', () => ({
  readCloudState: async () => structuredClone(fixture.states.get(currentClient()) || {
    binding: null, enabled: false, bases: {}, lastSync: '', approvedUploads: [], pendingUploads: [],
  }),
  readCloudConflicts: async () => structuredClone(fixture.conflicts.get(currentClient()) || []),
  persistCloudState: async (state: any, conflicts: any[] = [], project?: ProjectBackup) => {
    const clientId = currentClient()
    fixture.states.set(clientId, structuredClone(state))
    if (project) {
      fixture.projects.set(clientId, structuredClone(project))
    }
    const previous = fixture.conflicts.get(clientId) || []
    for (const conflict of conflicts) {
      const index = previous.findIndex(item => item.id === conflict.id)
      if (index < 0) previous.push(structuredClone(conflict))
      else previous[index] = structuredClone(conflict)
    }
    fixture.conflicts.set(clientId, previous)
  },
}))

vi.mock('@/services/projectSnapshot', () => ({
  flushProjectState: async () => {},
  captureProjectSnapshot: async () => {
    const project = fixture.projects.get(currentClient())
    if (!project) throw new Error(`missing HTTP fixture project: ${currentClient()}`)
    return structuredClone(project)
  },
  adoptProjectSnapshot: (project: ProjectBackup) => {
    fixture.projects.set(currentClient(), structuredClone(project))
  },
}))

vi.mock('@/services/database', async importOriginal => ({
  ...await importOriginal<any>(),
  retainProjectRestorePoint: async () => {},
}))

interface HttpResult {
  status: number
  body: any
}

interface Client {
  id: string
  pinia: Pinia
  sync: ReturnType<typeof useCloudSyncStore>
}

interface PushObservation {
  client: 'A' | 'B'
  status: number
  key: string
  baseVersion: number
  title: string
}

let dataDirectory = ''
let certificateDirectory = ''
let endpoint = ''
let serverProcess: ChildProcess | undefined
let serverStderr = ''
let previousFetch: typeof globalThis.fetch | undefined
let account = { username: '', password: '' }
const dataDirectoryPrefix = 'novel-cloud-http-data-'
const certificateDirectoryPrefix = 'novel-cloud-http-cert-'

function clone<T>(value: T): T {
  return structuredClone(value)
}

function resolveExecutable(name: string, candidates: string[] = []): string {
  const explicit = name === 'python' ? process.env.CLOUD_SYNC_PYTHON : process.env.CLOUD_SYNC_OPENSSL
  const choices = [explicit, ...candidates].filter((value): value is string => !!value)
  for (const candidate of choices) {
    const result = spawnSync(candidate, ['--version'], { encoding: 'utf8', windowsHide: true })
    if (!result.error && result.status === 0) return candidate
  }
  throw new Error(`cloud HTTP acceptance executable unavailable: ${name}`)
}

function installLoopbackFetch(): void {
  previousFetch = globalThis.fetch
  const loopbackFetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const requestUrl = typeof input === 'string' ? new URL(input) : input instanceof URL ? input : new URL(input.url)
    if (requestUrl.origin !== endpoint) throw new Error(`HTTP acceptance fetch escaped isolated endpoint: ${requestUrl.origin}`)
    const requestHeaders = new Headers(input instanceof Request ? input.headers : init.headers)
    const headers: Record<string, string> = {}
    requestHeaders.forEach((value, key) => { headers[key] = value })
    const body = typeof init.body === 'string' ? init.body : undefined
    return new Promise((resolve, reject) => {
      const request = httpsRequest(requestUrl, {
        method: init.method || (body === undefined ? 'GET' : 'POST'),
        headers,
        rejectUnauthorized: false,
        signal: init.signal ?? undefined,
      }, response => {
        const chunks: Buffer[] = []
        response.on('data', chunk => chunks.push(Buffer.from(chunk)))
        response.once('end', () => {
          const responseHeaders = new Headers()
          for (const [key, value] of Object.entries(response.headers)) {
            if (value !== undefined) responseHeaders.set(key, Array.isArray(value) ? value.join(', ') : value)
          }
          resolve(new Response(Buffer.concat(chunks), {
            status: response.statusCode || 0,
            statusText: response.statusMessage,
            headers: responseHeaders,
          }))
        })
      })
      request.once('error', reject)
      if (body !== undefined) request.write(body)
      request.end()
    })
  }
  globalThis.fetch = loopbackFetch as typeof globalThis.fetch
  if (typeof window !== 'undefined') window.fetch = loopbackFetch as typeof window.fetch
}

function removeTemporaryDirectory(directory: string, prefix: string): void {
  if (!directory) return
  const root = resolve(tmpdir())
  const target = resolve(directory)
  const relativeTarget = relative(root, target)
  if (!relativeTarget || relativeTarget === '..' || relativeTarget.startsWith(`..${sep}`)
    || isAbsolute(relativeTarget) || !basename(target).startsWith(prefix)) {
    throw new Error(`refusing to recursively remove unexpected temporary directory: ${target}`)
  }
  rmSync(target, { recursive: true, force: true })
}

function pythonEnvironment(dataDir: string): NodeJS.ProcessEnv {
  const pythonPath = [process.cwd(), process.env.PYTHONPATH]
    .filter((value): value is string => Boolean(value))
    .join(delimiter)
  return { ...process.env, SYNC_DATA_DIR: dataDir, PYTHONPATH: pythonPath }
}

function allocatePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const listener = createServer()
    listener.once('error', reject)
    listener.listen(0, '127.0.0.1', () => {
      const address = listener.address()
      if (!address || typeof address === 'string') {
        listener.close()
        reject(new Error('could not allocate loopback port'))
        return
      }
      listener.close(error => error ? reject(error) : resolve(address.port))
    })
  })
}

async function waitForHealth(): Promise<{ protocol: number; version: string }> {
  let lastError = ''
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const response = await fetch(`${endpoint}/v1/health`)
      const body = await response.json() as { protocol: number; version: string }
      if (response.ok) return body
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`isolated FastAPI health did not become ready: ${lastError}; ${serverStderr.slice(-500)}`)
}

async function httpRequest(path: string, token?: string, body?: unknown): Promise<HttpResult> {
  const response = await fetch(`${endpoint}/v1/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null }
}

function assertHttp(result: HttpResult, expected: number, label: string): any {
  expect(result.status, label).toBe(expected)
  return result.body
}

function activate(client: Client): void {
  setActivePinia(client.pinia)
  window.location.hash = '#/'
}

async function withClient<T>(client: Client, action: () => Promise<T>): Promise<T> {
  activate(client)
  return clientContext.run(client.id, action)
}

function createBaseProject(): ProjectBackup {
  const pinia = createPinia()
  setActivePinia(pinia)
  const novels = useNovelStore()
  const novel = novels.addNovel({
    genre: '', subGenre: '', tags: [], targetWordCountMin: 1, targetWordCountMax: 2,
    settings: novels.defaultSettings(), writingStyle: novels.defaultWritingStyle(),
  })
  novel.title = '合成 HTTP 基线'
  novel.synopsis = '基线正文只用于本地回归。'
  return createProjectBackup({
    novels: [novel], knowledgeBases: [], chapterRevisions: [], inspirationSessions: [],
    reconstructionWorkspaces: [emptyProjectWorkspace(novel.id)],
  })
}

async function createClient(id: string, project: ProjectBackup): Promise<Client> {
  return clientContext.run(id, async () => {
    fixture.projects.set(id, clone(project))
    fixture.novelIds.set(id, project.novels[0].id)
    fixture.states.set(id, {
      binding: null, enabled: false, bases: {}, lastSync: '', approvedUploads: [], pendingUploads: [],
    })
    fixture.conflicts.set(id, [])
    sessionStorage.clear()
    const pinia = createPinia()
    setActivePinia(pinia)
    const sync = useCloudSyncStore()
    await sync.initialize()
    sync.endpoint = endpoint
    await sync.authenticate('login', account.username, account.password)
    await sync.setEnabled(true)
    if (sync.pendingUploads.length) await sync.approveUploads(sync.pendingUploads.map(item => item.key))
    sync.dispose()
    return { id, pinia, sync }
  })
}

function novelOf(clientId: string) {
  return fixture.projects.get(clientId)!.novels.find(novel => novel.id === fixture.novelIds.get(clientId))!
}

function titleOf(clientId: string): string {
  return novelOf(clientId).title
}

function setTitle(clientId: string, title: string): void {
  const novel = novelOf(clientId)
  novel.title = title
  novel.updatedAt = new Date().toISOString()
}

function tokenOf(client: Client): string {
  const token = client.sync.session?.token
  if (!token) throw new Error(`missing session token for ${client.id}`)
  return token
}

async function pullRecord(token: string, key: string): Promise<any> {
  const body = assertHttp(await httpRequest('sync/pull', token, { keys: [key] }), 200, `pull ${key}`)
  expect(body.records).toHaveLength(1)
  return body.records[0]
}

async function createRace(clientA: Client, clientB: Client, key: string, localTitle: string, remoteTitle: string) {
  setTitle(clientA.id, localTitle)
  setTitle(clientB.id, remoteTitle)
  const tokenA = tokenOf(clientA)
  const tokenB = tokenOf(clientB)
  expect(tokenA).not.toBe(tokenB)

  const originalFetch = globalThis.fetch
  const observations: PushObservation[] = []
  let paused = false
  let releasePause!: () => void
  let markPaused!: () => void
  const pauseReleased = new Promise<void>(resolve => { releasePause = resolve })
  const pushPaused = new Promise<void>(resolve => { markPaused = resolve })

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const headers = new Headers(init?.headers)
    const authorization = headers.get('Authorization') || ''
    const requestBody = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    const isPush = new URL(url).pathname.endsWith('/v1/sync/push')
    if (isPush && authorization === `Bearer ${tokenA}` && !paused) {
      paused = true
      markPaused()
      await pauseReleased
    }
    const response = await originalFetch(input, init)
    if (isPush && requestBody) {
      observations.push({
        client: authorization === `Bearer ${tokenA}` ? 'A' : authorization === `Bearer ${tokenB}` ? 'B' : 'A',
        status: response.status,
        key: requestBody.key,
        baseVersion: requestBody.baseVersion,
        title: requestBody.payload ? JSON.parse(requestBody.payload).novel.title : 'deleted',
      })
    }
    return response
  }

  try {
    const clientASync = withClient(clientA, () => clientA.sync.syncNow())
    await Promise.race([
      pushPaused,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('client A did not reach its real push request')), 15000)),
    ])
    await withClient(clientB, () => clientB.sync.syncNow())
    activate(clientA)
    releasePause()
    await clientASync
  } finally {
    releasePause()
    globalThis.fetch = originalFetch
  }

  const conflict = clientA.sync.pendingConflicts.find(item => item.key === key)
  expect(conflict).toBeDefined()
  expect(conflict!.local).toContain(localTitle)
  expect(conflict!.remote).toContain(remoteTitle)
  expect(titleOf(clientA.id)).toBe(localTitle)
  const remote = await pullRecord(tokenA, key)
  expect(remote.version).toBe(2)
  expect(remote.payload).toContain(remoteTitle)
  expect(await hashPayload(remote.payload)).toBe(remote.hash)
  return { conflict: conflict!, observations, remote }
}

async function resolveAndSync(client: Client, conflictId: string, choice: 'local' | 'remote', key: string) {
  await withClient(client, () => client.sync.resolveConflict(conflictId, choice))
  client.sync.dispose()
  expect(client.sync.pendingConflicts).toHaveLength(0)
  const archive = client.sync.conflicts.find(item => item.id === conflictId)
  expect(archive?.resolution).toBe(choice)
  const before = await pullRecord(tokenOf(client), key)
  await withClient(client, () => client.sync.syncNow())
  const after = await pullRecord(tokenOf(client), key)
  return { archive, before, after }
}

describe('真实 FastAPI 双客户端云冲突验收', () => {
  beforeAll(async () => {
    dataDirectory = mkdtempSync(join(tmpdir(), dataDirectoryPrefix))
    certificateDirectory = mkdtempSync(join(tmpdir(), certificateDirectoryPrefix))
    const python = resolveExecutable('python', [
      'python',
      'python3',
    ])
    const openssl = resolveExecutable('openssl', [
      'openssl',
      'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
      'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe',
    ])
    const keyFile = join(certificateDirectory, 'key.pem')
    const certificateFile = join(certificateDirectory, 'cert.pem')
    const certificate = spawnSync(openssl, [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', certificateFile,
      '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1',
    ], { encoding: 'utf8', windowsHide: true })
    if (certificate.error || certificate.status !== 0) throw new Error('could not create temporary loopback certificate')
    installLoopbackFetch()

    const invite = spawnSync(python, ['-m', 'server.manage', '--data-dir', dataDirectory, 'invite', '--uses', '1'], {
      cwd: process.cwd(), encoding: 'utf8', windowsHide: true, env: pythonEnvironment(dataDirectory),
    })
    if (invite.error || invite.status !== 0 || !invite.stdout.trim()) throw new Error('could not create synthetic local invitation')

    const port = await allocatePort()
    endpoint = `https://127.0.0.1:${port}`
    serverProcess = spawn(python, [
      '-m', 'uvicorn', 'server.app:create_app', '--factory', '--host', '127.0.0.1', '--port', String(port),
      '--ssl-keyfile', keyFile, '--ssl-certfile', certificateFile, '--no-access-log', '--log-level', 'warning',
    ], {
      cwd: process.cwd(), windowsHide: true,
      env: pythonEnvironment(dataDirectory),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    serverProcess.stderr?.on('data', chunk => { serverStderr += String(chunk) })
    const health = await waitForHealth()
    expect(health.protocol).toBe(1)

    account = { username: 'httpconflict1109', password: 'synthetic-http-password-1109' }
    const registered = assertHttp(await httpRequest('auth/register', undefined, {
      username: account.username, password: account.password, invite: invite.stdout.trim(),
    }), 200, 'synthetic account registration')
    expect(registered.user.username).toBe(account.username)
    assertHttp(await httpRequest('auth/logout', registered.token, {}), 200, 'registration session cleanup')
  }, 120000)

  afterAll(async () => {
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill()
      await Promise.race([
        once(serverProcess, 'exit'),
        new Promise(resolve => setTimeout(resolve, 1000)),
      ])
    }
    removeTemporaryDirectory(dataDirectory, dataDirectoryPrefix)
    removeTemporaryDirectory(certificateDirectory, certificateDirectoryPrefix)
    if (previousFetch) {
      globalThis.fetch = previousFetch
      if (typeof window !== 'undefined') window.fetch = previousFetch
    }
  })

  it('uses two independent clients for 409 preservation, local/cloud decisions and manual merge upload', async () => {
    const localProject = createBaseProject()
    const localKey = `novel:${localProject.novels[0].id}`
    const localA = await createClient('local-A', localProject)
    const localB = await createClient('local-B', localProject)
    const localConflict = await createRace(localA, localB, localKey, '本机选择版本', '云端选择版本')
    expect(localConflict.observations.map(item => [item.client, item.status, item.baseVersion])).toEqual(expect.arrayContaining([
      ['A', 409, 1], ['B', 200, 1],
    ]))
    const localResult = await resolveAndSync(localA, localConflict.conflict.id, 'local', localKey)
    expect(localResult.before.version).toBe(2)
    expect(localResult.after.version).toBe(3)
    expect(localResult.after.payload).toContain('本机选择版本')
    expect(localResult.after.payload).not.toContain('云端选择版本')
    expect(await hashPayload(localResult.after.payload)).toBe(localResult.after.hash)

    const remoteProject = createBaseProject()
    const remoteKey = `novel:${remoteProject.novels[0].id}`
    const remoteA = await createClient('remote-A', remoteProject)
    const remoteB = await createClient('remote-B', remoteProject)
    const remoteConflict = await createRace(remoteA, remoteB, remoteKey, '本机被保留副本', '云端最终版本')
    const remoteResult = await resolveAndSync(remoteA, remoteConflict.conflict.id, 'remote', remoteKey)
    expect(remoteResult.before.version).toBe(2)
    expect(remoteResult.after.version).toBe(2)
    expect(titleOf(remoteA.id)).toBe('云端最终版本')
    expect(remoteResult.after.payload).toContain('云端最终版本')
    expect(remoteResult.archive?.local).toContain('本机被保留副本')
    expect(remoteResult.archive?.remote).toContain('云端最终版本')

    const mergeProject = createBaseProject()
    const mergeKey = `novel:${mergeProject.novels[0].id}`
    const mergeA = await createClient('merge-A', mergeProject)
    const mergeB = await createClient('merge-B', mergeProject)
    const mergeConflict = await createRace(mergeA, mergeB, mergeKey, '本机段落', '云端段落')
    await withClient(mergeA, () => mergeA.sync.resolveConflict(mergeConflict.conflict.id, 'local'))
    mergeA.sync.dispose()
    const mergedTitle = '合并稿：本机段落＋云端段落'
    setTitle(mergeA.id, mergedTitle)
    const mergedResult = await withClient(mergeA, () => mergeA.sync.syncNow())
    expect(mergedResult).toBeUndefined()
    const mergedRecord = await pullRecord(tokenOf(mergeA), mergeKey)
    expect(mergedRecord.version).toBe(3)
    expect(mergedRecord.payload).toContain(mergedTitle)
    expect(await hashPayload(mergedRecord.payload)).toBe(mergedRecord.hash)
    expect(mergeA.sync.conflicts.find(item => item.id === mergeConflict.conflict.id)?.resolution).toBe('local')

    const summary = {
      endpoint: `https://127.0.0.1:${new URL(endpoint).port}`,
      protocol: 1,
      sameBaseRevision: 1,
      real409: localConflict.observations.find(item => item.client === 'A'),
      real200: localConflict.observations.find(item => item.client === 'B'),
      serverAfterRace: { version: localConflict.remote.version, hash: localConflict.remote.hash, title: JSON.parse(localConflict.remote.payload).novel.title },
      localChoice: { version: localResult.after.version, hash: localResult.after.hash, title: JSON.parse(localResult.after.payload).novel.title, alternatePreserved: !!localResult.archive?.remote },
      remoteChoice: { version: remoteResult.after.version, hash: remoteResult.after.hash, title: JSON.parse(remoteResult.after.payload).novel.title, alternatePreserved: !!remoteResult.archive?.local },
      manualMerge: { version: mergedRecord.version, hash: mergedRecord.hash, title: JSON.parse(mergedRecord.payload).novel.title },
    }
    if (process.env.CLOUD_SYNC_HTTP_REPORT) {
      writeFileSync(process.env.CLOUD_SYNC_HTTP_REPORT, JSON.stringify(summary, null, 2) + '\n')
    }
    console.log(`CLOUD_HTTP_CONFLICT_ACCEPTANCE ${JSON.stringify(summary)}`)
  }, 120000)
})
