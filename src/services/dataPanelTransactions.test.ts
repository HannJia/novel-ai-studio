import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useNovelStore } from '@/stores/novel'
import type { DataPanelChange, DataPanelField } from '@/types/novel'
import type { StoryAggregate } from './storyAggregate'
import { bindAuthorDataPanelProposalSource, bindDataPanelProposalSource, dataPanelProposalSourceIsCurrent } from './dataPanelProposalSource'
import { captureDataClockBaseline, captureDataPanelBaseline, confirmDataChapterTime, decideDataPanelProposals, editDataPanel, editDataStoryClock, queueDataPanelAutomation } from './dataPanelTransactions'
import { STORY_CLOCK_SOURCE } from './dataPanel'
import { equipmentSnapshot } from './dataPanelEquipment'
import { buildReviewContextVersion } from './reconstructionReviewVersion'
import { createTestProjectBackup } from '@/test/projectBackupFixture'
import { parseProjectBackup } from './projectBackup'
import { setStoryTimeOrigin } from '@/types/storyTime'
import { recordStoryTime } from './storyTime'

const now = '2026-10-31T00:00:00.000Z'
let sequence = 0
const id = () => 'data-test-' + ++sequence
function setup() {
  const store = useNovelStore()
  const novel = store.addNovel({ genre: 'fantasy', subGenre: 'xuanhuan', tags: [], targetWordCountMin: 20, targetWordCountMax: 30,
    writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() })
  const chapter = store.addChapter(novel.id, { content: '林澈拾起两枚铜钱，放入背包。', title: '计划中的灵稻' })!
  setStoryTimeOrigin(novel, 0, '故事起点', now, () => 'story-origin-' + novel.id)
  novel.dataPanels = [{ id: 'pack', name: '背包', category: '自定义', fields: [{ id: 'coins', name: '铜钱', value: '0', unit: '枚', note: '', type: 'number' }],
    relatedKeywords: [], createdAt: now, updatedAt: now }]
  const aggregate: StoryAggregate = { novel, workspace: { candidates: [], canonMutations: [], reviewFindings: [] } }
  const proposal: DataPanelChange = { id: id(), itemId: 'pack', itemName: '背包', fieldId: 'coins', fieldName: '铜钱', oldValue: '0', newValue: '2',
    reason: '拾起两枚铜钱', chapterIndex: chapter.chapterIndex, createdAt: now, status: 'pending' }
  proposal.sourceBinding = bindDataPanelProposalSource(novel, chapter, proposal, 'chapter')
  novel.dataPanelChanges.push(proposal)
  return { novel, chapter, proposal, aggregate, field: novel.dataPanels[0].fields[0] }
}

beforeEach(() => { setActivePinia(createPinia()); sequence = 0 })

