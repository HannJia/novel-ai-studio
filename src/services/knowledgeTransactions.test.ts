import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import type { ProjectKernelRequest } from '@/types/projectKernel'
import type { KnowledgeBase } from '@/types/knowledge'
import { testKnowledgeCoverage } from '@/test/knowledgeCoverageFixture'
import { entrySourceVersion, baseSourceVersion, getCurrentEntrySummary, getCurrentBaseSummary } from './knowledgeSources'

const require = createRequire(import.meta.url)
const { createProjectKernel } = require('../../app-main/projectKernel.cjs')
const { validateBackup } = require('../../app-main/projectKernelRpc.cjs')
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const now = '2026-10-28T00:00:00.000Z'

describe.each(['sql', 'kernel'] as const)('knowledge summary transactions (%s)', backend => {
  let pinia: ReturnType<typeof createPinia>
  let root: string | undefined
  let store: ReturnType<(typeof import('@/stores/knowledge'))['useKnowledgeStore']>
  let editVersion: (typeof import('@/stores/knowledge'))['knowledgeSummaryEditVersion']
  let kb: KnowledgeBase
  let kernel: { commit: (request: unknown) => Promise<unknown>; read: () => Promise<any> } | undefined
  let nextWrite: (() => Promise<void>) | undefined
  let releases: Array<() => void>
  let writes: number

  async function diskWrite() { writes++; const hook = nextWrite; nextWrite = undefined; await hook?.() }
  function holdWrite() {
    let start!: () => void, release!: () => void
    const started = new Promise<void>(resolve => { start = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    releases.push(release)
    nextWrite = async () => { start(); await gate }
    return { started, release }
  }
  async function reload() { return (await (await import('./db/knowledge')).loadAllKnowledgeBasesFromDb())[0] }
  function saveEntry(summary: string, origin: 'ai' | 'author' = 'author') {
    const entry = kb.entries[0]
    return store.saveEntrySummary(kb.id, entry.id, entrySourceVersion(kb.id, entry), editVersion(entry), summary, origin, origin === 'ai' ? testKnowledgeCoverage(kb.id, [entry]) : undefined)
  }
  function saveBase(summary: string) {
    return store.saveBaseSummary(kb.id, baseSourceVersion(kb), editVersion(kb), summary, 'detailed')
  }

  beforeEach(async () => {
    vi.resetModules()
    pinia = createPinia(); setActivePinia(pinia)
    root = undefined; kernel = undefined; nextWrite = undefined; releases = []; writes = 0
    vi.stubGlobal('window', { addEventListener: () => {}, electronAPI: { dbRead: async () => null, dbWrite: diskWrite } })
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
    kb = { id: 'kb', name: '白塔资料', description: '测试资料', createdAt: now, entries: [
      { id: 'entry', title: '黑钥匙', content: '黑钥匙留在旅馆。', summary: '', category: '事件', tags: [], createdAt: now, updatedAt: now },
    ] }
    const { createTestProjectBackup } = await import('@/test/projectBackupFixture')
    const backup = createTestProjectBackup([], [kb])
    if (backend === 'kernel') {
      root = await mkdtemp(path.join(os.tmpdir(), 'mojian-knowledge-transaction-'))
      kernel = await createProjectKernel({ root, validateBackup, fault: async (stage: string) => { if (stage === 'before-publish') await diskWrite() } })
      await kernel!.commit({ baseRevision: null, backup })
      window.electronAPI!.projectRequest = async (request: ProjectKernelRequest) => {
        try {
          if (request.method !== 'read' && request.method !== 'commit') throw new Error('Unexpected request')
          return { ok: true, value: copy(await (request.method === 'read' ? kernel!.read() : kernel!.commit(request))) }
        } catch (error) { return { ok: false, error: { code: 'PROJECT_INVALID', message: (error as Error).message } } }
      }
      await (await import('./projectKernelClient')).initializeProjectKernel()
    } else await (await import('./db/project')).replaceProjectInDb(backup)
    const module = await import('@/stores/knowledge')
    editVersion = module.knowledgeSummaryEditVersion
    store = module.useKnowledgeStore(); await store.initStore()
    kb = store.knowledgeBases[0]; writes = 0
  })

  afterEach(async () => {
    for (const release of releases) release()
    disposePinia(pinia); vi.unstubAllGlobals()
    if (root) {
      if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('mojian-knowledge-transaction-')) throw new Error('Unexpected test root')
      await rm(root, { recursive: true, force: true })
    }
  })

  it('commits sources/history, retains stale summaries after editing and reloads confirmations', async () => {
    await saveEntry('钥匙在旅馆。', 'ai')
    await saveBase('旅馆保管钥匙。')
    const before = await reload()
    expect(before.entries[0].summarySource?.coverage).toEqual(testKnowledgeCoverage(kb.id, [kb.entries[0]]))
    expect(getCurrentEntrySummary(kb.id, before.entries[0])).toBe('钥匙在旅馆。')
    expect(getCurrentBaseSummary(before)).toBe('旅馆保管钥匙。')
    store.updateEntry(kb.id, 'entry', { content: '黑钥匙移到城门。' })
    expect(kb.summary).toBe('旅馆保管钥匙。')
    expect(getCurrentBaseSummary(kb)).toBe('')
    expect(getCurrentEntrySummary(kb.id, kb.entries[0])).toBe('')
    await saveEntry('钥匙在城门。')
    await saveBase('城门保管钥匙。')
    const reloaded = await reload()
    expect(reloaded.entries[0].summarySource?.origin).toBe('author')
    expect(getCurrentEntrySummary(kb.id, reloaded.entries[0])).toBe('钥匙在城门。')
    expect(reloaded.entries[0].summaryHistory?.[0]).toMatchObject({ summary: '钥匙在旅馆。', summarySource: { origin: 'ai' } })
    expect(reloaded.entries[0].summaryHistory?.[0].summarySource?.coverage).toEqual(before.entries[0].summarySource?.coverage)
    expect(reloaded.summaryHistory?.[0].summary).toBe('旅馆保管钥匙。')
    expect(getCurrentBaseSummary(reloaded)).toBe('城门保管钥匙。')
  })

  it('keeps a confirmed base summary valid when persistence reorders imported entries', async () => {
    const imported = store.addEntry(kb.id, {
      title: '导入的旧资料', content: '旧资料记录了渡口的位置。', category: '地点', summary: '', tags: [],
    })!
    // SQL reads entries by creation time; imported entries may carry an older date.
    store.updateEntry(kb.id, imported.id, { createdAt: '2026-10-27T00:00:00.000Z' })
    await saveBase('旅馆保管钥匙，旧资料记载渡口。')
    expect(getCurrentBaseSummary(await reload())).toBe('旅馆保管钥匙，旧资料记载渡口。')
  })

  it('rejects AI summaries without current coverage before any database write', async () => {
    const entry = kb.entries[0], coverage = testKnowledgeCoverage(kb.id, [entry])
    await expect(store.saveEntrySummary(kb.id, entry.id, entrySourceVersion(kb.id, entry), editVersion(entry), '无覆盖摘要', 'ai')).rejects.toThrow('完整覆盖记录')
    coverage.sources[0].sourceVersionId = 'wrong-source'
    await expect(store.saveEntrySummary(kb.id, entry.id, entrySourceVersion(kb.id, entry), editVersion(entry), '错来源摘要', 'ai', coverage)).rejects.toThrow('完整覆盖记录')
    expect(writes).toBe(0)
    expect((await reload()).entries[0].summary).toBe('')
  })

  it('does not publish a failed summary or its history and permits a retry', async () => {
    await saveEntry('第一版摘要。')
    const before = copy(kb), stored = await reload()
    nextWrite = async () => { throw new Error('模拟摘要磁盘失败') }
    await expect(saveEntry('未落盘摘要。')).rejects.toThrow('模拟摘要磁盘失败')
    expect(copy(kb)).toEqual(before)
    expect(await reload()).toEqual(stored)
    await saveEntry('重试成功摘要。')
    expect((await reload()).entries[0].summary).toBe('重试成功摘要。')
    expect(kb.entries[0].summaryHistory).toHaveLength(1)
  })

  it('rejects queued stale confirmations and changed sources before any second write', async () => {
    const entry = kb.entries[0], version = entrySourceVersion(kb.id, entry), baseline = editVersion(entry)
    const held = holdWrite()
    const first = store.saveEntrySummary(kb.id, entry.id, version, baseline, '先保存的摘要。')
    await held.started
    const second = store.saveEntrySummary(kb.id, entry.id, version, baseline, '过期表单。')
    const rejected = expect(second).rejects.toThrow('发生变化')
    held.release(); await first; await rejected
    expect(writes).toBe(1)
    const baseVersion = baseSourceVersion(kb), baseBaseline = editVersion(kb)
    store.addEntry(kb.id, { title: '新规则', content: '禁止通行。', category: '世界观', summary: '', tags: [] })
    await expect(store.saveBaseSummary(kb.id, baseVersion, baseBaseline, '迟到的整库摘要。')).rejects.toThrow('发生变化')
    expect(kb.summary || '').toBe('')
    await store.flushPendingSaves()
  })

  it('preserves author input made during commit and does not trust the saved earlier summary', async () => {
    const entry = kb.entries[0], held = holdWrite()
    const saving = saveEntry('旅馆中的钥匙。')
    await held.started
    store.updateEntry(kb.id, entry.id, { content: '作者在保存期间改为城门。' })
    held.release(); await saving
    expect(kb.entries[0]).toBe(entry)
    expect(entry.content).toBe('作者在保存期间改为城门。')
    expect(getCurrentEntrySummary(kb.id, entry)).toBe('')
    await store.flushPendingSaves()
    const reloaded = await reload()
    expect(reloaded.entries[0].content).toBe(entry.content)
    expect(getCurrentEntrySummary(kb.id, reloaded.entries[0])).toBe('')
  })
})
