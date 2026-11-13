// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, shallowMount, enableAutoUnmount } from '@vue/test-utils'
import KnowledgeBase from '@/v3/knowledge/KnowledgeLibrary.vue'
import KnowledgeImportDialog from '@/components/KnowledgeImportDialog.vue'
import { useKnowledgeStore } from '@/stores/knowledge'
import { useConfigStore } from '@/stores/config'
import { callAI } from '@/services/ai'
import { createEntrySummarySource } from '@/services/knowledgeSources'

vi.mock('vue-router', () => ({ useRoute: () => ({ params: {} }), useRouter: () => ({ push: vi.fn() }) }))
vi.mock('naive-ui', async original => ({ ...await original<object>(), useMessage: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }) }))
vi.mock('@/services/ai', async original => ({ ...await original<object>(), callAI: vi.fn() }))
vi.mock('@/services/db/knowledge', () => ({
  loadAllKnowledgeBasesFromDb: vi.fn().mockResolvedValue([]),
  saveKnowledgeBaseToDb: vi.fn().mockResolvedValue(undefined),
  deleteKnowledgeBaseFromDb: vi.fn().mockResolvedValue(undefined),
}))
enableAutoUnmount(afterEach)
beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  vi.mocked(callAI).mockReset()
})
const stubs = {
  RouterLink: { template: '<a><slot /></a>' },
  InputNumber: { props: ['value'], emits: ['update:value'], template: '<input type="number" :value="value" @input="$emit(\'update:value\', Number($event.target.value))" />' },
  Modal: { props: ['show'], template: '<div v-if="show"><slot /><slot name="action" /></div>' },
  Button: { template: '<button><slot /></button>' },
  Input: { props: ['value', 'placeholder'], emits: ['update:value'], template: '<input :value="value" :placeholder="placeholder" @input="$emit(\'update:value\', $event.target.value)" />' },
}

