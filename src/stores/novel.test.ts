import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCurrentChapterSummary, getChapterSummaryStatus } from '@/services/derivedSources'
import { createPinia, setActivePinia } from 'pinia'
import { useNovelStore } from '@/stores/novel'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { bindStoryProposalSource } from '@/services/storyProposalSource'
import * as storyAggregate from '@/services/storyAggregate'


describe('chapter deletion transactions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(storyAggregate, 'readStoryAggregate').mockResolvedValue({ novel: null, workspace: {
      candidates: [], reviewFindings: [], canonMutations: [], chapterReviews: [], aiRuns: [],
    } })
    vi.spyOn(storyAggregate, 'saveStoryAggregate').mockResolvedValue()
  })
  afterEach(() => vi.restoreAllMocks())

  function book() {
    const store = useNovelStore()
    const novel = store.addNovel({ genre: 'fantasy', subGenre: 'xuanhuan', tags: [], targetWordCountMin: 20, targetWordCountMax: 30,
      writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() })
    const first = store.addChapter(novel.id, { title: '合成第一章', content: '甲推开城门。' })!
    const second = store.addChapter(novel.id, { title: '合成第二章', content: '乙离开渡口。' })!
    return { store, novel, first, second }
  }

  it('does not publish deletion until the aggregate is saved and rolls back a failure', async () => {
    const { store, novel, first } = book()
    const before = JSON.stringify(novel)
    let rejectSave!: (error: Error) => void
    vi.mocked(storyAggregate.saveStoryAggregate).mockImplementation(() => new Promise((_, reject) => { rejectSave = reject }))
    const pending = store.deleteChapter(novel.id, first.id)
    const outcome = expect(pending).rejects.toThrow('synthetic disk failure')
    expect(JSON.stringify(novel)).toBe(before)
    await vi.waitFor(() => expect(rejectSave).toBeTypeOf('function'))
    expect(JSON.stringify(novel)).toBe(before)
    rejectSave(new Error('synthetic disk failure'))
    await outcome
    expect(JSON.stringify(novel)).toBe(before)
    expect(useReconstructionWorkspaceStore().getImpactReports(novel.id)).toHaveLength(0)
  })

  it('explicitly refuses a locked deletion and an all-or-nothing clear', async () => {
    const { store, novel, first } = book()
    first.status = 'locked'
    await expect(store.deleteChapter(novel.id, first.id)).rejects.toThrow('锁定')
    await expect(store.clearChapters(novel.id)).rejects.toThrow('锁定')
    expect(novel.chapters).toHaveLength(2)
    expect(storyAggregate.saveStoryAggregate).not.toHaveBeenCalled()
  })

  it('uses an opening baseline and refuses a changed target before saving', async () => {
    const { store, novel, first } = book()
    const baseline = store.captureChapterDeletionBaseline(novel.id, first.id)
    store.updateChapter(novel.id, first.id, { content: '甲没有推开城门。' })
    await expect(store.deleteChapter(novel.id, first.id, baseline)).rejects.toThrow('变化')
    expect(novel.chapters).toHaveLength(2)
    expect(storyAggregate.saveStoryAggregate).not.toHaveBeenCalled()
  })

  it('returns false for duplicate and empty operations without another save', async () => {
    const { store, novel, first } = book()
    expect(await store.deleteChapter(novel.id, first.id)).toBe(true)
    expect(await store.deleteChapter(novel.id, first.id)).toBe(false)
    expect(storyAggregate.saveStoryAggregate).toHaveBeenCalledTimes(1)
    expect(await store.clearChapters(novel.id)).toBe(true)
    expect(await store.clearChapters(novel.id)).toBe(false)
    expect(storyAggregate.saveStoryAggregate).toHaveBeenCalledTimes(2)
  })
})

