import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useCloudSyncStore } from './cloudSync'
import { useConfigStore } from './config'
import { useThemeStore } from './theme'
import { cloudRequest } from '@/services/cloudSyncApi'
import { canonicalJson, hashPayload, type CloudSession } from '@/services/cloudSyncModel'
import { checkPreferencesRecord, joinConfig, parsePreferences, settingsDigest, splitConfig, type PreferencesBundle, type PreferencesRecord } from '@/services/configSync'
import { openVault, sealVault } from '@/services/configVault'
import { activeAiCount } from '@/services/aiActivity'
import { chapterBackgroundQueue } from '@/services/aiTaskQueue'
import { cloudApplyBusy, cloudPreferencesBusy, cloudConfigApplying, appUpdateInstalling } from '@/services/appLifecycle'
import { projectTransferBusy } from '@/services/projectTransfer'

interface PreferenceState { enabled: boolean; version: number; hash: string; localDigest: string; schema: 2 }
const emptyState = (): PreferenceState => ({ enabled: false, version: 0, hash: '', localDigest: '', schema: 2 })

interface AccountKey { scope: string; token: string; key: string }

export const useCloudPreferencesStore = defineStore('cloudPreferences', () => {
  const sync = useCloudSyncStore()
  const config = useConfigStore()
  const theme = useThemeStore()

  const state = ref(emptyState())
  const enabled = computed(() => state.value.enabled)
  const busy = ref(false)
  const supported = ref<boolean | null>(null)
  const status = ref('尚未启用配置同步')
  const error = ref('')
  const remote = ref<PreferencesRecord | null>(null)
  const conflict = ref(false)
  const initialized = ref(false)
  const archiveCount = ref(0)

  let scope = ''
  let accountKey: AccountKey | null = null
  let timer: ReturnType<typeof setInterval> | undefined
  let controller: AbortController | null = null
  let epoch = 0
  let ticking = false

  const currentScope = () => sync.session ? JSON.stringify([sync.session.endpoint, sync.session.user.id]) : ''
  const stateKey = () => 'mojian-v3-cloud-preferences:' + scope
  const archiveKey = () => 'mojian-v3-cloud-preference-archives:' + scope
  const localSnapshot = () => ({ config: config.exportConfig(), theme: theme.currentTheme })
  const localDigest = () => hashPayload(canonicalJson(localSnapshot())) as Promise<string>
  const context = async (auth: CloudSession, bundle: Pick<PreferencesBundle, 'settings'>) => ({ endpoint: auth.endpoint, userId: auth.user.id, settingsHash: await settingsDigest(bundle.settings) })

  function idle() {
    const route = window.location.hash.replace(/^#/, '').split('?')[0]
    return ['', '/', '/settings'].includes(route) && !sync.busy && !activeAiCount.value && !chapterBackgroundQueue.pendingCount
      && !projectTransferBusy.value && !appUpdateInstalling.value
  }

  function persist(next: PreferenceState) { localStorage.setItem(stateKey(), JSON.stringify(next)); state.value = next }

  function reset() {
    epoch++
    controller?.abort()
    accountKey = null
    scope = currentScope()
    state.value = emptyState()
    supported.value = null
    remote.value = null
    conflict.value = false
    error.value = ''
    status.value = '尚未启用配置同步'
    archiveCount.value = 0
    if (!scope) return
    try {
      const saved = JSON.parse(localStorage.getItem(stateKey()) || 'null')
      if (saved && typeof saved.enabled === 'boolean' && Number.isSafeInteger(saved.version) && saved.version >= 0
        && typeof saved.hash === 'string' && typeof saved.localDigest === 'string') {
        state.value = { ...saved, schema: 2 }
      }
      archiveCount.value = JSON.parse(localStorage.getItem(archiveKey()) || '[]').length
    } catch { error.value = '本机配置同步记录读取失败，原有模型配置未改变。' }
    if (enabled.value) status.value = '等待比较云端配置'
  }

  watch(() => JSON.stringify([currentScope(), sync.session?.token]), reset, { flush: 'sync' })

  function archive(payload: string, schema: 2) {
    parsePreferences(payload)
    const saved = JSON.parse(localStorage.getItem(archiveKey()) || '[]') as { at: string; payload: string; schema: 2 }[]
    const items = [{ at: new Date().toISOString(), payload, schema }, ...saved].slice(0, 5)
    while (items.length > 1 && new TextEncoder().encode(JSON.stringify(items)).length > 2 * 1024 * 1024) items.pop()
    localStorage.setItem(archiveKey(), JSON.stringify(items))
    archiveCount.value = items.length
  }

  function exportArchives() {
    const data = localStorage.getItem(archiveKey()) || '[]'
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = '配置恢复副本-密钥已加密.json'; link.click(); URL.revokeObjectURL(url)
  }

  async function getAccountKey(auth: CloudSession, check: () => void, signal: AbortSignal): Promise<string> {
    if (accountKey && accountKey.scope === scope && accountKey.token === auth.token) return accountKey.key
    const response = await cloudRequest<{ schema: number; key: string }>(auth.endpoint, 'sync/preferences/key', { token: auth.token, signal })
    check()
    if (response.schema !== 1 || typeof response.key !== 'string' || response.key.length !== 44 || !/^[A-Za-z0-9+/]{43}=$/.test(response.key)) {
      throw new Error('账号密钥格式错误。')
    }
    if (btoa(atob(response.key)) !== response.key) throw new Error('账号密钥格式错误。')
    accountKey = { scope, token: auth.token, key: response.key }
    return response.key
  }

  async function operate<T>(action: (auth: CloudSession, check: () => void, signal: AbortSignal) => Promise<T>): Promise<T> {
    if (busy.value || cloudPreferencesBusy.value || cloudApplyBusy.value || !idle()) throw new Error('请返回书架或设置页，等待当前 AI、项目或同步任务结束。')
    if (!sync.session) throw new Error('请先登录云同步账号。')
    if (scope !== currentScope()) reset()
    const auth = { ...sync.session, user: { ...sync.session.user } }
    const expectedScope = scope
    const version = epoch
    const check = () => {
      if (version !== epoch || expectedScope !== currentScope() || sync.session?.token !== auth.token || !idle()) throw new Error('账号或运行状态已变化，配置操作已停止。')
    }
    busy.value = true
    cloudPreferencesBusy.value = true
    error.value = ''
    controller = new AbortController()
    try { return await action(auth, check, controller.signal) }
    catch (cause) { if (version === epoch) error.value = cause instanceof Error ? cause.message : '配置同步未完成，本机配置已保留。'; throw cause }
    finally { busy.value = false; cloudPreferencesBusy.value = false; controller = null }
  }

  async function fetchRemote(auth: CloudSession, check: () => void, signal: AbortSignal) {
    const health = await cloudRequest<{ features?: string[] }>(auth.endpoint, 'health', { signal })
    check()
    const hasPreferencesV1 = health.features?.includes('preferences-v1') === true
    const hasAccountKey = health.features?.includes('preferences-account-key-v1') === true
    supported.value = hasPreferencesV1 && hasAccountKey
    if (!supported.value) { status.value = '同步服务器需要升级才能自动同步配置和密钥'; return undefined }
    const response = await cloudRequest<{ record: unknown }>(auth.endpoint, 'sync/preferences', { token: auth.token, signal })
    const result = await checkPreferencesRecord(response.record)
    check()
    if (state.value.version && (!result || result.version < state.value.version || (result.version === state.value.version && result.hash !== state.value.hash))) {
      throw new Error('云端配置版本发生回退或变化，已停止恢复和上传。')
    }
    return result
  }

  async function setEnabled(value: boolean) {
    if (busy.value) throw new Error('请等待配置同步操作结束。')
    if (!sync.session) throw new Error('请先登录。')
    if (scope !== currentScope()) reset()
    accountKey = null
    persist({ ...state.value, enabled: value })
    status.value = value ? '等待比较云端配置' : '配置同步已暂停'
    if (value) await syncNow()
  }

  async function refresh() {
    if (!enabled.value) return
    await operate(async (auth, check, signal) => {
      const result = await fetchRemote(auth, check, signal)
      if (result === undefined) return
      remote.value = result
      const digest = await localDigest(); check()
      const hasLocalModels = config.models.length > 0 || !!config.embedding.apiKey
      conflict.value = !!result && result.version !== state.value.version
        && (state.value.localDigest ? digest !== state.value.localDigest : hasLocalModels)
      if (result) parsePreferences(result.payload)
      status.value = !result ? '云端为空，等待首次上传本机配置'
        : conflict.value ? '两端配置均有变化，请选择恢复或上传'
        : result.hash === state.value.hash && digest === state.value.localDigest ? '配置已同步'
        : result.version !== state.value.version ? '发现云端配置，等待自动恢复' : '本机配置有变化，等待上传'
    })
  }

  async function upload() {
    if (!enabled.value) throw new Error('请先开启配置同步。')
    await operate(async (auth, check, signal) => {
      const displayed = remote.value
      const result = await fetchRemote(auth, check, signal)
      if (result === undefined) return
      if (result?.hash !== displayed?.hash) { remote.value = result; throw new Error('云端配置刚刚更新，请重新比较后再上传。') }
      const before = canonicalJson(localSnapshot())
      const selected = splitConfig(config.exportConfig(), theme.currentTheme)
      const key = await getAccountKey(auth, check, signal)
      check()
      const vault = await sealVault(selected.secrets, key, await context(auth, selected))
      check()
      if (before !== canonicalJson(localSnapshot())) throw new Error('本机配置已变化，请重新上传。')
      const payload = canonicalJson({ schema: 2, settings: selected.settings, vault })
      if (result) archive(result.payload, parsePreferences(result.payload).schema)
      const response = await cloudRequest<{ record: unknown }>(auth.endpoint, 'sync/preferences', { token: auth.token, signal, body: { baseVersion: result?.version || 0, payload } })
      const accepted = await checkPreferencesRecord(response.record); check()
      if (!accepted || accepted.payload !== payload || accepted.version < (result?.version || 0)) throw new Error('云端配置写入结果校验失败。')
      const digest = (await hashPayload(before))!
      check()
      persist({ enabled: true, version: accepted.version, hash: accepted.hash, localDigest: digest, schema: 2 })
      remote.value = accepted
      conflict.value = false
      status.value = '配置和加密密钥已同步'
    })
  }

  async function restore(confirmReplace = false, expectedDigest?: string) {
    if (!enabled.value) throw new Error('请先开启配置同步。')
    await operate(async (auth, check, signal) => {
      const result = await fetchRemote(auth, check, signal)
      if (!result) { if (result === null) throw new Error('云端还没有配置。'); return }
      const bundle = parsePreferences(result.payload)
      const before = canonicalJson(localSnapshot())
      if (expectedDigest !== undefined && await hashPayload(before) !== expectedDigest) {
        throw new Error('本机配置已变化，请重新比较后恢复。')
      }
      check()
      const oldConfig = config.exportConfig()
      const oldTheme = theme.currentTheme
      if (oldConfig.models.length && !confirmReplace) throw new Error('本机已有模型配置，请确认采用云端配置。')
      if (!bundle.vault) throw new Error('云端配置缺少加密密钥包，已停止恢复。')
      const key = await getAccountKey(auth, check, signal)
      const secrets = await openVault(bundle.vault, key, await context(auth, bundle)); check()
      const candidate = joinConfig(bundle.settings, secrets)
      if (before !== canonicalJson(localSnapshot())) throw new Error('本机配置已变化，请重新比较后恢复。')
      if (oldConfig.models.length || oldConfig.embedding?.apiKey) {
        const prior = splitConfig(oldConfig, oldTheme)
        const priorVault = await sealVault(prior.secrets, key, await context(auth, prior)); check()
        archive(canonicalJson({ schema: 2, settings: prior.settings, vault: priorVault }), 2)
      }
      if (before !== canonicalJson(localSnapshot())) throw new Error('本机配置已变化，请重新比较后恢复。')
      const latest = await fetchRemote(auth, check, signal)
      if (latest?.hash !== result.hash) { remote.value = latest || null; throw new Error('云端配置刚刚更新，请重新恢复。') }
      check()
      if (before !== canonicalJson(localSnapshot())) throw new Error('本机配置已变化，请重新比较后恢复。')
      cloudConfigApplying.value = true
      cloudApplyBusy.value = true
      try {
        theme.switchTheme(bundle.settings.theme)
        const withTheme = canonicalJson(localSnapshot())
        try {
          await config.importConfig(candidate, () => { try { check(); return withTheme === canonicalJson(localSnapshot()) } catch { return false } })
        } catch (cause) {
          try { theme.switchTheme(oldTheme) }
          catch { theme.currentTheme = oldTheme; document.documentElement.setAttribute('data-theme', oldTheme); throw new Error('模型配置未替换；主题恢复记录写入失败，请检查本机存储空间。') }
          throw cause
        }
      } finally { cloudApplyBusy.value = false; cloudConfigApplying.value = false }
      check()
      const digest = await localDigest(); check()
      persist({ enabled: true, version: result.version, hash: result.hash, localDigest: digest, schema: 2 })
      remote.value = result
      conflict.value = false
      status.value = '已恢复配置和密钥，可以直接使用模型'
    })
  }


  async function syncNow() {
    if (ticking || !enabled.value || busy.value || cloudPreferencesBusy.value || !idle() || cloudApplyBusy.value || !sync.session) return
    ticking = true
    try {
      const expectedScope = currentScope()
      const expectedToken = sync.session.token
      await refresh()
      if (!enabled.value || expectedScope !== currentScope() || expectedToken !== sync.session?.token || !supported.value || conflict.value) return
      const baseline = state.value.localDigest
      const digest = await localDigest()
      if (!enabled.value || expectedScope !== currentScope() || expectedToken !== sync.session?.token) return
      if (!remote.value) await upload()
      else if (remote.value.version === state.value.version) {
        if (digest !== baseline) await upload()
      } else if (baseline ? digest === baseline : !config.models.length && !config.embedding.apiKey) {
        await restore(true, digest)
      } else {
        conflict.value = true
        status.value = '本机与云端配置不同，请选择使用哪一份'
      }
    } finally {
      ticking = false
    }
  }

  async function tick() {
    try { await syncNow() }
    catch { /* Explicit status/error stays visible; retry only next interval. */ }
  }

  async function initialize() {
    if (initialized.value) return
    initialized.value = true
    reset()
    timer = setInterval(() => void tick(), 30000)
    await tick()
  }

  function dispose() { clearInterval(timer); controller?.abort(); epoch++; accountKey = null }

  return { enabled, busy, supported, status, error, remote, conflict, initialized, archiveCount, initialize, setEnabled, syncNow, refresh, upload, restore, exportArchives, dispose }
})
