import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useKnowledgeStore } from './knowledge'
beforeEach(() => setActivePinia(createPinia()))
describe('knowledge text storage', () => {
  it('retains single-line text and short factual entries rather than dropping their content', () => {
    const store = useKnowledgeStore()
    const kb = store.createKB('本地资料')
    expect(store.importFromText(kb.id, '某年县学重建。', '事件')).toBe(1)
    expect(kb.entries[0].content).toBe('某年县学重建。')
    expect(store.importFromText(kb.id, '## 县学\n重建。\n\n---\n\n## 集市\n新增。', '事件')).toBe(2)
    expect(kb.entries.map(entry => entry.content)).toContain('重建。')
  })
})
