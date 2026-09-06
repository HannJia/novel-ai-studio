import { describe, expect, it } from 'vitest'
import { buildDataScanContent } from './useChapterAnalysis'
import type { DataPanelItem } from '@/types/novel'

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
