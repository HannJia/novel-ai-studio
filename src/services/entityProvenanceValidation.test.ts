import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createRequire } from 'node:module'
import { characterStateFixture, stateTestTime as now } from '@/test/characterStateFixture'
import { createTestProjectBackup } from '@/test/projectBackupFixture'
import { applyCandidateChangeToCanon } from './reconstructionCanon'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import { validateProjectBackup } from './projectBackupValidation'
import type { EntityRevision } from '@/types/entityProvenance'

const require = createRequire(import.meta.url)
const kernelValidate = require('../../app-main/kernel-validation/projectBackupValidation.js').validateProjectBackup
beforeEach(() => setActivePinia(createPinia()))
function fixture() {
  const { novel } = characterStateFixture()
  const chapter = novel.chapters[0], version = buildAnalysisSourceVersionId(chapter.content)
  const record = applyCandidateChangeToCanon(novel, { id: 'entity', novelId: novel.id, chapterId: chapter.id,
    type: 'fact', proposedValue: JSON.stringify({ kind: 'character', name: '林澈', identity: '调查员' }),
    sourceVersionId: version, status: 'accepted', createdAt: now, updatedAt: now,
    evidence: [{ id: 'quote', sourceType: 'chapter', sourceId: chapter.id, sourceVersionId: version, quote: chapter.content }] }, now).record
  const backup = createTestProjectBackup([novel], [])
  backup.reconstructionWorkspaces[0].canonMutations.push(record)
  const revisions = backup.novels[0].characters[0].provenance!.revisions
  return { backup, novel: backup.novels[0], record, revision: revisions[revisions.length - 1] }
}

describe.each([['renderer', validateProjectBackup], ['kernel', kernelValidate]] as const)('entity provenance backups (%s)', (_, validate) => {
  it('accepts real Canon revisions and inert history after source deletion', () => {
    const { backup, novel } = fixture()
    expect(() => validate(backup)).not.toThrow()
    novel.chapters.splice(0, 1)
    expect(() => validate(backup)).not.toThrow()
  })
  it.each([
    ['unknown field', (r: EntityRevision) => { r.changes[0].field = 'provenance' }],
    ['invalid value', (r: EntityRevision) => { r.changes.push({ field: 'status', after: 'immortal' }) }],
    ['owner mismatch', (r: EntityRevision) => { r.entityId = 'wrong-owner' }],
    ['empty history step', (r: EntityRevision) => { r.changes = [] }],
    ['invalid date', (r: EntityRevision) => { r.appliedAt = '2026-02-30T00:00:00.000Z' }],
    ['fractional offset', (r: EntityRevision) => { if (r.source.kind === 'chapter') r.source.evidence[0].startOffset = 0.5 }],
    ['empty evidence', (r: EntityRevision) => { if (r.source.kind === 'chapter') r.source.evidence = [] }],
  ] as const)('rejects %s before importing', (_label, change) => {
    const { backup, revision } = fixture()
    change(revision)
    expect(() => validate(backup)).toThrow('实体来源')
  })
  it('rejects Canon entity changes belonging to a different type or source chapter', () => {
    const { backup, record } = fixture()
    record.type = 'timeline'
    expect(() => validate(backup)).toThrow('entityChanges.type')
    record.type = 'fact'; record.chapterId = 'removed-chapter'
    expect(() => validate(backup)).toThrow('entityChanges.source')
  })
  it('rejects a known foreign-book source but preserves a missing historical source', () => {
    const { backup, revision, record } = fixture()
    const other = characterStateFixture().novel
    other.characters = []; other.chapters = [{ ...other.chapters[0], id: 'foreign-chapter' }]
    backup.novels.push(other)
    backup.reconstructionWorkspaces.push({ novelId: other.id, candidates: [], reviewFindings: [], chapterReviews: [], aiRuns: [], canonMutations: [] })
    if (revision.source.kind === 'chapter') revision.source.chapterId = 'foreign-chapter'
    expect(() => validate(backup)).toThrow('属于其他作品')
    if (revision.source.kind === 'chapter') revision.source.chapterId = 'deleted-chapter'
    record.chapterId = 'deleted-chapter'
    record.entityChanges = [JSON.parse(JSON.stringify(revision))]
    expect(() => validate(backup)).not.toThrow()
  })
  it('refuses contradictory copies of the same Canon field history', () => {
    const { backup, record } = fixture()
    record.entityChanges![0].changes[0].after = '另一份值'
    expect(() => validate(backup)).toThrow('与实体历史不一致')
  })
})
