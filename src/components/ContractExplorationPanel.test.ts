// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { createEmptyCreationDraft } from '@/types/reconstruction'
import { useConfigStore } from '@/stores/config'
import { callAI } from '@/services/ai'
import ContractExplorationPanel from './ContractExplorationPanel.vue'
import type { ContractExploration } from '@/types/reconstruction'

vi.mock('@/services/ai', () => ({ callAI: vi.fn() }))
const now = '2026-11-10T00:00:00.000Z'
beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks() })
function fixture(flush = vi.fn(async () => {})) {
  vi.spyOn(useConfigStore(), 'getModelForTask').mockReturnValue({ id: 'test', apiKey: 'private-test-key', modelName: 'test' } as never)
  return mount(ContractExplorationPanel, { props: { contract: createEmptyCreationDraft({ id: 'test', now }).contract, flush } })
}
function latest(wrapper: ReturnType<typeof fixture>) {
  return wrapper.emitted('change')!.slice(-1)[0][0] as ContractExploration
}
describe('contract exploration persistence boundary', () => {
  it('flushes the author message before exactly one explicit request and requires adoption', async () => {
    const flush = vi.fn(async () => {}).mockImplementationOnce(async () => { expect(callAI).not.toHaveBeenCalled() })
    const wrapper = fixture(flush)
    vi.mocked(callAI).mockResolvedValue({ finishReason: 'stop', content: JSON.stringify({ reply: '建议使用限知视角。', suggestions: [{ cardId: 'voice', values: { pointOfView: '第三人称限知' } }] }) })
    await wrapper.get('textarea').setValue('从谁的视角讲？')
    expect(callAI).not.toHaveBeenCalled()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(callAI).toHaveBeenCalledTimes(1)
    expect(vi.mocked(callAI).mock.calls[0][0].noAutomaticRetry).toBe(true)
    expect(latest(wrapper).messages[1].status).toBe('completed')
    expect(wrapper.emitted('adopt')).toBeUndefined()
    await wrapper.get('details button').trigger('click')
    expect(wrapper.emitted('adopt')).toHaveLength(1)
    wrapper.unmount()
  })
  it('prevents a paid request when the recovery flush fails and keeps input in the saved conversation', async () => {
    const wrapper = fixture(vi.fn(async () => { throw new Error('磁盘失败') }))
    await wrapper.get('textarea').setValue('让主角追查旧信')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(callAI).not.toHaveBeenCalled()
    expect(latest(wrapper).messages[0].content).toBe('让主角追查旧信')
    expect(latest(wrapper).messages[1].status).toBe('failed')
    expect(wrapper.text()).toContain('尚未保存')
    wrapper.unmount()
  })
  it('keeps truncated output without adoptable suggestions', async () => {
    const wrapper = fixture()
    vi.mocked(callAI).mockImplementation(async options => {
      options.onChunk?.('{"reply":"未完')
      return { content: '{"reply":"未完', finishReason: 'length' }
    })
    await wrapper.get('textarea').setValue('帮我追问')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(latest(wrapper).messages[1]).toMatchObject({ status: 'partial', content: '{"reply":"未完' })
    expect(wrapper.find('details').exists()).toBe(false)
    wrapper.unmount()
  })
  it('stops a running request and retains the partial stream', async () => {
    const wrapper = fixture()
    vi.mocked(callAI).mockImplementation(options => new Promise((_resolve, reject) => {
      options.onChunk?.('部分回复')
      options.signal!.addEventListener('abort', () => reject(new DOMException('停止', 'AbortError')))
    }))
    await wrapper.get('textarea').setValue('再问一个问题')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    await wrapper.get('button').trigger('click'); await flushPromises()
    expect(latest(wrapper).messages[1]).toMatchObject({ status: 'interrupted', content: '部分回复' })
    expect(wrapper.emitted('busy')?.slice(-1)[0]).toEqual([false])
    wrapper.unmount()
  })
})
