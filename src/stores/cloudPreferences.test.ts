// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { createPinia, setActivePinia } from 'pinia'
import { reactive, watch } from 'vue'
import { useConfigStore } from './config'
import { useCloudPreferencesStore } from './cloudPreferences'
import { useThemeStore } from './theme'
import { hashPayload, canonicalJson } from '@/services/cloudSyncModel'
import { parsePreferences, settingsDigest, splitConfig } from '@/services/configSync'
import { sealVault } from '@/services/configVault'
import { activeAiCount } from '@/services/aiActivity'
import { cloudApplyBusy, cloudPreferencesBusy, cloudConfigApplying } from '@/services/appLifecycle'

const memory = vi.hoisted(() => ({ cloud: null as any, remote: null as any, supported: true, posts: [] as any[],
  disk: '', failWrite: false, key: '', keyRequests: 0, onGet: null as null | (() => void | Promise<void>), onPost: null as null | (() => void) }))
vi.mock('./cloudSync', () => ({ useCloudSyncStore: () => memory.cloud }))
vi.mock('@/services/aiTaskQueue', () => ({ chapterBackgroundQueue: { pendingCount: 0 } }))
vi.mock('@/services/cloudSyncApi', () => ({ cloudRequest: async (_endpoint: string, path: string, options: any = {}) => {
  if (path === 'health') return { features: memory.supported ? ['preferences-v1', 'preferences-account-key-v1'] : ['preferences-v1'] }
  if (path === 'sync/preferences/key') { memory.keyRequests++; return { schema: 1, key: memory.key } }
  if (path !== 'sync/preferences') throw Error('Unexpected API')
  if (!options.body) { await memory.onGet?.(); return { record: structuredClone(memory.remote) } }
  memory.posts.push(structuredClone(options.body))
  memory.onPost?.()
  if (options.body.baseVersion !== (memory.remote?.version || 0)) throw Error('版本冲突')
  memory.remote = { version: options.body.baseVersion + 1, payload: options.body.payload, hash: await hashPayload(options.body.payload), updatedAt: Date.now() }
  return { record: structuredClone(memory.remote) }
} }))
const legacyPassword = 'synthetic-recovery-phrase'
let prefs: ReturnType<typeof useCloudPreferencesStore>
let config: ReturnType<typeof useConfigStore>
function addModel(secret = 'fixture-model-credential') {
  config.addModel({ name: '测试模型', baseUrl: 'https://example.test/v1', apiKey: secret, modelName: 'model-test', maxTokens: 4096, temperature: 0.7, topP: 1 })
}
async function start() {
  setActivePinia(createPinia())
  config = useConfigStore()
  await config.loadConfig()
  useThemeStore().initTheme()
  prefs = useCloudPreferencesStore()
  await prefs.initialize()
}
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto)
  window.location.hash = '#/'
  localStorage.clear(); sessionStorage.clear()
  activeAiCount.value = 0
  cloudApplyBusy.value = false; cloudPreferencesBusy.value = false; cloudConfigApplying.value = false
  Object.assign(memory, { remote: null, supported: true, posts: [], disk: '', failWrite: false, key: btoa('0123456789abcdef0123456789abcdef'), keyRequests: 0, onGet: null, onPost: null })
  memory.cloud = reactive({ session: { endpoint: 'https://sync.example.test', token: 'fixture-login', user: { id: 'account-a', username: 'author' } }, busy: false })
  window.electronAPI = {
    configRead: async () => memory.disk,
    configWrite: async (data: string) => { if (memory.failWrite) throw Error('磁盘失败'); memory.disk = data },
    configEncrypt: async (data: string) => data ? 'enc:' + btoa(data) : '',
    configDecrypt: async (data: string) => data.startsWith('enc:') ? atob(data.slice(4)) : data,
    configSecurityStatus: async () => ({ encryptionAvailable: true }),
  } as any
  await start()
})
afterEach(() => {
  prefs.dispose(); window.electronAPI = undefined; vi.unstubAllGlobals(); vi.restoreAllMocks()
  activeAiCount.value = 0; cloudApplyBusy.value = false; cloudPreferencesBusy.value = false; cloudConfigApplying.value = false
})
async function createCloud() { addModel(); await config.saveConfig(); await prefs.setEnabled(true) }
async function emptyMachine() {
  prefs.dispose(); memory.disk = ''; localStorage.clear(); sessionStorage.clear()
  await start()
}
async function captureTick() {
  prefs.dispose()
  let interval!: () => void
  vi.spyOn(globalThis, 'setInterval').mockImplementation(callback => { interval = callback as () => void; return 1 as any })
  await start()
  return () => interval()
}
async function legacyCloud() {
  addModel(); await config.saveConfig()
  const selected = splitConfig(config.exportConfig(), useThemeStore().currentTheme)
  const vault = await sealVault(selected.secrets, legacyPassword, { endpoint: memory.cloud.session.endpoint,
    userId: memory.cloud.session.user.id, settingsHash: await settingsDigest(selected.settings) })
  const payload = canonicalJson({ schema: 1, settings: selected.settings, vault })
  memory.remote = { version: 1, payload, hash: await hashPayload(payload), updatedAt: Date.now() }
  await emptyMachine()
}

