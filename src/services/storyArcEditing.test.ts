import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { characterStateFixture, stateTestTime as now } from '@/test/characterStateFixture'
import type { Novel, StoryArc } from '@/types/novel'
import { analyzeStoryArcImpact, applyStoryArcEdit, arcPlanningSourceVersion, validateStoryArcGraph, type ArcDefinition } from './storyArcEditing'
import { appendEntityRevision, captureEntityRevision, getEntitySourceIssues, projectCanonicalEntities } from './entityProvenance'
import { withCurrentStoryEntities } from './effectiveStory'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import { buildReviewContextVersion } from './reconstructionReviewVersion'
import { buildSemanticRecords } from './semanticIndex'
import { applyCandidateChangeToCanon } from './reconstructionCanon'

let sequence = 0
const id = () => 'arc-test-' + ++sequence
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const definition = (overrides: Partial<ArcDefinition> = {}): ArcDefinition => ({ title: '调查身世', description: '循线找人', type: 'character',
  importance: 4, status: 'active', reactivateAt: '', characterIds: ['person-0'], goal: '查明失踪原因', conflict: '主角害怕背叛',
  expectedResolution: '查清真相', initialState: '盲信', desire: '找到归属', fear: '被抛弃', falseBelief: '血缘决定一切', finalState: '主动选择信任', ...overrides })
function createArc(novel: Novel, overrides: Partial<ArcDefinition> = {}): StoryArc {
  applyStoryArcEdit(novel, { action: 'create', definition: definition(overrides), nodes: [
    { title: '获得书信', description: '确认城主活着', targetChapter: 1 },
    { title: '改变选择', description: '开始独立判断', targetChapter: 2 },
  ] }, now, id)
  return novel.storyArcs!.slice(-1)[0]!
}
function complete(novel: Novel, arc: StoryArc, index: number, chapterIndex: number) {
  const chapter = novel.chapters[chapterIndex]
  return applyStoryArcEdit(novel, { action: 'node_status', arcId: arc.id, nodeId: arc.nodes[index].id, expectedArc: JSON.stringify(arc),
    status: 'completed', source: { kind: 'chapter', chapterId: chapter.id, chapterIndex, sourceVersionId: buildAnalysisSourceVersionId(chapter.content), evidence: [{ quote: chapter.content }] } }, now, id)
}
beforeEach(() => { setActivePinia(createPinia()); sequence = 0 })

