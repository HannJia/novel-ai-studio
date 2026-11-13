// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { NInput } from 'naive-ui'
import OutlineView from './OutlineView.vue'
import { useNovelStore } from '@/stores/novel'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { useConfigStore } from '@/stores/config'
import { callAI } from '@/services/ai'
const { route, error } = vi.hoisted(() => ({ route: { params: { novelId: '' } }, error: vi.fn() }))
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/services/ai', () => ({ callAI: vi.fn() }))
vi.mock('naive-ui', async original => ({ ...await original<object>(), useMessage: () => ({ error, success: vi.fn() }) }))
let wrapper: ReturnType<typeof shallowMount>
function setup() {
  const store = useNovelStore()
  const created = store.addNovel({ genre: 'urban', subGenre: 'mystery', tags: [], targetWordCountMin: 50, targetWordCountMax: 100,
    settings: store.defaultSettings(), writingStyle: store.defaultWritingStyle() })
  const novel = store.getNovel(created.id)!
  store.updateOutline(novel.id, '原始总纲')
  route.params.novelId = novel.id
  vi.spyOn(useReconstructionWorkspaceStore(), 'transactStory').mockImplementation(async (id, operation) => operation({
    novel: store.getNovel(id)!, workspace: { candidates: [], reviewFindings: [], chapterReviews: [], canonMutations: [], aiRuns: [] },
  }))
  vi.spyOn(useConfigStore(), 'getModelForTask').mockReturnValue({ id: 'test', modelName: 'test' } as never)
  wrapper = shallowMount(OutlineView, { global: { renderStubDefaultSlot: true, stubs: {
    Button: { props: ['disabled'], emits: ['click'], template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>' },
  } } })
  return { store, novel }
}
const button = (label: string) => wrapper.findAll('button').find(item => item.text() === label)!
async function requestModification() {
  wrapper.getComponent(NInput).vm.$emit('update:value', '调整结尾')
  await flushPromises()
  await button('生成修改建议').trigger('click')
}
beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks(); vi.mocked(callAI).mockReset() })
afterEach(() => wrapper?.unmount())
describe('outline form and candidate baselines', () => {
  it('rejects an old form without losing the author input', async () => {
    const { store, novel } = setup()
    await button('编辑').trigger('click')
    wrapper.getComponent(NInput).vm.$emit('update:value', '旧表单中的作者输入')
    store.updateOutline(novel.id, '另一个窗口的新大纲')
    await button('保存').trigger('click'); await flushPromises()
    expect(novel.outline).toBe('另一个窗口的新大纲')
    expect(wrapper.getComponent(NInput).props('value')).toBe('旧表单中的作者输入')
    expect(error).toHaveBeenCalledWith(expect.stringContaining('已经变化'))
  })
  it('disables edits during persistence and retains the form on failure for retry', async () => {
    const { store, novel } = setup()
    await button('编辑').trigger('click')
    wrapper.getComponent(NInput).vm.$emit('update:value', '作者新稿')
    let reject!: (value: Error) => void
    vi.spyOn(store, 'updateOutlineWithImpact').mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
    await button('保存').trigger('click')
    expect(button('取消').attributes('disabled')).toBeDefined()
    expect(wrapper.getComponent(NInput).props('disabled')).toBe(true)
    reject(new Error('磁盘失败')); await flushPromises()
    expect(novel.outline).toBe('原始总纲')
    expect(wrapper.getComponent(NInput).props('value')).toBe('作者新稿')
    await button('保存').trigger('click'); await flushPromises()
    expect(novel.outline).toBe('作者新稿')
    expect(wrapper.find('.outline-editor').exists()).toBe(false)
  })
  it('never accepts a partial stream or a truncated response', async () => {
    const { novel } = setup()
    let release!: (value: never) => void
    vi.mocked(callAI).mockImplementationOnce(input => {
      input.onChunk?.('只返回一半')
      return new Promise(resolve => { release = resolve })
    })
    await requestModification()
    expect(button('采纳修改').attributes('disabled')).toBeDefined()
    release({ content: '只返回一半', finishReason: 'length' } as never); await flushPromises()
    expect(button('采纳修改').attributes('disabled')).toBeDefined()
    expect(novel.outline).toBe('原始总纲')
  })
  it('rejects a completed candidate when its base changes before acceptance', async () => {
    const { store, novel } = setup()
    vi.mocked(callAI).mockResolvedValueOnce({ content: 'AI 建议', finishReason: 'stop' } as never)
    await requestModification(); await flushPromises()
    expect(button('采纳修改').attributes('disabled')).toBeUndefined()
    store.updateOutline(novel.id, '等待确认期间的新大纲')
    await button('采纳修改').trigger('click'); await flushPromises()
    expect(novel.outline).toBe('等待确认期间的新大纲')
    expect(wrapper.find('.modify-preview').text()).toContain('AI 建议')
    expect(error).toHaveBeenCalledWith(expect.stringContaining('已经变化'))
  })
  it('rejects a response based on context that changed during generation', async () => {
    const { store, novel } = setup()
    let release!: (value: never) => void
    vi.mocked(callAI).mockImplementationOnce(input => {
      input.onChunk?.('迟到的建议')
      return new Promise(resolve => { release = resolve })
    })
    await requestModification()
    store.updateOutline(novel.id, '新方向')
    release({ content: '迟到的建议', finishReason: 'stop' } as never); await flushPromises()
    expect(novel.outline).toBe('新方向')
    expect(button('采纳修改').attributes('disabled')).toBeDefined()
    expect(error).toHaveBeenCalledWith(expect.stringContaining('已经变化'))
  })
})
