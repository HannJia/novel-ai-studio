import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createTestProjectBackup } from '@/test/projectBackupFixture'

const require = createRequire(import.meta.url)
const { createProjectKernelHandler, validateBackup } = require('../../app-main/projectKernelRpc.cjs')
let root: string
let handle: (event: object, request: unknown) => Promise<any>
const trusted = { sender: 'main-frame' }
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'mojian-kernel-rpc-'))
  handle = createProjectKernelHandler({ root, authorize: (event: unknown) => {
    if (event !== trusted) throw Object.assign(new Error('Unauthorized sender'), { code: 'PROJECT_FORBIDDEN' })
  } })
})
afterEach(async () => {
  if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('mojian-kernel-rpc-')) throw new Error('Unexpected test root')
  await rm(root, { recursive: true, force: true })
})

describe('typed project IPC handler', () => {
  it('authorizes before touching project storage', async () => {
    expect(await handle({}, { method: 'read' })).toMatchObject({ ok: false, error: { code: 'PROJECT_FORBIDDEN' } })
    expect(await readdir(root)).toEqual([])
  })
  it.each([null, [], {}, { method: 'exec', sql: 'DELETE FROM novels' }, { method: 'constructor' },
    { method: 'read', path: '../secret' }, { method: 'commit', backup: {} }, { method: 'restore', baseRevision: null, revision: 5 },
    { method: 'location', projectId: '../x', path: 'x' }, { method: 'rebuildIndex', projectId: '' },
  ])('rejects unsupported or malformed request %j without filesystem effects', async request => {
    expect(await handle(trusted, request)).toMatchObject({ ok: false, error: { code: 'PROJECT_INVALID' } })
    expect(await readdir(root)).toEqual([])
  })
  it('uses the generated full V2 validator at the main-process boundary', () => {
    const backup = createTestProjectBackup([], [])
    expect(() => validateBackup(backup)).not.toThrow()
    expect(() => validateBackup({ ...backup, version: 1 })).toThrow()
    expect(() => validateBackup({ ...backup, reconstructionWorkspaces: undefined })).toThrow()
    expect(() => validateBackup({ ...backup, knowledgeBases: [{ id: '__proto__' }] })).toThrow()
  })
  it('validates and executes the retention preview and confirmation RPCs', async () => {
    const backup = createTestProjectBackup([], [])
    const committed = await handle(trusted, { method: 'commit', baseRevision: null, backup })
    const invalid = await handle(trusted, { method: 'previewHistoryRetention', policy: { keepLatest: -1, keepSince: null }, pinnedRevisions: [] })
    expect(invalid).toMatchObject({ ok: false, error: { code: 'PROJECT_INVALID' } })
    const preview = await handle(trusted, { method: 'previewHistoryRetention', policy: { keepLatest: 1, keepSince: null }, pinnedRevisions: [] })
    expect(preview.ok).toBe(true)
    const confirmed = await handle(trusted, { method: 'confirmHistoryRetention', token: preview.value.token, baseRevision: committed.value.revision })
    expect(confirmed.ok).toBe(true)
    expect(confirmed.value.revision).not.toBe(committed.value.revision)
    expect((await handle(trusted, { method: 'historyRetention' })).value.policy.keepLatest).toBe(1)
  })
  it('round trips serializable responses and forwards history, CAS and restore', async () => {
    const read = await handle(trusted, { method: 'read' })
    expect(read).toEqual({ ok: true, value: { revision: null, backup: null, sync: { state: null, conflicts: [] } } })
    const backup = createTestProjectBackup([], [])
    const first = await handle(trusted, { method: 'commit', baseRevision: null, backup })
    expect(first.ok).toBe(true)
    expect(JSON.parse(JSON.stringify(first)).value.backup).toEqual(backup)
    const stale = await handle(trusted, { method: 'commit', baseRevision: null, backup })
    expect(stale).toMatchObject({ ok: false, error: { code: 'PROJECT_CONFLICT' } })
    const restored = await handle(trusted, { method: 'restore', baseRevision: first.value.revision, revision: first.value.revision })
    expect(restored).toMatchObject({ ok: false, error: { code: 'PROJECT_INVALID', message: expect.stringContaining('逐作品') } })
    const history = await handle(trusted, { method: 'history' })
    expect(history.value).toHaveLength(1)
    expect(history.value[0].revision).toBe(first.value.revision)
  }, 20000)
})