describe('author arc graph', () => {
  it('lets explicit author saving retain a chapter-born arc after its original source expires', () => {
    const { novel } = characterStateFixture(), chapter = novel.chapters[1]
    const arc: StoryArc = { ...definition(), id: 'chapter-source-only', nodes: [], createdAt: now, updatedAt: now }
    appendEntityRevision(arc, captureEntityRevision('arc', undefined, arc, { kind: 'chapter', chapterId: chapter.id, chapterIndex: chapter.chapterIndex,
      sourceVersionId: buildAnalysisSourceVersionId(chapter.content), evidence: [{ quote: chapter.content }] }, now, 'chapter-arc-birth'))
    novel.storyArcs = [arc]
    const originalHistory = copy(arc.provenance!.revisions[0])
    chapter.content += '来源正文已修改。'
    expect(projectCanonicalEntities(novel).arcs).toHaveLength(0)
    applyStoryArcEdit(novel, { action: 'update', arcId: arc.id, expectedArc: JSON.stringify(arc),
      definition: definition({ description: '作者明确保留的调查规划' }) }, now, id)
    expect(projectCanonicalEntities(novel).arcs).toEqual([expect.objectContaining({ id: arc.id, description: '作者明确保留的调查规划', status: 'active' })])
    expect(arc.provenance!.revisions[0]).toEqual(originalHistory)
    expect(arc.provenance!.revisions[arc.provenance!.revisions.length - 1]).toMatchObject({ source: { kind: 'author' }, changes: expect.arrayContaining([{ field: '$exists', before: true, after: true }]) })
  })

  it('records structured planning and separate node histories, and rejects stale author forms', () => {
    const { novel } = characterStateFixture(), arc = createArc(novel), baseline = JSON.stringify(arc)
    expect(arc.provenance!.revisions[0].changes.some(change => change.field === 'nodes')).toBe(false)
    expect(arc.nodes[0].provenance!.revisions[0].entityType).toBe('arc_node')
    applyStoryArcEdit(novel, { action: 'update', arcId: arc.id, expectedArc: baseline, definition: definition({ goal: '寻找亲人' }) }, now, id)
    expect(arc.goal).toBe('寻找亲人')
    expect(() => applyStoryArcEdit(novel, { action: 'update', arcId: arc.id, expectedArc: baseline, definition: definition() }, now, id)).toThrow('编辑期间发生变化')
  })
  it('requires current, unambiguous chapter evidence and keeps completion out of earlier chapters', () => {
    const { novel } = characterStateFixture(), arc = createArc(novel)
    const edit = { action: 'node_status' as const, arcId: arc.id, nodeId: arc.nodes[0].id, expectedArc: JSON.stringify(arc), status: 'completed' as const }
    expect(() => applyStoryArcEdit(novel, edit, now, id)).toThrow('原文证据')
    const chapter = novel.chapters[1]
    chapter.content = '书信到了。书信到了。'
    const source = { kind: 'chapter' as const, chapterId: chapter.id, chapterIndex: 1, sourceVersionId: buildAnalysisSourceVersionId(chapter.content), evidence: [{ quote: '书信到了。' }] }
    expect(() => applyStoryArcEdit(novel, { ...edit, source }, now, id)).toThrow('多次')
    chapter.content = '苏禾带来书信，林澈知道城主活着。'
    expect(() => applyStoryArcEdit(novel, { ...edit, source }, now, id)).toThrow('正文已经变化')
    complete(novel, arc, 0, 1)
    expect(arc.nodes[0].actualChapter).toBe(1)
    expect(projectCanonicalEntities(novel, 1).arcs[0].nodes[0]).toMatchObject({ status: 'pending', actualChapter: undefined })
    expect(projectCanonicalEntities(novel, 2).arcs[0].nodes[0]).toMatchObject({ status: 'completed', actualChapter: 1 })
    const projected = withCurrentStoryEntities(novel, 2)
    expect(withCurrentStoryEntities(projected, 1).storyArcs![0].nodes[0].status).toBe('pending')
    chapter.content += '作者改了这一章。'
    expect(projectCanonicalEntities(novel).arcs[0].nodes[0]).toMatchObject({ status: 'unverified', actualChapter: undefined })
    expect(arc.nodes[0].status).toBe('completed') // retained history, never destructive projection
  })
  it('propagates a stale prerequisite and rejects premature completion', () => {
    const { novel } = characterStateFixture(), arc = createArc(novel)
    // The author definition is recorded through the transaction API.
    applyStoryArcEdit(novel, { action: 'update_node', arcId: arc.id, nodeId: arc.nodes[1].id, expectedArc: JSON.stringify(arc),
      definition: { title: '改变选择', description: '', targetChapter: 2, prerequisiteNodeIds: [arc.nodes[0].id] } }, now, id)
    expect(() => complete(novel, arc, 1, 2)).toThrow('前置里程碑')
    complete(novel, arc, 0, 1); complete(novel, arc, 1, 2)
    expect(projectCanonicalEntities(novel).arcs[0].nodes[1].status).toBe('completed')
    novel.chapters[1].content += '修订了书信。'
    expect(projectCanonicalEntities(novel).arcs[0].nodes[1].status).toBe('unverified')
    expect(getEntitySourceIssues(novel, 'arc_node', arc.nodes[1]).some(issue => issue.reason === 'prerequisite_unconfirmed')).toBe(true)
  })
  it('does not accept untracked completion as a fact', () => {
    const { novel } = characterStateFixture(), arc = createArc(novel)
    delete arc.nodes[0].provenance
    arc.nodes[0].status = 'completed'; arc.nodes[0].actualChapter = 2
    expect(projectCanonicalEntities(novel, 1).arcs[0].nodes[0]).toMatchObject({ status: 'unverified', actualChapter: undefined })
  })
  it('requires fresh evidence when an already completed milestone is redefined', () => {
    const { novel } = characterStateFixture(), arc = createArc(novel)
    complete(novel, arc, 0, 1)
    applyStoryArcEdit(novel, { action: 'update_node', arcId: arc.id, nodeId: arc.nodes[0].id, expectedArc: JSON.stringify(arc),
      definition: { title: '亲眼见到城主', description: '不再只是听说', targetChapter: 1 } }, now, id)
    expect(projectCanonicalEntities(novel).arcs[0].nodes[0]).toMatchObject({ title: '亲眼见到城主', status: 'pending', actualChapter: undefined })
    expect(arc.nodes[0].provenance!.revisions.some(revision => revision.source.kind === 'chapter')).toBe(true)
  })
  it('binds accepted AI arc status to the source chapter and excludes it from earlier contexts', () => {
    const { novel } = characterStateFixture(), arc = createArc(novel), chapter = novel.chapters[1]
    const sourceVersionId = buildAnalysisSourceVersionId(chapter.content)
    const result = applyCandidateChangeToCanon(novel, { id: 'arc-candidate', novelId: novel.id, chapterId: chapter.id,
      type: 'plotline', targetId: arc.id, proposedValue: JSON.stringify({ status: 'resolved' }), status: 'accepted', sourceVersionId,
      evidence: [{ id: 'arc-proof', sourceType: 'chapter', sourceId: chapter.id, sourceVersionId, quote: chapter.content }], createdAt: now, updatedAt: now }, now)
    expect(result.record.entityChanges![0].entityType).toBe('arc')
    expect(projectCanonicalEntities(novel, 1).arcs[0].status).toBe('active')
    expect(projectCanonicalEntities(novel, 2).arcs[0].status).toBe('completed')
    chapter.content += '修改。'
    expect(projectCanonicalEntities(novel).arcs[0].status).toBe('unverified')
  })
  it('rejects dependency cycles and protects referenced and sourced entities from deletion', () => {
    const { novel } = characterStateFixture(), first = createArc(novel), second = createArc(novel, { title: '后续', dependencyArcIds: [first.id] })
    first.dependencyArcIds = [second.id]
    expect(() => validateStoryArcGraph(novel)).toThrow('循环依赖')
    first.dependencyArcIds = []
    expect(() => applyStoryArcEdit(novel, { action: 'delete', arcId: first.id, expectedArc: JSON.stringify(first) }, now, id)).toThrow('引用')
    complete(novel, second, 0, 1)
    expect(() => applyStoryArcEdit(novel, { action: 'delete_node', arcId: second.id, nodeId: second.nodes[0].id, expectedArc: JSON.stringify(second) }, now, id)).toThrow('正文来源')
    first.nodes[0].prerequisiteNodeIds = [first.nodes[1].id]; first.nodes[1].prerequisiteNodeIds = [first.nodes[0].id]
    expect(() => validateStoryArcGraph(novel)).toThrow('循环依赖')
  })
  it('reports full chapter ranges and dependency closure beyond sixty chapters', () => {
    const { novel, store } = characterStateFixture(), first = createArc(novel), second = createArc(novel, { title: '后续', dependencyArcIds: [first.id] })
    for (let index = 3; index <= 100; index++) store.addChapter(novel.id, { title: '章节' + index })
    novel.chapterPlans = [{ id: 'range', title: '长段落', horizon: 'far', status: 'planned', objective: '', summary: '', beats: [],
      targetChapterStart: 10, targetChapterEnd: 100, relatedArcIds: [second.id], relatedEventIds: [], source: 'user', createdAt: now, updatedAt: now }]
    const impact = analyzeStoryArcImpact(novel, first.id)
    expect(impact.arcIds).toContain(second.id)
    expect(impact.reasons[novel.chapters[75].id]).toContain('章节计划：长段落')
    expect(impact.chapterIds).toContain(novel.chapters[100].id)
    expect(impact.chapterIds).not.toContain(novel.chapters[0].id)
  })
  it('includes design in retrieval and review versions, invalidates all written reviews, and rejects stale outline suggestions', () => {
    const { novel } = characterStateFixture(), arc = createArc(novel)
    const before = buildReviewContextVersion(novel, novel.chapters[0])
    novel.chapters[0].status = 'finalized'; novel.chapters[0].contentReviewSignature = 'old'
    applyStoryArcEdit(novel, { action: 'update', arcId: arc.id, expectedArc: JSON.stringify(arc), definition: definition({ falseBelief: '信任会招致背叛' }) }, now, id)
    expect(buildReviewContextVersion(novel, novel.chapters[0])).not.toBe(before)
    expect(novel.chapters[0].status).toBe('writing')
    expect(novel.chapters[0].contentReviewSignature).toBe('')
    expect(buildSemanticRecords(novel).find(record => record.sourceType === 'story_arc')?.content).toContain('信任会招致背叛')
    const planningSourceVersion = arcPlanningSourceVersion(novel)
    novel.outline += '新的大纲'
    expect(() => applyStoryArcEdit(copy(novel), { action: 'create', definition: definition(), planningSourceVersion }, now, id)).toThrow('重新提取')
  })
})
