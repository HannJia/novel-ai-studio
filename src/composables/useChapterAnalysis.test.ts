import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { buildDataScanContent, useChapterAnalysis } from './useChapterAnalysis'
import { useNovelStore } from '@/stores/novel'
import { callAI } from '@/services/ai'
import type { ModelConfig } from '@/stores/config'
import type { DataPanelItem } from '@/types/novel'
import * as storyAggregate from '@/services/storyAggregate'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
vi.mock('@/services/ai', () => ({ callAI: vi.fn() }))

const panel: DataPanelItem = {
  id: 'panel-1', category: '资源', name: '灵石库存', relatedKeywords: ['灵石'],
  fields: [{ id: 'field-1', name: '数量', value: '10', unit: '枚', note: '', type: 'number' }],
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
}

describe('章节数据扫描取样', () => {
  it('长正文优先保留数据关键词附近的证据并限制输入长度', () => {
    const content = `${'无关段落。'.repeat(1200)}灵石库存减少到九枚。${'后续段落。'.repeat(1200)}`
    const sampled = buildDataScanContent(content, [panel])
    expect(sampled).toContain('灵石库存减少到九枚')
    expect(sampled.length).toBeLessThanOrEqual(8000)
  })
})

describe('辅助写作数据扫描', () => {
  beforeEach(() => {
    setActivePinia(createPinia()); vi.clearAllMocks()
    vi.spyOn(storyAggregate, 'readStoryAggregate').mockResolvedValue({ novel: null, workspace: { candidates: [], reviewFindings: [], canonMutations: [], chapterReviews: [], aiRuns: [] } })
    vi.spyOn(storyAggregate, 'saveStoryAggregate').mockResolvedValue()
  })
  afterEach(() => vi.restoreAllMocks())
  const model = { id: 'test-model' } as ModelConfig
  function setup() {
    const store = useNovelStore()
    const novel = store.addNovel({ genre: '', subGenre: '', tags: [], targetWordCountMin: 1, targetWordCountMax: 2,
      writingMode: 'manual', settings: store.defaultSettings(), writingStyle: store.defaultWritingStyle() })
    const chapter = store.addChapter(novel.id, { title: '铁剑', content: '林澈获得铁剑，攻击加成10，放进了背包。' })!
    const currentChapterId = ref(chapter.id)
    const currentContent = ref(chapter.content)
    const onWarning = vi.fn()
    const analysis = useChapterAnalysis({ currentNovelId: ref(novel.id), currentChapterId, currentContent, currentPanels: ref([]), onWarning })
    const reply = JSON.stringify({ newItems: [{ name: '铁剑', category: '装备', ownerItemName: '林澈', equipmentState: 'stored',
      fields: [{ name: '攻击加成', value: '10', modifier: { attribute: '攻击力', operation: 'flat' } }],
      confidence: 'clear', reason: chapter.content }], equipmentChanges: [], dataChanges: [] })
    return { store, novel, chapter, currentChapterId, currentContent, analysis, reply, onWarning }
  }
  it('空面板也调用AI，读取完整正文，新增对象只进入待确认', async () => {
    const { novel, chapter, currentContent, analysis, reply } = setup()
    chapter.content = '开头'.repeat(3000) + chapter.content + '结尾'.repeat(3000)
    currentContent.value = chapter.content
    vi.mocked(callAI).mockImplementation(async options => { options.onChunk?.(reply); return { content: reply } })
    await analysis.scanDataPanelChanges(model)
    expect(vi.mocked(callAI).mock.calls[0][0].messages[1].content).toContain(chapter.content)
    expect(novel.dataPanels).toHaveLength(0)
    expect(novel.dataPanelChanges).toHaveLength(1)
    expect(novel.dataPanelChanges[0].mutation?.kind).toBe('create')
    expect(novel.dataPanelChanges[0].status).toBe('pending')
    expect(chapter.content).toBe(currentContent.value)
    expect(analysis.scanningDataChanges.value).toBe(false)
  })
  it('离开章节后后台扫描仍写回原书，不写进新页面', async () => {
    const { novel, chapter, currentChapterId, currentContent, analysis, reply } = setup()
    vi.mocked(callAI).mockImplementation(async options => {
      currentChapterId.value = 'another-chapter'
      currentContent.value = '其他章节'
      options.onChunk?.(reply)
      return { content: reply }
    })
    await analysis.scanDataPanelChanges(model, { novelId: novel.id, chapterIndex: chapter.chapterIndex, content: chapter.content, panels: [] })
    expect(novel.dataPanelChanges).toHaveLength(1)
    expect(novel.dataPanelChanges[0].chapterIndex).toBe(chapter.chapterIndex)
    expect(currentContent.value).toBe('其他章节')
  })
  it('扫描期间正文改变或删除章节，不采纳旧结果', async () => {
    const { novel, chapter, analysis, reply, onWarning } = setup()
    vi.mocked(callAI).mockImplementation(async options => { chapter.content = '修改后的正文'; options.onChunk?.(reply); return { content: reply } })
    await analysis.scanDataPanelChanges(model)
    expect(novel.dataPanelChanges).toEqual([])
    expect(onWarning).toHaveBeenCalledWith('正文已变化，已跳过旧版本的数据扫描结果')
  })
  it.each(['structure', 'data'] as const)('retains failed %s output for a retry without another request', async mode => {
    const { analysis, novel, chapter, reply } = setup()
    const payload = JSON.stringify({ ...JSON.parse(reply), events: [{ title: '获得铁剑', description: '主角获得铁剑', evidence: '铁剑' }],
      characters: [], knowledgeChanges: [], relationshipChanges: [], timeAdvanceDays: 0 })
    vi.mocked(callAI).mockResolvedValue({ content: payload })
    vi.mocked(storyAggregate.saveStoryAggregate).mockRejectedValueOnce(new Error('分析写盘失败'))
    if (mode === 'structure') await expect(analysis.analyzeChapterStructure(model)).rejects.toThrow('分析写盘失败')
    else await analysis.scanDataPanelChanges(model)
    expect(novel.dataPanelChanges).toHaveLength(0)
    expect(useReconstructionWorkspaceStore().getCandidates(novel.id)).toHaveLength(0)
    expect((mode === 'structure' ? analysis.pendingChapterAnalysis : analysis.pendingDataAnalysis).value?.error).toBe('分析写盘失败')
    if (mode === 'structure') await analysis.analyzeChapterStructure(model)
    else await analysis.scanDataPanelChanges(model)
    expect(callAI).toHaveBeenCalledTimes(1)
    expect(novel.dataPanelChanges).toHaveLength(1)
    expect(novel.dataPanels).toHaveLength(0)
    expect(chapter.content).toContain('铁剑')
    expect((mode === 'structure' ? analysis.pendingChapterAnalysis : analysis.pendingDataAnalysis).value).toBeUndefined()
  })

  it('does not rebase retained analysis output after reference data changes', async () => {
    const { analysis, novel, reply } = setup()
    vi.mocked(callAI).mockResolvedValue({ content: JSON.stringify({ ...JSON.parse(reply), events: [], characters: [], knowledgeChanges: [], relationshipChanges: [] }) })
    vi.mocked(storyAggregate.saveStoryAggregate).mockRejectedValueOnce(new Error('分析写盘失败'))
    await expect(analysis.analyzeChapterStructure(model)).rejects.toThrow('分析写盘失败')
    novel.settings.protagonist.name = '资料中的新名字'
    await expect(analysis.analyzeChapterStructure(model)).rejects.toThrow('正文或故事资料已变化')
    expect(callAI).toHaveBeenCalledTimes(1); expect(novel.dataPanelChanges).toHaveLength(0)
    expect(analysis.pendingChapterAnalysis.value).toBeDefined()
    analysis.discardPendingChapterAnalysis()
    expect(analysis.pendingChapterAnalysis.value).toBeUndefined()
  })

  it('coalesces simultaneous structure requests and refuses a different scope', async () => {
    const { analysis } = setup()
    const content = JSON.stringify({ events: [], characters: [], knowledgeChanges: [], relationshipChanges: [], timeAdvanceDays: 0 })
    vi.mocked(callAI).mockResolvedValue({ content })
    const first = analysis.analyzeChapterStructure(model), repeated = analysis.analyzeChapterStructure(model)
    await expect(analysis.analyzeChapterStructure(model, { includeCharacters: false })).rejects.toThrow('不同范围')
    expect(await Promise.all([first, repeated])).toEqual([true, true])
    expect(callAI).toHaveBeenCalledTimes(1)
  })

  it('rejects analysis when an earlier chapter invalidates a foreshadowing reference', async () => {
    const { analysis, novel, chapter, store } = setup()
    const { captureEntityRevision, appendEntityRevision } = await import('@/services/entityProvenance')
    const { buildAnalysisSourceVersionId } = await import('@/services/reconstructionCandidates')
    const earlier = store.addChapter(novel.id, { title: '遗留物', content: '门边藏着钥匙。' })!
    earlier.chapterIndex = 0; chapter.chapterIndex = 1
    novel.eventLog = [{ id: 'key-foreshadow', chapterIndex: 0, title: '遗留的钥匙', description: '门边藏着钥匙。',
      characters: [], type: '伏笔', status: 'planted', source: 'ai', timestamp: '2026-10-31T00:00:00Z' }]
    const event = novel.eventLog[0]
    appendEntityRevision(event, captureEntityRevision('event', undefined, event, { kind: 'chapter', chapterId: earlier.id,
      chapterIndex: 0, sourceVersionId: buildAnalysisSourceVersionId(earlier.content), evidence: [{ quote: earlier.content }] }, event.timestamp, 'key-source'))
    const eventsBefore = JSON.stringify(novel.eventLog)
    vi.mocked(callAI).mockImplementation(async options => {
      expect(options.messages.map(message => message.content).join('\n')).toContain('「遗留的钥匙」')
      earlier.content = '门边没有钥匙。'
      return { content: JSON.stringify({ events: [], characters: [], knowledgeChanges: [], relationshipChanges: [], timeAdvanceDays: 0 }) }
    })
    await expect(analysis.analyzeChapterStructure(model)).rejects.toThrow('正文或故事资料已变化')
    expect(JSON.stringify(novel.eventLog)).toBe(eventsBefore)
    expect(storyAggregate.saveStoryAggregate).not.toHaveBeenCalled()
    expect(analysis.pendingChapterAnalysis.value).toBeDefined()
  })

  it('invalid structure output is not reported as a successful memory update', async () => {
    const { analysis, novel } = setup()
    vi.mocked(callAI).mockImplementation(async options => { options.onChunk?.('{}'); return { content: '{}' } })
    expect(await analysis.analyzeChapterStructure(model)).toBe(false)
    expect(novel.eventLog).toHaveLength(0)
  })
  it('explains truncated memory output without saving partial candidates', async () => {
    const { analysis, novel } = setup()
    vi.mocked(callAI).mockResolvedValue({ content: '{"events":[', finishReason: 'length',
      usage: { completion_tokens: 8192, completion_tokens_details: { reasoning_tokens: 8000 } } })
    await expect(analysis.analyzeChapterStructure(model)).rejects.toThrow('结束原因：length；正文长度：11 字符；输出用量：8192 token；推理用量：8000 token')
    expect(useReconstructionWorkspaceStore().getCandidates(novel.id)).toEqual([])
    expect(storyAggregate.saveStoryAggregate).not.toHaveBeenCalled()
    expect(callAI).toHaveBeenCalledOnce()
  })
  it('reports success only after applying valid memory and forwards cancellation', async () => {
    const { analysis } = setup()
    const controller = new AbortController()
    const payload = JSON.stringify({ events: [], characters: [], timeAdvanceDays: 0, knowledgeChanges: [], relationshipChanges: [] })
    vi.mocked(callAI).mockImplementation(async options => { options.onChunk?.(payload); return { content: payload } })
    expect(await analysis.analyzeChapterStructure(model, { signal: controller.signal })).toBe(true)
    expect(vi.mocked(callAI).mock.calls[0][0].signal).toBe(controller.signal)
    expect(vi.mocked(callAI).mock.calls[0][0].taskName).toBe('更新章节记忆')
    expect(vi.mocked(callAI).mock.calls[0][0].structuredOutput).toBe('concise-json')
  })

  it('keeps AI story changes as candidates instead of writing Canon directly', async () => {
    const { novel, chapter } = setup()
    const onCandidatesDetected = vi.fn()
    const candidateAnalysis = useChapterAnalysis({
      currentNovelId: ref(novel.id),
      currentChapterId: ref(chapter.id),
      currentContent: ref(chapter.content),
      currentPanels: ref([]),
      onCandidatesDetected,
    })
    const payload = JSON.stringify({
      events: [{ title: '发现线索', description: '主角找到一张旧照片', type: '主线', evidence: '铁剑' }],
      characters: [{ name: '守门人', identity: '封存室守卫', evidence: '铁剑' }],
      timeAdvanceDays: 2,
      knowledgeChanges: [], relationshipChanges: [],
    })
    vi.mocked(callAI).mockImplementation(async options => { options.onChunk?.(payload); return { content: payload } })

    expect(await candidateAnalysis.analyzeChapterStructure(model)).toBe(true)
    expect(onCandidatesDetected).toHaveBeenCalledTimes(1)
    expect(onCandidatesDetected.mock.calls[0][0].candidates).toHaveLength(3)
    expect(novel.eventLog).toHaveLength(0)
    expect(novel.characters).toHaveLength(0)
    expect(novel.storyClock).toBeUndefined()
  })
})
