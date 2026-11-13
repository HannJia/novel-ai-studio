import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { characterStateFixture, stateTestTime as now } from '@/test/characterStateFixture'
import { createEmptyCreationDraft, type ReconstructionWorkspaceSnapshot } from '@/types/reconstruction'
import type { Novel, StoryArc } from '@/types/novel'
import type { StoryImpactChange } from '@/types/storyImpact'
import { captureStoryImpact, buildStoryImpactReport } from './storyImpactAnalysis'
import { assertStoryImpactReport } from './storyImpactValidation'
import { editDefinitionsWithImpact, editStoryArcWithImpact } from './storyImpactTransactions'

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const empty = (): ReconstructionWorkspaceSnapshot => ({ candidates: [], reviewFindings: [], canonMutations: [] })
const change: StoryImpactChange = { target: { kind: 'character', id: 'person-0', label: '林澈' }, action: 'update', fields: ['identity'] }
const arc = (id: string, overrides: Partial<StoryArc> = {}): StoryArc => ({ id, title: id, description: '', type: 'main', importance: 3,
  status: 'active', reactivateAt: '', characterIds: [], nodes: [], createdAt: now, updatedAt: now, ...overrides })
function report(novel: Novel, workspace = empty(), rootChange = change) {
  const snapshot = captureStoryImpact(novel, workspace)
  return buildStoryImpactReport(snapshot, snapshot, [rootChange], novel.chapters.map(chapter => chapter.id), now, 'report')
}
beforeEach(() => setActivePinia(createPinia()))

