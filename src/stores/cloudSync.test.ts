// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useNovelStore } from './novel'
import { useKnowledgeStore } from './knowledge'
import { useCloudSyncStore } from './cloudSync'
import { canonicalJson, emptySyncState, hashPayload, type CloudRecord } from '@/services/cloudSyncModel'

const memory = vi.hoisted(() => ({
  state: null as any, conflicts: [] as any[], records: new Map<string, any>(), userId: 'owner',
  onPull: null as null | (() => void | Promise<void>), onPush: null as null | (() => Promise<void>), failSave: false, expired: false,
}))
vi.mock('@/services/db/cloudSync', () => ({
  readCloudState: async () => structuredClone(memory.state),
  readCloudConflicts: async () => structuredClone(memory.conflicts),
  persistCloudState: async (state: any, conflicts: any[] = []) => {
    if (memory.failSave) throw new Error('磁盘写入失败')
    memory.state = structuredClone(state)
    for (const item of conflicts) {
      memory.conflicts = memory.conflicts.filter(old => old.id !== item.id)
      memory.conflicts.push(structuredClone(item))
    }
  },
}))
vi.mock('@/services/db/novels', () => ({
  loadAllNovelsFromDb: async () => [], saveNovelToDb: async () => {}, deleteNovelFromDb: async () => {},
}))
vi.mock('@/services/db/knowledge', () => ({
  loadAllKnowledgeBasesFromDb: async () => [], saveKnowledgeBaseToDb: async () => {}, deleteKnowledgeBaseFromDb: async () => {},
}))
vi.mock('@/services/db/chapterRevisions', async importOriginal => ({
  ...await importOriginal<any>(), loadProjectChapterRevisions: async () => [],
}))
vi.mock('@/services/database', async importOriginal => ({
  ...await importOriginal<any>(), retainProjectRestorePoint: async () => {},
}))
vi.mock('@/services/cloudSyncApi', async importOriginal => {
  const original = await importOriginal<any>()
  return { ...original, cloudRequest: async (_endpoint: string, path: string, options: any = {}) => {
    if (path === 'auth/login') return { token: 'test-token-not-a-secret', expiresAt: Date.now() + 86400000,
      user: { id: memory.userId, username: memory.userId, role: 'user', quotaBytes: 100000000, usedBytes: 0 } }
    if (path === 'auth/logout') return { ok: true }
    if (path === 'sync/manifest') {
      if (memory.expired) throw new original.CloudApiError(401, '登录已过期，请重新登录。')
      return { protocol: 1, records: [...memory.records.values()].map(({ payload, ...meta }) => meta) }
    }
    if (path === 'sync/pull') {
      await memory.onPull?.()
      return { records: options.body.keys.map((key: string) => structuredClone(memory.records.get(key))).filter(Boolean) }
    }
    if (path === 'sync/push') {
      if (memory.onPush) await memory.onPush()
      const { key, baseVersion, payload } = options.body
      const old = memory.records.get(key)
      const hash = payload === null ? null : await hashPayload(payload)
      if (old?.hash === hash) return { record: old }
      if ((old?.version || 0) !== baseVersion) throw new original.CloudApiError(409, '版本冲突')
      const record = { key, version: baseVersion + 1, hash, payload, bytes: payload?.length || 0, updatedAt: Date.now() }
      memory.records.set(key, record)
      return { record }
    }
    throw new Error(`Unexpected API: ${path}`)
  } }
})

let sync: ReturnType<typeof useCloudSyncStore>
beforeEach(async () => {
  vi.useFakeTimers()
  window.location.hash = '#/'
  sessionStorage.clear()
  localStorage.clear()
  memory.state = emptySyncState()
  memory.conflicts = []
  memory.records = new Map()
  memory.userId = 'owner'
  memory.onPull = null
  memory.onPush = null
  memory.failSave = false
  memory.expired = false
  setActivePinia(createPinia())
  await useNovelStore().initStore()
  await useKnowledgeStore().initStore()
  sync = useCloudSyncStore()
  await sync.initialize()
})
afterEach(() => { sync.dispose(); vi.useRealTimers(); vi.restoreAllMocks() })

