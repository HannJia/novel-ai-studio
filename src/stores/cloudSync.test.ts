// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useNovelStore } from './novel'
import { useKnowledgeStore } from './knowledge'
import { useInspirationSessionsStore } from './inspirationSessions'
import { parseInspirationSession } from '@/services/inspirationSessions'
import { useCloudSyncStore } from './cloudSync'
import { canonicalJson, emptySyncState, hashPayload, type CloudRecord } from '@/services/cloudSyncModel'
import { cloudPreferencesBusy } from '@/services/appLifecycle'
import { emptyProjectWorkspace, plannedProjectWorkspace } from '@/test/projectBackupFixture'
import { useReconstructionWorkspaceStore } from './reconstructionWorkspace'

const memory = vi.hoisted(() => ({
  state: null as any, conflicts: [] as any[], records: new Map<string, any>(), userId: 'owner',
  onPull: null as null | (() => void | Promise<void>), onPush: null as null | (() => Promise<void>), failSave: false, expired: false,
  requests: [] as { endpoint: string; path: string }[],
  workspaces: new Map<string, any>(),
}))
vi.mock('@/services/db/cloudSync', () => ({
  readCloudState: async () => structuredClone(memory.state),
  readCloudConflicts: async () => structuredClone(memory.conflicts),
  persistCloudState: async (state: any, conflicts: any[] = [], project?: any) => {
    if (memory.failSave) throw new Error('磁盘写入失败')
    memory.state = structuredClone(state)
    if (project) memory.workspaces = new Map(project.reconstructionWorkspaces.map((item: any) => [item.novelId, structuredClone(item)]))
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
vi.mock('@/services/db/inspirationSessions', () => ({ loadInspirationSessions: async () => [], saveInspirationSessions: async () => {} }))
vi.mock('@/services/db/reconstruction', () => ({
  loadReconstructionWorkspace: async (id: string) => structuredClone(memory.workspaces.get(id) || { candidates: [], reviewFindings: [], chapterReviews: [], aiRuns: [], canonMutations: [] }),
  saveReconstructionWorkspace: async (id: string, snapshot: any) => { memory.workspaces.set(id, JSON.parse(JSON.stringify(snapshot))) },
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
    memory.requests.push({ endpoint: _endpoint, path })
    if (path === 'auth/login') return { token: 'test-token-not-a-secret', expiresAt: Date.now() + 86400000,
      user: { id: memory.userId, username: memory.userId, role: 'user', quotaBytes: 100000000, usedBytes: 0 } }
    if (path === 'auth/logout' || path === 'auth/password') return { ok: true }
    if (path === 'sync/manifest?include=inspiration') {
      if (memory.expired) throw new original.CloudApiError(401, '登录已过期，请重新登录。')
      return { protocol: 1, features: ['inspiration'], records: [...memory.records.values()].map(({ payload, ...meta }) => meta) }
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
  memory.requests = []
  memory.workspaces = new Map()
  cloudPreferencesBusy.value = false
  setActivePinia(createPinia())
  await useNovelStore().initStore()
  await useKnowledgeStore().initStore()
  await useInspirationSessionsStore().initialize()
  sync = useCloudSyncStore()
  await sync.initialize()
})
afterEach(() => { sync.dispose(); cloudPreferencesBusy.value = false; vi.useRealTimers(); vi.restoreAllMocks() })

function addBook() {
  const store = useNovelStore()
  return store.addNovel({ genre: '', subGenre: '', tags: [], targetWordCountMin: 1, targetWordCountMax: 2,
    settings: store.defaultSettings(), writingStyle: store.defaultWritingStyle() })
}
async function loginAndEnable() {
  await sync.authenticate('login', 'owner', 'not-a-real-password')
  await sync.setEnabled(true)
  if (sync.pendingUploads.length) await sync.approveUploads(sync.pendingUploads.map(item => item.key))
}
async function remoteEdit(key: string, title: string | null) {
  const old = memory.records.get(key)!
  const doc = old.payload === null ? null : JSON.parse(old.payload)
  if (doc) doc.novel.title = title
  const payload = title === null ? null : canonicalJson(doc)
  const record: CloudRecord = { ...old, version: old.version + 1, payload, hash: await hashPayload(payload) }
  memory.records.set(key, record)
}

describe('首次下载与本机内容确认', () => {
  it('applies V3 planning to the live workspace only after durable cloud commit and retains it on failure', async () => {
    const novel = addBook()
    const localState = plannedProjectWorkspace(novel)
    memory.workspaces.set(novel.id, localState)
    const workspace = useReconstructionWorkspaceStore()
    await workspace.hydrateFromPersistence(novel.id)
    await loginAndEnable()
    const key = 'novel:' + novel.id
    const old = memory.records.get(key)
    const doc = JSON.parse(old.payload)
    expect(doc.reconstructionWorkspace.creationDraft).toEqual(localState.creationDraft)
    doc.reconstructionWorkspace.creationDraft.contract.title = '云端契约修改'
    const payload = canonicalJson(doc)
    memory.records.set(key, { ...old, payload, version: old.version + 1, hash: await hashPayload(payload) })
    memory.failSave = true
    await sync.syncNow()
    expect(sync.error).toContain('磁盘写入失败')
    expect(workspace.getCreationDraft(novel.id)?.contract.title).toBe('作者确认的作品契约')
    memory.failSave = false
    await sync.syncNow()
    expect(sync.error).toBe('')
    expect(workspace.getCreationDraft(novel.id)?.contract.title).toBe('云端契约修改')
    expect(workspace.getAiRuns(novel.id)[0].checkpoint).toBe('chapter-1:review-needs-author')
    await remoteEdit(key, null)
    await sync.syncNow()
    expect(workspace.getCreationDraft(novel.id)).toBeUndefined()
    expect(workspace.getAiRuns(novel.id)).toEqual([])
  })

  async function seedRemote() {
    const book = addBook()
    book.title = '云端作品'
    const key = 'novel:' + book.id
    const payload = canonicalJson({ kind: 'novel', schemaVersion: 3, novel: book, chapterRevisions: [], reconstructionWorkspace: emptyProjectWorkspace(book.id) })
    memory.records.set(key, { key, payload, hash: await hashPayload(payload), version: 1, bytes: payload.length, updatedAt: Date.now() })
    useNovelStore().adoptImportedNovels([])
    return book.id
  }
  it('empty new machines download cloud works without issuing a write', async () => {
    const id = await seedRemote()
    await sync.authenticate('login', 'owner', 'fixture-password')
    await sync.setEnabled(true)
    expect(useNovelStore().getNovel(id)?.title).toBe('云端作品')
    expect(memory.requests.filter(item => item.path === 'sync/push')).toHaveLength(0)
    expect(sync.pendingUploads).toHaveLength(0)
    expect(sync.error).toBe('')
  })
  it('downloads first and uploads only the selected local works', async () => {
    const remoteId = await seedRemote()
    const first = addBook(), second = addBook()
    await sync.authenticate('login', 'owner', 'fixture-password')
    await sync.setEnabled(true)
    expect(useNovelStore().getNovel(remoteId)).toBeDefined()
    expect(sync.pendingUploads).toHaveLength(2)
    expect(memory.records.size).toBe(1)
    await sync.approveUploads(['novel:' + first.id])
    expect(memory.records.has('novel:' + first.id)).toBe(true)
    expect(memory.records.has('novel:' + second.id)).toBe(false)
    expect(sync.pendingUploads.map(item => item.key)).toEqual(['novel:' + second.id])
    const calls = memory.requests.map(item => item.path)
    expect(calls.indexOf('sync/pull')).toBeLessThan(calls.indexOf('sync/push'))
  })
  it('keeps unapproved content local through repeated sync, toggle and restart', async () => {
    const book = addBook()
    await sync.authenticate('login', 'owner', 'fixture-password')
    await sync.setEnabled(true)
    await sync.syncNow()
    await sync.setEnabled(false); await sync.setEnabled(true)
    sync.dispose()
    setActivePinia(createPinia())
    await useNovelStore().initStore(); await useKnowledgeStore().initStore(); await useInspirationSessionsStore().initialize()
    useNovelStore().adoptImportedNovels([JSON.parse(JSON.stringify(book))])
    sync = useCloudSyncStore(); await sync.initialize(); await sync.syncNow()
    expect(memory.records.size).toBe(0)
    expect(sync.pendingUploads.map(item => item.key)).toEqual(['novel:' + book.id])
  })
  it('retains both versions of same-ID works on first comparison', async () => {
    const id = await seedRemote()
    const doc = JSON.parse(memory.records.get('novel:' + id).payload)
    doc.novel.title = '本机离线版本'
    useNovelStore().adoptImportedNovels([doc.novel])
    await sync.authenticate('login', 'owner', 'fixture-password'); await sync.setEnabled(true)
    expect(sync.pendingConflicts).toHaveLength(1)
    expect(sync.pendingConflicts[0].local).toContain('本机离线版本')
    expect(sync.pendingConflicts[0].remote).toContain('云端作品')
    expect(memory.requests.some(item => item.path === 'sync/push')).toBe(false)
  })
  it('requires explicit knowledge-library approval before uploading a linked novel', async () => {
    const kb = useKnowledgeStore().createKB('本机资料')
    const novel = addBook(); novel.knowledgeBaseIds = [kb.id]
    await sync.authenticate('login', 'owner', 'fixture-password'); await sync.setEnabled(true)
    await expect(sync.approveUploads(['novel:' + novel.id])).rejects.toThrow('知识库')
    expect(memory.records.size).toBe(0)
    await sync.approveUploads(['novel:' + novel.id, 'knowledge:' + kb.id])
    expect(sync.error).toBe('')
    expect(memory.records.has('knowledge:' + kb.id)).toBe(true)
    expect(memory.records.get('novel:' + novel.id).payload).toContain(kb.id)
  })
  it('failed initial pulls leave local-only works unapproved and preserve local content', async () => {
    await seedRemote(); const local = addBook()
    memory.onPull = () => { throw Error('下载失败') }
    await sync.authenticate('login', 'owner', 'fixture-password'); await sync.setEnabled(true)
    expect(sync.error).toContain('下载失败')
    expect(useNovelStore().getNovel(local.id)).toBeDefined()
    expect(memory.records.has('novel:' + local.id)).toBe(false)
    expect(sync.state.approvedUploads).toEqual([])
  })
  it('requires knowledge approval for inspiration before remembering any upload consent', async () => {
    const kb = useKnowledgeStore().createKB('本机资料')
    useInspirationSessionsStore().upsert(parseInspirationSession({ id: 'linked-idea', title: '参考资料的灵感',
      updatedAt: '2026-10-18T00:00:00Z', messages: [{ role: 'user', content: '合成测试' }], knowledgeIds: [kb.id] }))
    await sync.authenticate('login', 'owner', 'fixture-password')
    await sync.setEnabled(true)
    await expect(sync.approveUploads(['inspiration:linked-idea'])).rejects.toThrow('知识库')
    expect(sync.state.approvedUploads).toEqual([])
    expect(memory.records.size).toBe(0)
    await sync.approveUploads(['inspiration:linked-idea', 'knowledge:' + kb.id])
    expect(sync.error).toBe('')
    expect(memory.records.has('knowledge:' + kb.id)).toBe(true)
    expect(memory.records.has('inspiration:linked-idea')).toBe(true)
  })
  it('does not treat a knowledge tombstone as approval of a restored local library', async () => {
    const kb = useKnowledgeStore().createKB('本机恢复的资料')
    const key = 'knowledge:' + kb.id
    // An acknowledged deletion exists, but this local copy has never been approved.
    sync.state.bases[key] = { version: 1, hash: null }
    memory.records.set(key, { key, version: 1, hash: null, payload: null, bytes: 0, updatedAt: Date.now() })
    const novel = addBook(); novel.knowledgeBaseIds = [kb.id]
    await sync.authenticate('login', 'owner', 'fixture-password')
    await expect(sync.approveUploads(['novel:' + novel.id])).rejects.toThrow('启用云同步')
    // Check preflight without allowing an intervening sync to recreate the library.
    sync.state.enabled = true
    sync.state.pendingUploads = [{ key: 'novel:' + novel.id, title: novel.title, kind: 'novel' }]
    await expect(sync.approveUploads(['novel:' + novel.id])).rejects.toThrow('知识库')
    expect(sync.state.approvedUploads).toEqual([])
    expect(memory.requests.some(item => item.path === 'sync/push')).toBe(false)
  })
})

describe('云同步状态机', () => {
  it('keeps browser login in the current tab session and restores it after a reload', async () => {
    await sync.authenticate('login', 'owner', 'not-a-real-password')
    expect(sessionStorage.getItem('mojian-v3-cloud-session')).toContain('test-token-not-a-secret')
    expect(localStorage.getItem('mojian-v3-cloud-session')).toBeNull()

    sync.dispose()
    setActivePinia(createPinia())
    await useNovelStore().initStore(); await useKnowledgeStore().initStore(); await useInspirationSessionsStore().initialize()
    sync = useCloudSyncStore()
    await sync.initialize()
    expect(sync.session?.token).toBe('test-token-not-a-secret')

    await sync.logout()
    expect(sessionStorage.getItem('mojian-v3-cloud-session')).toBeNull()
  })

  it('serializes project operations against silent preference network synchronization', async () => {
    addBook()
    await loginAndEnable()
    memory.requests = []
    cloudPreferencesBusy.value = true
    await sync.syncNow()
    await expect(sync.logout()).rejects.toThrow('等待')
    expect(memory.requests).toHaveLength(0)
    expect(sync.session).not.toBeNull()
    cloudPreferencesBusy.value = false
    await sync.syncNow()
    expect(memory.requests.some(item => item.path.startsWith('sync/manifest'))).toBe(true)
  })
  it('uploads a whole unfinished conversation and restores remote drafts without any model credentials', async () => {
    const store = useInspirationSessionsStore()
    store.upsert(parseInspirationSession({ id: 'idea', title: '未成书', updatedAt: '2026-09-18T00:00:00Z',
      messages: [{ role: 'user', content: '种田的故事' }], draft: '明天继续', knowledgeIds: [], webSearch: true }))
    await loginAndEnable()
    const remote = memory.records.get('inspiration:idea')
    expect(remote.payload).toContain('明天继续')
    const doc = JSON.parse(remote.payload)
    doc.inspiration.messages.push({ role: 'assistant', content: '公司的回复' })
    doc.inspiration.draft = '家里继续'
    const payload = canonicalJson(doc)
    memory.records.set('inspiration:idea', { ...remote, payload, hash: await hashPayload(payload), version: 2 })
    await sync.syncNow()
    expect(store.sessions[0].messages).toHaveLength(2)
    expect(store.sessions[0].draft).toBe('家里继续')
    expect(store.sessions[0].webSearch).toBe(true)
    expect(sync.error).toBe('')
  })
  it('logs out after password changes while preserving bound novels', async () => {
    const book = addBook()
    await loginAndEnable()
    await sync.changePassword('old-password', '123456')
    expect(sync.session).toBeNull()
    expect(sync.state.binding?.userId).toBe('owner')
    expect(useNovelStore().getNovel(book.id)).toBeDefined()
    expect(memory.requests.some(item => item.path === 'auth/password')).toBe(true)
  })
  it('does not upload merely by signing in; enabling binds the local shelf', async () => {
    const novel = addBook()
    await sync.authenticate('login', 'owner', 'not-a-real-password')
    expect(memory.records.size).toBe(0)
    expect(sync.state.binding).toBeNull()
    await sync.setEnabled(true)
    expect(memory.records.size).toBe(0)
    expect(sync.pendingUploads).toHaveLength(1)
    await sync.approveUploads(sync.pendingUploads.map(item => item.key))
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
  it('does not report synced or advance lastSync while an acknowledged upload is deferred', async () => {
    const novel = addBook()
    await loginAndEnable()
    const lastSync = sync.state.lastSync
    const remoteVersion = memory.records.get('novel:' + novel.id).version
    memory.requests = []
    vi.setSystemTime(Date.now() + 60000)
    useNovelStore().getNovel(novel.id)!.title = '编辑器中的未上传修改'
    window.location.hash = `#/workspace/${novel.id}/editor/chapter`
    await sync.syncNow()
    expect(sync.phase).toBe('waiting')
    expect(sync.state.lastSync).toBe(lastSync)
    expect(memory.requests.some(item => item.path === 'sync/push')).toBe(false)
    expect(memory.records.get('novel:' + novel.id).version).toBe(remoteVersion)
    window.location.hash = '#/'
    await sync.syncNow()
    expect(memory.records.get('novel:' + novel.id).payload).toContain('编辑器中的未上传修改')
    expect(sync.error).toBe('')
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
  it('refreshes a stale conflict without recording an unapplied local choice', async () => {
    const novel = addBook()
    await loginAndEnable()
    useNovelStore().getNovel(novel.id)!.title = '家里'
    const key = `novel:${novel.id}`
    await remoteEdit(key, '公司')
    await sync.syncNow()
    const original = sync.pendingConflicts[0]

    await remoteEdit(key, '公司又改了')
    await expect(sync.resolveConflict(original.id, 'remote')).rejects.toThrow('已刷新冲突记录')

    expect(useNovelStore().getNovel(novel.id)?.title).toBe('家里')
    expect(sync.pendingConflicts).toHaveLength(1)
    expect(sync.pendingConflicts[0]).toMatchObject({ local: expect.stringContaining('家里'), remote: expect.stringContaining('公司又改了'), remoteVersion: 3 })
    expect(sync.conflicts.find(item => item.id === original.id)?.resolution).toBe('superseded')

    await sync.resolveConflict(sync.pendingConflicts[0].id, 'remote')
    expect(useNovelStore().getNovel(novel.id)?.title).toBe('公司又改了')
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
    expect(sessionStorage.getItem('mojian-v3-cloud-session')).toBeNull()
  })
  it('restores the bound server without a token and rejects changed destinations before sending credentials', async () => {
    sync.dispose()
    memory.state = { ...emptySyncState(), binding: { endpoint: 'https://sync.example.test', userId: 'owner', username: 'owner' } }
    setActivePinia(createPinia())
    sync = useCloudSyncStore()
    await sync.initialize()
    expect(sync.endpoint).toBe('https://sync.example.test')
    sync.endpoint = 'https://different.example.test'
    await expect(sync.authenticate('login', 'owner', 'private-password')).rejects.toThrow('原服务器地址')
    await expect(sync.recover('owner', 'private-recovery', 'new-password')).rejects.toThrow('原服务器地址')
    expect(memory.requests).toHaveLength(0)
    sync.endpoint = 'https://sync.example.test'
    await expect(sync.authenticate('register', 'new-account', 'private-password', 'invite')).rejects.toThrow('已绑定账号')
    expect(memory.requests).toHaveLength(0)
  })
})
