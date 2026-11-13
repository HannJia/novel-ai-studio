import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Novel } from '@/types/novel'
import type { StoryImpactReport, StoryImpactRef } from '@/types/storyImpact'
import type { StoryMemoryRecord } from '@/types/storyMemory'
import type { ReconstructionWorkspaceSnapshot } from '@/types/reconstruction'
import { emptyProjectWorkspace } from '@/test/projectBackupFixture'
import { validateReconstructionWorkspaces } from './reconstructionBackupValidation'

const memory = new Map<string, string>()
const now = '2026-10-30T00:00:00.000Z'

beforeEach(() => {
  vi.resetModules()
  memory.clear()
  vi.stubGlobal('window', {})
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
    removeItem: (key: string) => memory.delete(key),
  })
})

function ref(kind: StoryImpactRef['kind'], id: string): StoryImpactRef {
  return { kind, id, label: id }
}

function setRoot(workspace: { impactReports?: StoryImpactReport[] }, target: StoryImpactRef) {
  const report = workspace.impactReports![0]
  const previous = report.changes[0].target
  report.changes[0].target = target
  for (const item of report.affected) for (const reason of item.reasons) {
    if (reason.from.kind === previous.kind && reason.from.id === previous.id) reason.from = target
  }
}

function report(novelId: string, id = `${novelId}:impact`): StoryImpactReport {
  const root = ref('character', `${novelId}:character`)
  const affected = ref('chapter', `${novelId}:chapter`)
  return {
    id,
    novelId,
    createdAt: now,
    version: 1,
    beforeVersion: `${novelId}:before`,
    afterVersion: `${novelId}:after`,
    changes: [{ target: root, action: 'update', fields: ['title'] }],
    affected: [{ target: affected, depth: 1, reasons: [{ from: root, relation: 'appears-in', phase: 'after' }] }],
    mentions: [{ chapter: affected, terms: ['关键词'] }],
    reviewPolicy: 'all-written',
    reviewChapterIds: [affected.id],
  }
}

function snapshot(impactReports: StoryImpactReport[]): ReconstructionWorkspaceSnapshot {
  return { candidates: [], reviewFindings: [], chapterReviews: [], aiRuns: [], canonMutations: [], impactReports }
}

function novel(id: string): Novel {
  return {
    id,
    chapters: [{ id: `${id}:chapter`, sceneNotes: [{ id: `${id}:scene` }], versions: [] }],
    characters: [{ id: `${id}:character` }],
    eventLog: [{ id: `${id}:event` }],
    storyArcs: [{ id: `${id}:arc`, nodes: [{ id: `${id}:node` }] }],
    chapterPlans: [{ id: `${id}:plan` }],
    volumes: [],
    dataPanels: [],
  } as unknown as Novel
}

function memoryRecord(novelId: string): StoryMemoryRecord {
  return {
    id: `${novelId}:memory`,
    novelId,
    title: '历史回顾',
    scope: { kind: 'book', throughChapterId: `${novelId}:chapter` },
    summary: '已删除正文中的历史事实。',
    source: { version: 1, sourceVersionId: `${novelId}:source`, value: '已删除正文中的历史事实。', origin: 'author', confirmedAt: now },
    history: [],
  }
}