function addBook() {
  const store = useNovelStore()
  return store.addNovel({ genre: '', subGenre: '', tags: [], targetWordCountMin: 1, targetWordCountMax: 2,
    settings: store.defaultSettings(), writingStyle: store.defaultWritingStyle() })
}
async function loginAndEnable() {
  await sync.authenticate('login', 'owner', 'not-a-real-password')
  await sync.setEnabled(true)
}
async function remoteEdit(key: string, title: string | null) {
  const old = memory.records.get(key)!
  const doc = old.payload === null ? null : JSON.parse(old.payload)
  if (doc) doc.novel.title = title
  const payload = title === null ? null : canonicalJson(doc)
  const record: CloudRecord = { ...old, version: old.version + 1, payload, hash: await hashPayload(payload) }
  memory.records.set(key, record)
}

describe('云同步状态机', () => {
  it('does not upload merely by signing in; enabling binds the local shelf', async () => {
    const novel = addBook()
    await sync.authenticate('login', 'owner', 'not-a-real-password')
    expect(memory.records.size).toBe(0)
    expect(sync.state.binding).toBeNull()
    await sync.setEnabled(true)
    expect(memory.records.has(`novel:${novel.id}`)).toBe(true)
    expect(sync.state.binding?.userId).toBe('owner')
    expect(sync.error).toBe('')
  })
  it('does not reupload unchanged documents', async () => {
    const novel = addBook()
    await loginAndEnable()
    await sync.syncNow()
    expect(memory.records.get(`novel:${novel.id}`).version).toBe(1)
  })
  it('pulls an updated book on the shelf', async () => {
    const novel = addBook()
    await loginAndEnable()
    await remoteEdit(`novel:${novel.id}`, '在公司修改的标题')
    await sync.syncNow()
    expect(useNovelStore().getNovel(novel.id)?.title).toBe('在公司修改的标题')
    expect(sync.error).toBe('')
  })
  it('defers remote replacement while an editor is open', async () => {
    const novel = addBook()
    await loginAndEnable()
    window.location.hash = `#/workspace/${novel.id}/editor/chapter`
    await remoteEdit(`novel:${novel.id}`, '远端')
    await sync.syncNow()
    expect(sync.pendingDownloads).toBe(1)
    expect(useNovelStore().getNovel(novel.id)?.title).not.toBe('远端')
    window.location.hash = '#/settings'
    await sync.syncNow()
    expect(useNovelStore().getNovel(novel.id)?.title).toBe('远端')
  })
  it('preserves both versions of simultaneous edits without overwriting either', async () => {
    const novel = addBook()
    await loginAndEnable()
    useNovelStore().getNovel(novel.id)!.title = '家里'
    await remoteEdit(`novel:${novel.id}`, '公司')
    await sync.syncNow()
    expect(sync.pendingConflicts).toHaveLength(1)
    expect(sync.pendingConflicts[0].local).toContain('家里')
    expect(sync.pendingConflicts[0].remote).toContain('公司')
    expect(useNovelStore().getNovel(novel.id)?.title).toBe('家里')
    expect(memory.records.get(`novel:${novel.id}`).payload).toContain('公司')
  })
  it('detects an edit made while a download is in progress', async () => {
    const novel = addBook()
    await loginAndEnable()
    await remoteEdit(`novel:${novel.id}`, '公司')
    memory.onPull = () => { useNovelStore().getNovel(novel.id)!.title = '下载时的新编辑' }
    await sync.syncNow()
    expect(useNovelStore().getNovel(novel.id)?.title).toBe('下载时的新编辑')
    expect(sync.pendingConflicts[0].local).toContain('下载时的新编辑')
  })
  it('keeps a locally edited novel when another device deletes it', async () => {
    const novel = addBook()
    await loginAndEnable()
    useNovelStore().getNovel(novel.id)!.title = '离线新稿'
    await remoteEdit(`novel:${novel.id}`, null)
    await sync.syncNow()
    expect(useNovelStore().getNovel(novel.id)).toBeDefined()
    expect(sync.pendingConflicts[0].remote).toBeNull()
  })
  it('resolves a conflict but retains its alternate copy', async () => {
    const novel = addBook()
    await loginAndEnable()
    useNovelStore().getNovel(novel.id)!.title = '家里'
    await remoteEdit(`novel:${novel.id}`, '公司')
    await sync.syncNow()
    await sync.resolveConflict(sync.pendingConflicts[0].id, 'remote')
    expect(useNovelStore().getNovel(novel.id)?.title).toBe('公司')
    expect(sync.pendingConflicts).toHaveLength(0)
    expect(sync.conflicts[0].local).toContain('家里')
    expect(sync.conflicts[0].resolution).toBe('remote')
  })
  it('refuses to upload a bound local shelf to another account', async () => {
    addBook()
    await loginAndEnable()
    await sync.logout()
    memory.userId = 'different-account'
    await expect(sync.authenticate('login', 'different-account', 'password')).rejects.toThrow('已绑定账号')
    expect(sync.session).toBeNull()
  })
  it('keeps the previous baseline on local disk failure and retries safely', async () => {
    const novel = addBook()
    await loginAndEnable()
    useNovelStore().getNovel(novel.id)!.title = '新内容'
    const version = sync.state.bases[`novel:${novel.id}`].version
    memory.failSave = true
    await sync.syncNow()
    expect(sync.error).toContain('磁盘写入失败')
    expect(sync.state.bases[`novel:${novel.id}`].version).toBe(version)
    memory.failSave = false
    await sync.syncNow()
    expect(sync.pendingConflicts).toHaveLength(0)
    expect(sync.error).toBe('')
    expect(sync.state.bases[`novel:${novel.id}`].version).toBe(version + 1)
  })
  it('still works locally after logout and does not upload new edits', async () => {
    const novel = addBook()
    await loginAndEnable()
    await sync.logout()
    useNovelStore().getNovel(novel.id)!.title = '本地继续写'
    await sync.syncNow()
    expect(memory.records.get(`novel:${novel.id}`).payload).not.toContain('本地继续写')
    expect(useNovelStore().getNovel(novel.id)?.title).toBe('本地继续写')
  })
  it('serializes conflict resolution against automatic sync and account changes', async () => {
    const novel = addBook()
    await loginAndEnable()
    useNovelStore().getNovel(novel.id)!.title = '家里'
    await remoteEdit(`novel:${novel.id}`, '公司')
    await sync.syncNow()
    let resume!: () => void
    memory.onPull = () => new Promise<void>(resolve => { resume = resolve })
    const resolving = sync.resolveConflict(sync.pendingConflicts[0].id, 'remote')
    await Promise.resolve()
    expect(sync.busy).toBe(true)
    await sync.syncNow()
    await expect(sync.logout()).rejects.toThrow('等待')
    await expect(sync.setEnabled(false)).rejects.toThrow('等待')
    await expect(sync.authenticate('login', 'owner', 'password')).rejects.toThrow('等待')
    resume()
    await resolving
    expect(sync.busy).toBe(false)
    expect(sync.pendingConflicts).toHaveLength(0)
    expect(useNovelStore().getNovel(novel.id)?.title).toBe('公司')
  })
  it('requires login again on expired tokens without losing local data or binding', async () => {
    const novel = addBook()
    await loginAndEnable()
    memory.expired = true
    await sync.syncNow()
    expect(sync.session).toBeNull()
    expect(sync.error).toContain('登录已过期')
    expect(sync.state.binding?.userId).toBe('owner')
    expect(useNovelStore().getNovel(novel.id)).toBeDefined()
    expect(sessionStorage.getItem('novel-cloud-session')).toBeNull()
  })
})
