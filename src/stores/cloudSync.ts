import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { useNovelStore } from './novel'
import { useKnowledgeStore } from './knowledge'
import { cloudRequest, CloudApiError } from '@/services/cloudSyncApi'
import {
  DEFAULT_SYNC_ENDPOINT, normalizeSyncEndpoint, emptySyncState, projectDocuments, hashPayload,
  parseCloudDocument, documentTitle, decideSync, mergeCloudDocuments,
  type CloudSession, type CloudUser, type CloudRecord, type SyncState, type SyncConflict,
} from '@/services/cloudSyncModel'
import { readCloudState, readCloudConflicts, persistCloudState } from '@/services/db/cloudSync'
import { createProjectBackup, downloadProjectBackup } from '@/services/projectBackup'
import { loadProjectChapterRevisions } from '@/services/db/chapterRevisions'
import { retainProjectRestorePoint } from '@/services/database'
import { cloudApplyBusy, appUpdateInstalling, flushEditorDrafts } from '@/services/appLifecycle'
import { chapterBackgroundQueue } from '@/services/aiTaskQueue'
import { activeAiCount } from '@/services/aiActivity'
import { projectTransferBusy } from '@/services/projectTransfer'

const SESSION_KEY = 'novel-cloud-session'

export const useCloudSyncStore = defineStore('cloudSync', () => {
  const state = ref<SyncState>(emptySyncState())
  const session = ref<CloudSession | null>(null)
  const conflicts = ref<SyncConflict[]>([])
  const initialized = ref(false)
  const busy = ref(false)
  const error = ref('')
  const pendingDownloads = ref(0)
  const phase = ref<'signed-out' | 'paused' | 'syncing' | 'synced' | 'waiting' | 'error'>('signed-out')
  const endpoint = ref(DEFAULT_SYNC_ENDPOINT)
  let generation = 0
  let abort: AbortController | null = null
  let running: Promise<void> | null = null
  let operation: Promise<unknown> | null = null
  let timer: ReturnType<typeof setInterval> | undefined
  let scheduled: ReturnType<typeof setTimeout> | undefined
  const pendingConflicts = computed(() => conflicts.value.filter(item => !item.resolution))
  const statusText = computed(() => {
    if (!session.value) return '未登录云同步'
    if (!state.value.enabled) return '云同步已暂停'
    if (busy.value) return '正在同步'
    if (error.value) return '同步未完成'
    if (pendingConflicts.value.length) return `${pendingConflicts.value.length} 项版本冲突`
    if (pendingDownloads.value) return `${pendingDownloads.value} 项云端更新待合并`
    return phase.value === 'synced' ? '已同步' : '等待同步'
  })

  function safeView() {
    const path = window.location.hash.replace(/^#/, '').split('?')[0]
    return ['', '/', '/settings'].includes(path)
  }
  function localWorkBusy() {
    return activeAiCount.value > 0 || chapterBackgroundQueue.pendingCount > 0
      || projectTransferBusy.value || appUpdateInstalling.value
  }
  async function capture() {
    const revisions = await loadProjectChapterRevisions()
    return createProjectBackup(useNovelStore().novels, useKnowledgeStore().knowledgeBases, revisions)
  }
  async function flush() {
    await flushEditorDrafts()
    await Promise.all([useNovelStore().flushPendingSaves(), useKnowledgeStore().flushPendingSaves()])
  }
  async function writeSession(value: CloudSession | null) {
    if (window.electronAPI?.cloudSessionWrite) await window.electronAPI.cloudSessionWrite(value)
    else if (value) sessionStorage.setItem(SESSION_KEY, JSON.stringify(value))
    else sessionStorage.removeItem(SESSION_KEY)
  }
  function assertBinding(value: CloudSession) {
    const owner = state.value.binding
    if (owner && (owner.userId !== value.user.id || owner.endpoint !== value.endpoint)) {
      throw new Error(`当前本地书架已绑定账号 ${owner.username}。为避免串号上传，请登录原账号；另一账号请使用独立的系统用户环境。`)
    }
  }
  async function initialize() {
    if (initialized.value) return
    try {
      state.value = await readCloudState()
      conflicts.value = await readCloudConflicts()
      const saved = window.electronAPI?.cloudSessionRead
        ? await window.electronAPI.cloudSessionRead()
        : JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null') as CloudSession | null
      if (saved) {
        saved.endpoint = normalizeSyncEndpoint(saved.endpoint)
        assertBinding(saved)
        endpoint.value = saved.endpoint
        if (saved.expiresAt > Date.now()) session.value = saved
      }
      phase.value = session.value ? (state.value.enabled ? 'waiting' : 'paused') : 'signed-out'
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '同步登录信息加载失败，请重新登录。'
    } finally {
      initialized.value = true
      timer = setInterval(schedule, 30000)
      window.addEventListener('online', schedule)
      window.addEventListener('focus', schedule)
      schedule()
    }
  }
  function schedule() {
    if (!state.value.enabled || !session.value || busy.value || running || operation || scheduled) return
    scheduled = setTimeout(() => {
      scheduled = undefined
      void syncNow()
    }, 1000)
  }
  async function exclusively<T>(action: () => Promise<T>): Promise<T> {
    if (busy.value || operation) throw new Error('请等待当前同步操作结束。')
    busy.value = true
    const task = Promise.resolve().then(action)
    operation = task
    try { return await task }
    finally { operation = null; busy.value = false }
  }
  async function authenticate(mode: 'login' | 'register', username: string, password: string, invite = '') {
    const recovery = await exclusively(async () => {
      const target = normalizeSyncEndpoint(endpoint.value)
      const response = await cloudRequest<{ token: string; expiresAt: number; user: CloudUser; recoveryCode?: string }>(
        target, `auth/${mode}`, { body: { username, password, invite } })
      const clean: CloudSession = { endpoint: target, token: response.token, expiresAt: response.expiresAt, user: response.user }
      try {
        assertBinding(clean)
        await writeSession(clean)
      } catch (cause) {
        void cloudRequest(target, 'auth/logout', { token: clean.token, body: {} }).catch(() => undefined)
        throw cause
      }
      session.value = clean
      error.value = ''
      phase.value = state.value.enabled ? 'waiting' : 'paused'
      return response.recoveryCode || ''
    })
    schedule()
    return recovery
  }
  async function stop() {
    generation++
    abort?.abort()
    clearTimeout(scheduled)
    scheduled = undefined
    await running
  }
  async function logout() {
    await exclusively(async () => {
      await stop()
      const old = session.value
      await writeSession(null)
      session.value = null
      error.value = ''
      phase.value = 'signed-out'
      if (old) void cloudRequest(old.endpoint, 'auth/logout', { token: old.token, body: {} }).catch(() => undefined)
    })
  }
  async function setEnabled(enabled: boolean) {
    await exclusively(async () => {
      await stop()
      const next = JSON.parse(JSON.stringify(state.value)) as SyncState
      if (enabled) {
        if (!session.value) throw new Error('请先登录。')
        assertBinding(session.value)
        next.binding = { endpoint: session.value.endpoint, userId: session.value.user.id, username: session.value.user.username }
      }
      next.enabled = enabled
      await persistCloudState(next)
      state.value = next
      phase.value = enabled ? 'waiting' : 'paused'
      error.value = ''
    })
    if (enabled) await syncNow()
  }
  function checkedRecord(raw: CloudRecord, payload = false): CloudRecord {
    if (!raw || typeof raw.key !== 'string' || !/^(novel|knowledge):[^\x00-\x1f\x7f]{1,200}$/.test(raw.key)
      || !Number.isSafeInteger(raw.version) || raw.version < 1
      || (raw.hash !== null && !/^[a-f0-9]{64}$/.test(raw.hash))
      || !Number.isFinite(raw.bytes) || !Number.isFinite(raw.updatedAt)
      || (payload && raw.payload !== null && typeof raw.payload !== 'string')) throw new Error('云端同步记录格式错误。')
    return raw
  }
  async function syncNow() {
    if (running) return running
    if (busy.value || operation || cloudApplyBusy.value || !session.value || !state.value.enabled) return
    const version = generation
    const auth = session.value
    const check = () => { if (generation !== version) throw new Error('同步已停止。') }
    if (localWorkBusy()) { phase.value = 'waiting'; return }
    abort = new AbortController()
    const signal = abort.signal
    running = (async () => {
      busy.value = true
      phase.value = 'syncing'
      error.value = ''
      assertBinding(auth)
      await flush()
      check()
      const snapshot = await capture()
      const local = projectDocuments(snapshot)
      const hashes = new Map<string, string | null>()
      for (const [key, payload] of local) hashes.set(key, await hashPayload(payload))
      const next = JSON.parse(JSON.stringify(state.value)) as SyncState
      const manifest = await cloudRequest<{ protocol: number; records: CloudRecord[] }>(auth.endpoint, 'sync/manifest', { token: auth.token, signal })
      if (manifest.protocol !== 1 || !Array.isArray(manifest.records) || manifest.records.length > 2000) throw new Error('云端同步协议不兼容。')
      const remote = new Map(manifest.records.map(raw => {
        const item = checkedRecord(raw)
        return [item.key, item] as const
      }))
      const updates = new Map<string, CloudRecord>()
      const newConflicts: SyncConflict[] = []
      const existing = new Set(pendingConflicts.value.map(item => item.key))
      async function fetchRecord(key: string) {
        const response = await cloudRequest<{ records: CloudRecord[] }>(auth.endpoint, 'sync/pull', {
          token: auth.token, signal, body: { keys: [key] },
        })
        const item = checkedRecord(response.records?.[0], true)
        if (item.key !== key || await hashPayload(item.payload ?? null) !== item.hash) throw new Error('云端文档校验失败。')
        if (item.payload !== null) parseCloudDocument(key, item.payload!)
        return item
      }
      function conflict(key: string, item: CloudRecord, localPayload = local.get(key) ?? null) {
        newConflicts.push({ id: crypto.randomUUID(), key,
          title: documentTitle(key, localPayload ?? item.payload ?? null),
          local: localPayload, remote: item.payload ?? null, remoteHash: item.hash,
          remoteVersion: item.version, createdAt: new Date().toISOString() })
      }
      for (const key of new Set([...local.keys(), ...Object.keys(next.bases), ...remote.keys()])) {
        check()
        if (localWorkBusy()) throw new Error('AI 或项目任务正在运行，已暂停同步，稍后自动重试。')
        if (existing.has(key)) continue
        const item = remote.get(key)
        const decision = decideSync(hashes.get(key) ?? null, item, next.bases[key])
        if (decision === 'same') {
          if (item) next.bases[key] = { hash: item.hash, version: item.version }
        } else if (decision === 'push') {
          try {
            const response = await cloudRequest<{ record: CloudRecord }>(auth.endpoint, 'sync/push', {
              token: auth.token, signal, body: { key, baseVersion: next.bases[key]?.version || 0, payload: local.get(key) ?? null },
            })
            const accepted = checkedRecord(response.record)
            if (accepted.key !== key || accepted.hash !== (hashes.get(key) ?? null)) throw new Error('云端写入结果校验失败。')
            next.bases[key] = { hash: accepted.hash, version: accepted.version }
            remote.set(key, accepted)
          } catch (cause) {
            if (!(cause instanceof CloudApiError) || cause.status !== 409) throw cause
            conflict(key, await fetchRecord(key))
          }
        } else {
          const latest = await fetchRecord(key)
          const currentDecision = decideSync(hashes.get(key) ?? null, latest, next.bases[key])
          if (currentDecision === 'same') next.bases[key] = { hash: latest.hash, version: latest.version }
          else if (currentDecision === 'pull') updates.set(key, latest)
          else conflict(key, latest)
        }
      }
      check()
      const canApply = updates.size > 0 && safeView() && !localWorkBusy()
      if (canApply) cloudApplyBusy.value = true
      try {
        await flush()
        check()
        const current = await capture()
        const currentDocs = projectDocuments(current)
        const accepted = new Map<string, string | null>()
        if (canApply && safeView() && !localWorkBusy()) {
          for (const [key, item] of updates) {
            if ((currentDocs.get(key) ?? null) !== (local.get(key) ?? null)) conflict(key, item, currentDocs.get(key) ?? null)
            else {
              accepted.set(key, item.payload ?? null)
              next.bases[key] = { hash: item.hash, version: item.version }
            }
          }
        }
        const project = accepted.size ? mergeCloudDocuments(current, accepted) : undefined
        if (project) await retainProjectRestorePoint(JSON.stringify(current))
        check()
        pendingDownloads.value = updates.size - accepted.size
        const locallyChanged = [...currentDocs.keys(), ...local.keys()].some(key => currentDocs.get(key) !== local.get(key))
        const complete = !pendingDownloads.value && !pendingConflicts.value.length && !newConflicts.length && !locallyChanged
        if (complete) next.lastSync = new Date().toISOString()
        await persistCloudState(next, newConflicts, project)
        if (project) {
          useNovelStore().adoptImportedNovels(project.novels)
          useKnowledgeStore().adoptImportedKnowledgeBases(project.knowledgeBases)
        }
        state.value = next
        if (session.value?.user.id === auth.user.id) session.value.user.usedBytes = [...remote.values()].reduce((total, item) => total + item.bytes, 0)
        conflicts.value = await readCloudConflicts()
        phase.value = complete ? 'synced' : 'waiting'
      } finally { cloudApplyBusy.value = false }
    })().catch(async cause => {
      if (generation !== version) return
      error.value = cause instanceof Error ? cause.message : '同步失败，本地内容已保留。'
      phase.value = 'error'
      if (cause instanceof CloudApiError && cause.status === 401) {
        session.value = null
        try { await writeSession(null) } catch { /* A stale encrypted token cannot authenticate. */ }
        phase.value = 'signed-out'
      }
    }).finally(() => {
      busy.value = false
      running = null
      abort = null
    })
    return running
  }
  async function resolveConflict(id: string, choice: 'local' | 'remote') {
    if (busy.value || localWorkBusy() || !safeView()) throw new Error('请在书架或设置页、没有 AI 任务运行时处理冲突。')
    if (!session.value) throw new Error('请先登录。')
    assertBinding(session.value)
    const item = conflicts.value.find(conflict => conflict.id === id && !conflict.resolution)
    if (!item) return
    const auth = session.value
    await exclusively(async () => {
      cloudApplyBusy.value = true
      try {
      const latest = await cloudRequest<{ records: CloudRecord[] }>(auth.endpoint, 'sync/pull', {
        token: auth.token, body: { keys: [item.key] },
      })
      const remote = checkedRecord(latest.records[0], true)
      if (remote.key !== item.key || await hashPayload(remote.payload ?? null) !== remote.hash) throw new Error('云端文档校验失败。')
      if (remote.payload !== null) parseCloudDocument(item.key, remote.payload!)
      if (remote.version !== item.remoteVersion) {
        const refreshed = { ...item, remote: remote.payload ?? null, remoteHash: remote.hash, remoteVersion: remote.version }
        await persistCloudState(state.value, [{ ...item, id: crypto.randomUUID(), resolution: 'local' }, refreshed])
        conflicts.value = await readCloudConflicts()
        throw new Error('云端版本又有更新，已刷新冲突记录，请重新选择。')
      }
      await flush()
      const current = await capture()
      const next = JSON.parse(JSON.stringify(state.value)) as SyncState
      next.bases[item.key] = { version: remote.version, hash: remote.hash }
      const project = choice === 'remote' ? mergeCloudDocuments(current, new Map([[item.key, remote.payload ?? null]])) : undefined
      if (project) await retainProjectRestorePoint(JSON.stringify(current))
      const currentPayload = projectDocuments(current).get(item.key) ?? null
      const archives: SyncConflict[] = [{ ...item, resolution: choice }]
      if (currentPayload !== item.local) archives.push({ ...item, id: crypto.randomUUID(), local: currentPayload, resolution: choice })
      await persistCloudState(next, archives, project)
      if (project) {
        useNovelStore().adoptImportedNovels(project.novels)
        useKnowledgeStore().adoptImportedKnowledgeBases(project.knowledgeBases)
      }
      state.value = next
      conflicts.value = await readCloudConflicts()
      error.value = ''
      phase.value = 'waiting'
      } finally { cloudApplyBusy.value = false }
    })
    schedule()
  }
  async function exportConflict(id: string, side: 'local' | 'remote') {
    const item = conflicts.value.find(conflict => conflict.id === id)
    if (!item) return
    const project = mergeCloudDocuments(await capture(), new Map([[item.key, item[side]]]))
    downloadProjectBackup(project, `同步冲突-${side === 'local' ? '本机' : '云端'}-${item.createdAt.slice(0, 10)}.json`)
  }
  async function createInvite(uses = 1) {
    if (!session.value) throw new Error('请先登录。')
    return cloudRequest<{ code: string; uses: number; expiresInDays: number }>(session.value.endpoint, 'admin/invites', {
      token: session.value.token, body: { uses },
    })
  }
  async function recover(username: string, recoveryCode: string, password: string) {
    return cloudRequest<{ recoveryCode: string }>(endpoint.value, 'auth/recover', { body: { username, recoveryCode, password } })
  }
  async function flushBeforeClose() {
    await operation
    if (!session.value || !state.value.enabled) return
    await stop()
    const timeout = setTimeout(() => abort?.abort(), 12000)
    try {
      await syncNow()
      if (error.value) throw new Error(`本地已保存，但云同步未完成：${error.value}`)
    } finally { clearTimeout(timeout) }
  }
  function dispose() {
    clearInterval(timer)
    clearTimeout(scheduled)
    window.removeEventListener('online', schedule)
    window.removeEventListener('focus', schedule)
    abort?.abort()
  }
  return {
    state, session, conflicts, initialized, busy, error, pendingDownloads, phase, endpoint,
    pendingConflicts, statusText, initialize, authenticate, logout, setEnabled, syncNow,
    schedule, resolveConflict, exportConflict, createInvite, recover, flushBeforeClose, dispose,
  }
})