describe('story impact report persistence', () => {
  it('persists composite-key reports independently per novel and deletes only the selected owner', async () => {
    const db = await import('./database')
    const { deleteReconstructionWorkspace, loadReconstructionWorkspace, saveReconstructionWorkspace } = await import('./db/reconstruction')
    const sharedId = 'same-report-id'

    const orderedReports = [report('novel-a', 'z-report'), report('novel-a', 'a-report')]
    await saveReconstructionWorkspace('novel-a', snapshot(orderedReports))
    await saveReconstructionWorkspace('novel-b', snapshot([report('novel-b', sharedId)]))

    expect((await loadReconstructionWorkspace('novel-a')).impactReports?.map(item => item.id)).toEqual(['z-report', 'a-report'])
    expect(await loadReconstructionWorkspace('novel-b')).toMatchObject({ impactReports: [report('novel-b', sharedId)] })
    expect(db.queryAll<{ count: number }>("SELECT COUNT(*) AS count FROM reconstruction_impact_reports WHERE novel_id IN ('novel-a', 'novel-b')")).toEqual([{ count: 3 }])

    await saveReconstructionWorkspace('novel-a', snapshot([]))
    expect(await loadReconstructionWorkspace('novel-b')).toMatchObject({ impactReports: [report('novel-b', sharedId)] })
    expect(db.queryAll<{ count: number }>('SELECT COUNT(*) AS count FROM reconstruction_impact_reports WHERE novel_id = ?', ['novel-a'])).toEqual([{ count: 0 }])

    await deleteReconstructionWorkspace('novel-b')
    expect((await loadReconstructionWorkspace('novel-b')).impactReports).toBeUndefined()
    expect(db.queryAll<{ count: number }>("SELECT COUNT(*) AS count FROM reconstruction_impact_reports WHERE novel_id IN ('novel-a', 'novel-b')")).toEqual([{ count: 0 }])
  })

  it('validates report ownership, uniqueness, historical references, and every mapped foreign reference kind', () => {
    const local = novel('local')
    const foreign = novel('foreign')
    const valid = report('local')
    const workspace = { ...emptyProjectWorkspace(local.id), impactReports: [valid] }
    expect(() => validateReconstructionWorkspaces([workspace], [local])).not.toThrow()

    const deleted = structuredClone(workspace)
    deleted.impactReports![0].changes[0].target = ref('character', 'deleted-character')
    for (const item of deleted.impactReports![0].affected) for (const reason of item.reasons) {
      if (reason.from.id === `${local.id}:character`) reason.from = ref('character', 'deleted-character')
    }
    expect(() => validateReconstructionWorkspaces([deleted], [local])).not.toThrow()

    const kinds: Array<[StoryImpactRef['kind'], string]> = [
      ['character', 'foreign:character'], ['event', 'foreign:event'], ['arc', 'foreign:arc'], ['node', 'foreign:node'],
      ['plan', 'foreign:plan'], ['scene', 'foreign:scene'], ['chapter', 'foreign:chapter'],
    ]
    for (const [kind, id] of kinds) {
      const invalid = structuredClone(workspace)
      setRoot(invalid, ref(kind, id))
      expect(() => validateReconstructionWorkspaces([invalid, emptyProjectWorkspace(foreign.id)], [local, foreign])).toThrow('其他小说')
    }

    const foreignNodeParent = structuredClone(workspace)
    setRoot(foreignNodeParent, { ...ref('node', 'deleted-node'), parentId: `${foreign.id}:arc` })
    expect(() => validateReconstructionWorkspaces([foreignNodeParent, emptyProjectWorkspace(foreign.id)], [local, foreign])).toThrow('其他小说')
    const foreignSceneParent = structuredClone(workspace)
    setRoot(foreignSceneParent, { ...ref('scene', 'deleted-scene'), parentId: `${foreign.id}:plan` })
    expect(() => validateReconstructionWorkspaces([foreignSceneParent, emptyProjectWorkspace(foreign.id)], [local, foreign])).toThrow('其他小说')

    const foreignMemoryWorkspace = { ...emptyProjectWorkspace(foreign.id), storyMemories: [memoryRecord(foreign.id)] }
    const memoryRef = structuredClone(workspace)
    setRoot(memoryRef, ref('memory', `${foreign.id}:memory`))
    expect(() => validateReconstructionWorkspaces([memoryRef, foreignMemoryWorkspace], [local, foreign])).toThrow('其他小说')

    const duplicate = { ...emptyProjectWorkspace(local.id), impactReports: [valid, structuredClone(valid)] }
    expect(() => validateReconstructionWorkspaces([duplicate], [local])).toThrow('重复 ID')

    const wrongOwner = structuredClone(workspace)
    wrongOwner.impactReports![0].novelId = foreign.id
    expect(() => validateReconstructionWorkspaces([wrongOwner], [local])).toThrow()
  })
})
