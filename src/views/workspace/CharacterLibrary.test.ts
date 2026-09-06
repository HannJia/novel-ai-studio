// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, shallowMount } from '@vue/test-utils'
import CharacterLibrary from './CharacterLibrary.vue'
import { useNovelStore } from '@/stores/novel'
import { useConfigStore } from '@/stores/config'
import { callAI } from '@/services/ai'

const { route, notify } = vi.hoisted(() => ({
  route: { params: { novelId: '' } }, notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))
vi.mock('vue-router', () => ({ useRoute: () => reactive(route) }))
vi.mock('@/services/ai', () => ({ callAI: vi.fn() }))
vi.mock('naive-ui', async original => ({ ...await original<object>(), useMessage: () => notify }))
const paint = { clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
  fillText: vi.fn(), arc: vi.fn(), fill: vi.fn(), fillRect: vi.fn(), measureText: () => ({ width: 50 }) }

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(paint as unknown as CanvasRenderingContext2D)
})
afterEach(() => vi.restoreAllMocks())

function setup() {
  const store = useNovelStore()
  const book = store.addNovel({ genre: 'urban', subGenre: 'business', tags: [], targetWordCountMin: 80, targetWordCountMax: 100,
    writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() })
  const a = store.addCharacter(book.id, { name: '甲', identity: '工人' })!
  const b = store.addCharacter(book.id, { name: '乙', identity: '甲的同事' })!
  store.updateOutline(book.id, '甲与乙是同事，合作创业。')
  route.params.novelId = book.id
  useConfigStore().models = [{ id: 'fixture', name: 'fixture', baseUrl: 'https://example.test', modelName: 'fixture',
    apiKey: 'synthetic', temperature: 0.7, topP: 0.9, maxTokens: 4000 }]
  const wrapper = shallowMount(CharacterLibrary, { global: { renderStubDefaultSlot: true, stubs: {
    Button: { props: ['disabled'], template: '<button :disabled="disabled"><slot /></button>' },
    Modal: { props: ['show'], template: '<section v-if="show" role="dialog"><slot /><slot name="footer"/><slot name="action"/></section>' },
    Drawer: { props: ['show'], template: '<aside v-if="show"><slot /></aside>' },
    DrawerContent: { props: ['title'], template: '<div><h3>{{ title }}</h3><slot /></div>' },
  } } })
  const button = (text: string) => wrapper.findAll('button').find(item => item.text().includes(text))!
  return { store, book, a, b, wrapper, button }
}

