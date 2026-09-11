import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { buildDataScanContent, useChapterAnalysis } from './useChapterAnalysis'
import { useNovelStore } from '@/stores/novel'
import { callAI } from '@/services/ai'
import type { ModelConfig } from '@/stores/config'
import type { DataPanelItem } from '@/types/novel'
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
  beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks() })
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
})
