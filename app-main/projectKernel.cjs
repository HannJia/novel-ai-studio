'use strict'

// This module owns only project data. The injected V2 validator is deliberately
// the only connection to the application's domain model. SQLite is disposable.
const fs = require('node:fs')
const fsp = fs.promises
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const { INDEX_SCHEMA_VERSION, INDEX_DATA_VERSION, createIndexProjection, openProjectIndex, updateProjectIndex } = require('./projectIndex.cjs')

const HASH = /^[a-f0-9]{64}$/
const REVISION = /^[0-9]{16}-[a-f0-9]{64}$/
const BACKUP_KEYS = ['format', 'version', 'exportedAt', 'novels', 'knowledgeBases', 'chapterRevisions', 'inspirationSessions', 'reconstructionWorkspaces']
const MAX_JSON_BYTES = 256 * 1024 * 1024
const queues = new Map()
let sqlPromise
const hash = data => createHash('sha256').update(data).digest('hex')
const json = value => Buffer.from(JSON.stringify(value), 'utf8')
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : object(value)
  ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value)
function error(code, message, cause) { return Object.assign(new Error(message, { cause }), { code }) }
function check(ok, message) { if (!ok) throw new Error(message) }
function exact(value, keys) { check(object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), 'Invalid object fields') }
function id(value) { check(typeof value === 'string' && value.length > 0 && value.length <= 200, 'Invalid ID') }
function digest(value) { check(typeof value === 'string' && HASH.test(value), 'Invalid content hash') }
function revision(value, nullable = false) { check((nullable && value === null) || (typeof value === 'string' && REVISION.test(value)), 'Invalid revision') }
function timestamp(value) { check(typeof value === 'string' && Number.isFinite(Date.parse(value)), 'Invalid timestamp') }

// Validate before stringify as well: JSON.stringify otherwise hides undefined,
// functions, non-finite numbers, custom prototypes and prototype pollution keys.
function jsonTree(value, depth = 0, seen = new Set(), optional = true) {
  check(depth <= 40, 'JSON nesting exceeds 40 levels')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') { check(Number.isFinite(value), 'Invalid JSON number'); return }
  check(Array.isArray(value) || object(value), 'Expected plain JSON data')
  check(!seen.has(value), 'Cyclic JSON data')
  seen.add(value)
  for (const [key, child] of Object.entries(value)) {
    check(!['__proto__', 'prototype', 'constructor'].includes(key), 'Unsafe JSON key')
    // Optional application fields may explicitly be undefined; JSON omits them.
    if (optional && child === undefined && !Array.isArray(value)) continue
    jsonTree(child, depth + 1, seen, optional)
  }
  seen.delete(value)
}
function syncData(value) {
  exact(value, ['state', 'conflicts'])
  check(value.state === null || object(value.state), 'Invalid sync state')
  check(Array.isArray(value.conflicts) && value.conflicts.every(object), 'Invalid sync conflicts')
  jsonTree(value, 0, new Set(), false)
  const bytes = json(value)
  check(bytes.length <= MAX_JSON_BYTES, 'Sync JSON exceeds 256 MiB')
  return JSON.parse(bytes.toString('utf8'))
}
async function serialized(key, action) {
  const previous = queues.get(key) || Promise.resolve()
  const next = previous.catch(() => {}).then(action)
  queues.set(key, next)
  try { return await next } finally { if (queues.get(key) === next) queues.delete(key) }
}
async function sql() {
  if (!sqlPromise) sqlPromise = (async () => {
    const wasmBinary = await fsp.readFile(require.resolve('sql.js/dist/sql-wasm.wasm'))
    return require('sql.js')({ wasmBinary })
  })().catch(cause => { sqlPromise = undefined; throw cause })
  return sqlPromise
}

