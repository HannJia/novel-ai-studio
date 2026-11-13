import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, readdir, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { characterStateFixture, knowledgeCandidate, stateTestTime } from '@/test/characterStateFixture'
import { createTestProjectBackup, plannedProjectWorkspace } from '@/test/projectBackupFixture'
import { acceptCandidateChange } from './reconstructionReview'
import { applyCandidateChangeToCanon } from './reconstructionCanon'
import type { ProjectBackup } from './projectBackup'

const require = createRequire(import.meta.url)
type Sync = { state: Record<string, unknown> | null; conflicts: Record<string, unknown>[] }
type Snapshot = { revision: string | null; backup: ProjectBackup | null; sync: Sync }
interface Kernel {
  read(): Promise<Snapshot>
  commit(input: { baseRevision: string | null; backup: ProjectBackup; sync?: Sync }): Promise<Snapshot>
  history(): Promise<import('@/types/projectHistory').ProjectHistoryEntry[]>
  historyRetention(): Promise<{ supported: boolean; policy: { keepLatest: number | null; keepSince: string | null }; pinnedRevisions: string[]; fingerprint: string; limitations: string[] }>
  previewHistoryRetention(input: { policy: { keepLatest: number | null; keepSince: string | null }; pinnedRevisions: string[] }): Promise<{ token: string; baseRevision: string | null; fingerprint: string; policy: { keepLatest: number | null; keepSince: string | null }; pinnedRevisions: string[]; prunedRevisions: string[]; archiveSources: unknown[] }>
  confirmHistoryRetention(input: { token: string; baseRevision: string | null }): Promise<{ revision: string | null; backup: ProjectBackup | null; sync: Sync; policy: { keepLatest: number | null; keepSince: string | null }; pinnedRevisions: string[]; prunedRevisions: string[] }>
  checkpoint(input: { baseRevision: string | null; novelId: string }): Promise<Snapshot>
  readSnapshot(input: { revision: string }): Promise<ProjectBackup>
  historyRuns(input: { projectId: string; baseRevision: string | null; cursor: number }): Promise<{ projectId: string; baseRevision: string | null; nextCursor: number | null; source: { runs: any[] } | null }>
  restore(input: { baseRevision: string | null; revision: string }): Promise<Snapshot>
  restoreNovel(input: { baseRevision: string; revision: string; novelId: string; scope: import('@/types/projectHistory').ProjectHistoryScope }): Promise<Snapshot>
  getProjectLocation(id: string): Promise<string>
  rebuildIndex(id: string): Promise<void>
}
const kernelModule = require.resolve('../../app-main/projectKernel.cjs')
const validationModule = require.resolve('../../app-main/projectKernelRpc.cjs')
const { createProjectKernel } = require(kernelModule) as { createProjectKernel(options: { root: string; validateBackup: (value: unknown) => void; fault?: (stage: string) => void | Promise<void> }): Promise<Kernel> }
const { validateBackup } = require(validationModule) as { validateBackup: (value: unknown) => void }
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
let root: string
const children = new Set<ChildProcessWithoutNullStreams>()
const open = (fault?: (stage: string) => void | Promise<void>) => createProjectKernel({ root, validateBackup, fault })