describe('账号授权的自动配置同步', () => {
  it('requires opt-in, then automatically uploads without another password or plaintext secret', async () => {
    addModel(); await config.saveConfig()
    await prefs.syncNow()
    expect(memory.posts).toHaveLength(0)
    await prefs.setEnabled(true)
    expect(memory.posts).toHaveLength(1)
    const request = JSON.stringify(memory.posts[0])
    expect(request).not.toContain('fixture-model-credential')
    expect(request).not.toContain(memory.key)
    const bundle = parsePreferences(memory.remote.payload)
    expect(bundle.schema).toBe(2)
    expect(bundle.settings.models[0]).not.toHaveProperty('apiKey')
    expect(bundle.vault?.ciphertext).toBeTruthy()
  })
  it('automatically restores models, assignments and keys on an empty machine after opt-in', async () => {
    await createCloud()
    const modelId = config.models[0].id
    await emptyMachine()
    expect(config.models).toHaveLength(0)
    await prefs.setEnabled(true)
    expect(config.models[0].id).toBe(modelId)
    expect(config.models[0].apiKey).toBe('fixture-model-credential')
    expect(config.assignments.writing).toBe(modelId)
    expect(memory.disk).not.toContain('fixture-model-credential')
    await config.loadConfig()
    expect(config.models[0].apiKey).toBe('fixture-model-credential')
    expect(memory.posts).toHaveLength(1)
  })
  it('resumes the opted-in account after reload and never needs a recovery password', async () => {
    await createCloud()
    prefs.dispose()
    await start()
    config.models[0].temperature = 0.3
    await prefs.syncNow()
    expect(memory.remote.version).toBe(2)
    expect(parsePreferences(memory.remote.payload).settings.models[0].temperature).toBe(0.3)
  })
  it('leaves local and cloud untouched if the account key is wrong', async () => {
    await createCloud(); await emptyMachine()
    memory.key = btoa('fedcba9876543210fedcba9876543210')
    await expect(prefs.setEnabled(true)).rejects.toThrow('解密')
    expect(config.models).toHaveLength(0)
    expect(memory.disk).toBe('')
    expect(memory.posts).toHaveLength(1)
  })
  it('authenticates public model addresses and refuses a tampered bundle', async () => {
    await createCloud(); await emptyMachine()
    const data = JSON.parse(memory.remote.payload)
    data.settings.models[0].baseUrl = 'https://attacker.example.test'
    memory.remote.payload = canonicalJson(data); memory.remote.hash = await hashPayload(memory.remote.payload)
    await expect(prefs.setEnabled(true)).rejects.toThrow('解密')
    expect(config.models).toHaveLength(0)
    expect(memory.disk).toBe('')
  })
  it('asks which nonempty configuration to use and archives outgoing keys only in encrypted form', async () => {
    await createCloud(); await emptyMachine(); addModel('local-only-credential'); await config.saveConfig()
    const before = memory.disk
    await prefs.setEnabled(true)
    expect(prefs.conflict).toBe(true)
    expect(memory.disk).toBe(before)
    await expect(prefs.restore(false)).rejects.toThrow('确认')
    await prefs.restore(true)
    expect(config.models[0].apiKey).toBe('fixture-model-credential')
    expect(prefs.archiveCount).toBe(1)
    const archiveKey = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!).find(key => key.startsWith('mojian-v3-cloud-preference-archives:'))!
    expect(localStorage.getItem(archiveKey)).not.toContain('local-only-credential')
    expect(localStorage.getItem(archiveKey)).not.toContain(memory.key)
  })
  it('keeps both versions when local and cloud change before the next sync', async () => {
    await createCloud()
    config.models[0].temperature = 0.4
    memory.remote.version++
    await prefs.syncNow()
    expect(prefs.conflict).toBe(true)
    expect(config.models[0].temperature).toBe(0.4)
    expect(memory.posts).toHaveLength(1)
    await prefs.upload()
    expect(memory.posts).toHaveLength(2)
    expect(prefs.archiveCount).toBe(1)
  })
  it('preserves the current configuration on durable write failure', async () => {
    await createCloud(); await emptyMachine()
    memory.failWrite = true
    await expect(prefs.setEnabled(true)).rejects.toThrow('磁盘')
    expect(config.models).toHaveLength(0)
    expect(memory.disk).toBe('')
  })
  it('keeps older servers usable without falling back to manuscript records', async () => {
    memory.supported = false
    await prefs.setEnabled(true)
    expect(prefs.supported).toBe(false)
    expect(prefs.status).toContain('服务器需要升级')
    expect(memory.posts).toHaveLength(0)
    expect(memory.keyRequests).toBe(0)
  })
  it('rejects concurrent cloud writes without advancing the baseline', async () => {
    await createCloud()
    config.models[0].temperature = 0.5
    memory.onPost = () => { memory.remote.version++ }
    await expect(prefs.upload()).rejects.toThrow('版本冲突')
    expect(prefs.remote?.version).toBe(1)
    expect(config.models[0].temperature).toBe(0.5)
  })
  it('stops restore when an account logs out or AI work begins', async () => {
    await createCloud(); await emptyMachine()
    activeAiCount.value = 1
    await prefs.setEnabled(true)
    await expect(prefs.restore()).rejects.toThrow('等待')
    activeAiCount.value = 0
    memory.onGet = () => { memory.cloud.session = null }
    await expect(prefs.restore()).rejects.toThrow('账号')
    expect(config.models).toHaveLength(0)
    expect(prefs.remote).toBeNull()
  })
  it('checks unchanged configuration without global page overlay, model write, or key fetch', async () => {
    await createCloud()
    const transitions: boolean[] = []
    const stop = watch(cloudApplyBusy, value => transitions.push(value), { flush: 'sync' })
    const disk = memory.disk
    await prefs.syncNow()
    stop()
    expect(transitions).not.toContain(true)
    expect(memory.disk).toBe(disk)
    expect(memory.posts).toHaveLength(1)
    expect(memory.keyRequests).toBe(1)
  })
  it('keeps navigation and local edits usable during a slow background network check', async () => {
    await createCloud()
    let release!: () => void
    memory.onGet = () => new Promise<void>(resolve => { release = resolve })
    const result = prefs.refresh().then(() => null, cause => cause as Error)
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    expect(cloudPreferencesBusy.value).toBe(true)
    expect(cloudApplyBusy.value).toBe(false)
    config.models[0].temperature = 0.19
    await config.saveConfig()
    window.location.hash = '#/workspace/fixture'
    release()
    expect((await result)?.message).toContain('运行状态已变化')
    expect(config.models[0].temperature).toBe(0.19)
    expect(cloudPreferencesBusy.value).toBe(false)
    expect(cloudApplyBusy.value).toBe(false)
    expect(memory.posts).toHaveLength(1)
  })
  it('silently uploads local changes on the timer without covering the page', async () => {
    const tick = await captureTick()
    await createCloud()
    const transitions: boolean[] = []
    const stop = watch(cloudApplyBusy, value => transitions.push(value), { flush: 'sync' })
    config.models[0].temperature = 0.2
    tick()
    await vi.waitFor(() => expect(memory.remote.version).toBe(2), { timeout: 5000 })
    stop()
    expect(transitions).not.toContain(true)
    expect(memory.keyRequests).toBe(1)
  })
  it('keeps local edits made while automatic restore fetches the updated remote', async () => {
    const tick = await captureTick()
    await createCloud()
    memory.remote.version++
    let gets = 0
    let disk = ''
    memory.onGet = () => { if (++gets === 2) { config.models[0].temperature = 0.1; disk = memory.disk } }
    tick()
    await vi.waitFor(() => { expect(gets).toBeGreaterThanOrEqual(2); expect(prefs.busy).toBe(false) }, { timeout: 5000 })
    expect(config.models[0].temperature).toBe(0.1)
    expect(memory.disk).toBe(disk)
    expect(prefs.error).toContain('本机配置已变化')
    await prefs.syncNow()
    expect(prefs.conflict).toBe(true)
  })
  it('automatically restores a remote update while the local snapshot stays unchanged', async () => {
    const tick = await captureTick()
    await createCloud()
    const saved = canonicalJson(config.exportConfig())
    memory.remote.version++
    tick()
    await vi.waitFor(() => expect(prefs.status).toContain('已恢复配置和密钥'), { timeout: 5000 })
    expect(canonicalJson(config.exportConfig())).toBe(saved)
    expect(memory.posts).toHaveLength(1)
    expect(prefs.remote?.version).toBe(2)
  })
  it('rolls back the theme as well as models if durable import fails', async () => {
    useThemeStore().switchTheme('dark')
    await createCloud(); await emptyMachine()
    const theme = useThemeStore(); const before = theme.currentTheme
    expect(before).not.toBe('dark')
    memory.failWrite = true
    await expect(prefs.setEnabled(true)).rejects.toThrow('磁盘')
    expect(config.models).toHaveLength(0)
    expect(theme.currentTheme).toBe(before)
    expect(document.documentElement.getAttribute('data-theme')).toBe(before)
    expect(localStorage.getItem('mojian-v3-theme')).toBe(before)
    expect(cloudApplyBusy.value).toBe(false)
    expect(cloudConfigApplying.value).toBe(false)
  })
  it('keeps manual edits made during the final cloud-version check before replacement', async () => {
    await createCloud(); await emptyMachine(); addModel('local-original-credential'); await config.saveConfig()
    await prefs.setEnabled(true)
    const disk = memory.disk; let gets = 0
    memory.onGet = () => { if (++gets === 2) config.models[0].temperature = 0.15 }
    await expect(prefs.restore(true)).rejects.toThrow('本机配置已变化')
    expect(config.models[0].apiKey).toBe('local-original-credential')
    expect(config.models[0].temperature).toBe(0.15)
    expect(memory.disk).toBe(disk)
  })
  it('re-fetches the account secret on a new login token and never stores it locally', async () => {
    await createCloud()
    memory.cloud.session.token = 'fixture-new-login'
    config.models[0].temperature = 0.25
    await prefs.syncNow()
    expect(memory.keyRequests).toBe(2)
    const local = Array.from({ length: localStorage.length }, (_, i) => localStorage.getItem(localStorage.key(i)!)).join('')
    expect(local).not.toContain(memory.key)
  })
  it('rejects retired cloud preference envelopes without upgrading or replacing them', async () => {
    await legacyCloud()
    const original = JSON.stringify(memory.remote)
    await prefs.setEnabled(true).catch(() => undefined)
    expect(prefs.error).toBeTruthy()
    expect(JSON.stringify(memory.remote)).toBe(original)
    expect('migrateLegacy' in prefs).toBe(false)
  })
})
