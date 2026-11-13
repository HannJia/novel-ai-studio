// @vitest-environment happy-dom
vi.mock('@/v3/components/BookPage.vue', () => ({ default: { template: '<div><slot /></div>' } }))
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick, reactive } from 'vue'
import { flushPromises, shallowMount, type VueWrapper } from '@vue/test-utils'
import { NButton, NInput, NInputNumber, NModal, NPopconfirm, NSelect } from 'naive-ui'
import DataPanelWorkspace from '@/v3/data/DataManager.vue'
import DataPanelFieldEditor from '@/components/data-panel/DataPanelFieldEditor.vue'
import type { Chapter, DataPanelItem } from '@/types/novel'

const { store, messages } = vi.hoisted(() => ({
  store: {
    getNovel: vi.fn(), captureDataPanelEditBaseline: vi.fn(), captureDataClockBaseline: vi.fn(),
    addDataPanelItem: vi.fn(), updateDataPanelItem: vi.fn(), restoreDataPanelVersion: vi.fn(),
    deleteDataPanelItem: vi.fn(), applyDataPanelChange: vi.fn(), rejectDataPanelChange: vi.fn(),
    setStoryClock: vi.fn(), queueAutomaticDataPanelChanges: vi.fn(),
  },
  messages: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))
vi.mock('@/stores/novel', () => ({ useNovelStore: () => store }))
vi.mock('vue-router', () => ({ useRoute: () => ({ params: { novelId: 'synthetic-book' }, query: { chapterId: 'chapter-1' } }) }))
vi.mock('naive-ui', async original => ({ ...await original<object>(), useMessage: () => messages }))
const Button = defineComponent({ props: ['disabled', 'loading'], template: '<button :disabled="disabled || loading"><slot /></button>' })
const Modal = defineComponent({ props: ['show', 'title'], template: '<section v-if="show"><slot /><slot name="footer" /></section>' })
const Popconfirm = defineComponent({ emits: ['positive-click'], template: `<div><slot name="trigger" /><button @click="$emit('positive-click')">确认删除</button></div>` })
const now = '2026-10-31T09:00:00.000Z'
const conflict = '正文来源或当前数据已变化，请重新核对/分析'
const chapter: Chapter = { id: 'chapter-1', volumeIndex: 0, chapterIndex: 0, title: '第一章', content: '正文', summary: '',
  wordCount: 2, status: 'writing', createdAt: now, updatedAt: now }
let wrapper: VueWrapper

function setup() {
  const item: DataPanelItem = { id: 'panel', name: '合成库存', category: '资源', relatedKeywords: [],
    fields: [{ id: 'stock', name: '数量', value: '10', unit: '', note: '' }], createdAt: now, updatedAt: now,
    versions: [{ id: 'version', label: '手动修改前', savedAt: now, snapshot: '{}' }] }
  const book = reactive({ id: 'synthetic-book', chapters: [chapter], dataPanels: [item],
    storyClock: { currentDay: 2, label: '初始日', updatedAt: now },
    dataPanelChanges: [{ id: 'proposal', itemId: item.id, itemName: item.name, fieldId: 'stock', fieldName: '数量',
      oldValue: '10', newValue: '11', chapterIndex: 0, reason: '合成正文', status: 'pending', createdAt: now }],
  })
  store.getNovel.mockReturnValue(book)
  store.captureDataPanelEditBaseline.mockReturnValue('opened-data')
  store.captureDataClockBaseline.mockReturnValue('loaded-clock')
  wrapper = shallowMount(DataPanelWorkspace, { global: { renderStubDefaultSlot: true, stubs: { Button, Modal, Popconfirm } } })
  return { book, item }
}
function button(label: string) {
  const found = wrapper.findAll('button').find(value => value.text() === label)
  expect(found, `button ${label}`).toBeDefined()
  return found!
}
function modal(title: string) { return wrapper.findAllComponents(NModal).find(value => value.props('title') === title)! }
function nameInput() { return wrapper.findAllComponents(NInput).find(value => value.attributes('placeholder') === '数据对象名称')! }
async function click(label: string) { await button(label).trigger('click'); await flushPromises() }
beforeEach(() => { vi.resetAllMocks() })
afterEach(() => { wrapper?.unmount() })

describe('data workspace async persistence', () => {
  it('shows source uncertainty while retaining the saved value and an author confirmation path', async () => {
    const { book } = setup()
    book.dataPanelChanges[0].status = 'accepted'
    const { recordDataPanelReference } = await import('@/services/dataPanelReference')
    const previous = JSON.parse(JSON.stringify(book.dataPanels[0]))
    book.dataPanels[0].fields[0].value = '11'
    recordDataPanelReference(book.dataPanels[0], previous, { kind: 'unverified' }, now, 'unverified-value')
    await nextTick()
    expect(wrapper.get('[role="status"]').text()).toContain('部分数据来源需要核对')
    expect(wrapper.get('[role="status"]').text()).toContain('核对原文后可编辑并确认当前值')
    expect(book.dataPanels[0].fields[0].value).toBe('11')
    await click('编辑')
    expect(modal('编辑数据').props('show')).toBe(true)
    expect(store.updateDataPanelItem).not.toHaveBeenCalled()
  })
  it('keeps edited fields and the opened baseline through a pending save, failure, conflict and retry', async () => {
    const { book } = setup()
    await click('编辑')
    nameInput().vm.$emit('update:value', '作者保留的库存名称')
    const fields = [{ ...book.dataPanels[0].fields[0], value: '42' }]
    wrapper.getComponent(DataPanelFieldEditor).vm.$emit('update:fields', fields)
    store.captureDataPanelEditBaseline.mockReturnValue('background-data')
    let fail!: (error: Error) => void
    store.updateDataPanelItem.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
    await click('保存')
    expect(modal('编辑数据').props('show')).toBe(true)
    expect(button('取消').attributes('disabled')).toBeDefined()
    wrapper.findAllComponents(NButton).find(value => value.text() === '保存')!.vm.$emit('click')
    await nextTick()
    expect(store.updateDataPanelItem).toHaveBeenCalledTimes(1)
    expect(messages.success).not.toHaveBeenCalled()
    fail(new Error('数据写盘失败')); await flushPromises()
    expect(messages.error).toHaveBeenCalledWith('数据写盘失败')
    expect(nameInput().props('value')).toBe('作者保留的库存名称')
    expect(wrapper.getComponent(DataPanelFieldEditor).props('fields')).toEqual(fields)
    expect(book.dataPanels[0].name).toBe('合成库存')
    store.updateDataPanelItem.mockResolvedValueOnce(false)
    await click('保存')
    expect(messages.warning).toHaveBeenCalledWith(conflict)
    expect(modal('编辑数据').props('show')).toBe(true)
    store.updateDataPanelItem.mockResolvedValueOnce(true)
    await click('保存')
    expect(modal('编辑数据').props('show')).toBe(false)
    expect(store.captureDataPanelEditBaseline).toHaveBeenCalledTimes(1)
    for (const args of store.updateDataPanelItem.mock.calls) {
      expect(args).toEqual(['synthetic-book', 'panel', expect.objectContaining({ name: '作者保留的库存名称', fields: [{ ...fields[0], automationRules: [] }] }), 'opened-data'])
    }
    expect(messages.success).toHaveBeenCalledTimes(1)
  })

  it('keeps a new object form on a null result and only closes it after successful creation', async () => {
    const { item } = setup()
    await click('新建数据')
    nameInput().vm.$emit('update:value', '新合成对象')
    store.captureDataPanelEditBaseline.mockReturnValue('background-data')
    store.addDataPanelItem.mockResolvedValueOnce(null)
    await click('保存')
    expect(modal('新建数据').props('show')).toBe(true)
    expect(nameInput().props('value')).toBe('新合成对象')
    expect(messages.success).not.toHaveBeenCalled()
    store.addDataPanelItem.mockResolvedValueOnce({ ...item, name: '新合成对象' })
    await click('保存')
    expect(modal('新建数据').props('show')).toBe(false)
    expect(store.addDataPanelItem).toHaveBeenCalledTimes(2)
    for (const args of store.addDataPanelItem.mock.calls) expect(args).toEqual(['synthetic-book', expect.objectContaining({ name: '新合成对象' }), 'opened-data'])
  })

  it('preserves a clock draft and its original baseline across background updates and failed saves', async () => {
    const { book } = setup()
    const day = wrapper.getComponent(NInputNumber)
    const label = wrapper.findAllComponents(NInput).find(value => value.attributes('placeholder') === '显示名称（可选）')!
    day.vm.$emit('update:value', 8); label.vm.$emit('update:value', '作者指定日')
    book.storyClock = { currentDay: 20, label: '后台时钟', updatedAt: now }
    store.captureDataClockBaseline.mockReturnValue('background-clock')
    await nextTick()
    expect(day.props('value')).toBe(8); expect(label.props('value')).toBe('作者指定日')
    store.setStoryClock.mockRejectedValueOnce(new Error('时钟写盘失败'))
    await click('确认故事起点')
    expect(messages.error).toHaveBeenCalledWith('时钟写盘失败')
    expect(store.setStoryClock).toHaveBeenLastCalledWith(book.id, 8, '作者指定日', 'loaded-clock')
    store.setStoryClock.mockResolvedValueOnce(null)
    await click('确认故事起点')
    expect(day.props('value')).toBe(8); expect(label.props('value')).toBe('作者指定日')
    expect(messages.success).not.toHaveBeenCalled()
    store.captureDataClockBaseline.mockReturnValue('saved-clock')
    store.setStoryClock.mockResolvedValue({ currentDay: 8, label: '作者指定日', updatedAt: now,
      origin: { id: 'origin', day: 8, label: '作者指定日', confirmedAt: now, source: 'author' } })
    await click('确认故事起点')
    day.vm.$emit('update:value', 9)
    await click('确认故事起点')
    expect(store.setStoryClock).toHaveBeenLastCalledWith(book.id, 9, '作者指定日', 'saved-clock')
    expect(store.queueAutomaticDataPanelChanges).not.toHaveBeenCalled()
  })

  it('retains the selected historical version after failure and sends the opening baseline on retry', async () => {
    setup()
    await wrapper.get('[title="查看历史版本"]').trigger('click')
    store.captureDataPanelEditBaseline.mockReturnValue('changed-data')
    store.restoreDataPanelVersion.mockRejectedValueOnce(new Error('恢复写盘失败')).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    await click('恢复此版本')
    expect(messages.error).toHaveBeenCalledWith('恢复写盘失败')
    expect(modal('数据面板版本').props('show')).toBe(true)
    expect(modal('数据面板版本').getComponent(NSelect).props('value')).toBe('version')
    await click('恢复此版本')
    expect(modal('数据面板版本').props('show')).toBe(true)
    await click('恢复此版本')
    expect(modal('数据面板版本').props('show')).toBe(false)
    for (const args of store.restoreDataPanelVersion.mock.calls) expect(args).toEqual(['synthetic-book', 'panel', 'version', 'opened-data'])
  })

  it('retains the selected object after delete failure and uses the confirmation-opening baseline', async () => {
    setup()
    const confirm = wrapper.getComponent(NPopconfirm)
    await wrapper.get('[title="删除数据"]').trigger('click')
    store.captureDataPanelEditBaseline.mockReturnValue('changed-data')
    store.deleteDataPanelItem.mockRejectedValueOnce(new Error('删除写盘失败')).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    confirm.vm.$emit('positive-click'); await flushPromises()
    expect(messages.error).toHaveBeenCalledWith('删除写盘失败')
    expect(wrapper.find('.selected-data-detail').exists()).toBe(true)
    confirm.vm.$emit('positive-click'); await flushPromises()
    expect(messages.success).not.toHaveBeenCalled()
    confirm.vm.$emit('positive-click'); await flushPromises()
    expect(wrapper.find('.selected-data-detail').exists()).toBe(false)
    for (const args of store.deleteDataPanelItem.mock.calls) expect(args).toEqual(['synthetic-book', 'panel', 'opened-data'])
  })

  it.each([['应用', 'applyDataPanelChange'], ['忽略', 'rejectDataPanelChange']] as const)('awaits %s, exposes failures and allows retry', async (label, action) => {
    setup()
    let settle!: (value: boolean) => void
    store[action].mockImplementationOnce(() => new Promise(resolve => { settle = resolve }))
    await click(label)
    expect(messages.success).not.toHaveBeenCalled()
    expect(button(label).attributes('disabled')).toBeDefined()
    settle(false); await flushPromises()
    expect(messages.warning).toHaveBeenCalledWith(conflict)
    store[action].mockRejectedValueOnce(new Error('提案写盘失败'))
    await click(label)
    expect(messages.error).toHaveBeenCalledWith('提案写盘失败')
    store[action].mockResolvedValueOnce(true)
    await click(label)
    expect(messages.success).toHaveBeenCalledTimes(1)
  })
})
