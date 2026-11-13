import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { characterStateFixture } from '@/test/characterStateFixture'
import type { DataPanelChange } from '@/types/novel'
import type { StoryAggregate } from './storyAggregate'
import { bindDataPanelProposalSource } from './dataPanelProposalSource'
import { captureDataPanelBaseline, decideDataPanelProposals, editDataPanel, queueDataPanelAutomation } from './dataPanelTransactions'
import { buildSemanticRecords } from './semanticIndex'
import { projectDataPanelReferences, preserveDataPanelReferenceHistory } from './dataPanelReference'
import { captureStoryImpact } from './storyImpactAnalysis'
import { equipmentSnapshot } from './dataPanelEquipment'
import { buildReviewContextVersion } from './reconstructionReviewVersion'
import { createTestProjectBackup } from '@/test/projectBackupFixture'
import { parseProjectBackup } from './projectBackup'

const now = '2026-10-31T08:00:00.000Z'
let seq = 0
const id = () => 'data-ref-' + ++seq
beforeEach(() => { setActivePinia(createPinia()); seq = 0 })
function setup(automation = false) {
  const { novel } = characterStateFixture()
  const chapter = novel.chapters[1]
  chapter.content = '林澈清点背包，铜钱现有七枚。'
  novel.dataPanels = [{ id: 'pack', category: '资源', name: '背包', fields: [
    { id: 'coins', name: '铜钱', value: '2', unit: '枚', note: '', type: 'number' },
    { id: 'total', name: '折算', value: '20', unit: '', note: '', type: 'formula', formula: '铜钱 * 10', autoCalculate: true },
  ], relatedKeywords: ['背包'], createdAt: now, updatedAt: now }]
  if (automation) novel.dataPanels[0].fields[0].automationRules = [{ id: 'gain', trigger: 'per_chapter', amount: 1,
    interval: 1, enabled: true, lastEvaluatedChapterIndex: 1 }]
  const proposal: DataPanelChange = { id: id(), itemId: 'pack', fieldId: 'coins', itemName: '背包', fieldName: '铜钱',
    oldValue: '2', newValue: '7', reason: '铜钱现有七枚', chapterIndex: 1, createdAt: now, status: 'pending' }
  proposal.sourceBinding = bindDataPanelProposalSource(novel, chapter, proposal, 'chapter')
  novel.dataPanelChanges = [proposal]
  const aggregate: StoryAggregate = { novel, workspace: { candidates: [], canonMutations: [], reviewFindings: [] } }
  expect(decideDataPanelProposals(aggregate, [proposal.id], 'accept', {}, now, id)).toBe(1)
  const data = (before = 2) => buildSemanticRecords(novel, [], before).filter(row => row.sourceType === 'data_panel').map(row => row.content).join('\n')
  return { novel, chapter, proposal, aggregate, data }
}