function fixture() {
  const { novel, store } = characterStateFixture()
  const candidate = acceptCandidateChange(knowledgeCandidate(novel, 0), stateTestTime)
  const canon = applyCandidateChangeToCanon(novel, candidate, stateTestTime).record
  const first = plannedProjectWorkspace(novel)
  first.candidates = [candidate]
  first.canonMutations = [canon]
  first.reviewFindings = [{ id: 'finding', type: 'knowledge', severity: 'warning', title: '线索', explanation: '作者保留',
    chapterId: novel.chapters[0].id, evidence: candidate.evidence, blocksFinalization: false, status: 'intentional' }]
  first.chapterReviews = [{ id: 'review', chapterId: novel.chapters[0].id, sourceVersionId: candidate.sourceVersionId!,
    startedAt: stateTestTime, deterministicChecksPassed: true, findings: [], candidateChanges: [], status: 'approved' }]
  novel.chapters[0].content = '\ufeff  开头\r\n\t正文 😀\n\n结尾  \r\n'
  novel.chapters[0].versions = [{ id: 'chapter-version', label: '旧稿', savedAt: stateTestTime, snapshot: JSON.stringify({
    title: novel.chapters[0].title, content: '旧正文', summary: '', status: 'draft',
  }) }]
  const second = store.addNovel({ genre: '', subGenre: '', tags: [], targetWordCountMin: 1, targetWordCountMax: 2,
    settings: store.defaultSettings(), writingStyle: store.defaultWritingStyle() })
  second.title = '第二本'
  store.addChapter(second.id, { title: '空正文', content: '' })
  const secondWorkspace = plannedProjectWorkspace(second)
  const backup = createTestProjectBackup([novel, second], [{ id: 'kb', name: '设定', description: '', createdAt: stateTestTime,
    entries: [{ id: 'entry', category: '世界', title: '规则', content: '知识正文', summary: '', tags: [], createdAt: stateTestTime, updatedAt: stateTestTime }] }],
  [second, novel].map((book, index) => ({ id: 'revision-' + index, novelId: book.id, chapterId: book.chapters[0].id,
    baseContent: '原稿', proposedContent: '新稿', diff: '差异', reason: '人工修订', source: 'user', status: 'pending', createdAt: stateTestTime, updatedAt: stateTestTime })),
  [{ id: 'inspiration', title: '灵感', updatedAt: stateTestTime, messages: [{ role: 'assistant', content: '保留灵感' }], knowledgeIds: ['kb'], draft: '草案', webSearch: false }],
  [secondWorkspace, first])
  validateBackup(backup)
  return backup
}
async function latestMarker() {
  const names = (await readdir(path.join(root, 'commits'))).filter(name => name.endsWith('.json')).sort()
  const name = names[names.length - 1]
  const filename = path.join(root, 'commits', name)
  return { filename, marker: JSON.parse(await readFile(filename, 'utf8')) }
}
async function replaceMarker(filename: string, marker: unknown) {
  const data = JSON.stringify(marker)
  const next = path.join(path.dirname(filename), path.basename(filename).slice(0, 17) + sha(data) + '.json')
  await writeFile(filename, data)
  if (filename !== next) await rename(filename, next)
}
function child(mode: string, backup: ProjectBackup, baseRevision: string | null = null) {
  const code = `
    const { createProjectKernel } = require(${JSON.stringify(kernelModule)});
    const { validateBackup } = require(${JSON.stringify(validationModule)});
    let input = ''; process.stdin.on('data', chunk => input += chunk);
    process.stdin.on('end', async () => {
      const { root, backup, baseRevision, mode } = JSON.parse(input);
      try {
        if (mode === 'observe-owner') {
          const fs = require('node:fs').promises, path = require('node:path');
          const open = fs.open.bind(fs), kill = process.kill.bind(process);
          let notified = false, release;
          const released = new Promise(resolve => { release = resolve; });
          process.on('message', value => { if (value === 'release-owner-read') release(); });
          const notify = kind => { if (!notified) { notified = true; process.send({ kind }); } };
          fs.open = async (...args) => {
            const handle = await open(...args);
            if (path.dirname(String(args[0])) === path.join(root, '.writer-lock')) {
              const read = handle.readFile.bind(handle);
              handle.readFile = async (...input) => { await released; return read(...input); };
              notify('owner-file-open');
            }
            return handle;
          };
          process.kill = (pid, signal) => { const value = kill(pid, signal); if (signal === 0) notify('owner-alive'); return value; };
        }
        const kernel = await createProjectKernel({ root, validateBackup, fault: mode === 'crash' ? async stage => {
          if (stage === 'before-publish') { process.stdout.write('READY\\n'); await new Promise(() => setInterval(() => {}, 1000)); }
        } : undefined });
        const result = await kernel.commit({ baseRevision, backup });
        process.stdout.write(JSON.stringify({ ok: true, revision: result.revision }));
      } catch (e) { process.stdout.write(JSON.stringify({ ok: false, code: e.code, message: e.message })); process.exitCode = 1; }
      finally { if (process.connected) process.disconnect(); }
    });`
  const worker = spawn(process.execPath, ['-e', code], { cwd: path.dirname(kernelModule), windowsHide: true,
    stdio: mode === 'observe-owner' ? ['pipe', 'pipe', 'pipe', 'ipc'] : ['pipe', 'pipe', 'pipe'] }) as ChildProcessWithoutNullStreams
  children.add(worker)
  let output = '', stderr = ''
  let readyResolve!: () => void
  const ready = new Promise<void>(resolve => { readyResolve = resolve })
  worker.on('message', value => { if (value && typeof value === 'object' && 'kind' in value) readyResolve() })
  worker.stdout.on('data', data => { output += data; if (output.includes('READY')) readyResolve() })
  worker.stderr.on('data', data => { stderr += data })
  const done = new Promise<{ ok: boolean; code?: string; revision?: string }>((resolve, reject) => {
    worker.on('error', reject)
    worker.on('close', () => {
      children.delete(worker)
      if (mode === 'crash') { resolve({ ok: false }); return }
      try { resolve(JSON.parse(output)) } catch { reject(new Error(stderr || output || 'Child produced no result')) }
    })
  })
  worker.stdin.end(JSON.stringify({ root, backup, baseRevision, mode }))
  return { worker, ready, done }
}

