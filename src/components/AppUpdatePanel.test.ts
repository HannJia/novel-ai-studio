// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { shallowMount, flushPromises } from '@vue/test-utils'
import AppUpdatePanel from './AppUpdatePanel.vue'
import { useAppUpdateStore } from '@/stores/appUpdate'
import { appUpdateInstalling } from '@/services/appLifecycle'
import type { AppUpdateState } from '@/types/update'

const dialog = vi.hoisted(() => ({ warning: vi.fn() }))
vi.mock('naive-ui', async importOriginal => ({ ...await importOriginal<object>(), useDialog: () => dialog }))
const base: AppUpdateState = {
  supported: true, currentVersion: '1.0.2', phase: 'available', autoCheck: true, error: '', checkedAt: '',
  release: { version: '1.0.3', url: 'https://github.com/HannJia/novel-ai-studio/releases/tag/v1.0.3',
    notes: '<script>unsafe()</script>\n修复问题', publishedAt: '', canDownload: true },
  percent: 0, total: 0, transferred: 0, bytesPerSecond: 0, revision: 1,
}
const mounted: ReturnType<typeof shallowMount>[] = []
function mount() {
  const wrapper = shallowMount(AppUpdatePanel, { global: { renderStubDefaultSlot: true, stubs: {
    Button: { props: ['disabled'], emits: ['click'], template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>' },
  } } })
  mounted.push(wrapper)
  return wrapper
}
function mockBridge(initial: AppUpdateState = base) {
  let receive!: (state: AppUpdateState) => void
  const bridge = {
    updateGetState: vi.fn(async () => initial), onUpdateState: vi.fn(callback => { receive = callback; return vi.fn() }),
    updateCheck: vi.fn(async () => initial), updateDownload: vi.fn(async () => ({ ...initial, phase: 'downloaded', revision: 2 })),
    updateCancel: vi.fn(async () => ({ ...initial, phase: 'idle', revision: 3 })),
    updateInstall: vi.fn(async () => ({ ...initial, phase: 'installing', revision: 4 })),
    updateSetAutoCheck: vi.fn(async (enabled: boolean) => ({ ...initial, autoCheck: enabled, revision: 5 })),
    updateOpenRelease: vi.fn(async () => undefined),
  }
  window.electronAPI = bridge as unknown as ElectronAPI
  return { bridge, emit: (state: AppUpdateState) => receive(state) }
}
beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  delete window.electronAPI
  appUpdateInstalling.value = false
})
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  useAppUpdateStore().$dispose()
  delete window.electronAPI
  appUpdateInstalling.value = false
})
describe('update settings and notifications', () => {
  it('surfaces automatic check failures without pretending no newer version exists', async () => {
    mockBridge({ ...base, phase: 'error', release: null, error: '无法连接更新服务' })
    const wrapper = mount()
    await flushPromises()
    expect(useAppUpdateStore().showNotice).toBe(true)
    expect(wrapper.text()).toContain('无法连接更新服务')
    expect(wrapper.text()).not.toContain('已是最新')
    useAppUpdateStore().dismissNotice()
    expect(useAppUpdateStore().showNotice).toBe(false)
  })
  it('explains the browser limitation without displaying a fake successful check', async () => {
    const wrapper = mount()
    await flushPromises()
    expect(wrapper.text()).toContain('浏览器 / 开发环境不安装更新')
    expect(wrapper.findAll('button')[0].attributes('disabled')).toBeDefined()
    expect(wrapper.text()).not.toContain('当前已是最新版本')
    expect(wrapper.get('a').attributes('href')).toBe('https://github.com/HannJia/novel-ai-studio/releases')
  })
  it('renders release notes as plain text and downloads only on command', async () => {
    const { bridge } = mockBridge()
    const wrapper = mount()
    await flushPromises()
    expect(wrapper.text()).toContain('最新版本 1.0.3')
    expect(wrapper.find('pre script').exists()).toBe(false)
    expect(wrapper.get('pre').text()).toContain('<script>')
    expect(bridge.updateDownload).not.toHaveBeenCalled()
    await wrapper.findAll('button').find(button => button.text() === '下载更新')!.trigger('click')
    await flushPromises()
    expect(bridge.updateDownload).toHaveBeenCalledOnce()
    expect(bridge.updateInstall).not.toHaveBeenCalled()
    await wrapper.findAll('button').find(button => button.text() === '安装并重启')!.trigger('click')
    expect(bridge.updateInstall).not.toHaveBeenCalled()
    dialog.warning.mock.calls[0][0].onPositiveClick()
    await flushPromises()
    expect(bridge.updateInstall).toHaveBeenCalledOnce()
  })
  it('initializes one listener, ignores stale responses, and resets the install lock on failure', async () => {
    const { bridge, emit } = mockBridge()
    const store = useAppUpdateStore()
    await Promise.all([store.init(), store.init()])
    expect(bridge.onUpdateState).toHaveBeenCalledOnce()
    emit({ ...base, phase: 'installing', revision: 10 })
    expect(appUpdateInstalling.value).toBe(true)
    emit({ ...base, phase: 'available', revision: 2 })
    expect(store.state.phase).toBe('installing')
    emit({ ...base, phase: 'downloaded', error: 'AI 任务仍在运行', revision: 11 })
    expect(appUpdateInstalling.value).toBe(false)
    expect(store.state.error).toContain('AI 任务')
  })
  it('dismisses notices until the download completes without opening a blocking dialog', async () => {
    const { emit } = mockBridge()
    const store = useAppUpdateStore()
    await store.init()
    expect(store.showNotice).toBe(true)
    expect(store.detailsOpen).toBe(false)
    store.dismissNotice()
    expect(store.showNotice).toBe(false)
    emit({ ...base, phase: 'downloaded', revision: 2 })
    expect(store.showNotice).toBe(true)
  })
})