describe('novel store data panel integration', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => vi.restoreAllMocks())

  function createBook(title: string) {
    const store = useNovelStore()
    const novel = store.addNovel({
      genre: 'fantasy', subGenre: 'xuanhuan', tags: [], targetWordCountMin: 20, targetWordCountMax: 30,
      writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings(),
    })
    store.updateTitle(novel.id, title)
    return novel
  }

  function mockStoryPersistence() {
    vi.spyOn(storyAggregate, 'readStoryAggregate').mockResolvedValue({ novel: null, workspace: {
      candidates: [], reviewFindings: [], canonMutations: [], chapterReviews: [], aiRuns: [],
    } })
    vi.spyOn(storyAggregate, 'saveStoryAggregate').mockResolvedValue(undefined)
  }

  it('keeps each book writing mode independent', () => {
    const store = useNovelStore()
    const first = createBook('AI书')
    const second = createBook('人工书')
    store.setWritingMode(first.id, 'ai')
    store.setWritingMode(second.id, 'manual')
    expect(first.writingMode).toBe('ai')
    expect(second.writingMode).toBe('manual')
    store.setWritingMode(second.id, 'ai')
    store.setWritingMode(first.id, 'manual')
    expect(second.writingMode).toBe('ai')
  })

  it('binds author summaries, keeps old bindings after prose edits, and restores their original versions', async () => {
    vi.spyOn(storyAggregate, 'readStoryAggregate').mockResolvedValue({ novel: null, workspace: { candidates: [], reviewFindings: [], canonMutations: [] } })
    vi.spyOn(storyAggregate, 'saveStoryAggregate').mockResolvedValue()
    const store = useNovelStore(), novel = createBook('摘要来源')
    const chapter = store.addChapter(novel.id, { content: '林澈走进旧城。', summary: '林澈进城。' })!
    const binding = chapter.summarySource
    expect(binding?.origin).toBe('author')
    expect(getCurrentChapterSummary(chapter)).toBe('林澈进城。')
    store.updateChapter(novel.id, chapter.id, { content: '林澈离开旧城。' })
    expect(chapter.summarySource).toEqual(binding)
    expect(chapter.summary).toBe('林澈进城。')
    expect(getChapterSummaryStatus(chapter)).toBe('stale')
    const original = chapter.versions!.find(item => JSON.parse(item.snapshot).content === '林澈走进旧城。')!
    store.updateChapter(novel.id, chapter.id, { summary: '林澈出城。' })
    expect(getCurrentChapterSummary(chapter)).toBe('林澈出城。')
    await store.restoreChapterVersion(novel.id, chapter.id, original.id)
    expect(chapter.summarySource).toEqual(binding)
    expect(getCurrentChapterSummary(chapter)).toBe('林澈进城。')
    store.updateChapter(novel.id, chapter.id, { summary: '' })
    expect(chapter.summarySource).toBeUndefined()
    expect(getChapterSummaryStatus(chapter)).toBe('empty')
  })

  it('does not promote an unbound historical summary when restoring it', async () => {
    vi.spyOn(storyAggregate, 'readStoryAggregate').mockResolvedValue({ novel: null, workspace: { candidates: [], reviewFindings: [], canonMutations: [] } })
    vi.spyOn(storyAggregate, 'saveStoryAggregate').mockResolvedValue()
    const store = useNovelStore(), novel = createBook('待核对摘要')
    const chapter = store.addChapter(novel.id, { content: '作者正文。' })!
    store.updateChapter(novel.id, chapter.id, { summary: '历史总结。', summarySource: undefined })
    expect(getChapterSummaryStatus(chapter)).toBe('unverified')
    store.updateChapter(novel.id, chapter.id, { summary: '核对后的总结。' })
    const history = chapter.versions!.find(item => JSON.parse(item.snapshot).summary === '历史总结。')!
    await store.restoreChapterVersion(novel.id, chapter.id, history.id)
    expect(chapter.summary).toBe('历史总结。')
    expect(chapter.summarySource).toBeUndefined()
    expect(getCurrentChapterSummary(chapter)).toBe('')
  })

  it('archives every inspiration message independently from assistant retention and clearing', () => {
    const store = useNovelStore()
    const first = createBook('灵感书')
    const second = createBook('另一本书')
    const messages = Array.from({ length: 65 }, (_, index) => ({
      id: `idea-${index}`, role: 'user' as const, content: `想法${index}`, timestamp: first.createdAt,
    }))
    store.setInspirationHistory(first.id, messages)
    messages[0].content = '调用方后来修改了内容'
    for (let index = 0; index < 60; index++) {
      store.addChatMessage(first.id, { id: `chat-${index}`, role: 'user', content: '正文阶段的问题', timestamp: first.createdAt })
    }
    expect(first.chatHistory).toHaveLength(50)
    expect(first.inspirationHistory).toHaveLength(65)
    expect(first.inspirationHistory?.[0].content).toBe('想法0')
    store.clearChatHistory(first.id)
    expect(first.chatHistory).toHaveLength(0)
    expect(first.inspirationHistory).toHaveLength(65)
    expect(second.inspirationHistory).toHaveLength(0)
    expect(second.chatHistory).toHaveLength(0)
  })

  it('rejects duplicate creates and changes relationships only through explicit edits', async () => {
    const store = useNovelStore()
    const book = createBook('关系测试')
  vi.spyOn(storyAggregate, 'readStoryAggregate').mockResolvedValue({ novel: null, workspace: { candidates: [], reviewFindings: [], canonMutations: [], chapterReviews: [], aiRuns: [] } })
  vi.spyOn(storyAggregate, 'saveStoryAggregate').mockResolvedValue()

    const target = await store.addCharacter(book.id, { name: '乙' })!
    const relation = { targetId: target.id, targetName: target.name, relation: '同事', dimension: 'allegiance' }
    const source = await store.addCharacter(book.id, { name: '甲', relationships: [relation] })!
    await expect(store.addCharacter(book.id, { name: '甲', relationships: [relation, { ...relation, relation: '合伙人' }] })).rejects.toThrow()
    expect(source.relationships).toEqual([relation])
    await store.updateCharacter(book.id, source.id, { relationships: [relation, { ...relation, relation: '合伙人', dimension: 'hierarchy' }] })
    expect(source.relationships.map(item => item.relation)).toEqual(['同事', '合伙人'])
    expect(book.characters).toHaveLength(2)
  })

  it('creates books with an explicit manual mode unless the author selected AI', () => {
    const manual = createBook('默认人工书')
    expect(manual.writingMode).toBe('manual')
    const store = useNovelStore()
    const ai = store.addNovel({ genre: 'fantasy', subGenre: 'xuanhuan', tags: [], targetWordCountMin: 20, targetWordCountMax: 30,
      writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings(), writingMode: 'ai' })
    expect(ai.writingMode).toBe('ai')
    expect(manual.writingMode).toBe('manual')
  })

  it('batch-applies editable changes, rejects others, and keeps books isolated', async () => {
    mockStoryPersistence()
    const store = useNovelStore()
    const first = createBook('第一本书')
    const second = createBook('第二本书')
    const panel = (await store.addDataPanelItem(first.id, {
      name: '主角状态', category: '角色', relatedKeywords: ['主角'], fields: [
        { id: 'level', name: '等级', value: '1', unit: '级', note: '', type: 'number' },
        { id: 'coins', name: '金币', value: '10', unit: '枚', note: '', type: 'number' },
        { id: 'remaining', name: '剩余金币', value: '10', unit: '枚', note: '', type: 'formula', formula: '金币', autoCalculate: true },
      ],
    }))!
    const level = (await store.addDataPanelChange(first.id, {
      itemId: panel.id, fieldId: 'level', itemName: panel.name, fieldName: '等级', oldValue: '1', newValue: '2', reason: '正文明确升级', confidence: 'clear', chapterIndex: 0,
    }))!
    const coins = (await store.addDataPanelChange(first.id, {
      itemId: panel.id, fieldId: 'coins', itemName: panel.name, fieldName: '金币', oldValue: '10', newValue: '15', reason: '正文获得金币', confidence: 'clear', chapterIndex: 0,
    }))!

    expect(await store.applyDataPanelChanges(first.id, [level.id], { [level.id]: '3' })).toBe(1)
    expect(await store.rejectDataPanelChanges(first.id, [coins.id])).toBe(1)
    expect(panel.fields.find(field => field.id === 'level')?.value).toBe('3')
    expect(level.status).toBe('accepted')
    expect(coins.status).toBe('rejected')
    expect(second.dataPanels).toHaveLength(0)
    expect(second.dataPanelChanges).toHaveLength(0)
  })

  it('queues automation for confirmation and advances the rolling next plan', async () => {
    mockStoryPersistence()
    const store = useNovelStore()
    const novel = createBook('滚动计划测试')
    store.addChapter(novel.id, { title: '调查开始', content: '调查从矿区入口开始。' })
    const automationChapter = store.addChapter(novel.id, { title: '矿区回报', content: '矿工仍未找到。' })!
    novel.chapterPlans = [{
      id: 'current', horizon: 'next', title: '当前章节', objective: '完成当前目标', summary: '当前计划', beats: ['行动'],
      targetChapterStart: 0, targetChapterEnd: 0, relatedArcIds: [], relatedEventIds: [], status: 'active', source: 'user',
      createdAt: novel.createdAt, updatedAt: novel.updatedAt,
    }, {
      id: 'near', horizon: 'near', title: '进入矿区', objective: '找到失踪矿工', summary: '连续调查矿道', beats: ['问询', '入矿'],
      targetChapterStart: 1, targetChapterEnd: 4, relatedArcIds: [], relatedEventIds: [], status: 'planned', source: 'user',
      createdAt: novel.createdAt, updatedAt: novel.updatedAt,
    }]
    expect(store.completeChapterPlans(novel.id, 0)).toBe(1)
    expect(novel.chapterPlans[0].status).toBe('awaiting_review')
    const plan = store.ensureNextChapterPlan(novel.id, 0)
    expect(plan?.horizon).toBe('next')
    expect(plan?.targetChapterStart).toBe(1)
    expect(store.ensureNextChapterPlan(novel.id, 0)?.id).toBe(plan?.id)
    expect(novel.chapterPlans.filter(item => item.horizon === 'next' && ['planned', 'active'].includes(item.status))).toHaveLength(1)

    const panel = (await store.addDataPanelItem(novel.id, {
      name: '任务进度', category: '任务', relatedKeywords: ['矿工'], fields: [{
        id: 'days', name: '已过天数', value: '0', unit: '天', note: '', type: 'days', automationRules: [{
          id: 'rule', trigger: 'per_chapter', amount: 1, interval: 1, enabled: true,
        }],
      }],
    }))!
    expect(automationChapter.chapterIndex).toBe(1)
    expect(await store.queueAutomaticDataPanelChanges(novel.id, automationChapter.chapterIndex, automationChapter.content)).toBe(1)
    expect(novel.dataPanelChanges[0].status).toBe('pending')
    expect(panel.fields[0].value).toBe('0')
    await store.applyDataPanelChange(novel.id, novel.dataPanelChanges[0].id)
    expect(panel.fields[0].value).toBe('1')
  })

  it('confirms evidence-backed promises and goals without accepting stale text', async () => {
    // SQL/kernel durability is exercised in storyTransactions.test.ts.
    vi.spyOn(storyAggregate, 'readStoryAggregate').mockResolvedValue({ novel: null, workspace: { candidates: [], reviewFindings: [], canonMutations: [] } })
    vi.spyOn(storyAggregate, 'saveStoryAggregate').mockResolvedValue(undefined)
    const store = useNovelStore()
    const novel = createBook('期待核对')
    const chapter = store.addChapter(novel.id, { title: '第一章', volumeIndex: 0 })!
    store.updateChapter(novel.id, chapter.id, { content: '她留下了一封封存十年的密信，主角终于找到了入口。' })
    const plan = store.addChapterPlan(novel.id, {
      horizon: 'next', title: '找到入口', objective: '找到入口', summary: '', beats: [],
      targetChapterStart: chapter.chapterIndex, targetChapterEnd: chapter.chapterIndex,
      relatedArcIds: [], relatedEventIds: [], status: 'active', source: 'user',
    })!
    store.completeChapterPlans(novel.id, chapter.chapterIndex)
    const proposal = store.addStoryStateProposal(novel.id, {
      targetType: 'chapter_plan', targetId: plan.id, targetTitle: plan.title, field: 'status',
      oldValue: 'awaiting_review', newValue: 'completed', reason: '找到了入口', evidence: '主角终于找到了入口',
      chapterSource: bindStoryProposalSource(chapter, '主角终于找到了入口'),
      chapterIndex: chapter.chapterIndex, source: 'ai',
    })!
    const promise = store.addStoryStateProposal(novel.id, {
      targetType: 'event', targetId: 'draft:secret', targetTitle: '密信', field: 'create',
      oldValue: '', newValue: 'planted', reason: '未来揭开密信', evidence: '封存十年的密信',
      chapterSource: bindStoryProposalSource(chapter, '封存十年的密信'),
      eventDraft: { title: '密信', description: '未来揭开密信', evidence: '封存十年的密信',
        characters: [], relatedArcIds: [] }, chapterIndex: chapter.chapterIndex, source: 'ai',
    })!
    expect(await store.applyStoryStateProposal(novel.id, proposal.id)).toBe(true)
    expect(plan.status).toBe('completed')
    expect(useReconstructionWorkspaceStore().getImpactReports(novel.id)).toHaveLength(1)
    expect(useReconstructionWorkspaceStore().getImpactReports(novel.id)[0].changes[0]).toMatchObject({ target: { kind: 'plan', id: plan.id }, action: 'confirm', fields: ['status'] })
    expect(await store.applyStoryStateProposal(novel.id, promise.id)).toBe(true)
    expect(novel.eventLog.find(event => event.title === '密信')?.status).toBe('planted')
    expect(useReconstructionWorkspaceStore().getImpactReports(novel.id)).toHaveLength(2)
    expect(useReconstructionWorkspaceStore().getImpactReports(novel.id)[1].changes[0]).toMatchObject({ target: { kind: 'event' }, action: 'create', fields: ['$exists'] })

    const stale = store.addStoryStateProposal(novel.id, {
      targetType: 'event', targetId: 'draft:stale', targetTitle: '旧伏笔', field: 'create',
      oldValue: '', newValue: 'planted', reason: '', evidence: '封存十年的密信',
      chapterSource: bindStoryProposalSource(chapter, '封存十年的密信'),
      eventDraft: { title: '旧伏笔', description: '已过期', evidence: '封存十年的密信',
        characters: [], relatedArcIds: [] }, chapterIndex: chapter.chapterIndex, source: 'ai',
    })!
    store.updateChapter(novel.id, chapter.id, { content: '主角进入了城门。' })
    expect(await store.applyStoryStateProposal(novel.id, stale.id)).toBe(false)
    expect(novel.eventLog.some(event => event.title === '旧伏笔')).toBe(false)
    expect(useReconstructionWorkspaceStore().getImpactReports(novel.id)).toHaveLength(2)
  })

  it('keeps scans idempotent and applies multi-chapter changes in chronological order', async () => {
    mockStoryPersistence()
    const store = useNovelStore()
    const novel = createBook('数据顺序测试')
    const panel = (await store.addDataPanelItem(novel.id, {
      name: '能量核心', category: '资源', relatedKeywords: ['能量'], fields: [
        { id: 'energy', name: '能量', value: '1', unit: '级', note: '', type: 'number' },
      ],
    }))!
    const first = (await store.addDataPanelChange(novel.id, {
      itemId: panel.id, fieldId: 'energy', itemName: panel.name, fieldName: '能量',
      oldValue: '1', newValue: '2', reason: '第一章提升', confidence: 'clear', chapterIndex: 0,
    }))!
    const second = (await store.addDataPanelChange(novel.id, {
      itemId: panel.id, fieldId: 'energy', itemName: panel.name, fieldName: '能量',
      oldValue: '2', newValue: '3', reason: '第二章提升', confidence: 'clear', chapterIndex: 1,
    }))!

    expect(await store.applyDataPanelChanges(novel.id, [second.id, first.id])).toBe(2)
    expect(panel.fields[0].value).toBe('3')

    const third = (await store.addDataPanelChange(novel.id, {
      itemId: panel.id, fieldId: 'energy', itemName: panel.name, fieldName: '能量',
      oldValue: '3', newValue: '4', reason: '第三章提升', confidence: 'clear', chapterIndex: 2,
    }))!
    expect(await store.rejectDataPanelChange(novel.id, third.id)).toBe(true)
    expect(await store.addDataPanelChange(novel.id, {
      itemId: panel.id, fieldId: 'energy', itemName: panel.name, fieldName: '能量',
      oldValue: '3', newValue: '4', reason: '重复扫描', confidence: 'clear', chapterIndex: 2,
    })).toBeNull()
  })

  it('does not overwrite a field when the pending old value is stale', async () => {
    mockStoryPersistence()
    const store = useNovelStore()
    const novel = createBook('数据冲突测试')
    const panel = (await store.addDataPanelItem(novel.id, {
      name: '库存', category: '资源', relatedKeywords: [], fields: [
        { id: 'stock', name: '数量', value: '5', unit: '', note: '', type: 'number' },
      ],
    }))!
    const change = (await store.addDataPanelChange(novel.id, {
      itemId: panel.id, fieldId: 'stock', itemName: panel.name, fieldName: '数量',
      oldValue: '4', newValue: '6', reason: '过期建议', confidence: 'clear', chapterIndex: 0,
    }))!

    expect(await store.applyDataPanelChange(novel.id, change.id)).toBe(false)
    expect(panel.fields[0].value).toBe('5')
    expect(change.status).toBe('pending')
  })
})