async function createProjectKernel(options) {
  const { root, validateBackup, fault } = options || {}
  if (typeof root !== 'string' || !path.isAbsolute(root) || path.resolve(root) === path.parse(root).root || typeof validateBackup !== 'function' || (fault !== undefined && typeof fault !== 'function')) {
    throw error('PROJECT_INVALID', 'An absolute dedicated root and synchronous validateBackup are required')
  }
  const base = path.resolve(root)
  const queueKey = process.platform === 'win32' ? base.toLowerCase() : base

  // Check ancestors too: junctions are symlinks according to Node's lstat. All
  // paths below are built from fixed names, internal hashes or safe revisions.
  async function directory(absolute, create = false) {
    const parent = path.dirname(absolute)
    if (parent !== absolute) await directory(parent, create)
    let stat
    try { stat = await fsp.lstat(absolute) } catch (cause) {
      if (cause.code !== 'ENOENT' || !create) throw cause
      try { await fsp.mkdir(absolute) } catch (e) { if (e.code !== 'EEXIST') throw e }
      stat = await fsp.lstat(absolute)
    }
    check(!stat.isSymbolicLink() && stat.isDirectory(), 'Unsafe directory: ' + absolute)
  }
  function location(relative) {
    check(typeof relative === 'string' && relative.length && !relative.includes('\\') && !relative.includes(':') && relative.split('/').every(part => part && part !== '.' && part !== '..'), 'Unsafe relative path')
    const result = path.resolve(base, ...relative.split('/'))
    check(result.startsWith(base + path.sep), 'Path escapes project root')
    return result
  }
  async function regular(relative, missing = false) {
    const absolute = location(relative)
    await directory(path.dirname(absolute))
    try {
      const stat = await fsp.lstat(absolute)
      check(!stat.isSymbolicLink() && stat.isFile() && stat.nlink === 1, 'Unsafe file: ' + relative)
      return absolute
    } catch (cause) { if (missing && cause.code === 'ENOENT') return null; throw cause }
  }
  async function bytes(relative, expected) {
    const absolute = await regular(relative)
    const handle = await fsp.open(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0))
    try {
      const stat = await handle.stat()
      check(stat.isFile() && stat.nlink === 1, 'Unsafe source file')
      const data = await handle.readFile()
      if (expected !== undefined) check(hash(data) === expected, 'Source checksum mismatch: ' + relative)
      return data
    } finally { await handle.close() }
  }
  async function parsed(relative, expected) { return JSON.parse((await bytes(relative, expected)).toString('utf8')) }
  async function syncDir(absolute) {
    // Windows does not expose directory fsync through Node. File flushes and
    // same-volume renames are still used there; POSIX also flushes directories.
    if (process.platform === 'win32') return
    const handle = await fsp.open(absolute, 'r')
    try { await handle.sync() } finally { await handle.close() }
  }
  async function writeNew(relative, data) {
    const absolute = location(relative)
    await directory(path.dirname(absolute), true)
    const handle = await fsp.open(absolute, 'wx', 0o600)
    try { await handle.writeFile(data); await handle.sync() } finally { await handle.close() }
    await syncDir(path.dirname(absolute))
  }
  async function immutableFile(relative, data) {
    if (await regular(relative, true)) { await bytes(relative, hash(data)); return }
    const temp = relative + '.tmp-' + randomUUID()
    await writeNew(temp, data)
    check(!(await regular(relative, true)), 'Immutable target already exists')
    await fsp.rename(location(temp), location(relative))
    await syncDir(path.dirname(location(relative)))
  }
  function validate(value, code) {
    try {
      exact(value, BACKUP_KEYS)
      check(value.format === 'ai-novel-writer-backup' && value.version === 2, 'Expected ProjectBackup V2')
      jsonTree(value)
      check(json(value).length <= MAX_JSON_BYTES, 'Project backup exceeds 256 MiB')
      const result = validateBackup(value)
      check(!result || typeof result.then !== 'function', 'validateBackup must be synchronous')
      return JSON.parse(JSON.stringify(value))
    } catch (cause) { throw error(code, 'Invalid project backup: ' + cause.message, cause) }
  }
  async function disk(action) {
    try { return await action() } catch (cause) {
      if (['PROJECT_CORRUPT', 'PROJECT_INVALID', 'PROJECT_CONFLICT', 'PROJECT_BUSY'].includes(cause.code)) throw cause
      throw error('PROJECT_CORRUPT', 'Project storage is invalid: ' + cause.message, cause)
    }
  }

  // Preparing the nonempty owner directory before renaming avoids an observable
  // half-written lock. Reaping unlinks only the *observed* dead owner's name; a
  // competing reaper cannot accidentally unlink a subsequent live owner's file.
  async function acquire() {
    await directory(base)
    const owner = process.pid + '-' + randomUUID()
    const pending = '.lock-' + owner
    await writeNew(pending + '/' + owner, json({ pid: process.pid }))
    const lock = location('.writer-lock')
    try {
      for (let attempt = 0; attempt < 200; attempt++) {
        try {
          await fsp.rename(location(pending), lock)
          await syncDir(base)
          return async () => {
            await regular('.writer-lock/' + owner)
            // Detach the nonempty lock atomically; never expose an empty live
            // lock directory which another rename could replace.
            await fsp.rename(lock, location(pending))
            await fsp.unlink(location(pending + '/' + owner))
            await fsp.rmdir(location(pending))
            await syncDir(base)
          }
        } catch (cause) {
          if (!['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES'].includes(cause.code)) throw cause
        }
        let owners
        try { await directory(lock); owners = await fsp.readdir(lock) } catch (cause) {
          if (cause.code === 'ENOENT') continue
          throw cause
        }
        if (owners.length === 1 && /^[1-9][0-9]*-[a-f0-9-]{36}$/.test(owners[0])) {
          const observed = owners[0]
          const pid = Number(observed.split('-')[0])
          check(Number.isSafeInteger(pid) && pid > 0, 'Invalid lock PID')
          let dead = false
          try { process.kill(pid, 0) } catch (cause) { if (cause.code === 'ESRCH') dead = true }
          if (dead) {
            // On Windows, an open owner file prevents renaming its parent lock
            // directory. Observing a live owner must not make its successful
            // commit fail during release. The name identifies its PID; inspect
            // the contents only when verifying a dead owner before reaping it.
            let info
            try { info = await parsed('.writer-lock/' + observed) } catch (cause) {
              if (cause.code === 'ENOENT') continue
              throw cause
            }
            check(info.pid === pid, 'Invalid lock owner')
            try {
              await fsp.unlink(location('.writer-lock/' + observed))
              await fsp.rmdir(lock)
            } catch (cause) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(cause.code)) throw cause }
            continue
          }
        }
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      throw error('PROJECT_BUSY', 'Project library is locked by another writer; owner death could not be confirmed')
    } finally {
      // Observation/validation errors must clean up our unpublished claim too.
      // A successful acquisition moved it away; never remove .writer-lock here.
      try {
        await regular(pending + '/' + owner)
        await fsp.unlink(location(pending + '/' + owner))
        await fsp.rmdir(location(pending))
      } catch (cause) { if (cause.code !== 'ENOENT') throw cause }
    }
  }
  async function writer(action) {
    return serialized(queueKey, () => disk(async () => {
      const release = await acquire()
      try { return await action() } finally { await release() }
    }))
  }

  function markerShape(marker, name) {
    exact(marker, ['format', 'version', 'seq', 'parentRevision', 'createdAt', 'projects', 'library', 'sync', ...(marker.historyAction ? ['historyAction'] : []), ...(marker.retention ? ['retention'] : [])])
    if (marker.retention) { exact(marker.retention, ['decision', 'baseRevision']); digest(marker.retention.decision); revision(marker.retention.baseRevision, true) }
    if (marker.historyAction) {
      exact(marker.historyAction, ['kind', 'novelId', 'sourceRevision', 'label'])
      check(['checkpoint', 'restore-novel'].includes(marker.historyAction.kind), 'Invalid history action')
      id(marker.historyAction.novelId); revision(marker.historyAction.sourceRevision, true)
      check(typeof marker.historyAction.label === 'string' && marker.historyAction.label.length <= 200, 'Invalid history label')
    }
    check(marker.format === 'mojian-library-commit' && marker.version === 1, 'Invalid commit format')
    check(Number.isSafeInteger(marker.seq) && marker.seq > 0 && marker.seq < 1e16, 'Invalid commit sequence')
    check(name.startsWith(String(marker.seq).padStart(16, '0') + '-'), 'Commit sequence mismatch')
    revision(marker.parentRevision, true); timestamp(marker.createdAt)
    check(Array.isArray(marker.projects), 'Invalid project references')
    const ids = new Set()
    for (const ref of marker.projects) {
      exact(ref, ['id', 'key', 'snapshot'])
      id(ref.id); digest(ref.key); digest(ref.snapshot)
      check(ref.key === hash(ref.id) && !ids.has(ref.id), 'Invalid project reference')
      ids.add(ref.id)
    }
    exact(marker.library, ['hash']); digest(marker.library.hash)
    syncData(marker.sync)
  }
  async function markers() {
    await directory(location('commits'))
    const names = await fsp.readdir(location('commits'))
    const published = []
    for (const name of names) {
      if (name.startsWith('.tmp-')) continue
      check(name.endsWith('.json') && REVISION.test(name.slice(0, -5)), 'Invalid published commit name')
      published.push(name.slice(0, -5))
    }
    published.sort()
    const result = []
    for (const name of published) {
      const marker = await parsed('commits/' + name + '.json', name.slice(17))
      markerShape(marker, name)
      check(marker.seq === result.length + 1 && marker.parentRevision === (result.at(-1)?.revision || null), 'Broken commit chain')
      result.push({ revision: name, marker })
    }
    return result
  }
  const chapterFilename = (chapterId, index) => 'chapters/' + String(index).padStart(6, '0') + '-' + hash(chapterId) + '.md'
  const chapterSource = (projectKey, contentHash) => 'projects/' + projectKey + '/chapters/' + contentHash + '.md'
  async function projectManifest(ref) {
    const prefix = 'projects/' + ref.key + '/snapshots/' + ref.snapshot + '/'
    const manifest = await parsed(prefix + 'manifest.json', ref.snapshot)
    exact(manifest, ['format', 'version', 'id', 'files', 'chapters'])
    check(manifest.format === 'mojian-project-snapshot' && manifest.version === 2 && manifest.id === ref.id, 'Invalid project manifest')
    check(object(manifest.files) && Array.isArray(manifest.chapters), 'Invalid snapshot references')
    const expected = ['project.json', 'workspace.json', 'revisions.json']
    manifest.chapters.forEach((entry, index) => {
      exact(entry, ['id', 'filename']); id(entry.id)
      check(entry.filename === chapterFilename(entry.id, index), 'Unsafe chapter reference')
      expected.push(entry.filename)
    })
    check(Object.keys(manifest.files).length === expected.length && expected.every(file => Object.hasOwn(manifest.files, file)), 'Invalid snapshot files')
    for (const file of expected) digest(manifest.files[file])
    return manifest
  }
  async function projectWorkspaces(ref, manifest) {
    const prefix = 'projects/' + ref.key + '/snapshots/' + ref.snapshot + '/'
    const workspaces = await parsed(prefix + 'workspace.json', manifest.files['workspace.json'])
    check(Array.isArray(workspaces) && workspaces.length === 1 && workspaces.every(row => object(row) && row.novelId === ref.id && Array.isArray(row.aiRuns)), 'Invalid workspace ownership')
    return workspaces
  }
  // Metadata only: keep the last occurrence of a snapshot, so an explicit
  // return to an older snapshot is ordered after intervening ledger updates.
  function historyRunSources(entries, projectId) {
    const unique = new Map()
    for (const entry of entries) {
      const ref = entry.marker.projects.find(row => row.id === projectId)
      if (ref) { unique.delete(ref.snapshot); unique.set(ref.snapshot, { revision: entry.revision, ref }) }
    }
    return [...unique.values()]
  }
  async function readWorkspaceRunSource(source) {
    const marker = await parsed('commits/' + source.revision + '.json', source.revision.slice(17))
    markerShape(marker, source.revision)
    check(marker.projects.some(row => row.id === source.ref.id && row.key === source.ref.key && row.snapshot === source.ref.snapshot), 'Ledger source marker changed')
    const manifest = await projectManifest(source.ref)
    const workspace = (await projectWorkspaces(source.ref, manifest))[0]
    const runs = workspace?.aiRuns || []
    const { validateReconstructionAiRun } = require('./kernel-validation/reconstructionBackupValidation.js')
    check(new Set(runs.map(run => run.id)).size === runs.length, 'Duplicate historical run ID')
    for (const run of runs) validateReconstructionAiRun(run)
    // Chapter candidate prose is not needed for accounting. Request/node source
    // evidence remains intact, including failed/unknown reservations.
    return { revision: source.revision, snapshot: source.ref.snapshot, workspaceHash: manifest.files['workspace.json'],
      runs: runs.map(({ chapterDrafts, ...run }) => run) }
  }
  const sourceKey = ref => ref.key + ':' + ref.snapshot
  const defaultPolicy = () => ({ keepLatest: null, keepSince: null })
  function retentionPolicy(value) {
    exact(value, ['keepLatest', 'keepSince'])
    check(value.keepLatest === null || Number.isSafeInteger(value.keepLatest) && value.keepLatest >= 1 && value.keepLatest <= 1000000, '保留数量须为 1 至 1000000，留空表示不按数量筛选。')
    if (value.keepSince !== null) timestamp(value.keepSince)
    return { keepLatest: value.keepLatest, keepSince: value.keepSince }
  }
  function retentionPins(value, entries, pruned) {
    check(Array.isArray(value) && new Set(value).size === value.length, '固定版本重复或无效。')
    for (const name of value) { revision(name); check(entries.some(row => row.revision === name) && !pruned.has(name), '无法固定不存在或已裁剪的版本。') }
    return [...value].sort()
  }
  function historyPrefix(entries, revision) {
    if (revision === null) return []
    let low = 0, high = entries.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (entries[middle].revision <= revision) low = middle + 1
      else high = middle
    }
    return entries.slice(0, low)
  }
  // Decisions are anchored in the immutable commit chain. A missing decision
  // cannot silently reset policy/pruned state, even after all its prose is gone.
  async function retentionState(entries) {
    const state = { head: null, policy: defaultPolicy(), pinnedRevisions: [], pruned: new Map(), archives: new Map() }
    const byRevision = new Map(entries.map(row => [row.revision, row]))
    for (const entry of entries) {
      if (!entry.marker.retention) continue
      const pointer = entry.marker.retention.decision
      const decision = await parsed('maintenance/history-retention/' + pointer + '.json', pointer)
      exact(decision, ['format', 'version', 'parent', 'baseRevision', 'createdAt', 'policy', 'pinnedRevisions', 'prunedRevisions', 'archives'])
      check(decision.format === 'mojian-history-retention' && decision.version === 1 && decision.parent === state.head && decision.baseRevision === entry.marker.retention.baseRevision && decision.baseRevision === entry.marker.parentRevision, '历史保留决定链损坏，已停止读取。')
      const decisionEntries = historyPrefix(entries, decision.baseRevision)
      check(decision.baseRevision === null || byRevision.has(decision.baseRevision), '历史保留基线不在提交链中。')
      timestamp(decision.createdAt); retentionPolicy(decision.policy)
      check(Array.isArray(decision.archives) && Array.isArray(decision.prunedRevisions), 'Invalid retention sources')
      for (const item of decision.archives) {
        exact(item, ['projectId', 'key', 'snapshot', 'workspaceHash', 'sourceRevision', 'archiveHash'])
        id(item.projectId); digest(item.key); digest(item.snapshot); digest(item.workspaceHash); digest(item.archiveHash); revision(item.sourceRevision)
        check(hash(item.projectId) === item.key && byRevision.get(item.sourceRevision)?.marker.projects.some(ref => ref.id === item.projectId && ref.key === item.key && ref.snapshot === item.snapshot)
          && item.sourceRevision <= decision.baseRevision, '付费记录归档来源身份无效。')
        const key = sourceKey(item), old = state.archives.get(key)
        check(!old || canonical(old) === canonical(item), 'Conflicting authoritative archive')
        state.archives.set(key, item)
      }
      const pins = retentionPins(decision.pinnedRevisions, decisionEntries, state.pruned)
      const expectedPlan = retentionPlan(decisionEntries, state, decision.policy, pins, byRevision)
      check(canonical(decision.prunedRevisions) === canonical(expectedPlan.prunedRevisions), '历史裁剪范围不符合已确认的保留策略。')
      for (const name of decision.prunedRevisions) {
        const old = byRevision.get(name)
        check(old && name < decision.baseRevision && !state.pruned.has(name) && !pins.includes(name) && !old.marker.historyAction?.label && old.marker.historyAction?.kind !== 'checkpoint', 'Invalid pruned revision')
        for (const ref of old.marker.projects) check(state.archives.has(sourceKey(ref)), '裁剪版本缺少付费记录来源，已停止读取。')
        state.pruned.set(name, decision.createdAt)
      }
      check(!pins.some(name => state.pruned.has(name)), 'Pruned pin')
      state.head = pointer; state.policy = decision.policy; state.pinnedRevisions = pins
    }
    state.fingerprint = hash(json({ head: state.head, policy: state.policy, pinnedRevisions: state.pinnedRevisions }))
    return state
  }
  function restorable(entry, state) {
    check(!state.pruned.has(entry.revision), '该历史版本已由作者确认裁剪，无法预览或恢复；请求事实仍受保护。')
  }
  async function readHistoryRunSource(source, state) {
    const descriptor = state.archives.get(sourceKey(source.ref))
    if (!descriptor) return readWorkspaceRunSource(source)
    const relative = 'maintenance/history-ledger/' + descriptor.archiveHash + '.json'
    let data
    try { data = await bytes(relative, descriptor.archiveHash) } catch (cause) {
      // Recovery is allowed only when the original checksummed authority still
      // exists and reproduces the exact archived bytes. Never treat failure as 0.
      try {
        const origin = { revision: descriptor.sourceRevision, ref: { id: descriptor.projectId, key: descriptor.key, snapshot: descriptor.snapshot } }
        const raw = await readWorkspaceRunSource(origin), manifest = await projectManifest(origin.ref)
        data = json(ledgerArchive(origin, manifest, raw))
        check(hash(data) === descriptor.archiveHash, 'Archive cannot be reproduced')
        const temp = relative + '.tmp-' + randomUUID()
        await writeNew(temp, data); await regular(relative, true)
        await fsp.rename(location(temp), location(relative)); await syncDir(path.dirname(location(relative)))
      } catch (recovery) { throw error('PROJECT_CORRUPT', '历史付费记录缺失或损坏，且原始来源无法重建；已停止裁剪与恢复。', recovery) }
    }
    const archive = JSON.parse(data.toString('utf8'))
    exact(archive, ['format', 'version', 'projectId', 'key', 'snapshot', 'workspaceHash', 'sourceRevision', 'manifest', 'runs'])
    check(archive.format === 'mojian-history-ledger' && archive.version === 1 && archive.projectId === source.ref.id
      && archive.key === source.ref.key && archive.snapshot === source.ref.snapshot && archive.sourceRevision === descriptor.sourceRevision
      && archive.workspaceHash === descriptor.workspaceHash && hash(json(archive.manifest)) === descriptor.snapshot
      && archive.manifest.id === source.ref.id && archive.manifest.files['workspace.json'] === descriptor.workspaceHash, '付费记录归档身份或来源校验失败。')
    const marker = await parsed('commits/' + source.revision + '.json', source.revision.slice(17))
    markerShape(marker, source.revision)
    check(marker.projects.some(ref => ref.id === archive.projectId && ref.key === archive.key && ref.snapshot === archive.snapshot), 'Archive marker mismatch')
    const { validateReconstructionAiRun } = require('./kernel-validation/reconstructionBackupValidation.js')
    check(Array.isArray(archive.runs) && new Set(archive.runs.map(run => run.id)).size === archive.runs.length, 'Invalid archived runs')
    for (const run of archive.runs) validateReconstructionAiRun(run)
    return { revision: source.revision, snapshot: archive.snapshot, workspaceHash: archive.workspaceHash, runs: archive.runs }
  }
  function ledgerArchive(source, manifest, raw) {
    return { format: 'mojian-history-ledger', version: 1, projectId: source.ref.id, key: source.ref.key, snapshot: source.ref.snapshot,
      workspaceHash: raw.workspaceHash, sourceRevision: source.revision, manifest, runs: raw.runs }
  }
  async function historyRetention() {
    return writer(async () => {
      const state = await retentionState(await markers())
      return { supported: true, policy: state.policy, pinnedRevisions: state.pinnedRevisions, fingerprint: state.fingerprint, limitations: [] }
    })
  }
  const RETENTION_PREVIEW_TTL = 15 * 60 * 1000
  const RETENTION_PREVIEW_LIMIT = 32
  const LEDGER_SESSION_TTL = 5 * 60 * 1000
  const LEDGER_SESSION_LIMIT = 16
  function pruneSessions(sessions, ttl, limit, now) {
    for (const [key, value] of sessions) if (now - value.createdAt > ttl) sessions.delete(key)
    while (sessions.size >= limit) sessions.delete(sessions.keys().next().value)
  }
  function retentionPlan(entries, state, policy, pinnedRevisions, byRevision) {
    const latest = entries.at(-1)?.revision || null
    const pinned = new Set(pinnedRevisions)
    const retained = new Set()
    if (latest) retained.add(latest)
    for (const entry of entries) {
      if (state.pruned.has(entry.revision)) continue
      if (entry.marker.historyAction?.kind === 'checkpoint' || entry.marker.historyAction?.label) retained.add(entry.revision)
      if (pinned.has(entry.revision)) retained.add(entry.revision)
    }
    if (policy.keepLatest === null && policy.keepSince === null) for (const entry of entries) retained.add(entry.revision)
    if (policy.keepSince) for (const entry of entries) if (Date.parse(entry.marker.createdAt) >= Date.parse(policy.keepSince)) retained.add(entry.revision)
    if (policy.keepLatest !== null) {
      const eligible = entries.filter(entry => !state.pruned.has(entry.revision))
      for (const entry of eligible.slice(-policy.keepLatest)) retained.add(entry.revision)
    }
    const prunedRevisions = entries.filter(entry => !state.pruned.has(entry.revision) && !retained.has(entry.revision))
      .map(entry => entry.revision)
    const archiveSources = new Map()
    for (const revisionId of prunedRevisions) {
      const entry = byRevision.get(revisionId)
      check(entry, 'Retention plan revision missing')
      for (const ref of entry.marker.projects) {
        const source = { revision: revisionId, ref }
        const key = sourceKey(ref)
        const previous = archiveSources.get(key)
        if (!previous || previous.revision < revisionId) archiveSources.set(key, source)
      }
    }
    return { prunedRevisions, archiveSources: [...archiveSources.values()] }
  }

  const retentionPreviews = new Map()
  async function previewHistoryRetention(input) {
    let policy, pinnedRevisions
    try { policy = retentionPolicy(input.policy); pinnedRevisions = input.pinnedRevisions }
    catch (cause) { throw error('PROJECT_INVALID', cause.message, cause) }
    return writer(async () => {
      const entries = await markers(), state = await retentionState(entries)
      const pins = retentionPins(pinnedRevisions, entries, state.pruned)
      const byRevision = new Map(entries.map(entry => [entry.revision, entry]))
      const plan = retentionPlan(entries, state, policy, pins, byRevision)
      const token = randomUUID()
      const latest = entries.at(-1)?.revision || null
      const now = Date.now()
      pruneSessions(retentionPreviews, RETENTION_PREVIEW_TTL, RETENTION_PREVIEW_LIMIT, now)
      const preview = { token, baseRevision: latest, fingerprint: state.fingerprint, policy, pinnedRevisions: pins,
        prunedRevisions: plan.prunedRevisions, archiveSources: plan.archiveSources.map(source => ({ revision: source.revision, projectId: source.ref.id, snapshot: source.ref.snapshot })) }
      retentionPreviews.set(token, { ...preview, createdAt: now })
      return preview
    })
  }
  async function confirmHistoryRetention(input) {
    inputRevision(input.baseRevision)
    check(typeof input.token === 'string' && /^[a-f0-9-]{36}$/.test(input.token), '请重新预览历史保留策略。')
    return writer(async () => {
      const preview = retentionPreviews.get(input.token)
      const now = Date.now()
      pruneSessions(retentionPreviews, RETENTION_PREVIEW_TTL, RETENTION_PREVIEW_LIMIT + 1, now)
      if (!preview || now - preview.createdAt > RETENTION_PREVIEW_TTL) throw error('PROJECT_CONFLICT', '历史保留预览已过期，请重新预览。')
      const entries = await markers(), state = await retentionState(entries), latest = entries.at(-1)?.revision || null
      if (latest !== input.baseRevision || latest !== preview.baseRevision || state.fingerprint !== preview.fingerprint) throw error('PROJECT_CONFLICT', '历史或保留策略已变化，请重新预览。')
      const byRevision = new Map(entries.map(entry => [entry.revision, entry]))
      const plan = retentionPlan(entries, state, preview.policy, preview.pinnedRevisions, byRevision)
      if (JSON.stringify(plan.prunedRevisions) !== JSON.stringify(preview.prunedRevisions)) throw error('PROJECT_CONFLICT', '保留范围已变化，请重新预览。')
      await directory(location('maintenance/history-retention'), true)
      await directory(location('maintenance/history-ledger'), true)
      const archives = []
      for (const source of plan.archiveSources) {
        if (state.archives.has(sourceKey(source.ref))) {
          await readHistoryRunSource(source, state)
          continue
        }
        const raw = await readWorkspaceRunSource(source), manifest = await projectManifest(source.ref)
        const data = json(ledgerArchive(source, manifest, raw)), archiveHash = hash(data)
        await immutableFile('maintenance/history-ledger/' + archiveHash + '.json', data)
        archives.push({ projectId: source.ref.id, key: source.ref.key, snapshot: source.ref.snapshot,
          workspaceHash: raw.workspaceHash, sourceRevision: source.revision, archiveHash })
      }
      const createdAt = new Date().toISOString()
      const decision = { format: 'mojian-history-retention', version: 1, parent: state.head, baseRevision: latest,
        createdAt, policy: preview.policy, pinnedRevisions: preview.pinnedRevisions,
        prunedRevisions: plan.prunedRevisions, archives }
      const decisionBytes = json(decision), pointer = hash(decisionBytes)
      await immutableFile('maintenance/history-retention/' + pointer + '.json', decisionBytes)
      if (fault) await fault('before-history-retention-publish')
      const current = await load(entries.at(-1))
      const result = await publish(latest, current.backup, current.sync, undefined, { decision: pointer, baseRevision: latest })
      retentionPreviews.delete(input.token)
      return { revision: result.revision, policy: preview.policy, pinnedRevisions: preview.pinnedRevisions, prunedRevisions: plan.prunedRevisions }
    })
  }

  // A bounded cache of verified pointers, not receipts. Each page rechecks its
  // own marker, manifest and workspace; commit-chain validation happens once per
  // read sequence and again under restore's write lock, rather than N times.
  const ledgerReadSessions = new Map()
  async function historyRuns(input) {
    try { id(input.projectId); revision(input.baseRevision, true); check(Number.isSafeInteger(input.cursor) && input.cursor >= 0, 'Invalid ledger cursor') }
    catch (cause) { throw error('PROJECT_INVALID', cause.message, cause) }
    return writer(async () => {
      const key = input.projectId + ':' + input.baseRevision
      const now = Date.now()
      pruneSessions(ledgerReadSessions, LEDGER_SESSION_TTL, LEDGER_SESSION_LIMIT, now)
      let session = input.cursor > 0 ? ledgerReadSessions.get(key) : null
      if (input.cursor > 0 && !session) throw error('PROJECT_CONFLICT', '账本分页会话已过期，请从第一页重新读取。')
      let baseRevision
      if (!session) {
        const entries = await markers()
        baseRevision = entries.at(-1)?.revision || null
        session = { sources: historyRunSources(entries, input.projectId), count: entries.length, retention: await retentionState(entries), createdAt: now }
        ledgerReadSessions.set(key, session)
      } else {
        const names = (await fsp.readdir(location('commits'))).filter(name => !name.startsWith('.tmp-')).sort()
        check(names.every(name => name.endsWith('.json') && REVISION.test(name.slice(0, -5))), 'Invalid commit filenames')
        baseRevision = names.at(-1)?.slice(0, -5) || null
        if (names.length !== session.count) throw error('PROJECT_CONFLICT', '历史版本已变化，请重新预览。')
      }
      if (baseRevision !== input.baseRevision) throw error('PROJECT_CONFLICT', '读取账本期间项目已更新，请重新预览。')
      const sources = session.sources
      check(input.cursor <= sources.length, 'Invalid ledger cursor')
      const source = sources[input.cursor] ? await readHistoryRunSource(sources[input.cursor], session.retention) : null
      const nextCursor = input.cursor + 1 < sources.length ? input.cursor + 1 : null
      if (nextCursor === null) ledgerReadSessions.delete(key)
      return { projectId: input.projectId, baseRevision, source, nextCursor }
    })
  }
  async function loadProject(ref) {
    const prefix = 'projects/' + ref.key + '/snapshots/' + ref.snapshot + '/'
    const manifest = await projectManifest(ref)
    const novel = await parsed(prefix + 'project.json', manifest.files['project.json'])
    check(object(novel) && novel.id === ref.id && Array.isArray(novel.chapters) && novel.chapters.length === manifest.chapters.length, 'Project metadata mismatch')
    for (let i = 0; i < novel.chapters.length; i++) {
      const chapter = novel.chapters[i], entry = manifest.chapters[i]
      check(object(chapter) && chapter.id === entry.id && !Object.hasOwn(chapter, 'content'), 'Invalid chapter metadata')
      const contentHash = manifest.files[entry.filename]
      chapter.content = (await bytes(chapterSource(ref.key, contentHash), contentHash)).toString('utf8')
    }
    const workspaces = await projectWorkspaces(ref, manifest)
    const revisions = await parsed(prefix + 'revisions.json', manifest.files['revisions.json'])
    check(Array.isArray(workspaces) && workspaces.every(row => object(row) && row.novelId === ref.id), 'Invalid workspace ownership')
    check(Array.isArray(revisions) && revisions.every(row => object(row) && row.novelId === ref.id), 'Invalid revision ownership')
    return { novel, workspaces, revisions, manifest }
  }
  async function load(entry) {
    if (!entry) return { revision: null, backup: null, sync: { state: null, conflicts: [] } }
    const { marker } = entry
    const library = await parsed('library/' + marker.library.hash + '.json', marker.library.hash)
    exact(library, ['metadata', 'knowledgeBases', 'inspirationSessions', 'revisionOrder', 'workspaceOrder'])
    exact(library.metadata, ['format', 'version', 'exportedAt'])
    check(Array.isArray(library.knowledgeBases) && Array.isArray(library.inspirationSessions) && Array.isArray(library.revisionOrder) && Array.isArray(library.workspaceOrder), 'Invalid library data')
    const projects = []
    for (const ref of marker.projects) projects.push(await loadProject(ref))
    function ordered(rows, order, field) {
      const byId = new Map()
      for (const row of rows) { id(row[field]); check(!byId.has(row[field]), 'Duplicate ordered ID'); byId.set(row[field], row) }
      check(order.length === rows.length && new Set(order).size === rows.length && order.every(key => typeof key === 'string' && byId.has(key)), 'Invalid collection ordering')
      return order.map(key => byId.get(key))
    }
    const backup = { ...library.metadata, novels: projects.map(project => project.novel), knowledgeBases: library.knowledgeBases,
      chapterRevisions: ordered(projects.flatMap(project => project.revisions), library.revisionOrder, 'id'),
      inspirationSessions: library.inspirationSessions,
      reconstructionWorkspaces: ordered(projects.flatMap(project => project.workspaces), library.workspaceOrder, 'novelId') }
    return { revision: entry.revision, backup: validate(backup, 'PROJECT_CORRUPT'), sync: syncData(marker.sync) }
  }

  async function writeProject(novel, backup) {
    const key = hash(novel.id)
    const project = JSON.parse(JSON.stringify(novel))
    const files = new Map()
    const chapters = project.chapters.map((chapter, index) => {
      const filename = chapterFilename(chapter.id, index)
      files.set(filename, Buffer.from(chapter.content, 'utf8'))
      delete chapter.content
      return { id: chapter.id, filename }
    })
    files.set('project.json', json(project))
    files.set('workspace.json', json(backup.reconstructionWorkspaces.filter(row => row.novelId === novel.id)))
    files.set('revisions.json', json(backup.chapterRevisions.filter(row => row.novelId === novel.id)))
    const manifest = { format: 'mojian-project-snapshot', version: 2, id: novel.id,
      files: Object.fromEntries([...files].map(([file, data]) => [file, hash(data)])), chapters }
    const data = json(manifest), snapshot = hash(data)
    const prefix = 'projects/' + key + '/snapshots/'
    await directory(location(prefix + snapshot).replace(/[\\/]$/, ''), false).then(
      () => true, cause => { if (cause.code === 'ENOENT') return false; throw cause },
    ).then(async exists => {
      if (exists) {
        // A hash-identical new commit can reuse a previously pruned directory.
        // Recreate missing immutable objects from this validated new submission;
        // conflicting existing bytes still fail instead of being overwritten.
        for (const [file, contents] of files) await immutableFile(file.startsWith('chapters/') ? chapterSource(key, manifest.files[file]) : prefix + snapshot + '/' + file, contents)
        await immutableFile(prefix + snapshot + '/manifest.json', data)
        await loadProject({ id: novel.id, key, snapshot }); return
      }
      const staging = prefix + '.tmp-' + randomUUID()
      await directory(location('projects/' + key + '/chapters'), true)
      // Snapshot manifests retain the logical chapter names; immutable text is
      // shared by content hash across this book's snapshots. Editing metadata
      // or a single chapter must not copy a million-character manuscript.
      for (const [file, contents] of files) {
        if (file.startsWith('chapters/')) await immutableFile(chapterSource(key, manifest.files[file]), contents)
        else await writeNew(staging + '/' + file, contents)
      }
      await writeNew(staging + '/manifest.json', data)
      await syncDir(location(staging))
      await fsp.rename(location(staging), location(prefix + snapshot))
      await syncDir(location(prefix.slice(0, -1)))
    })
    return { id: novel.id, key, snapshot }
  }
  function indexProjection(ref, backup) {
    const novel = backup.novels.find(row => row.id === ref.id)
    return createIndexProjection(ref, novel, backup.reconstructionWorkspaces.find(row => row.novelId === ref.id),
      backup.chapterRevisions.filter(row => row.novelId === ref.id))
  }
  async function indexBytes(ref) {
    const target = 'projects/' + ref.key + '/index.sqlite'
    return await regular(target, true) ? bytes(target) : null
  }
  // All callers hold writer(). Only a published marker may authorize replacement.
  async function buildIndex(ref, backup, previousRef, previousBackup, force = false) {
    const projection = indexProjection(ref, backup)
    const previous = previousRef && previousBackup ? indexProjection(previousRef, previousBackup) : null
    const built = updateProjectIndex(await sql(), force ? null : await indexBytes(ref), projection, previous, force)
    const target = 'projects/' + ref.key + '/index.sqlite'
    const temp = target + '.tmp-' + randomUUID()
    try {
      if (fault) await fault('before-index-write')
      await writeNew(temp, built.data)
      // Verify the exported file, including its content, before making it visible.
      const verified = openProjectIndex(await sql(), await bytes(temp), projection)
      check(verified.db, 'Exported index verification failed')
      verified.db.close()
      if (fault) await fault('before-index-replace')
      const latest = (await markers()).at(-1)
      check(latest?.marker.projects.some(row => row.id === ref.id && row.snapshot === ref.snapshot), 'Index target is not the current published snapshot')
      await regular(target, true)
      // Do not unlink the previous index on Windows rename failure. Leave it
      // intact (and visibly stale) so an explicit repair can retry atomically.
      await fsp.rename(location(temp), location(target))
      await syncDir(location('projects/' + ref.key))
      return built.stats
    } finally {
      try { if (await regular(temp, true)) await fsp.unlink(location(temp)) } catch { /* Only our unique staging file; retry does not depend on cleanup. */ }
    }
  }
  async function publish(baseRevision, backup, suppliedSync, historyAction, retention) {
    const entries = await markers(), latest = entries.at(-1)
    await retentionState(entries)
    const current = await load(latest)
    if (baseRevision !== current.revision) throw error('PROJECT_CONFLICT', 'The library has changed since baseRevision')
    const sync = suppliedSync === undefined ? current.sync : suppliedSync
    const refs = []
    for (const novel of backup.novels) {
      const ref = await writeProject(novel, backup)
      refs.push(ref)
      if (fault) await fault('after-project-write')
    }
    const library = { metadata: { format: backup.format, version: backup.version, exportedAt: backup.exportedAt },
      knowledgeBases: backup.knowledgeBases, inspirationSessions: backup.inspirationSessions,
      revisionOrder: backup.chapterRevisions.map(row => row.id), workspaceOrder: backup.reconstructionWorkspaces.map(row => row.novelId) }
    const data = json(library), libraryHash = hash(data)
    await immutableFile('library/' + libraryHash + '.json', data)
    const marker = { format: 'mojian-library-commit', version: 1, seq: entries.length + 1, parentRevision: current.revision,
      createdAt: new Date().toISOString(), projects: refs, library: { hash: libraryHash }, sync,
      ...(historyAction ? { historyAction } : {}), ...(retention ? { retention } : {}) }
    const markerBytes = json(marker)
    const name = String(marker.seq).padStart(16, '0') + '-' + hash(markerBytes)
    markerShape(marker, name)
    if (retention) await retentionState([...entries, { revision: name, marker }])
    const temp = 'commits/.tmp-' + randomUUID()
    await writeNew(temp, markerBytes)
    // Verify the complete candidate through the disk reader before publication.
    const result = await load({ revision: name, marker })
    if (fault) await fault('before-publish')
    check(!(await regular('commits/' + name + '.json', true)), 'Commit already exists')
    await fsp.rename(location(temp), location('commits/' + name + '.json'))
    await syncDir(location('commits'))
    // Authority is durable first. A crash or failed cache write leaves a
    // detectable missing/stale index, never an index advertising unpublished prose.
    const indexWarnings = []
    for (const ref of refs) {
      const previousRef = latest?.marker.projects.find(row => row.id === ref.id)
      if (previousRef?.snapshot === ref.snapshot) continue
      try { await buildIndex(ref, result.backup, previousRef, current.backup) }
      catch (cause) { indexWarnings.push({ projectId: ref.id, message: cause instanceof Error ? cause.message : '索引更新失败，请从正式版本重建。' }) }
    }
    if (indexWarnings.length) result.indexWarnings = indexWarnings
    return result
  }
  function inputRevision(value) { try { revision(value, true) } catch (cause) { throw error('PROJECT_INVALID', cause.message, cause) } }
  async function read() { return disk(async () => { const entries = await markers(); await retentionState(entries); return load(entries.at(-1)) }) }
  async function commit(input) {
    if (!object(input)) throw error('PROJECT_INVALID', 'Expected a commit request')
    inputRevision(input.baseRevision)
    const backup = validate(input.backup, 'PROJECT_INVALID')
    let sync
    try { if (input.sync !== undefined) sync = syncData(input.sync) } catch (cause) { throw error('PROJECT_INVALID', cause.message, cause) }
    return writer(() => publish(input.baseRevision, backup, sync))
  }
  async function history() {
    return writer(async () => {
      const entries = await markers()
      const state = await retentionState(entries)
      await load(entries.at(-1))
      return entries.reverse().map(({ revision, marker }) => ({ revision, parentRevision: marker.parentRevision, createdAt: marker.createdAt, projectCount: marker.projects.length, projectIds: marker.projects.map(row => row.id), prunedAt: state.pruned.get(revision) || null, pinned: state.pinnedRevisions.includes(revision), ...(marker.historyAction ? { label: marker.historyAction.label, action: marker.historyAction } : marker.retention ? { label: '历史保留设置确认' } : {}) }))
    })
  }
  async function restore(input) {
    if (!object(input)) throw error('PROJECT_INVALID', 'Expected a restore request')
    inputRevision(input.baseRevision)
    try { revision(input.revision) } catch (cause) { throw error('PROJECT_INVALID', cause.message, cause) }
    return writer(async () => {
      const entries = await markers()
      const current = await load(entries.at(-1))
      if (input.baseRevision !== current.revision) throw error('PROJECT_CONFLICT', 'The library has changed since baseRevision')
      const target = entries.find(entry => entry.revision === input.revision)
      if (!target) throw error('PROJECT_INVALID', 'Unknown history revision')
      restorable(target, await retentionState(entries))
      // Whole-library rollback cannot erase paid facts or author authorization.
      // The scoped path has the complete cumulative proof and author preview.
      throw error('PROJECT_INVALID', '请在项目历史中逐作品预览并确认恢复，以保留累计付费记录和当前授权。')
    })
  }
  async function readSnapshot(input) {
    inputRevision(input.revision)
    return writer(async () => {
      const entries = await markers(), entry = entries.find(row => row.revision === input.revision)
      if (!entry) throw error('PROJECT_INVALID', 'Unknown history revision')
      restorable(entry, await retentionState(entries))
      return (await load(entry)).backup
    })
  }
  async function checkpoint(input) {
    inputRevision(input.baseRevision); id(input.novelId)
    return writer(async () => {
      const current = await load((await markers()).at(-1))
      if (!current.backup?.novels.some(row => row.id === input.novelId)) throw error('PROJECT_INVALID', 'Unknown project')
      return publish(input.baseRevision, current.backup, current.sync, { kind: 'checkpoint', novelId: input.novelId, sourceRevision: current.revision, label: '作者手动恢复点' })
    })
  }
  async function restoreNovel(input) {
    inputRevision(input.baseRevision); inputRevision(input.revision); id(input.novelId)
    return writer(async () => {
      const entries = await markers(), current = await load(entries.at(-1))
      if (current.revision !== input.baseRevision) throw error('PROJECT_CONFLICT', '预览后项目已变化，请重新预览。')
      const target = entries.find(row => row.revision === input.revision)
      if (!target) throw error('PROJECT_INVALID', 'Unknown history revision')
      const retention = await retentionState(entries)
      restorable(target, retention)
      const scope = input.scope, projectId = input.novelId
      const targetRef = target.marker.projects.find(row => row.id === projectId)
      check(targetRef, 'Snapshot does not contain project')
      // Keep source verification for the one version actually being restored.
      // Billing traversal below reads only workspaces, never other historical books.
      await loadProject(targetRef)
      check(scope?.novel?.id === projectId && scope?.workspace?.novelId === projectId, 'Invalid scope')
      check(Array.isArray(scope.chapterRevisions) && scope.chapterRevisions.every(row => row.novelId === projectId), 'Invalid revisions')
      const liveNovel = current.backup.novels.find(row => row.id === projectId)
      check(![...(liveNovel?.chapters || []), ...(liveNovel?.archivedChapters || [])].some(row => row.status === 'locked'), '请先解锁章节。')
      check([...(scope.novel.chapters || []), ...(scope.novel.archivedChapters || [])].every(row => !row.contentReviewSignature && !row.contentReviewCoverage && ['draft', 'writing'].includes(row.status)), 'Restored reviews must be invalidated')
      check(scope.workspace.aiRuns.every(row => row.status === 'paused'), 'Restored tasks must be paused')
      // Same verified workspace reader as historyRuns: never load historical
      // libraries or manuscript bodies to verify cumulative billing facts.
      const { preserveAiRunRequestHistory } = require('./kernel-validation/aiRunRequestValidation.js')
      check(typeof preserveAiRunRequestHistory === 'function', '主进程账本模块尚未更新，请完成项目模块生成并重启后再恢复。')
      const expected = new Map(), now = new Date().toISOString()
      for (const source of historyRunSources(entries, projectId)) for (const run of (await readHistoryRunSource(source, retention)).runs) {
        const restored = scope.workspace.aiRuns.find(row => row.id === run.id)
        check(restored, 'Missing historical run ledger')
        check(restored.taskType === run.taskType && restored.mode === run.mode && restored.targetId === run.targetId, 'Historical run identity changed')
        // Shared request proof checks identity and node evidence, independent of
        // the renderer. Its result must not add a receipt missing from the scope.
        if (run.requests || restored.requests) {
          const preserved = preserveAiRunRequestHistory([run], [restored], now)[0]
          check((preserved.requests?.length || 0) === (restored.requests?.length || 0), 'Lost historical requests')
          check(preserved.memoryTask?.requests.length === restored.memoryTask?.requests.length, 'Lost historical node evidence')
        }
        if (!run.requests?.length) check((restored.usedTokens || 0) >= (run.usedTokens || 0), 'Lost historical usage')
        const receipts = expected.get(run.id) || new Map()
        for (const request of run.requests || []) {
          const receipt = restored.requests?.find(row => row.id === request.id)
          check(receipt && receipt.startedAt === request.startedAt && receipt.modelId === request.modelId, 'Lost or conflicting request')
          const old = receipts.get(request.id)
          check(!(old && !['pending', 'not_sent'].includes(old.status) && request.status === 'not_sent'), 'Occurred request cannot become not_sent')
          receipts.set(request.id, request.status === 'pending' && old && old.status !== 'pending' ? old : request)
        }
        expected.set(run.id, receipts)
      }
      for (const [runId, receipts] of expected) {
        const restored = scope.workspace.aiRuns.find(row => row.id === runId)
        for (const request of receipts.values()) {
          const receipt = restored.requests?.find(row => row.id === request.id)
          if (request.status === 'pending') {
            check(receipt.status === 'interrupted' && receipt.usageSource === 'estimated'
              && receipt.inputTokens === request.inputTokens && receipt.outputTokens === request.outputTokens, 'Lost pending reservation')
          } else check(canonical(receipt) === canonical(request), 'Settled historical receipt changed')
        }
      }
      for (const live of current.backup.reconstructionWorkspaces.find(row => row.novelId === projectId)?.aiRuns || []) {
        const restored = scope.workspace.aiRuns.find(row => row.id === live.id)
        check(restored && (live.tokenBudget === undefined || restored.tokenBudget === live.tokenBudget)
          && (live.requestLimit === undefined || restored.requestLimit === live.requestLimit), 'Current author limits changed')
      }
      const backup = JSON.parse(JSON.stringify(current.backup))
      const ni = backup.novels.findIndex(row => row.id === projectId)
      if (ni < 0) backup.novels.push(scope.novel); else backup.novels[ni] = scope.novel
      const wi = backup.reconstructionWorkspaces.findIndex(row => row.novelId === projectId)
      if (wi < 0) backup.reconstructionWorkspaces.push(scope.workspace); else backup.reconstructionWorkspaces[wi] = scope.workspace
      backup.chapterRevisions = [...backup.chapterRevisions.filter(row => row.novelId !== projectId), ...scope.chapterRevisions]
      backup.exportedAt = new Date().toISOString()
      const checked = validate(backup, 'PROJECT_INVALID')
      const beforeRestore = await publish(current.revision, current.backup, current.sync,
        { kind: 'checkpoint', novelId: projectId, sourceRevision: input.revision, label: '单作品恢复前保护点' })
      const restored = await publish(beforeRestore.revision, checked, current.sync,
        { kind: 'restore-novel', novelId: projectId, sourceRevision: input.revision, label: '作者确认单作品恢复' })
      return restored
    })
  }
  async function getProjectLocation(projectId) {
    try { id(projectId) } catch (cause) { throw error('PROJECT_INVALID', cause.message, cause) }
    return disk(async () => {
      const current = await read()
      if (!current.backup?.novels.some(novel => novel.id === projectId)) throw error('PROJECT_INVALID', 'Unknown project ID')
      const absolute = location('projects/' + hash(projectId))
      await directory(absolute)
      return absolute
    })
  }
  async function rebuildIndex(projectId) {
    try { id(projectId) } catch (cause) { throw error('PROJECT_INVALID', cause.message, cause) }
    return writer(async () => {
      const latest = (await markers()).at(-1), current = await load(latest)
      const novel = current.backup?.novels.find(row => row.id === projectId)
      if (!novel) throw error('PROJECT_INVALID', 'Unknown project ID')
      const ref = latest.marker.projects.find(row => row.id === projectId)
      const stats = await buildIndex(ref, current.backup, null, null, true)
      return { projectId, snapshot: ref.snapshot, revision: current.revision, schemaVersion: INDEX_SCHEMA_VERSION,
        dataVersion: INDEX_DATA_VERSION, state: 'ready', reason: '已从当前正式版本重建索引', stats }
    })
  }
  async function indexStatus(projectId) {
    try { id(projectId) } catch (cause) { throw error('PROJECT_INVALID', cause.message, cause) }
    return writer(async () => {
      // The lock binds the inspected cache to this same authoritative marker.
      const latest = (await markers()).at(-1), current = await load(latest)
      const ref = latest?.marker.projects.find(row => row.id === projectId)
      if (!ref) throw error('PROJECT_INVALID', 'Unknown project ID')
      const inspected = openProjectIndex(await sql(), await indexBytes(ref), indexProjection(ref, current.backup))
      inspected.db?.close()
      return { projectId, snapshot: ref.snapshot, revision: current.revision, schemaVersion: INDEX_SCHEMA_VERSION,
        dataVersion: INDEX_DATA_VERSION, state: inspected.state, reason: inspected.reason }
    })
  }
  // Conservative retention: every published version remains restorable. The
  // commit chain, complete unpublished snapshots, ledger evidence and unknown
  // objects are protected. Only recognized unreferenced files are candidates.
  const capacityPreviews = new Map()
  async function capacityPlan() {
    const entries = await markers(), latest = entries.at(-1)
    const protectedFiles = new Set(), seen = new Set(), uncertainProjects = new Set()
    const protectSnapshot = async ref => {
      const key = ref.key + '/' + ref.snapshot
      if (seen.has(key)) return
      seen.add(key)
      const manifest = await projectManifest(ref), prefix = 'projects/' + key.replace('/', '/snapshots/') + '/'
      protectedFiles.add(prefix + 'manifest.json')
      for (const name of ['project.json', 'workspace.json', 'revisions.json']) protectedFiles.add(prefix + name)
      for (const chapter of manifest.chapters) protectedFiles.add(chapterSource(ref.key, manifest.files[chapter.filename]))
    }
    for (const entry of entries) {
      protectedFiles.add('commits/' + entry.revision + '.json')
      protectedFiles.add('library/' + entry.marker.library.hash + '.json')
      for (const ref of entry.marker.projects) await protectSnapshot(ref)
    }
    const inventory = []
    async function scan(relative) {
      let stat
      try { stat = await fsp.lstat(location(relative)) } catch (cause) { if (cause.code === 'ENOENT') return; throw cause }
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        await directory(location(relative))
        for (const name of (await fsp.readdir(location(relative))).sort()) await scan(relative + '/' + name)
      } else inventory.push({ relative, stat }) // Never traverse links or junctions.
    }
    for (const name of ['commits', 'library', 'projects', 'maintenance']) await scan(name)
    // Complete unpublished snapshots may contain paid/unknown facts. Keep them
    // and all bodies they reference. Unfinished/unknown snapshots conservatively
    // protect that project's chapter objects, rather than guessing provenance.
    for (const item of inventory) {
      const parts = item.relative.split('/')
      if (parts[0] !== 'projects' || !HASH.test(parts[1]) || parts[2] !== 'snapshots') continue
      if (!HASH.test(parts[3])) { uncertainProjects.add(parts[1]); continue }
      if (seen.has(parts[1] + '/' + parts[3])) continue
      try {
        const manifest = await parsed('projects/' + parts[1] + '/snapshots/' + parts[3] + '/manifest.json', parts[3])
        check(hash(manifest.id) === parts[1], 'Unpublished project identity mismatch')
        await protectSnapshot({ id: manifest.id, key: parts[1], snapshot: parts[3] })
      } catch { uncertainProjects.add(parts[1]) }
    }
    const present = new Set(inventory.map(row => row.relative))
    check([...protectedFiles].every(file => present.has(file)), 'Retained history has missing source files; cleanup stopped')
    const uuid = '[a-f0-9-]{36}', candidates = []
    let totalBytes = 0
    for (const { relative, stat } of inventory) {
      totalBytes += stat.size
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || protectedFiles.has(relative)) continue
      const parts = relative.split('/')
      const temporary = parts.length === 2 && (parts[0] === 'commits' && new RegExp('^[.]tmp-' + uuid + '$').test(parts[1])
        || parts[0] === 'library' && new RegExp('^[a-f0-9]{64}[.]json[.]tmp-' + uuid + '$').test(parts[1]))
        || parts[0] === 'projects' && HASH.test(parts[1]) && (parts.length === 3 && new RegExp('^index[.]sqlite[.]tmp-' + uuid + '$').test(parts[2])
          || parts.length === 4 && parts[2] === 'chapters' && new RegExp('^[a-f0-9]{64}[.]md[.]tmp-' + uuid + '$').test(parts[3]))
      const orphanLibrary = parts.length === 2 && parts[0] === 'library' && /^[a-f0-9]{64}[.]json$/.test(parts[1])
      const orphanBody = parts.length === 4 && parts[0] === 'projects' && HASH.test(parts[1]) && parts[2] === 'chapters'
        && /^[a-f0-9]{64}[.]md$/.test(parts[3]) && !uncertainProjects.has(parts[1])
      if (temporary || orphanLibrary || orphanBody) candidates.push({ relative, size: stat.size, mtime: stat.mtimeMs, ino: String(stat.ino), dev: String(stat.dev), hash: hash(await bytes(relative)) })
    }
    const baseRevision = latest?.revision || null
    const inventoryVersion = inventory.map(({ relative, stat }) => [relative, stat.size, stat.mtimeMs, String(stat.ino), String(stat.dev), stat.nlink, stat.isSymbolicLink()])
    return { candidates, fingerprint: hash(json({ baseRevision, inventoryVersion, candidates })), public: { baseRevision, totalFiles: inventory.length, totalBytes,
      reclaimableFiles: candidates.length, reclaimableBytes: candidates.reduce((sum, row) => sum + row.size, 0), protectedVersions: entries.length,
      protectedReasons: ['当前正式版本、全部已发布历史及其正文、Canon、请求账本来源均保留。',
        '手动恢复点、命名版本、恢复前保护点和提交 seq/parent/hash 链均保留。',
        '完整未发布快照、无法确认来源的对象、索引及维护审计保留。',
        ...(uncertainProjects.size ? ['有 ' + uncertainProjects.size + ' 部作品存在未完成或未知快照，其正文对象均审慎保留。'] : [])],
      limitations: ['本批只清理可证明无引用的文件；不会裁剪任何已发布恢复点。', '不自动删除；清理不会返还模型预算。目录本身及外部备份不计入可回收字节。'] } }
  }
  async function historyCapacity() {
    return writer(async () => {
      const plan = await capacityPlan(), token = randomUUID(), now = Date.now()
      pruneSessions(capacityPreviews, RETENTION_PREVIEW_TTL, RETENTION_PREVIEW_LIMIT, now)
      capacityPreviews.set(token, { ...plan, createdAt: now })
      return { token, ...plan.public }
    })
  }
  async function cleanupHistory(input) {
    inputRevision(input.baseRevision)
    return writer(async () => {
      const preview = capacityPreviews.get(input.token)
      const now = Date.now()
      pruneSessions(capacityPreviews, RETENTION_PREVIEW_TTL, RETENTION_PREVIEW_LIMIT + 1, now)
      if (!preview || now - preview.createdAt > RETENTION_PREVIEW_TTL) throw error('PROJECT_CONFLICT', '容量预览已过期，请重新预览。')
      const plan = await capacityPlan()
      if (input.baseRevision !== preview.public.baseRevision || plan.public.baseRevision !== input.baseRevision || plan.fingerprint !== preview.fingerprint) {
        throw error('PROJECT_CONFLICT', '项目或可回收对象已变化，请重新预览后确认。')
      }
      // Durable intent precedes reclamation. No published object is deleted, so
      // interruption can only leave garbage/a partial cleanup, never a lost version.
      const audit = 'maintenance/history-cleanup/' + Date.now() + '-' + input.token + '.json'
      await writeNew(audit, json({ format: 'mojian-history-cleanup', version: 1, baseRevision: input.baseRevision, createdAt: new Date().toISOString(), candidates: plan.candidates }))
      capacityPreviews.delete(input.token)
      if (fault) await fault('before-history-cleanup')
      let removedFiles = 0, removedBytes = 0, skippedFiles = 0
      for (const item of plan.candidates) {
        try {
          const absolute = await regular(item.relative, true)
          if (!absolute || hash(await bytes(item.relative)) !== item.hash) { skippedFiles++; continue }
          const stat = await fsp.lstat(absolute)
          if (stat.size !== item.size || String(stat.ino) !== item.ino || String(stat.dev) !== item.dev || stat.mtimeMs !== item.mtime) { skippedFiles++; continue }
          await fsp.unlink(absolute)
          removedFiles++; removedBytes += item.size
          try { await syncDir(path.dirname(absolute)) } catch { /* A crash can only leave this orphan to be reclaimed again. */ }
        } catch { skippedFiles++ } // A retry needs a new preview; no broad recursive deletion.
      }
      return { removedFiles, removedBytes, skippedFiles }
    })
  }
  await disk(async () => {
    await directory(base, true)
    for (const dir of ['commits', 'projects', 'library']) await directory(location(dir), true)
    // Opening a damaged initialized library fails, just as a subsequent read.
    await load((await markers()).at(-1))
  })
  return { read, commit, history, historyRuns, historyRetention, previewHistoryRetention, confirmHistoryRetention, restore, readSnapshot, checkpoint, restoreNovel, getProjectLocation, rebuildIndex, indexStatus, historyCapacity, cleanupHistory }
}

module.exports = { createProjectKernel }
