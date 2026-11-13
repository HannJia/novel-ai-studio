import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { characterStateFixture, stateTestTime as now } from '@/test/characterStateFixture'

const memory = new Map<string, string>()

beforeEach(() => {
  vi.resetModules()
  memory.clear()
  vi.stubGlobal('window', {})
  vi.stubGlobal('localStorage', {
    getItem: (name: string) => memory.get(name) ?? null,
    setItem: (name: string, value: string) => memory.set(name, value),
    removeItem: (name: string) => memory.delete(name),
  })
  setActivePinia(createPinia())
})

afterEach(() => vi.unstubAllGlobals())

describe('StoryArc SQL persistence', () => {
  it('round trips optional arc design, parent provenance, and node provenance', async () => {
    const { novel } = characterStateFixture()
    const revision = {
      id: 'arc-revision', entityType: 'arc' as const, entityId: 'arc-1', source: { kind: 'author' as const },
      appliedAt: now, changes: [{ field: 'goal', after: '找到真相' as const }],
    }
    const nodeRevision = {
      id: 'node-revision', entityType: 'arc_node' as const, entityId: 'node-1', source: { kind: 'author' as const },
      appliedAt: now, changes: [{ field: 'status', after: 'completed' as const }],
    }
    novel.storyArcs = [{
      id: 'arc-1', title: '真相线', description: '追查旧案', type: 'mystery', importance: 4, status: 'active', reactivateAt: '',
      characterIds: ['person-0'], goal: '找到真相', conflict: '证据被隐藏', expectedResolution: '公开真相',
      dependencyArcIds: ['arc-0'], initialState: '误信旧说', desire: '洗清嫌疑', fear: '牵连同伴', falseBelief: '苏禾已经背叛',
      finalState: '接受真相', turningPointEventIds: ['event-1'], provenance: { revisions: [revision] },
      nodes: [{ id: 'node-1', title: '取得书信', description: '拿到关键证据', targetChapter: 2, actualChapter: 2,
        status: 'completed', prerequisiteNodeIds: ['node-0'], consequenceEventIds: ['event-1'], provenance: { revisions: [nodeRevision] },
        createdAt: now, updatedAt: now }], createdAt: now, updatedAt: now,
    }]
    const database = await import('./database')
    const { saveNovelToDb, loadAllNovelsFromDb } = await import('./db/novels')

    await saveNovelToDb(novel)
    const columns = database.queryAll<{ name: string }>('PRAGMA table_info(story_arcs)')
    expect(columns.map(row => row.name)).toEqual(expect.arrayContaining(['design', 'provenance']))
    const stored = database.queryAll<{ design: string; nodes: string; provenance: string }>('SELECT design,nodes,provenance FROM story_arcs WHERE id = ?', ['arc-1'])[0]
    expect(JSON.parse(stored.design)).toMatchObject({ goal: '找到真相', dependencyArcIds: ['arc-0'], turningPointEventIds: ['event-1'] })
    expect(JSON.parse(stored.provenance)).toEqual({ revisions: [revision] })
    expect(JSON.parse(stored.nodes)[0].provenance).toEqual({ revisions: [nodeRevision] })

    const loaded = (await loadAllNovelsFromDb()).find(item => item.id === novel.id)!
    expect(loaded.storyArcs).toEqual(novel.storyArcs)
  })
})