beforeEach(async () => { setActivePinia(createPinia()); root = await mkdtemp(path.join(tmpdir(), 'mojian-kernel-')) })
afterEach(async () => {
  for (const worker of children) { const stopped = once(worker, 'close'); worker.kill(); await stopped }
  children.clear()
  if (path.dirname(root) !== tmpdir() || !path.basename(root).startsWith('mojian-kernel-')) throw new Error('Unexpected test root')
  await rm(root, { recursive: true, force: true })
})

describe('main-process project kernel on real files', () => {
  it('previews and commits retention decisions with protected checkpoints and archived request ledgers', async () => {
    const backup = fixture(), kernel = await open()
    const first = await kernel.commit({ baseRevision: null, backup })
    const protectedPoint = await kernel.checkpoint({ baseRevision: first.revision, novelId: backup.novels[0].id })
    const run = { id: 'retention-run', mode: 'autonomous', taskType: 'draft', targetId: backup.novels[0].id,
      chapterStart: 0, chapterEnd: 1, tokenBudget: 100, usedTokens: 20, requestLimit: 2, status: 'completed',
      createdAt: stateTestTime, updatedAt: stateTestTime, requests: [{ id: 'retention-request', chapterIndex: 0, phase: 'writing',
        modelId: 'test', status: 'completed', reservedTokens: 20, inputTokens: 10, outputTokens: 10, usageSource: 'reported', startedAt: stateTestTime, completedAt: stateTestTime }] }
    const workspace = backup.reconstructionWorkspaces.find(row => row.novelId === backup.novels[0].id)!
    workspace.aiRuns = [run as any]
    const withLedger = await kernel.commit({ baseRevision: protectedPoint.revision, backup })
    backup.novels[0].title = '账本之后的新版本'
    const latest = await kernel.commit({ baseRevision: withLedger.revision, backup })
    const preview = await kernel.previewHistoryRetention({ policy: { keepLatest: 1, keepSince: null }, pinnedRevisions: [] })
    expect(preview.prunedRevisions).toContain(first.revision)
    expect(preview.prunedRevisions).not.toContain(protectedPoint.revision)
    expect(preview.prunedRevisions).not.toContain(latest.revision)
    const result = await kernel.confirmHistoryRetention({ token: preview.token, baseRevision: preview.baseRevision })
    expect(result.prunedRevisions).toEqual(preview.prunedRevisions)
    expect((await kernel.history()).find(row => row.revision === first.revision)?.prunedAt).toBeTruthy()
    await expect(kernel.readSnapshot({ revision: first.revision! })).rejects.toThrow('已由作者确认裁剪')
    let cursor = 0, ledgerRuns: any[] = []
    do {
      const page = await kernel.historyRuns({ projectId: backup.novels[0].id, baseRevision: result.revision, cursor })
      if (page.source) ledgerRuns.push(...page.source.runs)
      if (page.nextCursor === null) break
      cursor = page.nextCursor
    } while (true)
    expect(ledgerRuns.find((item: any) => item.id === run.id)?.requests?.[0].id).toBe('retention-request')
    const retentionFiles = await readdir(path.join(root, 'maintenance', 'history-ledger'))
    expect(retentionFiles.some(name => name.endsWith('.json'))).toBe(true)
    const firstMarker = JSON.parse(await readFile(path.join(root, 'commits', first.revision + '.json'), 'utf8'))
    const firstSnapshot = firstMarker.projects.find((ref: { id: string }) => ref.id === backup.novels[0].id).snapshot
    let archiveName = ''
    for (const name of retentionFiles) {
      const archive = JSON.parse(await readFile(path.join(root, 'maintenance', 'history-ledger', name), 'utf8'))
      if (archive.projectId === backup.novels[0].id && archive.snapshot === firstSnapshot) archiveName = name
    }
    expect(archiveName).not.toBe('')
    const archivePath = path.join(root, 'maintenance', 'history-ledger', archiveName)
    const archiveBytes = await readFile(archivePath)
    await unlink(archivePath)
    await kernel.historyRuns({ projectId: backup.novels[0].id, baseRevision: result.revision, cursor: 0 })
    expect(await readFile(archivePath)).toEqual(archiveBytes)
    await expect((await open()).read()).resolves.toMatchObject({ revision: result.revision })
  })

  it('reuses immutable ledger archives across successive decisions and permits explicit unpinning', async () => {
    const kernel = await open(), backup = fixture()
    const first = await kernel.commit({ baseRevision: null, backup })
    const second = await kernel.commit({ baseRevision: first.revision, backup })
    let preview = await kernel.previewHistoryRetention({ policy: { keepLatest: 1, keepSince: null }, pinnedRevisions: [first.revision!] })
    expect(preview.prunedRevisions).toEqual([])
    await kernel.confirmHistoryRetention(preview)
    preview = await kernel.previewHistoryRetention({ policy: { keepLatest: 1, keepSince: null }, pinnedRevisions: [] })
    expect(preview.prunedRevisions).toContain(first.revision)
    await kernel.confirmHistoryRetention(preview)
    const archiveFiles = await readdir(path.join(root, 'maintenance', 'history-ledger'))
    preview = await kernel.previewHistoryRetention({ policy: { keepLatest: 1, keepSince: null }, pinnedRevisions: [] })
    await kernel.confirmHistoryRetention(preview)
    expect(await readdir(path.join(root, 'maintenance', 'history-ledger'))).toEqual(archiveFiles)
    const reopened = await open()
    expect((await reopened.historyRetention()).pinnedRevisions).toEqual([])
    expect((await reopened.history()).find(row => row.revision === second.revision)?.prunedAt).toBeTruthy()
    await expect(reopened.previewHistoryRetention({ policy: { keepLatest: null, keepSince: null }, pinnedRevisions: [first.revision!] })).rejects.toThrow('已裁剪')
  })

  it('rejects a stale retention preview and preserves current history', async () => {
    const backup = fixture(), kernel = await open(), first = await kernel.commit({ baseRevision: null, backup })
    const preview = await kernel.previewHistoryRetention({ policy: { keepLatest: 1, keepSince: null }, pinnedRevisions: [] })
    backup.novels[0].title = '预览后修改'
    await kernel.commit({ baseRevision: first.revision, backup })
    await expect(kernel.confirmHistoryRetention({ token: preview.token, baseRevision: preview.baseRevision })).rejects.toMatchObject({ code: 'PROJECT_CONFLICT' })
    expect((await kernel.history()).every(row => !row.prunedAt)).toBe(true)
  })

  it('does not publish a retention decision when the final marker commit fails', async () => {
    const backup = fixture(), initial = await open()
    const first = await initial.commit({ baseRevision: null, backup })
    const preview = await initial.previewHistoryRetention({ policy: { keepLatest: 1, keepSince: null }, pinnedRevisions: [] })
    const failing = await open(async stage => { if (stage === 'before-publish') throw new Error('retention marker failure') })
    const tokenPreview = await failing.previewHistoryRetention({ policy: { keepLatest: 1, keepSince: null }, pinnedRevisions: [] })
    await expect(failing.confirmHistoryRetention({ token: tokenPreview.token, baseRevision: preview.baseRevision })).rejects.toThrow('retention marker failure')
    expect((await initial.history()).find(row => row.revision === first.revision)?.prunedAt).toBeFalsy()
    expect((await initial.read()).revision).toBe(first.revision)
  })

  it('returns null only before initialization; an explicitly committed empty library is a backup', async () => {
    const kernel = await open()
    expect(await kernel.read()).toEqual({ revision: null, backup: null, sync: { state: null, conflicts: [] } })
    expect(await kernel.history()).toEqual([])
    const backup = createTestProjectBackup([], [])
    const committed = await kernel.commit({ baseRevision: null, backup })
    expect(committed.backup).toEqual(backup)
    expect((await (await open()).read()).revision).toBe(committed.revision)
  })

  it('round trips the entire bookshelf, ordering, planning, reviews, Canon and exact chapter whitespace', async () => {
    const kernel = await open(), backup = fixture()
    const sync = { state: { cursor: 'abc', nested: { enabled: true } }, conflicts: [{ id: 'conflict', local: backup.novels[0] }] }
    const result = await kernel.commit({ baseRevision: null, backup, sync })
    expect(result.backup).toEqual(backup)
    expect(result.sync).toEqual(sync)
    expect(await (await open()).read()).toEqual(result)
    const projectRoot = await kernel.getProjectLocation(backup.novels[0].id)
    expect(projectRoot).toBe(path.join(root, 'projects', sha(backup.novels[0].id)))
    const snapshot = (await readdir(path.join(projectRoot, 'snapshots')))[0]
    const directory = path.join(projectRoot, 'snapshots', snapshot)
    const project = JSON.parse(await readFile(path.join(directory, 'project.json'), 'utf8'))
    expect(project.chapters[0]).not.toHaveProperty('content')
    expect(project).not.toHaveProperty('config')
    const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'))
    const chapterHash = manifest.files[manifest.chapters[0].filename]
    expect(await readFile(path.join(projectRoot, 'chapters', chapterHash + '.md'), 'utf8')).toBe(backup.novels[0].chapters[0].content)
    expect(JSON.parse(await readFile(path.join(directory, 'workspace.json'), 'utf8'))[0]).toEqual(backup.reconstructionWorkspaces[1])
    result.backup!.novels[0].title = '外部修改'
    expect((await kernel.read()).backup).toEqual(backup)
  })

  it.each(['after-project-write', 'before-publish'])('keeps the whole previous commit current after %s failure and restart', async stage => {
    const backup = fixture(), kernel = await open()
    const previous = await kernel.commit({ baseRevision: null, backup, sync: { state: { cursor: 'old' }, conflicts: [] } })
    const changed = clone(backup)
    changed.novels.forEach(novel => { novel.title += '新'; novel.chapters[0].content += '新正文' })
    const failed = await open(at => { if (at === stage) throw new Error('simulated write failure') })
    await expect(failed.commit({ baseRevision: previous.revision, backup: changed, sync: { state: { cursor: 'new' }, conflicts: [] } })).rejects.toMatchObject({ code: 'PROJECT_CORRUPT' })
    const reopened = await open()
    expect(await reopened.read()).toEqual(previous)
    expect(await reopened.history()).toHaveLength(1)
    const next = await reopened.commit({ baseRevision: previous.revision, backup: changed })
    expect(next.backup).toEqual(changed)
    expect(next.sync).toEqual(previous.sync)
  })

  it('serializes independent instances and accepts exactly one commit with the same base revision', async () => {
    const backup = fixture(), a = await open(), b = await open()
    const outcomes = await Promise.allSettled([a.commit({ baseRevision: null, backup }), b.commit({ baseRevision: null, backup })])
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'PROJECT_CONFLICT' } })
    expect(await a.history()).toHaveLength(1)
  })

  it('enforces CAS between separate Node processes', async () => {
    await open()
    const backup = fixture()
    const a = child('commit', backup), b = child('commit', backup)
    const results = await Promise.all([a.done, b.done])
    expect(results.filter(result => result.ok), JSON.stringify(results)).toHaveLength(1)
    expect(results.find(result => !result.ok)).toMatchObject({ code: 'PROJECT_CONFLICT' })
    expect(await (await open()).history()).toHaveLength(1)
  }, 20000)

  it('releases a published commit while a competing process observes the live owner', async () => {
    const backup = fixture()
    let entered!: () => void, publish!: () => void
    const atPublish = new Promise<void>(resolve => { entered = resolve })
    const publishing = new Promise<void>(resolve => { publish = resolve })
    const kernel = await open(async stage => { if (stage === 'before-publish') { entered(); await publishing } })
    const committing = kernel.commit({ baseRevision: null, backup }).then(
      value => ({ ok: true as const, value }), error => ({ ok: false as const,
        error: { code: error.code, message: error.message, cause: error.cause?.code } }),
    )
    await Promise.race([atPublish, committing.then(() => { throw new Error('Writer exited before the publication checkpoint') })])
    const observer = child('observe-owner', backup)
    let outcome: Awaited<typeof committing>
    try {
      await Promise.race([observer.ready, observer.done.then(() => { throw new Error('Observer exited before checking the lock') })])
      publish()
      outcome = await committing
    } finally {
      publish()
      if (observer.worker.connected) observer.worker.send('release-owner-read')
    }
    const competitor = await observer.done
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true)
    expect(competitor).toMatchObject({ ok: false, code: 'PROJECT_CONFLICT' })
    expect(await (await open()).history()).toHaveLength(1)
    expect((await kernel.read()).backup).toEqual(backup)
    expect((await readdir(root)).filter(name => name === '.writer-lock' || name.startsWith('.lock-'))).toEqual([])
  }, 20000)

  it('recovers a confirmed dead process lock and ignores its unpublished marker', async () => {
    const kernel = await open(), backup = fixture()
    const previous = await kernel.commit({ baseRevision: null, backup })
    const changed = clone(backup); changed.novels[0].title = '崩溃前的新稿'
    const crashed = child('crash', changed, previous.revision)
    await Promise.race([crashed.ready, crashed.done.then(() => { throw new Error('Child exited before fault point') })])
    expect(await kernel.read()).toEqual(previous)
    await expect(kernel.commit({ baseRevision: previous.revision, backup: changed })).rejects.toMatchObject({ code: 'PROJECT_BUSY' })
    expect(await kernel.read()).toEqual(previous)
    crashed.worker.kill()
    await crashed.done
    const reopened = await open()
    expect(await reopened.read()).toEqual(previous)
    // A PID encoded in a dead owner's name does not authorize reaping a
    // contradictory owner record. Keep validating the record before removal.
    const owners = await readdir(path.join(root, '.writer-lock'))
    const ownerPath = path.join(root, '.writer-lock', owners[0])
    const ownerData = await readFile(ownerPath)
    await writeFile(ownerPath, JSON.stringify({ pid: process.pid }))
    await expect(reopened.commit({ baseRevision: previous.revision, backup: changed })).rejects.toMatchObject({
      code: 'PROJECT_CORRUPT', message: expect.stringContaining('Invalid lock owner'),
    })
    expect(await reopened.read()).toEqual(previous)
    expect((await readdir(root)).filter(name => name.startsWith('.lock-'))).toEqual([])
    expect(await readdir(path.join(root, '.writer-lock'))).toEqual(owners)
    expect(JSON.parse(await readFile(ownerPath, 'utf8'))).toEqual({ pid: process.pid })
    await writeFile(ownerPath, ownerData)
    const next = await reopened.commit({ baseRevision: previous.revision, backup: changed })
    expect(next.backup).toEqual(changed)
    expect(await reopened.history()).toHaveLength(2)
  }, 20000)

  it.each(['chapter', 'library', 'marker', 'manifest'])('reports damaged latest %s rather than falling back to older commits', async kind => {
    const backup = fixture(), kernel = await open()
    const first = await kernel.commit({ baseRevision: null, backup })
    backup.novels[0].title = '第二版本'
    await kernel.commit({ baseRevision: first.revision, backup })
    const { filename, marker } = await latestMarker()
    let target = filename
    if (kind === 'library') target = path.join(root, 'library', marker.library.hash + '.json')
    if (kind === 'manifest' || kind === 'chapter') {
      const ref = marker.projects[0]
      const directory = path.join(root, 'projects', ref.key, 'snapshots', ref.snapshot)
      target = path.join(directory, 'manifest.json')
      if (kind === 'chapter') {
        const manifest = JSON.parse(await readFile(target, 'utf8'))
        target = path.join(root, 'projects', ref.key, 'chapters', manifest.files[manifest.chapters[0].filename] + '.md')
      }
    }
    await writeFile(target, 'corrupt')
    await expect(kernel.read()).rejects.toMatchObject({ code: 'PROJECT_CORRUPT' })
    await expect(open()).rejects.toMatchObject({ code: 'PROJECT_CORRUPT' })
  })

  it('detects missing latest source files', async () => {
    const kernel = await open()
    await kernel.commit({ baseRevision: null, backup: fixture() })
    const { marker } = await latestMarker()
    await unlink(path.join(root, 'library', marker.library.hash + '.json'))
    await expect(kernel.read()).rejects.toMatchObject({ code: 'PROJECT_CORRUPT' })
  })

  it('restores deleted books and sync by appending a new commit without changing original snapshots', async () => {
    const backup = fixture(), kernel = await open()
    const first = await kernel.commit({ baseRevision: null, backup, sync: { state: { cursor: 'first' }, conflicts: [{ id: 'old' }] } })
    const { marker } = await latestMarker(), ref = marker.projects.find((row: { id: string }) => row.id === backup.novels[0].id)!
    const original = path.join(root, 'projects', ref.key, 'snapshots', ref.snapshot, 'manifest.json')
    const originalBytes = await readFile(original)
    const beforeRestore = clone(await kernel.read())
    const empty = await kernel.commit({ baseRevision: first.revision, backup: createTestProjectBackup([], []), sync: { state: null, conflicts: [] } })
    const historical = clone(first.backup!.novels.find(row => row.id === backup.novels[0].id)!)
    const restoredNovel: import('@/types/novel').Novel = { ...historical, chapters: historical.chapters.map(chapter => ({ ...chapter, status: 'writing', contentReviewSignature: '', contentReviewCoverage: undefined })) }
    const workspace = clone(first.backup!.reconstructionWorkspaces.find(row => row.novelId === backup.novels[0].id)!)
    workspace.aiRuns = workspace.aiRuns.map(run => ({ ...run, status: 'paused' as const }))
    const restored = await kernel.restoreNovel({ baseRevision: empty.revision!, revision: first.revision!, novelId: backup.novels[0].id,
      scope: { novel: restoredNovel, workspace, chapterRevisions: first.backup!.chapterRevisions.filter(row => row.novelId === backup.novels[0].id),
        inspirationSessions: [], knowledgeBaseIds: [] } })
    expect(restored.backup?.novels).toContainEqual(restoredNovel)
    expect(restored.sync).toEqual(empty.sync)
    expect(restored.revision).not.toBe(first.revision)
    expect(await readFile(original)).toEqual(originalBytes)
    const history = await kernel.history()
    expect(history).toHaveLength(4)
    expect(history.map(item => item.projectCount)).toEqual([1, 0, 0, 2])
    expect(history.map(item => item.parentRevision)).toEqual([expect.any(String), empty.revision, first.revision, null])
    expect(beforeRestore.revision).toBe(first.revision)
    expect(beforeRestore).not.toEqual(await kernel.read())
  })

  it('uses only generated hashes for hostile project IDs and titles and rejects junction paths', async () => {
    const backup = createTestProjectBackup([], [])
    const source = fixture().novels[1]
    source.id = '../../outside/C:\\escape'; source.title = '../../CON:<bad>|name'
    backup.novels = [source]; backup.reconstructionWorkspaces = [plannedProjectWorkspace(source)]
    const kernel = await open()
    await kernel.commit({ baseRevision: null, backup })
    const projectRoot = await kernel.getProjectLocation(source.id)
    expect(projectRoot).toBe(path.join(root, 'projects', sha(source.id)))
    await expect(kernel.getProjectLocation('../unknown')).rejects.toMatchObject({ code: 'PROJECT_INVALID' })
    const real = projectRoot + '-real'
    await rename(projectRoot, real)
    await symlink(real, projectRoot, process.platform === 'win32' ? 'junction' : 'dir')
    try {
      await expect(kernel.read()).rejects.toMatchObject({ code: 'PROJECT_CORRUPT' })
      await expect(kernel.rebuildIndex(source.id)).rejects.toMatchObject({ code: 'PROJECT_CORRUPT' })
    } finally { await unlink(projectRoot); await rename(real, projectRoot) }
  })

  it('validates forged manifest paths even when their hashes and the marker hash are recomputed', async () => {
    const kernel = await open()
    await kernel.commit({ baseRevision: null, backup: fixture() })
    const { filename, marker } = await latestMarker(), ref = marker.projects[0]
    const previous = path.join(root, 'projects', ref.key, 'snapshots', ref.snapshot)
    const manifest = JSON.parse(await readFile(path.join(previous, 'manifest.json'), 'utf8'))
    manifest.chapters[0].filename = '../../outside.md'
    const data = JSON.stringify(manifest), nextHash = sha(data)
    await writeFile(path.join(previous, 'manifest.json'), data)
    await rename(previous, path.join(path.dirname(previous), nextHash))
    ref.snapshot = nextHash
    await replaceMarker(filename, marker)
    await expect(kernel.read()).rejects.toMatchObject({ code: 'PROJECT_CORRUPT' })
  })

  it('rebuilds a deleted or corrupt SQLite cache from verified project sources', async () => {
    const kernel = await open(), backup = fixture()
    const committed = await kernel.commit({ baseRevision: null, backup })
    const projectRoot = await kernel.getProjectLocation(backup.novels[0].id)
    const indexPath = path.join(projectRoot, 'index.sqlite')
    await unlink(indexPath)
    expect(await kernel.read()).toEqual(committed)
    await kernel.rebuildIndex(backup.novels[0].id)
    const SQL = await require('sql.js')({ wasmBinary: await readFile(require.resolve('sql.js/dist/sql-wasm.wasm')) })
    const db = new SQL.Database(await readFile(indexPath))
    try {
      expect(db.exec('SELECT COUNT(*) FROM chapters')[0].values[0][0]).toBe(backup.novels[0].chapters.length)
      expect(db.exec('SELECT content_hash FROM chapters ORDER BY chapter_index')[0].values[0][0]).toBe(sha(backup.novels[0].chapters[0].content))
      for (const table of ['candidates', 'review_findings', 'chapter_reviews', 'canon_mutations']) expect(db.exec('SELECT COUNT(*) FROM ' + table)[0].values[0][0]).toBe(1)
    } finally { db.close() }
    await writeFile(indexPath, 'broken cache')
    expect(await kernel.read()).toEqual(committed)
    await kernel.rebuildIndex(backup.novels[0].id)
    expect((await readFile(indexPath)).subarray(0, 15).toString()).toBe('SQLite format 3')
    expect(await kernel.history()).toHaveLength(1)
  })

  it('rejects invalid backups and unsafe sync trees before publication, including disk sync with valid hashes', async () => {
    const kernel = await open(), backup = fixture()
    await expect(kernel.commit({ baseRevision: null, backup: { ...backup, version: 1 } as unknown as ProjectBackup })).rejects.toMatchObject({ code: 'PROJECT_INVALID' })
    let deep: Record<string, unknown> = {}
    for (let i = 0; i < 42; i++) deep = { nested: deep }
    for (const sync of [{ state: [], conflicts: [] }, { state: null, conflicts: {} }, { state: null, conflicts: [null] },
      { state: deep, conflicts: [] }, JSON.parse('{"state":{"__proto__":{}},"conflicts":[]}'), { state: { token: undefined }, conflicts: [] }]) {
      await expect(kernel.commit({ baseRevision: null, backup, sync: sync as Sync })).rejects.toMatchObject({ code: 'PROJECT_INVALID' })
    }
    expect(await kernel.history()).toHaveLength(0)
    await kernel.commit({ baseRevision: null, backup })
    const { filename, marker } = await latestMarker()
    marker.sync = { state: [], conflicts: [] }
    await replaceMarker(filename, marker)
    await expect(kernel.read()).rejects.toMatchObject({ code: 'PROJECT_CORRUPT' })
  })

  it('accepts conflict manuscripts larger than 4 MiB and commits them with the backup', async () => {
    const kernel = await open(), backup = createTestProjectBackup([], [])
    const sync = { state: { cursor: 1 }, conflicts: [{ manuscript: '文'.repeat(1_500_000) }] }
    const committed = await kernel.commit({ baseRevision: null, backup, sync })
    expect((await (await open()).read()).sync).toEqual(sync)
    expect(committed.backup).toEqual(backup)
  })

  it('reuses immutable chapter sources across edits, metadata changes and historical restores', async () => {
    const backup = fixture(), kernel = await open()
    const first = await kernel.commit({ baseRevision: null, backup })
    const project = await kernel.getProjectLocation(backup.novels[0].id)
    const bodies = path.join(project, 'chapters')
    const originalBodies = (await readdir(bodies)).sort()
    const originalBytes = await Promise.all(originalBodies.map(name => readFile(path.join(bodies, name))))
    backup.novels[0].title = '只修改标题'
    const second = await kernel.commit({ baseRevision: first.revision, backup })
    expect((await readdir(bodies)).sort()).toEqual(originalBodies)
    backup.novels[0].chapters[0].content += '追加的一句话'
    const third = await kernel.commit({ baseRevision: second.revision, backup })
    expect(await readdir(bodies)).toHaveLength(originalBodies.length + 1)
    expect(await Promise.all(originalBodies.map(name => readFile(path.join(bodies, name))))).toEqual(originalBytes)
    const selected = clone(first.backup!.reconstructionWorkspaces.find(row => row.novelId === backup.novels[0].id)!)
    selected.aiRuns = selected.aiRuns.map(run => ({ ...run, status: 'paused' as const }))
    const target = clone(first.backup!.novels[0])
    target.chapters = target.chapters.map(chapter => ({ ...chapter, status: 'writing', contentReviewSignature: '', contentReviewCoverage: undefined }))
    const restored = await kernel.restoreNovel({ baseRevision: third.revision!, revision: first.revision!, novelId: backup.novels[0].id,
      scope: { novel: target, workspace: selected,
        chapterRevisions: first.backup!.chapterRevisions.filter(row => row.novelId === backup.novels[0].id), inspirationSessions: [], knowledgeBaseIds: [] } })
    expect(restored.backup?.novels.find((row: import('@/types/novel').Novel) => row.id === target.id)).toEqual(target)
    expect(await readdir(bodies)).toHaveLength(originalBodies.length + 1)
    expect(await (await open()).read()).toEqual(restored)
  })
})
