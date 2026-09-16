// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowMount, flushPromises } from '@vue/test-utils'
import ModelSearchTest from './ModelSearchTest.vue'
import { testChatSearch } from '@/services/chatSearch'
import type { ModelConfig } from '@/stores/config'

const dialog = vi.hoisted(() => ({ warning: vi.fn() }))
vi.mock('naive-ui', async original => ({
  ...await original<object>(), useDialog: () => dialog,
  useMessage: () => ({ success: vi.fn(), error: vi.fn() }),
}))
vi.mock('@/services/chatSearch', async original => ({ ...await original<object>(), testChatSearch: vi.fn() }))
const model: ModelConfig = {
  id: 'fixture', name: 'fixture', baseUrl: 'https://relay.example/v1', apiKey: 'synthetic-private-key',
  modelName: 'claude-test', temperature: 0.7, topP: 0.9, maxTokens: 4096,
}
const mounted: ReturnType<typeof shallowMount>[] = []
function mount() {
  const wrapper = shallowMount(ModelSearchTest, { props: { model: { ...model } }, global: {
    renderStubDefaultSlot: true, stubs: {
      Button: { props: ['disabled'], emits: ['click'], template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>' },
    },
  } })
  mounted.push(wrapper)
  return wrapper
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(testChatSearch).mockResolvedValue({ status: 'verified', message: '本次测试收到搜索证据和 1 个来源。', sourceCount: 1 })
})
afterEach(() => { for (const wrapper of mounted.splice(0)) wrapper.unmount() })

describe('model search diagnostics', () => {
  it('never makes a paid test request before confirmation', async () => {
    const wrapper = mount()
    expect(wrapper.text()).toContain('自动推测：Claude Messages')
    expect(testChatSearch).not.toHaveBeenCalled()
    await wrapper.findAll('button').find(button => button.text() === '测试联网')!.trigger('click')
    expect(dialog.warning.mock.calls[0][0].content).toContain('可能产生模型和搜索费用')
    expect(testChatSearch).not.toHaveBeenCalled()
    dialog.warning.mock.calls[0][0].onPositiveClick()
    await flushPromises()
    expect(testChatSearch).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('本次搜索已验证')
    expect(wrapper.text()).not.toContain('尚未验证服务商能力')
    expect(wrapper.text()).not.toContain(model.apiKey)
  })

  it('copies a persistent diagnostic without a key or endpoint', async () => {
    const copy = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: copy }, configurable: true })
    vi.mocked(testChatSearch).mockResolvedValue({ status: 'failed', message: '[HTTP_403] 搜索权限被拒绝。', sourceCount: 0 })
    const wrapper = mount()
    await wrapper.findAll('button')[0].trigger('click')
    dialog.warning.mock.calls[0][0].onPositiveClick()
    await flushPromises()
    expect(wrapper.text()).toContain('HTTP_403')
    await wrapper.findAll('button').find(button => button.text() === '复制诊断')!.trigger('click')
    expect(copy).toHaveBeenCalledWith(expect.stringContaining('HTTP_403'))
    expect(copy.mock.calls[0][0]).not.toContain(model.apiKey)
    expect(copy.mock.calls[0][0]).not.toContain(model.baseUrl)
  })

  it('cancels pending work when stopped or edited and ignores late results', async () => {
    let resolve!: (result: Awaited<ReturnType<typeof testChatSearch>>) => void
    vi.mocked(testChatSearch).mockImplementation(() => new Promise(done => { resolve = done }))
    const wrapper = mount()
    await wrapper.findAll('button')[0].trigger('click')
    dialog.warning.mock.calls[0][0].onPositiveClick()
    await flushPromises()
    const signal = vi.mocked(testChatSearch).mock.calls[0][1]
    await wrapper.findAll('button').find(button => button.text() === '停止测试')!.trigger('click')
    expect(signal.aborted).toBe(true)
    resolve({ status: 'verified', message: '过期结果', sourceCount: 1 })
    await flushPromises()
    expect(wrapper.text()).toContain('测试已停止')
    expect(wrapper.text()).not.toContain('过期结果')
    await wrapper.setProps({ model: { ...model, chatSearchProtocol: 'responses' } })
    expect(wrapper.text()).not.toContain('测试已停止')
    expect(wrapper.text()).toContain('已选择：Responses')
  })

  it('invalidates old results and does not run an old confirmation for changed settings', async () => {
    const wrapper = mount()
    await wrapper.findAll('button')[0].trigger('click')
    const confirm = dialog.warning.mock.calls[0][0].onPositiveClick
    await wrapper.setProps({ model: { ...model, modelName: 'different' } })
    confirm()
    expect(testChatSearch).not.toHaveBeenCalled()
    await wrapper.findAll('button')[0].trigger('click')
    dialog.warning.mock.calls[1][0].onPositiveClick()
    await flushPromises()
    expect(wrapper.text()).toContain('本次搜索已验证')
    await wrapper.setProps({ model: { ...model, apiKey: 'changed-key' } })
    expect(wrapper.text()).not.toContain('本次搜索已验证')
  })

  it('aborts the test when the settings dialog closes', async () => {
    vi.mocked(testChatSearch).mockImplementation(() => new Promise(() => {}))
    const wrapper = mount()
    await wrapper.findAll('button')[0].trigger('click')
    dialog.warning.mock.calls[0][0].onPositiveClick()
    const signal = vi.mocked(testChatSearch).mock.calls[0][1]
    wrapper.unmount()
    expect(signal.aborted).toBe(true)
  })
})