describe('structured author impact reports', () => {
  it('shows direct character and event associations without spreading into other objects', () => {
    const { novel } = characterStateFixture()
    novel.characters[1].relationships = [{ targetId: 'person-0', targetName: '林澈', relation: '敬重' }]
    novel.eventLog = [{ id: 'event', title: '收到信', description: '', type: '主线', chapterIndex: 1, characters: ['林澈', '苏禾'], timestamp: now }]
    novel.eventLog.push({ id: 'other-event', title: '另一封信', description: '', type: '支线', chapterIndex: 2, characters: ['苏禾'], timestamp: now })
    novel.storyArcs = [arc('arc-a', { characterIds: ['person-0'], turningPointEventIds: ['event'] })]
    const result = report(novel)
    expect(result.affected.find(item => item.target.id === 'person-1')).toMatchObject({ depth: 1, reasons: expect.arrayContaining([expect.objectContaining({ relation: '人物关系指向此人' })]) })
    expect(result.affected.find(item => item.target.id === 'event')).toMatchObject({ depth: 1, reasons: expect.arrayContaining([expect.objectContaining({ kind: 'association' })]) })
    expect(result.affected.some(item => item.target.id === 'other-event')).toBe(false)
    expect(result.affected.find(item => item.target.id === 'arc-a')?.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'association' })]))
    expect(result.affected.find(item => item.target.id === 'person-1')!.reasons.every(reason => reason.from.id === 'person-0')).toBe(true)
    expect(result.affected.some(item => item.target.kind === 'chapter')).toBe(false)
    expect(result.reviewChapterIds).toContain(novel.chapters[0].id)
    expect(() => assertStoryImpactReport(copy(result), novel.id)).not.toThrow()
  })

  it('continues declared dependencies but stops at node-to-arc association edges', () => {
    const { novel } = characterStateFixture()
    novel.storyArcs = [
      arc('arc-a', { nodes: [{ id: 'node-a', title: '第一节点', description: '', targetChapter: 0, status: 'pending', createdAt: now, updatedAt: now }] }),
      arc('arc-b', { dependencyArcIds: ['arc-a'], nodes: [{ id: 'node-b', title: '后续节点', description: '', targetChapter: 1, status: 'pending', createdAt: now, updatedAt: now }] }),
    ]
    const arcRoot: StoryImpactChange = { target: { kind: 'arc', id: 'arc-a', label: 'arc-a' }, action: 'update', fields: ['goal'] }
    const dependencyReport = report(novel, empty(), arcRoot)
    expect(dependencyReport.affected.find(item => item.target.id === 'arc-b')?.depth).toBe(1)
    expect(dependencyReport.affected.find(item => item.target.id === 'node-b')?.depth).toBe(2)
    expect(dependencyReport.affected.some(item => item.target.id === novel.chapters[1].id)).toBe(true)

    const nodeRoot: StoryImpactChange = { target: { kind: 'node', id: 'node-a', label: '第一节点', parentId: 'arc-a' }, action: 'update', fields: ['description'] }
    const associationReport = report(novel, empty(), nodeRoot)
    expect(associationReport.affected.some(item => item.target.id === 'arc-a')).toBe(true)
    expect(associationReport.affected.some(item => item.target.id === 'node-b')).toBe(false)
  })

  it('keeps traversing an object reached both directly and through a dependency', () => {
    const { novel } = characterStateFixture()
    novel.eventLog = [{ id: 'event', title: '转折事件', description: '', type: '主线', chapterIndex: 2, characters: [], timestamp: now }]
    novel.storyArcs = [arc('arc-a', {
      turningPointEventIds: ['event'],
      nodes: [{ id: 'node-a', title: '转折节点', description: '', targetChapter: 0, status: 'pending', consequenceEventIds: ['event'], createdAt: now, updatedAt: now }],
    })]
    const root: StoryImpactChange = { target: { kind: 'arc', id: 'arc-a', label: 'arc-a' }, action: 'update', fields: ['goal'] }
    const result = report(novel, empty(), root)
    expect(result.affected.find(item => item.target.id === 'event')?.depth).toBe(1)
    expect(result.affected.find(item => item.target.id === 'event')?.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'association' }), expect.objectContaining({ kind: 'dependency' })]))
    expect(result.affected.find(item => item.target.id === novel.chapters[2].id)?.depth).toBe(3)
    expect(() => assertStoryImpactReport(copy(result), novel.id)).not.toThrow()
  })

  it('keeps ambiguous participant names and prose-only matches out of dependency propagation', () => {
    const { novel } = characterStateFixture()
    novel.characters[0].aliases = ['先生']; novel.characters[1].aliases = ['先生']
    novel.eventLog = [{ id: 'ambiguous', title: '见面', description: '', type: '其他', chapterIndex: 0, characters: ['先生'], timestamp: now }]
    const workspace = empty()
    workspace.storyMemories = [{ id: 'memory', novelId: novel.id, title: '正文回顾', summary: '概要', history: [],
      scope: { kind: 'scene', chapterId: novel.chapters[0].id, startOffset: 0, endOffset: 1 }, source: { version: 1, value: '概要', origin: 'author', sourceVersionId: 'source', confirmedAt: now } }]
    const result = report(novel, workspace)
    expect(result.affected).toEqual([])
    expect(result.mentions.map(item => item.chapter.id)).toContain(novel.chapters[0].id)
    expect(result.mentions[0].terms).toContain('林澈')
  })

  it('records removed references and both old and new names without mixing snapshot paths', () => {
    const { novel } = characterStateFixture(), workspace = empty()
    novel.storyArcs = [arc('a', { characterIds: ['person-0'] }), arc('b')]
    const before = captureStoryImpact(novel, workspace)
    novel.characters[0].name = '林川'
    novel.chapters[2].content = '林川回来了。'
    novel.storyArcs[0].characterIds = []
    novel.storyArcs[1].dependencyArcIds = ['a']
    const result = buildStoryImpactReport(before, captureStoryImpact(novel, workspace), [change], [], now, 'rename')
    expect(result.affected.find(item => item.target.id === 'a')?.reasons.every(reason => reason.phase === 'before')).toBe(true)
    expect(result.affected.some(item => item.target.id === 'b')).toBe(false)
    expect(result.mentions.flatMap(item => item.terms)).toEqual(expect.arrayContaining(['林澈', '林川']))
  })

  it('terminates circular dependency references and records shortest distances', () => {
    const { novel } = characterStateFixture()
    novel.storyArcs = [arc('a', { dependencyArcIds: ['b'] }), arc('b', { dependencyArcIds: ['a'] }), arc('c', { dependencyArcIds: ['b'] })]
    const result = report(novel, empty(), { target: { kind: 'arc', id: 'a', label: 'a' }, action: 'update', fields: ['goal'] })
    expect(result.affected.map(item => item.depth)).toEqual([1, 2])
    expect(new Set(result.affected.map(item => item.target.id))).toEqual(new Set(['b', 'c']))
    expect(() => assertStoryImpactReport(result, novel.id)).not.toThrow()
  })

  it('rejects a persisted path that continues through an association', () => {
    const { novel } = characterStateFixture()
    novel.eventLog = [{ id: 'event', title: '遇见', description: '', type: '主线', chapterIndex: 0, characters: ['person-0'], timestamp: now }]
    const valid = report(novel)
    const event = valid.affected.find(item => item.target.id === 'event')!
    const forged = copy(valid)
    forged.affected.push({ target: { kind: 'chapter', id: novel.chapters[0].id, label: '第一章' }, depth: 2,
      reasons: [{ from: event.target, relation: '事件發生章节', phase: 'after', kind: 'dependency' }] })
    expect(() => assertStoryImpactReport(forged, novel.id)).toThrow('影响报告')
  })

  it('shows active viewpoint scenes without propagating through planning associations', () => {
    const { novel } = characterStateFixture(), workspace = empty()
    const draft = createEmptyCreationDraft({ id: 'draft', now })
    draft.chapterPlans = [{ id: 'v2-plan', title: '第二章', number: 2, endNumber: 2, objective: '', conflict: '', openingState: '', endingState: '', requiredEvents: [], prohibitedReveals: [], characterChangeNotes: [], foreshadowingIds: [], scenePlanIds: ['scene'], status: 'planned', approval: 'approved' }]
    draft.scenePlans = [{ id: 'scene', chapterPlanId: 'v2-plan', title: '书信', order: 1, purpose: '', requiredActions: [], informationChanges: [], outputState: '', status: 'planned', approval: 'approved', viewpointCharacterId: 'person-0' }]
    workspace.creationDraft = draft
    workspace.storyMemories = [{ id: 'memory', novelId: novel.id, title: '场景回顾', summary: '书信', history: [], scope: { kind: 'scene', chapterId: novel.chapters[1].id, startOffset: 0, endOffset: 2 }, source: { version: 1, value: '书信', sourceVersionId: 'source', origin: 'author', confirmedAt: now } }]
    const result = report(novel, workspace)
    expect(result.affected.map(item => item.target.id)).toEqual(['scene'])
    draft.scenePlans[0].approval = 'rejected'
    expect(report(novel, workspace).affected).toEqual([])
  })

  it('preserves deletion reports and excludes avatar-only changes', () => {
    const { novel } = characterStateFixture(), workspace = empty()
    let n = 0; const id = () => 'id-' + ++n
    editDefinitionsWithImpact({ novel, workspace }, [{ action: 'update', kind: 'character', entityId: 'person-0', expectedEntity: JSON.stringify(novel.characters[0]), updates: { avatarColor: '#fff' } }], now, id)
    expect(workspace.impactReports).toBeUndefined()
    editDefinitionsWithImpact({ novel, workspace }, [{ action: 'delete', kind: 'character', entityId: 'person-0', expectedEntity: JSON.stringify(novel.characters[0]) }], now, id)
    expect(workspace.impactReports).toHaveLength(1)
    expect(workspace.impactReports![0].changes[0]).toMatchObject({ action: 'delete', target: { id: 'person-0', label: '林澈' } })
    expect(workspace.impactReports![0].mentions).toHaveLength(3)
  })

  it('creates one report for a definition batch and tracks new arc and node identities', () => {
    const { novel } = characterStateFixture(), workspace = empty()
    let n = 0; const id = () => 'generated-' + ++n
    editDefinitionsWithImpact({ novel, workspace }, [{ action: 'create', kind: 'character', data: { name: '顾临' } }, { action: 'create', kind: 'event', data: { title: '追查钥匙', description: '', chapterIndex: -1, characters: [], type: '伏笔' } }], now, id)
    expect(workspace.impactReports).toHaveLength(1)
    expect(workspace.impactReports![0].changes).toHaveLength(2)
    const { id: _id, nodes: _nodes, createdAt: _created, updatedAt: _updated, ...definition } = arc('new', { characterIds: ['person-0'] })
    editStoryArcWithImpact({ novel, workspace }, { action: 'create', definition }, now, id)
    const created = novel.storyArcs![0]
    expect(workspace.impactReports![1].changes[0].target.id).toBe(created.id)
    editStoryArcWithImpact({ novel, workspace }, { action: 'add_node', arcId: created.id, expectedArc: JSON.stringify(created), definition: { title: '开端', description: '', targetChapter: 0 } }, now, id)
    expect(workspace.impactReports![2].changes[0].target).toMatchObject({ kind: 'node', id: created.nodes[0].id, parentId: created.id })
  })

  it('rejects disconnected, forged-depth, foreign-owner and malformed historical reports', () => {
    const { novel } = characterStateFixture()
    novel.storyArcs = [arc('a', { characterIds: ['person-0'] })]
    const valid = report(novel)
    const wrongDepth = copy(valid); wrongDepth.affected[0].depth = 99
    const wrongRef = copy(valid); wrongRef.affected[0].reasons[0].from.id = 'missing'
    const disconnected = copy(valid); disconnected.affected[0].reasons.forEach(reason => { reason.from = disconnected.affected[0].target })
    const date = copy(valid); date.createdAt = '2026-02-30T12:00:00Z'
    for (const invalid of [wrongDepth, wrongRef, disconnected, date, { ...valid, novelId: 'other' }, { ...valid, changes: [] }]) {
      expect(() => assertStoryImpactReport(invalid, novel.id)).toThrow('影响报告')
    }
  })
})
