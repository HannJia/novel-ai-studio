// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, shallowMount, enableAutoUnmount } from '@vue/test-utils'
import KnowledgeBase from './KnowledgeBase.vue'
import { useKnowledgeStore } from '@/stores/knowledge'

vi.mock('vue-router', () => ({ useRoute: () => ({ params: {} }), useRouter: () => ({ push: vi.fn() }) }))
vi.mock('naive-ui', async original => ({ ...await original<object>(), useMessage: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }) }))
enableAutoUnmount(afterEach)
beforeEach(() => setActivePinia(createPinia()))
const stubs = {
  Button: { template: '<button><slot /></button>' },
  Input: { props: ['value', 'placeholder'], emits: ['update:value'], template: '<input :value="value" :placeholder="placeholder" @input="$emit(\'update:value\', $event.target.value)" />' },
}

describe('knowledge full-content selection', () => {
  it('searches names, descriptions and entry titles and sorts by real latest activity', async () => {
    const store = useKnowledgeStore()
    const older = store.createKB('甲资料', '城市背景')
    const newer = store.createKB('乙资料', '世界设定')
    older.createdAt = '2020-01-01T00:00:00Z'
    newer.createdAt = '2021-01-01T00:00:00Z'
    const entry = store.addEntry(older.id, { title: 'Archive Bookshop', category: '地点', content: '资料', summary: '', tags: [] })!
    entry.updatedAt = '2026-01-01T00:00:00Z'
    const w = shallowMount(KnowledgeBase, { global: { stubs, renderStubDefaultSlot: true } })
    expect(w.findAll('.kb-card h3').map(card => card.text())).toEqual(['甲资料', '乙资料'])
    const search = w.get('input[placeholder="搜索知识库、描述或条目..."]')
    await search.setValue('archive')
    expect(w.findAll('.kb-card')).toHaveLength(1)
    expect(w.get('.kb-card h3').text()).toBe('甲资料')
    await search.setValue('世界设定')
    expect(w.get('.kb-card h3').text()).toBe('乙资料')
    await search.setValue('不存在')
    expect(w.find('.kb-card').exists()).toBe(false)
    expect(w.get('.kb-no-results').text()).toContain('没有匹配')
    expect(store.knowledgeBases).toHaveLength(2)
  })
  it('renders the full selected entry, filters selection and never keeps deleted detail', async () => {
    const store = useKnowledgeStore()
    const kb = store.createKB('设定资料')
    const first = store.addEntry(kb.id, { title: '长街', category: '地点', content: '长'.repeat(150) + '全文末尾证据', summary: '', tags: [] })!
    const second = store.addEntry(kb.id, { title: '书店', category: '地点', content: '旧书店完整资料', summary: '', tags: [] })!
    const w = shallowMount(KnowledgeBase, { global: { stubs, renderStubDefaultSlot: true } })
    await w.get('.kb-card').trigger('click')
    await flushPromises()
    expect(w.get('.entry-detail-panel').text()).toContain(second.content)
    const view = w.findAll('.entry-actions button').find(b => b.text() === '查看')!
    await view.trigger('click')
    await w.get('input[placeholder="搜索条目..."]').setValue('长街')
    await flushPromises()
    expect(w.get('.entry-detail-panel').text()).toContain('全文末尾证据')
    expect(w.get('.entry-detail-panel').text()).not.toContain(second.content)
    store.deleteEntry(kb.id, first.id)
    await flushPromises()
    expect(w.find('.entry-detail-panel').exists()).toBe(false)
    await w.get('input[placeholder="搜索条目..."]').setValue('')
    await flushPromises()
    expect(w.get('.entry-detail-panel').text()).toContain(second.content)
  })
})