describe('knowledge full-content selection', () => {
  it('shares one request budget across imported entries and preserves completed results', async () => {
    useConfigStore().addModel({ name: '模型', baseUrl: 'http://test.invalid', apiKey: 'test', modelName: 'test', maxTokens: 1000, contextWindow: 64000, temperature: 0, topP: 1 })
    const store = useKnowledgeStore(), kb = store.createKB('导入批次')
    const first = store.addEntry(kb.id, { title: '第一条', category: '其他', content: '第一条来源', summary: '', tags: [] })!
    const second = store.addEntry(kb.id, { title: '第二条', category: '其他', content: '第二条来源', summary: '', tags: [] })!
    vi.mocked(callAI).mockResolvedValue({ content: '完成第一条', finishReason: 'stop' })
    const w = shallowMount(KnowledgeBase, { global: { stubs, renderStubDefaultSlot: true } })
    await w.get('.kb-card').trigger('click')
    await w.get('input[aria-label="摘要请求上限"]').setValue('2')
    w.findComponent(KnowledgeImportDialog).vm.$emit('imported', { kbId: kb.id, entryIds: [first.id, second.id], summarize: true })
    await flushPromises()
    expect(callAI).toHaveBeenCalledTimes(2)
    expect(first.summary).toBe('完成第一条')
    expect(first.summarySource?.coverage?.leafCount).toBe(1)
    expect(second.summary).toBe('')
  })


  it('saves full entry coverage and reads the tail beyond the former input limit', async () => {
    useConfigStore().addModel({ name: '模型', baseUrl: 'http://test.invalid', apiKey: 'test', modelName: 'test', maxTokens: 1000, contextWindow: 64000, temperature: 0, topP: 1 })
    const store = useKnowledgeStore(), kb = store.createKB('全文')
    const entry = store.addEntry(kb.id, { title: '长资料', category: '其他', content: '原'.repeat(6200) + '尾部事实', summary: '', tags: [] })!
    vi.mocked(callAI).mockResolvedValueOnce({ content: '第一段摘要', finishReason: 'stop' })
      .mockResolvedValueOnce({ content: '尾部事实', finishReason: 'stop' })
      .mockResolvedValueOnce({ content: '完整合并事实', finishReason: 'stop' })
      .mockResolvedValueOnce({ content: '全文摘要包含尾部事实', finishReason: 'stop' })
    const w = shallowMount(KnowledgeBase, { global: { stubs, renderStubDefaultSlot: true } })
    await w.get('.kb-card').trigger('click')
    await w.findAll('.entry-summary-editor button').find(button => button.text() === '重新整理摘要')!.trigger('click')
    await flushPromises()
    expect(entry.summary).toBe('全文摘要包含尾部事实')
    expect(entry.summarySource?.coverage?.leafCount).toBe(2)
    expect(entry.summarySource?.coverage?.sources[0].ranges).toEqual([{ start: 0, end: 6000 }, { start: 6000, end: entry.content.length }])
    expect(callAI).toHaveBeenCalledTimes(4)
    expect(vi.mocked(callAI).mock.calls[1][0].messages.some(message => message.content.endsWith('尾部事实'))).toBe(true)
    expect(w.get('.entry-summary-editor .summary-coverage').text()).toContain('完整读取 1 个条目、2 段原文')
  })

  it('checks the request budget before starting a multi-part summary', async () => {
    useConfigStore().addModel({ name: '模型', baseUrl: 'http://test.invalid', apiKey: 'test', modelName: 'test', maxTokens: 1000, contextWindow: 64000, temperature: 0, topP: 1 })
    const store = useKnowledgeStore(), kb = store.createKB('预算')
    const entry = store.addEntry(kb.id, { title: '长资料', category: '其他', content: '原'.repeat(6200), summary: '旧摘要', tags: [] })!
    const w = shallowMount(KnowledgeBase, { global: { stubs, renderStubDefaultSlot: true } })
    await w.get('.kb-card').trigger('click')
    await w.get('input[aria-label="摘要请求上限"]').setValue('1')
    await w.findAll('.entry-summary-editor button').find(button => button.text() === '重新整理摘要')!.trigger('click')
    await flushPromises()
    expect(callAI).not.toHaveBeenCalled()
    expect(entry.summary).toBe('旧摘要')
    expect(w.get('.entry-summary-editor .summary-error').text()).toContain('超过剩余请求预算')
  })

  it('cancels an in-flight summary without changing the previously saved value', async () => {
    useConfigStore().addModel({ name: '模型', baseUrl: 'http://test.invalid', apiKey: 'test', modelName: 'test', maxTokens: 1000, contextWindow: 64000, temperature: 0, topP: 1 })
    const store = useKnowledgeStore(), kb = store.createKB('取消')
    const entry = store.addEntry(kb.id, { title: '资料', category: '其他', content: '原'.repeat(6200), summary: '旧摘要', tags: [] })!
    vi.mocked(callAI).mockImplementation(options => new Promise((_, reject) => options.signal?.addEventListener('abort', () => reject(options.signal!.reason), { once: true })))
    const w = shallowMount(KnowledgeBase, { global: { stubs, renderStubDefaultSlot: true } })
    await w.get('.kb-card').trigger('click')
    await w.findAll('.entry-summary-editor button').find(button => button.text() === '重新整理摘要')!.trigger('click')
    await flushPromises()
    await w.findAll('.entry-summary-editor button').find(button => button.text() === '取消条目整理')!.trigger('click')
    await flushPromises()
    expect(entry.summary).toBe('旧摘要')
    expect(entry.summarySource).toBeUndefined()
    expect(callAI).toHaveBeenCalledOnce()
    expect(w.get('.entry-summary-editor .summary-run-status').text()).toContain('已取消')
  })

  it('keeps a new source form after disk failure and retries without duplicating or calling AI', async () => {
    useConfigStore().addModel({ name: '模型', baseUrl: 'http://test.invalid', apiKey: 'test', modelName: 'test', maxTokens: 1000, contextWindow: 64000, temperature: 0, topP: 1 })
    const store = useKnowledgeStore(), kb = store.createKB('新来源')
    vi.spyOn(store, 'flushPendingSaves').mockRejectedValueOnce(new Error('模拟磁盘失败')).mockResolvedValue(undefined)
    const w = shallowMount(KnowledgeBase, { global: { stubs, renderStubDefaultSlot: true } })
    await w.get('.kb-card').trigger('click')
    await w.findAll('.detail-actions button').find(button => button.text().includes('添加条目'))!.trigger('click')
    await w.get('input[placeholder="条目标题"]').setValue('新来源')
    await w.get('input[placeholder="条目内容（支持 Markdown）"]').setValue('可用于摘要的原文，但保存不自动付费。')
    await w.findAll('button').find(button => button.text() === '保存')!.trigger('click')
    await flushPromises()
    expect(w.find('input[placeholder="条目标题"]').exists()).toBe(true)
    expect(kb.entries).toHaveLength(1)
    await w.findAll('button').find(button => button.text() === '保存')!.trigger('click')
    await flushPromises()
    expect(kb.entries).toHaveLength(1)
    expect(w.find('input[placeholder="条目标题"]').exists()).toBe(false)
    expect(callAI).not.toHaveBeenCalled()
  })


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

  it('allows author confirmation without a model and displays the previous summary in history', async () => {
    const store = useKnowledgeStore()
    const kb = store.createKB('人工核对')
    const entry = store.addEntry(kb.id, {
      title: '旧塔', category: '地点', content: '旧塔位于城北，入口由守门人看守。', summary: '待作者核对的旧摘要', tags: [],
    })!
    const w = shallowMount(KnowledgeBase, { global: { stubs, renderStubDefaultSlot: true } })
    await w.get('.kb-card').trigger('click')
    await flushPromises()

    const summary = w.get('input[aria-label="条目摘要"]')
    expect(w.find('.summary-status-stale').exists()).toBe(false)
    expect(w.text()).toContain('待核对')
    await summary.setValue('作者重新核对后的摘要')
    const confirm = w.findAll('.entry-summary-editor button').find(button => button.text().includes('作者核对'))!
    await confirm.trigger('click')
    await flushPromises()

    expect(entry.summary).toBe('作者重新核对后的摘要')
    expect(entry.summarySource?.origin).toBe('author')
    expect(w.get('.entry-summary-editor').text()).toContain('当前')
    expect(w.get('.entry-summary-editor').text()).toContain('待作者核对的旧摘要')
  })

  it('shows a stale status when the confirmed source no longer matches the entry', async () => {
    const store = useKnowledgeStore()
    const kb = store.createKB('来源状态')
    const entry = store.addEntry(kb.id, {
      title: '封存室', category: '地点', content: '封存室位于旧塔底层。', summary: '旧摘要', tags: [],
    })!
    entry.summarySource = createEntrySummarySource(kb.id, entry, entry.summary, 'author', entry.updatedAt)
    entry.content = '封存室已经迁到城南。'
    const w = shallowMount(KnowledgeBase, { global: { stubs, renderStubDefaultSlot: true } })
    await w.get('.kb-card').trigger('click')
    await flushPromises()

    expect(w.get('.entry-summary-editor').text()).toContain('来源已失效')
    expect(w.get('.entry-summary-editor').text()).toContain('旧摘要')
  })

  it('keeps the edited summary form when the async save fails', async () => {
    const store = useKnowledgeStore()
    const kb = store.createKB('保存失败')
    store.addEntry(kb.id, {
      title: '资料', category: '其他', content: '一段可供作者核对的资料。', summary: '原摘要', tags: [],
    })
    vi.spyOn(store, 'saveEntrySummary').mockRejectedValue(new Error('模拟保存失败'))
    const w = shallowMount(KnowledgeBase, { global: { stubs, renderStubDefaultSlot: true } })
    await w.get('.kb-card').trigger('click')
    await flushPromises()

    const summary = w.get('input[aria-label="条目摘要"]')
    await summary.setValue('保存失败后仍要保留的表单内容')
    await w.findAll('.entry-summary-editor button').find(button => button.text().includes('作者核对'))!.trigger('click')
    await flushPromises()

    expect((summary.element as HTMLInputElement).value).toBe('保存失败后仍要保留的表单内容')
    expect(w.get('.summary-error').text()).toContain('表单内容已保留')
  })

  it('rejects an entry draft whose source and summary changed after editing began', async () => {
    const store = useKnowledgeStore()
    const kb = store.createKB('条目并发')
    const entry = store.addEntry(kb.id, {
      title: '旧资料', category: '地点', content: '旧正文内容。', summary: '旧摘要', tags: [],
    })!
    const w = shallowMount(KnowledgeBase, { global: { stubs, renderStubDefaultSlot: true } })
    await w.get('.kb-card').trigger('click')
    await flushPromises()

    const summary = w.get('input[aria-label="条目摘要"]')
    await summary.setValue('编辑中的旧草稿')
    store.updateEntry(kb.id, entry.id, { content: '较新的正文内容。', summary: '较新的摘要' })
    await w.findAll('.entry-summary-editor button').find(button => button.text().includes('作者核对'))!.trigger('click')
    await flushPromises()

    expect(entry.summary).toBe('较新的摘要')
    expect((summary.element as HTMLInputElement).value).toBe('编辑中的旧草稿')
    expect(w.get('.summary-error').text()).toContain('已发生变化')
    expect(w.get('.summary-error').text()).toContain('重新载入当前来源')
  })

  it('rejects a whole-base draft whose source and summary changed after editing began', async () => {
    const store = useKnowledgeStore()
    const kb = store.createKB('整库并发')
    const entry = store.addEntry(kb.id, {
      title: '规则', category: '世界观', content: '旧规则正文。', summary: '', tags: [],
    })!
    kb.summary = '旧整库摘要'
    const w = shallowMount(KnowledgeBase, { global: { stubs, renderStubDefaultSlot: true } })
    await w.get('.kb-card').trigger('click')
    await flushPromises()

    const summary = w.get('input[aria-label="知识库摘要"]')
    await summary.setValue('编辑中的旧整库草稿')
    store.updateEntry(kb.id, entry.id, { content: '较新的规则正文。' })
    kb.summary = '较新的整库摘要'
    await w.findAll('.kb-summary-panel button').find(button => button.text().includes('作者核对'))!.trigger('click')
    await flushPromises()

    expect(kb.summary).toBe('较新的整库摘要')
    expect((summary.element as HTMLInputElement).value).toBe('编辑中的旧整库草稿')
    expect(w.get('.kb-summary-panel .summary-error').text()).toContain('已发生变化')
    expect(w.get('.kb-summary-panel .summary-error').text()).toContain('重新载入当前来源')
  })

  it('does not let a late entry save refresh the newly selected entry draft', async () => {
    const store = useKnowledgeStore()
    const firstKB = store.createKB('先选知识库')
    const firstEntry = store.addEntry(firstKB.id, {
      title: '第一条目', category: '其他', content: '第一条目的正文资料。', summary: '第一条目摘要', tags: [],
    })!
    const secondKB = store.createKB('后选知识库')
    store.addEntry(secondKB.id, {
      title: '第二条目', category: '其他', content: '第二条目的正文资料。', summary: '第二条目摘要', tags: [],
    })!
    let finish: (() => void) | undefined
    vi.spyOn(store, 'saveEntrySummary').mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
    const w = shallowMount(KnowledgeBase, { global: { stubs, renderStubDefaultSlot: true } })
    await w.findAll('.kb-card').find(card => card.text().includes('先选知识库'))!.trigger('click')
    await flushPromises()
    await w.get('input[aria-label="条目摘要"]').setValue('第一条目的旧草稿')
    await w.findAll('.entry-summary-editor button').find(button => button.text().includes('作者核对'))!.trigger('click')
    await flushPromises()

    await w.get('.kb-detail-header button').trigger('click')
    await w.findAll('.kb-card').find(card => card.text().includes('后选知识库'))!.trigger('click')
    await flushPromises()
    expect((w.get('input[aria-label="条目摘要"]').element as HTMLInputElement).value).toBe('第二条目摘要')
    finish?.()
    await flushPromises()

    expect(firstEntry.summary).toBe('第一条目摘要')
    expect((w.get('input[aria-label="条目摘要"]').element as HTMLInputElement).value).toBe('第二条目摘要')
  })

  it('does not let a late base save refresh the newly selected knowledge base draft', async () => {
    const store = useKnowledgeStore()
    const first = store.createKB('先选整库')
    store.addEntry(first.id, { title: '第一资料', category: '其他', content: '第一资料正文。', summary: '', tags: [] })
    first.summary = '第一整库摘要'
    const second = store.createKB('后选整库')
    store.addEntry(second.id, { title: '第二资料', category: '其他', content: '第二资料正文。', summary: '', tags: [] })
    second.summary = '第二整库摘要'
    let finish: (() => void) | undefined
    vi.spyOn(store, 'saveBaseSummary').mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
    const w = shallowMount(KnowledgeBase, { global: { stubs, renderStubDefaultSlot: true } })
    await w.findAll('.kb-card').find(card => card.text().includes('先选整库'))!.trigger('click')
    await flushPromises()
    await w.get('input[aria-label="知识库摘要"]').setValue('第一整库旧草稿')
    await w.findAll('.kb-summary-panel button').find(button => button.text().includes('作者核对'))!.trigger('click')
    await flushPromises()

    await w.get('.kb-detail-header button').trigger('click')
    await w.findAll('.kb-card').find(card => card.text().includes('后选整库'))!.trigger('click')
    await flushPromises()
    expect((w.get('input[aria-label="知识库摘要"]').element as HTMLInputElement).value).toBe('第二整库摘要')
    finish?.()
    await flushPromises()

    expect(first.summary).toBe('第一整库摘要')
    expect((w.get('input[aria-label="知识库摘要"]').element as HTMLInputElement).value).toBe('第二整库摘要')
  })

  it('rejects a late AI result after the entry source was edited and keeps its category', async () => {
    const config = useConfigStore()
    config.addModel({ name: '测试模型', baseUrl: 'http://test.invalid', apiKey: 'test', modelName: 'test', maxTokens: 1000, contextWindow: 64000, temperature: 0, topP: 1 })
    let finish: (() => void) | undefined
    vi.mocked(callAI).mockImplementation(async options => new Promise(resolve => {
      finish = () => {
        options.onChunk?.('迟到的 AI 摘要')
        resolve({ content: '迟到的 AI 摘要' })
      }
    }))
    const store = useKnowledgeStore()
    const kb = store.createKB('迟到结果')
    const entry = store.addEntry(kb.id, {
      title: '旧门', category: '地点', content: '旧门的原文资料足够长，可以触发一次 AI 整理请求。', summary: '原来的摘要', tags: [],
    })!
    const w = shallowMount(KnowledgeBase, { global: { stubs, renderStubDefaultSlot: true } })
    await w.get('.kb-card').trigger('click')
    await flushPromises()
    await w.findAll('.entry-summary-editor button').find(button => button.text().includes('重新整理摘要'))!.trigger('click')
    await flushPromises()
    expect(callAI).toHaveBeenCalled()

    store.updateEntry(kb.id, entry.id, { content: '资料已经被作者改写，迟到结果不能覆盖它。' })
    finish?.()
    await flushPromises()

    expect(entry.summary).toBe('原来的摘要')
    expect(entry.category).toBe('地点')
    expect(w.get('.summary-error').text()).toContain('迟到')
  })

  it('does not save an empty or truncated AI result', async () => {
    const config = useConfigStore()
    config.addModel({ name: '测试模型', baseUrl: 'http://test.invalid', apiKey: 'test', modelName: 'test', maxTokens: 1000, contextWindow: 64000, temperature: 0, topP: 1 })
    const store = useKnowledgeStore()
    const kb = store.createKB('不完整结果')
    const entry = store.addEntry(kb.id, {
      title: '资料', category: '其他', content: '这是一段足够长的原文，用于测试不完整的 AI 返回不会落盘。', summary: '旧摘要', tags: [],
    })!
    const w = shallowMount(KnowledgeBase, { global: { stubs, renderStubDefaultSlot: true } })
    await w.get('.kb-card').trigger('click')
    await flushPromises()

    vi.mocked(callAI).mockResolvedValueOnce({ content: '被截断的片段', finishReason: 'length' })
    await w.findAll('.entry-summary-editor button').find(button => button.text().includes('重新整理摘要'))!.trigger('click')
    await flushPromises()
    expect(entry.summary).toBe('旧摘要')
    expect(w.get('.summary-error').text()).toContain('未完整完成')

    vi.mocked(callAI).mockResolvedValueOnce({ content: '', finishReason: 'stop' })
    await w.findAll('.entry-summary-editor button').find(button => button.text().includes('重新整理摘要'))!.trigger('click')
    await flushPromises()
    expect(entry.summary).toBe('旧摘要')
    expect(w.get('.summary-error').text()).toContain('为空')
  })

  it.each([
    { content: '', finishReason: 'stop' },
    { content: '停止后的半份合并结果', finishReason: 'client_stop' },
  ])('does not publish partial segments when consolidation is incomplete ($finishReason)', async incomplete => {
    useConfigStore().addModel({ name: '测试模型', baseUrl: 'http://test.invalid', apiKey: 'test', modelName: 'test', maxTokens: 1000, contextWindow: 64000, temperature: 0, topP: 1 })
    const store = useKnowledgeStore(), kb = store.createKB('多段摘要')
    const entry = store.addEntry(kb.id, { title: '长资料', category: '其他', content: '原文'.repeat(3100), summary: '原有效摘要', tags: [] })!
    const w = shallowMount(KnowledgeBase, { global: { stubs, renderStubDefaultSlot: true } })
    await w.get('.kb-card').trigger('click')
    vi.mocked(callAI)
      .mockResolvedValueOnce({ content: '第一段事实', finishReason: 'stop' })
      .mockResolvedValueOnce({ content: '第二段事实', finishReason: 'stop' })
      .mockResolvedValueOnce(incomplete)
    await w.findAll('.entry-summary-editor button').find(button => button.text().includes('重新整理摘要'))!.trigger('click')
    await flushPromises()
    expect(callAI).toHaveBeenCalledTimes(3)
    expect(entry.summary).toBe('原有效摘要')
    expect(entry.summaryHistory).toBeUndefined()
    expect(entry.summarySource).toBeUndefined()
    expect(w.get('.summary-error').text()).toContain('未保存')
  })

  it('reports full input coverage and rejects a truncated whole-base result', async () => {
    useConfigStore().addModel({ name: '测试模型', baseUrl: 'http://test.invalid', apiKey: 'test', modelName: 'test', maxTokens: 1000, contextWindow: 64000, temperature: 0, topP: 1 })
    const store = useKnowledgeStore(), kb = store.createKB('部分资料')
    store.addEntry(kb.id, { title: '长资料', category: '其他', content: '原文'.repeat(2000), summary: '', tags: [] })
    kb.summary = '原整库摘要'
    const w = shallowMount(KnowledgeBase, { global: { stubs, renderStubDefaultSlot: true } })
    await w.get('.kb-card').trigger('click')
    expect(w.get('.kb-summary-panel .summary-scope-hint').text()).toContain('全文分批读取：4000 字')
    vi.mocked(callAI).mockResolvedValueOnce({ content: '仅一部分整库事实', finishReason: 'max_tokens' })
    await w.findAll('.detail-actions button').find(button => button.text() === '整理摘要')!.trigger('click')
    await flushPromises()
    expect(kb.summary).toBe('原整库摘要')
    expect(kb.summarySource).toBeUndefined()
    expect(w.get('.kb-summary-panel .summary-error').text()).toContain('未完整完成')
  })

  it('uses the same author confirmation and history flow for the whole knowledge base', async () => {
    const store = useKnowledgeStore()
    const kb = store.createKB('整库摘要')
    store.addEntry(kb.id, {
      title: '规则', category: '世界观', content: '这里有一条可以被整库摘要引用的规则。', summary: '', tags: [],
    })
    kb.summary = '旧整库摘要'
    const w = shallowMount(KnowledgeBase, { global: { stubs, renderStubDefaultSlot: true } })
    await w.get('.kb-card').trigger('click')
    await flushPromises()

    const summary = w.get('input[aria-label="知识库摘要"]')
    await summary.setValue('作者核对后的整库摘要')
    await w.findAll('.kb-summary-panel button').find(button => button.text().includes('作者核对'))!.trigger('click')
    await flushPromises()

    expect(kb.summary).toBe('作者核对后的整库摘要')
    expect(kb.summarySource?.origin).toBe('author')
    expect((summary.element as HTMLInputElement).value).toBe('作者核对后的整库摘要')
    expect(w.get('.kb-summary-panel').text()).toContain('旧整库摘要')
  })

  it('refreshes an untouched base baseline after an entry confirmation changes its source', async () => {
    const store = useKnowledgeStore()
    const kb = store.createKB('先确认条目')
    const entry = store.addEntry(kb.id, {
      title: '规则', category: '世界观', content: '规则正文。', summary: '', tags: [],
    })!
    kb.summary = '旧整库摘要'
    const w = shallowMount(KnowledgeBase, { global: { stubs, renderStubDefaultSlot: true } })
    await w.get('.kb-card').trigger('click')
    await flushPromises()

    entry.summary = '刚刚核对的条目摘要'
    entry.summarySource = createEntrySummarySource(kb.id, entry, entry.summary, 'author', entry.updatedAt)
    const summary = w.get('input[aria-label="知识库摘要"]')
    await summary.trigger('focus')
    await summary.setValue('新的整库摘要')
    await w.findAll('.kb-summary-panel button').find(button => button.text().includes('作者核对'))!.trigger('click')
    await flushPromises()

    expect(kb.summary).toBe('新的整库摘要')
    expect(kb.summarySource?.origin).toBe('author')
  })
})