describe('character relationship workflow', () => {
  it('replaces the list with the graph, draws reverse-only edges and refreshes in-place edits', async () => {
    const { store, book, a, b, wrapper, button } = setup()
    store.updateCharacter(book.id, b.id, { relationships: [{ targetId: a.id, targetName: a.name, relation: '同事' }] })
    await button('关系图').trigger('click')
    await flushPromises()
    expect(wrapper.find('.char-grid').exists()).toBe(false)
    expect(paint.fillText).toHaveBeenCalledWith('同事', expect.any(Number), expect.any(Number))
    expect(wrapper.get('.graph-legend').text()).toContain('1 条关系')
    paint.fillText.mockClear()
    store.updateCharacter(book.id, b.id, { relationships: [{ targetId: a.id, targetName: '旧名', relation: '合伙人' }] })
    await flushPromises()
    expect(paint.fillText).toHaveBeenCalledWith('合伙人', expect.any(Number), expect.any(Number))
    await button('列表').trigger('click')
    expect(wrapper.find('canvas').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows empty relationships and applies filters in graph mode', async () => {
    const { wrapper, button } = setup()
    await button('关系图').trigger('click')
    expect(wrapper.text()).toContain('尚无已确认关系')
    wrapper.findAllComponents({ name: 'Input' })[0].vm.$emit('update:value', '不存在')
    await flushPromises()
    expect(wrapper.find('canvas').exists()).toBe(false)
    expect(wrapper.text()).toContain('没有匹配的角色')
    wrapper.unmount()
  })

  it('supports outline-only analysis, validates targets, and writes only after confirmation', async () => {
    const { book, a, b, wrapper, button } = setup()
    vi.mocked(callAI).mockResolvedValue({ content: JSON.stringify([
      { sourceName: b.name, targetName: a.name, relation: '同事' },
      { sourceName: b.name, targetName: a.name, relation: '同事' },
      { sourceName: a.name, targetName: '不存在', relation: '朋友' },
      { sourceName: a.name, targetName: a.name, relation: '自己' }, null,
    ]) })
    await button('补全关系').trigger('click')
    await flushPromises()
    expect(book.chapters).toHaveLength(0)
    expect(vi.mocked(callAI).mock.calls[0][0].messages[1].content).toContain(book.outline)
    expect(wrapper.findAll('.relationship-review-row')).toHaveLength(1)
    expect(b.relationships).toHaveLength(0)
    await button('确认写入').trigger('click')
    expect(b.relationships).toEqual([{ targetId: a.id, targetName: a.name, relation: '同事' }])
    await button('补全关系').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.relationship-review-row')).toHaveLength(0)
    expect(b.relationships).toHaveLength(1)
    wrapper.unmount()
  })

  it.each(['stop', 'mutate', 'unmount'])('rejects stale analysis results after %s', async action => {
    const { store, book, a, b, wrapper, button } = setup()
    let finish!: (value: { content: string }) => void
    vi.mocked(callAI).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    await button('补全关系').trigger('click')
    if (action === 'stop') await button('停止').trigger('click')
    if (action === 'mutate') store.updateOutline(book.id, '已经改变的故事')
    if (action === 'unmount') wrapper.unmount()
    finish({ content: JSON.stringify([{ sourceName: a.name, targetName: b.name, relation: '同事' }]) })
    await flushPromises()
    expect(a.relationships).toHaveLength(0)
    if (action !== 'unmount') {
      expect(wrapper.findAll('.relationship-review-row')).toHaveLength(0)
      wrapper.unmount()
    }
  })

  it('opens details by clicking a scaled graph node and includes incoming relationships', async () => {
    const { store, book, a, b, wrapper, button } = setup()
    store.updateCharacter(book.id, b.id, { relationships: [{ targetId: a.id, targetName: a.name, relation: '同事' }] })
    await button('关系图').trigger('click')
    await flushPromises()
    const canvas = wrapper.get('canvas')
    vi.spyOn(canvas.element, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 350, height: 220 } as DOMRect)
    await canvas.trigger('click', { clientX: 98, clientY: 110 })
    expect(wrapper.get('aside').text()).toContain('乙 → 甲')
    expect(wrapper.get('aside').text()).toContain('同事')
    wrapper.unmount()
  })

  it('rejects confirmation when the underlying book was edited', async () => {
    const { book, store, a, b, wrapper, button } = setup()
    vi.mocked(callAI).mockResolvedValue({ content: JSON.stringify([{ sourceName: a.name, targetName: b.name, relation: '同事' }]) })
    await button('补全关系').trigger('click')
    await flushPromises()
    store.updateCharacter(book.id, a.id, { name: '新名字' })
    await button('确认写入').trigger('click')
    expect(a.relationships).toHaveLength(0)
    expect(notify.warning).toHaveBeenCalledWith('资料已变化，请重新分析人物关系')
    wrapper.unmount()
  })

  it('does not write into another book after navigating away during a scan', async () => {
    const { store, book, a, b, wrapper, button } = setup()
    const other = store.addNovel({ genre: 'urban', subGenre: 'business', tags: [], targetWordCountMin: 80, targetWordCountMax: 100,
      writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() })
    let finish!: (result: { content: string }) => void
    vi.mocked(callAI).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    await button('补全关系').trigger('click')
    reactive(route).params.novelId = other.id
    await flushPromises()
    expect(vi.mocked(callAI).mock.calls[0][0].signal?.aborted).toBe(true)
    finish({ content: JSON.stringify([{ sourceName: a.name, targetName: b.name, relation: '同事' }]) })
    await flushPromises()
    expect(book.characters[0].relationships).toHaveLength(0)
    expect(other.characters).toHaveLength(0)
    wrapper.unmount()
  })
})