describe('data proposal sources and draft transactions', () => {
  it('protects author suggestions against foreign ownership and changed field meaning', () => {
    const { novel, field, proposal } = setup()
    proposal.sourceBinding = bindAuthorDataPanelProposalSource(novel, proposal)
    expect(dataPanelProposalSourceIsCurrent(novel, proposal)).toBe(true)
    expect(dataPanelProposalSourceIsCurrent({ ...novel, id: 'other' }, proposal)).toBe(false)
    field.note = '现在表示含装备的总值'
    expect(dataPanelProposalSourceIsCurrent(novel, proposal)).toBe(false)
  })

  it('honors field IDs ahead of an earlier same-name field and refuses ambiguous fallback', () => {
    const { novel, proposal, aggregate, field } = setup()
    const other = { ...field, id: 'other-coins' }
    novel.dataPanels[0].fields.unshift(other)
    expect(dataPanelProposalSourceIsCurrent(novel, proposal)).toBe(true)
    expect(decideDataPanelProposals(aggregate, [proposal.id], 'accept', {}, now, id)).toBe(1)
    expect(other.value).toBe('0'); expect(field.value).toBe('2')
    const ambiguous = { ...proposal, id: id(), status: 'pending' as const, fieldId: 'missing', oldValue: '0' }
    ambiguous.sourceBinding = bindAuthorDataPanelProposalSource(novel, ambiguous)
    novel.dataPanelChanges.push(ambiguous)
    expect(decideDataPanelProposals(aggregate, [ambiguous.id], 'accept', {}, now, id)).toBe(0)
  })

  it('settles elapsed intervals from confirmed chapter times and carries the remainder forward', () => {
    const { novel, chapter, aggregate, field } = setup()
    novel.dataPanelChanges = []; chapter.status = 'completed'
    const rule = { id: 'elapsed', trigger: 'elapsed_days' as const, sourceFieldName: STORY_CLOCK_SOURCE, amount: 1, interval: 3, enabled: true }
    editDataPanel(aggregate, { action: 'update', itemId: 'pack', item: { fields: [{ ...field, automationRules: [rule] }] } },
      captureDataPanelBaseline(novel, 'pack'), now, id)
    const first = confirmDataChapterTime(aggregate, { chapterId: chapter.id, chapterIndex: chapter.chapterIndex, content: chapter.content,
      mode: 'absolute', startDay: 0, endDay: 4, label: '第四日', source: 'author' }, captureDataClockBaseline(novel), now, id)
    expect(first.changed).toBe(true)
    expect(chapter.status).toBe('writing')
    expect(decideDataPanelProposals(aggregate, [novel.dataPanelChanges[0].id], 'accept', {}, now, id)).toBe(1)
    expect(novel.dataPanels[0].fields[0].value).toBe('1')
    expect(novel.dataPanels[0].fields[0].automationRules![0].lastSourceValue).toBe(3)
    const next = useNovelStore().addChapter(novel.id, { content: '林澈穿过石桥。' })!
    const second = confirmDataChapterTime(aggregate, { chapterId: next.id, chapterIndex: next.chapterIndex, content: next.content,
      mode: 'relative', elapsedDays: 3, label: '第七日', source: 'author' }, captureDataClockBaseline(novel), now, id)
    expect(second.changed).toBe(true)
    expect(novel.dataPanelChanges[0].status).toBe('pending')
    expect(novel.dataPanelChanges[0].newValue).toBe('2')
    expect(decideDataPanelProposals(aggregate, [novel.dataPanelChanges[0].id], 'accept', {}, now, id)).toBe(1)
    expect(novel.dataPanels[0].fields[0].value).toBe('2')
    expect(novel.dataPanels[0].fields[0].automationRules![0].lastSourceValue).toBe(6)
  })

  it('distinguishes no-op success from missing targets and does not append impact or history', () => {
    const { novel, aggregate } = setup(), panel = novel.dataPanels[0]
    expect(editDataPanel(aggregate, { action: 'update', itemId: panel.id, item: { name: panel.name } }, captureDataPanelBaseline(novel, panel.id), now, id))
      .toEqual({ item: panel, changed: false })
    expect(editDataStoryClock(aggregate, novel.storyClock!.currentDay, novel.storyClock!.label, captureDataClockBaseline(novel), now, id))
      .toEqual({ clock: novel.storyClock, changed: false })
    expect(aggregate.workspace.impactReports || []).toEqual([])
    expect(panel.versions || []).toEqual([])
  })

  it('binds the displayed clock label but ignores automation bookkeeping in review signatures', () => {
    const { novel, chapter, field } = setup()
    recordStoryTime(novel, { chapterId: chapter.id, chapterIndex: chapter.chapterIndex, content: chapter.content, mode: 'absolute',
      startDay: 0, endDay: 0, label: '故事起点', source: 'author' }, now, id)
    field.automationRules = [{ id: 'mention', trigger: 'on_mention', amount: 1, interval: 1, enabled: true }]
    const before = buildReviewContextVersion(novel, chapter)
    field.automationRules[0].appliedCount = 8; field.automationRules[0].pendingChapterIndex = 0
    expect(buildReviewContextVersion(novel, chapter)).toBe(before)
    const existing = novel.storyClock!.history!.find(row => row.chapterId === chapter.id)!
    recordStoryTime(novel, { chapterId: chapter.id, chapterIndex: chapter.chapterIndex, content: chapter.content, mode: 'absolute',
      startDay: 0, endDay: 0, label: '寒冬的第一夜', source: 'author', replace: true, expectedRecordId: existing.id }, now, id)
    expect(buildReviewContextVersion(novel, chapter)).not.toBe(before)
  })

  it('validates provenance and decision timestamps when importing backups', () => {
    const { novel, proposal } = setup()
    const backup = () => JSON.stringify(createTestProjectBackup([novel], []))
    expect(parseProjectBackup(backup()).novels[0].dataPanelChanges[0].sourceBinding).toEqual(proposal.sourceBinding)
    proposal.sourceBinding!.novelId = 'foreign'
    expect(() => parseProjectBackup(backup())).toThrow('其他作品')
    proposal.sourceBinding!.novelId = novel.id; proposal.updatedAt = 'invalid'
    expect(() => parseProjectBackup(backup())).toThrow('updatedAt')
  })
  it('rejects same-length rewritten prose, foreign provenance, unbound legacy proposals and renamed targets', () => {
    const { novel, chapter, proposal, field } = setup()
    expect(dataPanelProposalSourceIsCurrent(novel, proposal)).toBe(true)
    const content = chapter.content
    chapter.content = chapter.content.replace('两枚', '三枚')
    expect(dataPanelProposalSourceIsCurrent(novel, proposal)).toBe(false)
    chapter.content = content; field.name = '银钱'
    expect(dataPanelProposalSourceIsCurrent(novel, proposal)).toBe(false)
    field.name = '铜钱'
    expect(dataPanelProposalSourceIsCurrent({ ...novel, id: 'foreign' }, proposal)).toBe(false)
    expect(dataPanelProposalSourceIsCurrent(novel, { ...proposal, sourceBinding: undefined })).toBe(false)
  })

  it('requires a unique original quotation and preserves its original whitespace', () => {
    const { novel, chapter, proposal } = setup()
    chapter.content = '林澈拾起两枚\n 铜钱，放入背包。'
    const binding = bindDataPanelProposalSource(novel, chapter, proposal, 'chapter')
    expect(binding).toMatchObject({ quote: '拾起两枚\n 铜钱' })
    chapter.content += chapter.content
    expect(() => bindDataPanelProposalSource(novel, chapter, proposal, 'chapter')).toThrow('唯一')
  })

  it('accepts exactly once, stores history and invalidates written reviews with the decision', () => {
    const { novel, chapter, proposal, aggregate, field } = setup()
    chapter.contentReviewSignature = 'old-review'; chapter.status = 'finalized'
    expect(decideDataPanelProposals(aggregate, [proposal.id, proposal.id], 'accept', {}, now, id)).toBe(1)
    expect(field.value).toBe('2'); expect(proposal.status).toBe('accepted')
    expect(chapter.contentReviewSignature).toBe(''); expect(chapter.status).toBe('writing')
    expect(novel.dataPanels[0].versions).toHaveLength(1)
    expect(aggregate.workspace.impactReports).toHaveLength(1)
    expect(decideDataPanelProposals(aggregate, [proposal.id], 'accept', {}, now, id)).toBe(0)
  })

  it('prevents plan-only mentions and refuses a mismatching automation body', () => {
    const { novel, chapter, field } = setup()
    novel.dataPanels[0].name = '灵稻'
    field.automationRules = [{ id: 'mention', trigger: 'on_mention', amount: 1, interval: 1, enabled: true }]
    expect(queueDataPanelAutomation(novel, chapter.chapterIndex, chapter.content, now, id).added).toBe(0)
    expect(() => queueDataPanelAutomation(novel, chapter.chapterIndex, chapter.title, now, id)).toThrow('正文已变化')
  })

  it('independent fields remain confirmable after another suggestion is accepted', () => {
    const { novel, chapter, aggregate, field } = setup()
    novel.dataPanelChanges = []
    const second: DataPanelField = { ...field, id: 'silver', name: '银钱' }
    novel.dataPanels[0].fields.push(second)
    for (const entry of [field, second]) entry.automationRules = [{ id: entry.id + '-rule', trigger: 'per_chapter', amount: 1, schedule: [1, 10], interval: 1, enabled: true }]
    expect(queueDataPanelAutomation(novel, chapter.chapterIndex, chapter.content, now, id).added).toBe(2)
    const first = novel.dataPanelChanges[0], next = novel.dataPanelChanges[1]
    expect(decideDataPanelProposals(aggregate, [first.id], 'accept', {}, now, id)).toBe(1)
    expect(dataPanelProposalSourceIsCurrent(novel, next)).toBe(true)
    expect(decideDataPanelProposals(aggregate, [next.id], 'accept', {}, now, id)).toBe(1)
    expect(novel.dataPanels[0].fields.map(row => row.value)).toEqual(['1', '1'])
    expect(novel.dataPanels[0].fields.map(row => row.automationRules![0].appliedCount)).toEqual([1, 1])
    const nextChapter = useNovelStore().addChapter(novel.id, { content: '林澈再次数钱。' })!
    expect(queueDataPanelAutomation(novel, nextChapter.chapterIndex, nextChapter.content, now, id).added).toBe(2)
    expect(novel.dataPanelChanges.slice(0, 2).map(row => row.newValue)).toEqual(['11', '11'])
  })

  it('leaves a rule pending when an earlier decision changes its source field within the batch', () => {
    const { novel, chapter, aggregate, field } = setup()
    novel.dataPanelChanges = []
    const days: DataPanelField = { id: 'days', name: '天数', value: '6', unit: '天', note: '', type: 'days' }
    novel.dataPanels[0].fields.push(days)
    const rule = { id: 'growth', trigger: 'elapsed_days' as const, sourceFieldName: '天数', amount: 1, interval: 3, lastSourceValue: 0, enabled: true }
    field.automationRules = [rule]
    queueDataPanelAutomation(novel, chapter.chapterIndex, chapter.content, now, id)
    const automatic = novel.dataPanelChanges[0]
    const manual: DataPanelChange = { ...automatic, id: id(), fieldId: days.id, fieldName: days.name, oldValue: '6', newValue: '9', createdAt: '2026-10-30T00:00:00.000Z' }
    manual.sourceBinding = bindAuthorDataPanelProposalSource(novel, manual)
    novel.dataPanelChanges.push(manual)
    expect(decideDataPanelProposals(aggregate, [automatic.id, manual.id], 'accept', {}, now, id)).toBe(1)
    expect(automatic.status).toBe('pending'); expect(field.value).toBe('0'); expect(rule.lastSourceValue).toBe(0)
    expect(queueDataPanelAutomation(novel, chapter.chapterIndex, chapter.content, now, id).added).toBe(1)
    expect(novel.dataPanelChanges[0].newValue).toBe('3')
    const replacement = novel.dataPanelChanges[0]
    expect(decideDataPanelProposals(aggregate, [automatic.id], 'reject', {}, now, id)).toBe(1)
    expect(field.automationRules![0].pendingChapterIndex).toBe(chapter.chapterIndex)
    expect(rule.lastSourceValue).toBe(0)
    expect(decideDataPanelProposals(aggregate, [replacement.id], 'accept', {}, now, id)).toBe(1)
    expect(field.value).toBe('3'); expect(rule.lastSourceValue).toBe(9)
  })

  it.each(['author', 'chapter'] as const)('rechecks a %s field proposal after ownership changes earlier in the batch', kind => {
    const { novel, chapter, aggregate, proposal, field } = setup()
    const panel = novel.dataPanels[0]
    panel.category = '装备'; panel.ownerItemId = 'owner-a'; panel.equipmentState = 'stored'
    novel.dataPanels.push(...['林澈', '苏禾'].map((name, index) => ({ id: index ? 'owner-b' : 'owner-a', name, category: '角色' as const,
      fields: [], relatedKeywords: [], createdAt: now, updatedAt: now })))
    const transfer: DataPanelChange = { ...proposal, id: id(), fieldId: 'equipment', fieldName: '持有状态',
      oldValue: equipmentSnapshot(panel, novel.dataPanels), newValue: '苏禾装备',
      mutation: { kind: 'equipment', ownerItemName: '苏禾', state: 'equipped' }, createdAt: '2026-10-30T00:00:00.000Z' }
    for (const change of [transfer, proposal]) change.sourceBinding = kind === 'author'
      ? bindAuthorDataPanelProposalSource(novel, change) : bindDataPanelProposalSource(novel, chapter, change, 'chapter')
    novel.dataPanelChanges.push(transfer)
    expect(decideDataPanelProposals(aggregate, [proposal.id, transfer.id], 'accept', {}, now, id)).toBe(1)
    expect(panel.ownerItemId).toBe('owner-b'); expect(transfer.status).toBe('accepted')
    expect(field.value).toBe('0'); expect(proposal.status).toBe('pending')
    expect(dataPanelProposalSourceIsCurrent(novel, proposal)).toBe(false)
  })

  it('reuses a pending calculation when its reservation is lost, without duplicate proposals', () => {
    const { novel, chapter, aggregate, field } = setup()
    novel.dataPanelChanges = []
    field.automationRules = [{ id: 'per-chapter', trigger: 'per_chapter', amount: 1, interval: 1, enabled: true }]
    queueDataPanelAutomation(novel, chapter.chapterIndex, chapter.content, now, id)
    const proposal = novel.dataPanelChanges[0]
    delete field.automationRules[0].pendingChapterIndex
    expect(decideDataPanelProposals(aggregate, [proposal.id], 'accept', {}, now, id)).toBe(0)
    expect(queueDataPanelAutomation(novel, chapter.chapterIndex, chapter.content, now, id)).toEqual({ changed: true, added: 0 })
    expect(novel.dataPanelChanges).toHaveLength(1)
    expect(decideDataPanelProposals(aggregate, [proposal.id], 'accept', {}, now, id)).toBe(1)
    expect(field.automationRules[0].appliedCount).toBe(1)
  })

  it.each(['equipment', 'create'] as const)('rejects a same-name replacement of an existing %s owner', kind => {
    const { novel, chapter, proposal } = setup()
    novel.dataPanels.push({ id: 'owner-a', name: '林澈', category: '角色', fields: [], relatedKeywords: [], createdAt: now, updatedAt: now })
    proposal.mutation = kind === 'equipment' ? { kind, ownerItemName: '林澈', state: 'equipped' }
      : { kind, item: { name: '铁剑', category: '装备', fields: [], relatedKeywords: [], ownerItemName: '林澈' } }
    proposal.sourceBinding = bindDataPanelProposalSource(novel, chapter, proposal, 'chapter')
    expect(proposal.sourceBinding.ownerTarget).toEqual({ name: '林澈', itemId: 'owner-a' })
    proposal.sourceBinding.ownerTarget = { itemId: 'owner-a', name: '林澈' }
    expect(dataPanelProposalSourceIsCurrent(novel, proposal)).toBe(true)
    novel.dataPanels[1].id = 'owner-b'
    expect(dataPanelProposalSourceIsCurrent(novel, proposal)).toBe(false)
  })

  it('supports an explicit owner creation and equipment creation in the same accepted batch', () => {
    const { novel, chapter, proposal, aggregate } = setup()
    const owner: DataPanelChange = { ...proposal, id: 'owner-candidate', itemId: 'new:owner', oldValue: '未记录',
      mutation: { kind: 'create', item: { name: '林澈', category: '角色', fields: [], relatedKeywords: [] } } }
    const equipment: DataPanelChange = { ...proposal, id: 'equipment-candidate', itemId: 'new:sword', oldValue: '未记录',
      mutation: { kind: 'create', item: { name: '铁剑', category: '装备', fields: [], relatedKeywords: [], ownerItemName: '林澈' } } }
    owner.sourceBinding = bindDataPanelProposalSource(novel, chapter, owner, 'chapter')
    equipment.sourceBinding = bindDataPanelProposalSource(novel, chapter, equipment, 'chapter')
    expect(equipment.sourceBinding.ownerTarget).toEqual({ name: '林澈', itemId: null })
    novel.dataPanelChanges = [equipment, owner]
    expect(decideDataPanelProposals(aggregate, [equipment.id, owner.id], 'accept', {}, now, id)).toBe(2)
    expect(novel.dataPanels.find(row => row.name === '铁剑')!.ownerItemId).toBe(novel.dataPanels.find(row => row.name === '林澈')!.id)
  })

  it('ignoring stale automation cannot consume a new rule, and permits a new calculation', () => {
    const { novel, chapter, aggregate, field } = setup()
    novel.dataPanelChanges = []
    const rule = { id: 'daily', trigger: 'per_chapter' as const, amount: 1, interval: 1, enabled: true, appliedCount: 0 }
    field.automationRules = [rule]
    queueDataPanelAutomation(novel, chapter.chapterIndex, chapter.content, now, id)
    const previous = novel.dataPanelChanges[0]
    rule.amount = 4
    expect(decideDataPanelProposals(aggregate, [previous.id], 'reject', {}, now, id)).toBe(1)
    expect(rule.appliedCount).toBe(0)
    expect(queueDataPanelAutomation(novel, chapter.chapterIndex, chapter.content, now, id).added).toBe(1)
    expect(novel.dataPanelChanges[0].newValue).toBe('4')
  })

  it.each(['accept', 'reject'] as const)('advances a leading zero schedule only after the author chooses %s', decision => {
    const { novel, chapter, aggregate, field } = setup()
    novel.dataPanelChanges = []
    field.automationRules = [{ id: 'zero-first', trigger: 'per_chapter', amount: 0, schedule: [0, 2], interval: 1, enabled: true, appliedCount: 0 }]
    const rule = field.automationRules[0]
    expect(queueDataPanelAutomation(novel, chapter.chapterIndex, chapter.content, now, id).added).toBe(1)
    const proposal = novel.dataPanelChanges[0]
    expect(proposal).toMatchObject({ oldValue: '0', newValue: '0', status: 'pending' })
    expect(field.value).toBe('0'); expect(rule.appliedCount).toBe(0)
    expect(queueDataPanelAutomation(novel, chapter.chapterIndex, chapter.content, now, id).added).toBe(0)
    expect(decideDataPanelProposals(aggregate, [proposal.id], decision, {}, now, id)).toBe(1)
    expect(field.value).toBe('0'); expect(rule.appliedCount).toBe(1)
    expect(decideDataPanelProposals(aggregate, [proposal.id], decision, {}, now, id)).toBe(0)
    expect(queueDataPanelAutomation(novel, chapter.chapterIndex, chapter.content, now, id).added).toBe(0)
    const next = useNovelStore().addChapter(novel.id, { content: '林澈再次清点背包。' })!
    expect(queueDataPanelAutomation(novel, next.chapterIndex, next.content, now, id).added).toBe(1)
    expect(novel.dataPanelChanges[0].newValue).toBe('2')
  })

  it('settles both opposing rules when their first net change is zero', () => {
    const { novel, chapter, aggregate, field } = setup()
    novel.dataPanelChanges = []
    field.automationRules = [
      { id: 'gain', trigger: 'per_chapter', amount: 1, schedule: [1, 2], interval: 1, enabled: true },
      { id: 'loss', trigger: 'per_chapter', amount: -1, schedule: [-1, 0], interval: 1, enabled: true },
    ]
    expect(queueDataPanelAutomation(novel, chapter.chapterIndex, chapter.content, now, id).added).toBe(1)
    expect(novel.dataPanelChanges[0].newValue).toBe('0')
    expect(decideDataPanelProposals(aggregate, [novel.dataPanelChanges[0].id], 'accept', {}, now, id)).toBe(1)
    expect(field.automationRules.map(rule => rule.appliedCount)).toEqual([1, 1])
    const next = useNovelStore().addChapter(novel.id, { content: '林澈再次清点背包。' })!
    expect(queueDataPanelAutomation(novel, next.chapterIndex, next.content, now, id).added).toBe(1)
    expect(novel.dataPanelChanges[0].newValue).toBe('2')
  })

  it('consumes all skipped chapter steps when their net change is zero', () => {
    const { novel, aggregate, field } = setup()
    novel.dataPanelChanges = []
    useNovelStore().addChapter(novel.id, { content: '林澈跨过石桥。' })
    const chapter = useNovelStore().addChapter(novel.id, { content: '林澈抵达城门。' })!
    field.automationRules = [{ id: 'skip', trigger: 'per_chapter', amount: 1, schedule: [1, -1, 3], interval: 1, enabled: true, lastEvaluatedChapterIndex: 0 }]
    expect(queueDataPanelAutomation(novel, chapter.chapterIndex, chapter.content, now, id).added).toBe(1)
    expect(novel.dataPanelChanges[0].newValue).toBe('0')
    expect(decideDataPanelProposals(aggregate, [novel.dataPanelChanges[0].id], 'accept', {}, now, id)).toBe(1)
    expect(field.automationRules[0].appliedCount).toBe(2)
    const next = useNovelStore().addChapter(novel.id, { content: '林澈检查城门。' })!
    expect(queueDataPanelAutomation(novel, next.chapterIndex, next.content, now, id).added).toBe(1)
    expect(novel.dataPanelChanges[0].newValue).toBe('3')
  })

  it('preserves partial elapsed intervals and consumes the actual multi-chapter schedule count', () => {
    const { novel, aggregate, field } = setup()
    novel.dataPanelChanges = []
    useNovelStore().addChapter(novel.id, { content: '林澈穿过小巷。' })
    useNovelStore().addChapter(novel.id, { content: '林澈进入旧城。' })
    useNovelStore().addChapter(novel.id, { content: '林澈抵达石门。' })
    const chapter3 = novel.chapters[3]
    const rule = { id: 'growth', trigger: 'per_chapter' as const, amount: 1, schedule: [1, 2, 3, 4], interval: 1, enabled: true, lastEvaluatedChapterIndex: 0, appliedCount: 0 }
    field.automationRules = [rule]
    queueDataPanelAutomation(novel, chapter3.chapterIndex, chapter3.content, now, id)
    expect(novel.dataPanelChanges[0].newValue).toBe('6')
    decideDataPanelProposals(aggregate, [novel.dataPanelChanges[0].id], 'accept', {}, now, id)
    expect(rule.appliedCount).toBe(3)
    recordStoryTime(novel, { chapterId: chapter3.id, chapterIndex: chapter3.chapterIndex, content: chapter3.content,
      mode: 'absolute', startDay: 0, endDay: 4, label: '第四日', source: 'author' }, now, id)
    const days = { id: 'days', trigger: 'elapsed_days' as const, amount: 1, interval: 3, sourceFieldName: STORY_CLOCK_SOURCE, enabled: true }
    editDataPanel(aggregate, { action: 'update', itemId: 'pack', item: { fields: [
      { ...novel.dataPanels[0].fields[0], automationRules: [days] },
    ] } }, captureDataPanelBaseline(novel, 'pack'), now, id)
    expect(queueDataPanelAutomation(novel, chapter3.chapterIndex, chapter3.content, now, id).added).toBe(1)
    decideDataPanelProposals(aggregate, [novel.dataPanelChanges[0].id], 'accept', {}, now, id)
    expect(novel.dataPanels[0].fields[0].automationRules![0].lastSourceValue).toBe(3)
  })

  it('rejects stale manual edit baselines and keeps proposal history when deleting a target', () => {
    const { novel, aggregate, field, proposal } = setup()
    const baseline = captureDataPanelBaseline(novel, 'pack')
    field.value = '7'
    expect(() => editDataPanel(aggregate, { action: 'update', itemId: 'pack', item: { name: '旧表单' } }, baseline, now, id)).toThrow('已变化')
    editDataPanel(aggregate, { action: 'delete', itemId: 'pack' }, captureDataPanelBaseline(novel, 'pack'), now, id)
    expect(novel.dataPanels).toHaveLength(0)
    expect(novel.dataPanelChanges).toEqual([proposal])
  })
})
