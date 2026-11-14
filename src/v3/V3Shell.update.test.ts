// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import V3Shell from './V3Shell.vue'
import { useAppUpdateStore } from '@/stores/appUpdate'
import type { AppUpdateState } from '@/types/update'

vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/', params: {}, query: {}, meta: { area: 'shelf' } }),
  useRouter: () => ({ push: vi.fn() }),
}))

let pinia: ReturnType<typeof createPinia>
let wrapper: ReturnType<typeof shallowMount>
beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  wrapper = shallowMount(V3Shell, { global: { plugins: [pinia], stubs: {
    RouterLink: { template: '<a><slot /></a>' }, RouterView: { template: '<div />' },
  } } })
})
afterEach(() => {
  wrapper.unmount()
  disposePinia(pinia)
})

function setUpdate(phase: AppUpdateState['phase'], autoCheck = false) {
  const store = useAppUpdateStore()
  store.state = { ...store.state, supported: true, phase, autoCheck,
    release: { version: '1.0.11', url: '', notes: '合成测试', publishedAt: '', canDownload: true } }
  return store
}

describe('版本号更新提醒', () => {
  it('关闭自动更新后显示红点，收起通知后仍可点击查看更新', async () => {
    const store = setUpdate('available')
    await nextTick()
    expect(wrapper.find('.rail-update-dot').exists()).toBe(true)
    expect(wrapper.get('.rail-ver').attributes('aria-label')).toContain('发现新版本 1.0.11')
    store.dismissNotice()
    await nextTick()
    expect(store.showNotice).toBe(false)
    expect(wrapper.find('.rail-update-dot').exists()).toBe(true)
    await wrapper.get('.rail-ver').trigger('click')
    expect(store.detailsOpen).toBe(true)
  })

  it('下载准备好后保留红点并说明可安装状态', async () => {
    setUpdate('downloaded')
    await nextTick()
    expect(wrapper.find('.rail-update-dot').exists()).toBe(true)
    expect(wrapper.get('.rail-ver').attributes('title')).toBe('更新已准备好 1.0.11')
  })

  it('自动更新开启时用准备好提示，不叠加版本号红点', async () => {
    setUpdate('downloaded', true)
    await nextTick()
    expect(wrapper.find('.rail-update-dot').exists()).toBe(false)
    expect(wrapper.get('.rail-ver').attributes('title')).toBe('更新已准备好 1.0.11')
  })

  it.each(['checking', 'downloading', 'idle', 'error'] as const)('已发现新版在%s状态仍保留红点', async phase => {
    setUpdate(phase)
    await nextTick()
    expect(wrapper.find('.rail-update-dot').exists()).toBe(true)
  })

  it('没有已发现新版、版本已最新或浏览器环境时收起红点', async () => {
    const store = useAppUpdateStore()
    expect(wrapper.find('.rail-update-dot').exists()).toBe(false)
    setUpdate('current')
    await nextTick()
    expect(wrapper.find('.rail-update-dot').exists()).toBe(false)
    store.state = { ...store.state, phase: 'available', release: null }
    await nextTick()
    expect(wrapper.find('.rail-update-dot').exists()).toBe(false)
    setUpdate('unsupported')
    await nextTick()
    expect(wrapper.find('.rail-update-dot').exists()).toBe(false)
  })
})