describe('accepted data in chapter references', () => {
  it('reads the previous value before the source chapter and the accepted value after it', () => {
    const { data } = setup()
    expect(data(1)).toContain('铜钱:2枚')
    expect(data(1)).not.toContain('铜钱:7枚')
    expect(data(2)).toContain('铜钱:7枚')
  })
  it.each(['rewrite', 'delete'])('excludes an accepted value and its formula after source %s', operation => {
    const { novel, chapter, data } = setup()
    if (operation === 'rewrite') chapter.content = chapter.content.replace('七枚', '九枚')
    else novel.chapters = novel.chapters.filter(row => row.id !== chapter.id)
    expect(data()).not.toContain('铜钱:7枚')
    expect(data()).not.toContain('折算:70')
    expect(novel.dataPanels[0].fields[0].value).toBe('7')
  })
  it('honors a later author edit after the old chapter evidence becomes invalid', () => {
    const { novel, chapter, aggregate, data } = setup()
    editDataPanel(aggregate, { action: 'update', itemId: 'pack', item: { fields: novel.dataPanels[0].fields.map(field =>
      field.id === 'coins' ? { ...field, value: '11' } : field) } }, captureDataPanelBaseline(novel, 'pack'), now, id)
    chapter.content = chapter.content.replace('七枚', '九枚')
    expect(data()).toContain('铜钱:11枚')
    expect(data()).toContain('折算:110')
  })
  it('permits explicit author confirmation of unchanged values after evidence becomes stale', () => {
    const { novel, chapter, aggregate, data } = setup()
    chapter.content = chapter.content.replace('七枚', '九枚')
    const panel = novel.dataPanels[0]
    expect(projectDataPanelReferences(novel).issues.length).toBeGreaterThan(0)
    expect(editDataPanel(aggregate, { action: 'update', itemId: panel.id, item: { fields: panel.fields } },
      captureDataPanelBaseline(novel, panel.id), now, id).changed).toBe(true)
    expect(data()).toContain('铜钱:7枚')
    expect(data()).toContain('折算:70')
    expect(projectDataPanelReferences(novel).issues).toEqual([])
    const report = aggregate.workspace.impactReports!.slice(-1)[0]
    expect(report.afterVersion).not.toBe(report.beforeVersion)
  })
  it('versions a change of chapter attribution even when the current value stays equal', () => {
    const { novel, aggregate } = setup()
    const panel = novel.dataPanels[0], revision = panel.referenceHistory!.revisions[0]
    const before = captureStoryImpact(novel, aggregate.workspace).version
    expect(projectDataPanelReferences(novel, 1).items[0].fields[0].value).toBe('2')
    revision.source = { kind: 'author' }
    expect(panel.fields[0].value).toBe('7')
    expect(projectDataPanelReferences(novel, 1).items[0].fields[0].value).toBe('7')
    expect(captureStoryImpact(novel, aggregate.workspace).version).not.toBe(before)
  })
  it('ignores runtime reservations and provenance display metadata in impact versions', () => {
    const { novel, aggregate } = setup(true)
    const before = captureStoryImpact(novel, aggregate.workspace).version
    const panel = novel.dataPanels[0], revision = panel.referenceHistory!.revisions[0]
    panel.updatedAt = '2026-10-31T09:00:00.000Z'
    panel.versions = [{ id: 'display', label: '查看记录', savedAt: panel.updatedAt, snapshot: '{}' }]
    revision.id = 'another-display-id'; revision.appliedAt = panel.updatedAt
    panel.fields[0].automationRules![0].lastEvaluatedChapterIndex = 9
    expect(captureStoryImpact(novel, aggregate.workspace).version).toBe(before)
  })
  it('tracks legacy uncertainty and preserves its impact version across proposal cleanup', () => {
    const { novel, aggregate } = setup()
    delete novel.dataPanels[0].referenceHistory
    const accepted = novel.dataPanelChanges
    novel.dataPanelChanges = []
    const withoutEvidence = captureStoryImpact(novel, aggregate.workspace).version
    novel.dataPanelChanges = accepted
    const unverified = captureStoryImpact(novel, aggregate.workspace).version
    expect(unverified).not.toBe(withoutEvidence)
    preserveDataPanelReferenceHistory(novel)
    novel.dataPanelChanges = []
    expect(captureStoryImpact(novel, aggregate.workspace).version).toBe(unverified)
  })
  it('does not invalidate an earlier chapter for a later accepted value or its source rewrite', () => {
    const { novel, chapter } = setup()
    const earlier = novel.chapters[0], before = buildReviewContextVersion(novel, earlier)
    chapter.content = chapter.content.replace('七枚', '九枚')
    expect(buildReviewContextVersion(novel, earlier)).toBe(before)
  })
  it('keeps legacy accepted values for inspection and only trusts an explicit author reconfirmation', () => {
    const { novel, aggregate, data } = setup()
    const panel = novel.dataPanels[0]
    delete panel.referenceHistory
    expect(data()).not.toContain('铜钱:7枚')
    expect(panel.fields[0].value).toBe('7')
    expect(projectDataPanelReferences(novel).issues.some(issue => issue.includes('缺少可验证来源'))).toBe(true)
    editDataPanel(aggregate, { action: 'update', itemId: panel.id, item: { fields: panel.fields } },
      captureDataPanelBaseline(novel, panel.id), now, id)
    const reloaded = parseProjectBackup(JSON.stringify(createTestProjectBackup([novel], []))).novels[0]
    expect(projectDataPanelReferences(reloaded).issues).toEqual([])
    expect(projectDataPanelReferences(reloaded).items[0].fields[0].value).toBe('7')
    expect(reloaded.dataPanelChanges[0].status).toBe('accepted')
  })
  it('does not turn unknown equipment ownership into an asserted stored state', () => {
    const { novel, chapter, aggregate } = setup()
    novel.dataPanels.push({ id: 'blade', name: '铁剑', category: '装备', fields: [], relatedKeywords: [], createdAt: now, updatedAt: now })
    chapter.content = '林澈装备了铁剑。'
    const proposal: DataPanelChange = { id: id(), itemId: 'blade', fieldId: 'equipment', itemName: '铁剑', fieldName: '装备状态',
      oldValue: equipmentSnapshot(novel.dataPanels[1], novel.dataPanels), newValue: '林澈装备', reason: '林澈装备了铁剑。',
      mutation: { kind: 'equipment', ownerItemName: '林澈', state: 'equipped' }, chapterIndex: 1, status: 'pending', createdAt: now }
    proposal.sourceBinding = bindDataPanelProposalSource(novel, chapter, proposal, 'chapter')
    novel.dataPanelChanges.push(proposal)
    expect(decideDataPanelProposals(aggregate, [proposal.id], 'accept', {}, now, id)).toBe(1)
    chapter.content = '林澈丢失了铁剑。'
    const projection = projectDataPanelReferences(novel, 2)
    const blade = projection.items.find(item => item.id === 'blade')!
    expect(equipmentSnapshot(blade, projection.items)).toBe('持有人或装备状态待核对')
    expect(projection.items.some(item => item.name === '林澈')).toBe(false)
  })
  it('invalidates a later calculation when its accepted input loses chapter evidence', () => {
    const { novel, chapter, aggregate } = setup(true)
    const next = novel.chapters[2]
    expect(queueDataPanelAutomation(novel, 2, next.content, now, id).added).toBe(1)
    expect(decideDataPanelProposals(aggregate, [novel.dataPanelChanges[0].id], 'accept', {}, now, id)).toBe(1)
    expect(projectDataPanelReferences(novel).items[0].fields[0].value).toBe('8')
    chapter.content = chapter.content.replace('七枚', '九枚')
    const projection = projectDataPanelReferences(novel)
    expect(projection.items[0].fields).toEqual([])
    expect(projection.issues.some(issue => issue.includes('自动推算'))).toBe(true)
  })
  it.each(['foreign', 'duplicate', 'field', 'date', 'key'])('rejects invalid reference history in backups (%s)', damage => {
    const { novel } = setup()
    const backup = createTestProjectBackup([novel], []), revisions = backup.novels[0].dataPanels[0].referenceHistory!.revisions
    if (damage === 'foreign') Object.assign(revisions[0].source, { novelId: 'other-book' })
    if (damage === 'duplicate') revisions.push(revisions[0])
    if (damage === 'field') revisions[0].changes.find(change => change.key === 'field:coins')!.key = 'field:wrong'
    if (damage === 'date') revisions[0].appliedAt = 'not-a-date'
    if (damage === 'key') revisions[0].changes[0].key = 'unknown-key'
    expect(() => parseProjectBackup(JSON.stringify(backup))).toThrow()
  })
})
