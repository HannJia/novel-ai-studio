import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { characterStateFixture, stateTestTime as now } from '@/test/characterStateFixture'
import { createTestProjectBackup } from '@/test/projectBackupFixture'
import { validateCanonEntityChanges } from './entityProvenanceValidation'
import { validateProjectBackup } from './projectBackupValidation'
import type { CanonMutationRecord } from '@/types/reconstruction'
import type { EntityRevision, EntityValue } from '@/types/entityProvenance'

beforeEach(() => setActivePinia(createPinia()))

function arcRevision(entityType: 'arc' | 'arc_node', entityId: string, field: string, after: EntityValue): EntityRevision {
  return { id: entityId + '-revision', entityType, entityId, source: { kind: 'author' as const }, appliedAt: now, changes: [{ field, after }] }
}

function makeArc(status: 'active' | 'unverified' = 'active') {
  return {
    id: 'arc-1', title: '真相线', description: '', type: 'mystery' as const, importance: 3 as const, status,
    reactivateAt: '', characterIds: ['person-0'], goal: '找到真相', conflict: '证据不足', expectedResolution: '公开真相',
    dependencyArcIds: [], initialState: '误信旧说', desire: '洗清嫌疑', fear: '牵连同伴', falseBelief: '旧说可信', finalState: '接受真相',
    turningPointEventIds: [], provenance: { revisions: [arcRevision('arc', 'arc-1', 'goal', '找到真相')] },
    nodes: [{ id: 'node-1', title: '取得证据', description: '', targetChapter: 1, status: 'unverified' as const,
      prerequisiteNodeIds: [], consequenceEventIds: [], provenance: { revisions: [arcRevision('arc_node', 'node-1', 'status', 'unverified')] },
      createdAt: now, updatedAt: now }], createdAt: now, updatedAt: now,
  } as any
}

describe('StoryArc backup validation', () => {
  it('accepts optional arc fields, unverified projection states, and owned histories', () => {
    const { novel } = characterStateFixture()
    novel.storyArcs = [makeArc()]
    const backup = createTestProjectBackup([novel], [])
    expect(() => validateProjectBackup(backup)).not.toThrow()
  })

  it('rejects a parent history that tries to recursively own nodes', () => {
    const { novel } = characterStateFixture()
    const arc = makeArc()
    arc.provenance.revisions[0].changes.push({ field: 'nodes', after: [] } as never)
    novel.storyArcs = [arc]
    expect(() => validateProjectBackup(createTestProjectBackup([novel], []))).toThrow('实体来源')
  })

  it('rejects known foreign arc references in live design fields', () => {
    const first = characterStateFixture().novel
    const second = characterStateFixture().novel
    second.id = 'foreign-novel'
    first.storyArcs = [{ ...makeArc(), dependencyArcIds: ['foreign-arc'] }]
    second.storyArcs = [{ ...makeArc(), id: 'foreign-arc', provenance: undefined }]
    expect(() => validateProjectBackup(createTestProjectBackup([first, second], []))).toThrow('引用属于其他作品')
  })

  it('runs graph validation after shape checks and rejects dangling dependencies', () => {
    const { novel } = characterStateFixture()
    novel.storyArcs = [{ ...makeArc(), dependencyArcIds: ['missing-arc'] }]
    expect(() => validateProjectBackup(createTestProjectBackup([novel], []))).toThrow('storyArcs')
  })

  it('accepts arc entityChanges for plotline Canon mutations and checks embedded history', () => {
    const { novel } = characterStateFixture()
    const arc = makeArc()
    novel.storyArcs = [arc]
    arc.provenance.revisions[0].source = { kind: 'chapter', chapterId: novel.chapters[0].id, chapterIndex: 0,
      sourceVersionId: 'source-version', evidence: [{ quote: novel.chapters[0].content }] }
    const record: CanonMutationRecord = {
      id: 'mutation-arc', candidateId: 'candidate-arc', novelId: novel.id, chapterId: novel.chapters[0].id,
      type: 'plotline', targetId: arc.id, summary: '确认剧情线状态', appliedAt: now,
      entityChanges: [JSON.parse(JSON.stringify(arc.provenance.revisions[0]))],
    }
    expect(() => validateCanonEntityChanges(record, [novel], 'canon')).not.toThrow()
    record.entityChanges![0].changes[0].after = '另一份值'
    expect(() => validateCanonEntityChanges(record, [novel], 'canon')).toThrow('与实体历史不一致')
  })
})
