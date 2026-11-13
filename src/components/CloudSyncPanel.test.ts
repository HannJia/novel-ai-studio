// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { reactive } from 'vue'
import { NCheckbox, NRadioGroup, NSwitch } from 'naive-ui'
import CloudSyncPanel from './CloudSyncPanel.vue'
import { copyText } from '@/utils/clipboard'

const holder = vi.hoisted(() => ({ store: null as any }))
vi.mock('@/stores/cloudSync', () => ({ useCloudSyncStore: () => holder.store }))
vi.mock('@/utils/clipboard', () => ({ copyText: vi.fn() }))
vi.mock('naive-ui', async original => ({ ...await original<object>(), useDialog: () => ({ warning: vi.fn() }) }))
beforeEach(() => {
  vi.mocked(copyText).mockReset().mockResolvedValue('browser')
  holder.store = reactive({ session: null, error: '', busy: false, state: { binding: null, enabled: false }, endpoint: 'https://example.test',
    pendingUploads: [], setEnabled: vi.fn().mockResolvedValue(undefined), approveUploads: vi.fn().mockResolvedValue(undefined),
    conflicts: [], pendingConflicts: [], authenticate: vi.fn().mockResolvedValue(''), recover: vi.fn().mockResolvedValue({ recoveryCode: 'test-recovery' }),
    changePassword: vi.fn().mockImplementation(async () => { holder.store.session = null }) })
})
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })
function mountPanel() {
  return shallowMount(CloudSyncPanel, { global: { renderStubDefaultSlot: true, stubs: {
    Input: { props: ['value'], emits: ['update:value'], template: '<input :value="value" @input="$emit(\'update:value\', $event.target.value)" />' },
    Button: { props: ['disabled'], template: '<button :disabled="disabled"><slot /></button>' },
    Modal: { props: ['show'], template: '<section v-if="show"><slot /><slot name="footer" /></section>' },
  } } })
}
describe('cloud password forms', () => {
  async function showRecovery() {
    holder.store.authenticate.mockResolvedValue('RECOVERY-TEST-ONLY')
    const wrapper = mountPanel()
    await wrapper.get('input[aria-label="云同步账号"]').setValue('test-author')
    await wrapper.get('input[aria-label="云同步密码"]').setValue('test-password')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    return wrapper
  }
  it('keeps copy errors visible inside the recovery dialog instead of behind its mask', async () => {
    vi.mocked(copyText).mockRejectedValueOnce(new Error('denied'))
    const wrapper = await showRecovery()
    await wrapper.get('button[aria-label="复制恢复码"]').trigger('click')
    await flushPromises()
    expect(copyText).toHaveBeenCalledExactlyOnceWith('RECOVERY-TEST-ONLY')
    expect(wrapper.get('.cloud-recovery-modal [role="status"]').text()).toContain('复制失败')
    expect(wrapper.get('.cloud-recovery-modal [role="status"]').text()).not.toContain('RECOVERY-TEST-ONLY')
    expect(wrapper.find('.cloud-panel > .cloud-feedback').exists()).toBe(false)
    expect(wrapper.find('button[aria-label="复制恢复码"]').exists()).toBe(true)
    wrapper.unmount()
  })
  it.each(['system', 'browser'] as const)('shows the actual copy destination (%s)', async channel => {
    vi.mocked(copyText).mockResolvedValueOnce(channel)
    const wrapper = await showRecovery()
    await wrapper.get('button[aria-label="复制恢复码"]').trigger('click')
    await flushPromises()
    const message = wrapper.get('.cloud-recovery-modal [role="status"]').text()
    expect(message).toContain(channel === 'system' ? '已复制到系统剪贴板' : '已请求浏览器复制，请粘贴确认')
    if (channel === 'browser') expect(message).not.toContain('已复制到系统剪贴板')
    wrapper.unmount()
  })
  it('announces the download request and keeps the blob alive until the browser can receive it', async () => {
    vi.useFakeTimers()
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:recovery-test-only')
    let clickedWhileAttached = false
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clickedWhileAttached = this.isConnected && this.download === '云同步账号恢复码.txt'
    })
    const wrapper = await showRecovery()
    await wrapper.findAll('button').find(button => button.text() === '下载恢复码')!.trigger('click')
    expect(clickedWhileAttached).toBe(true)
    expect(wrapper.get('.cloud-recovery-modal [role="status"]').text()).toContain('浏览器下载列表')
    expect(wrapper.get('.cloud-recovery-modal a.cloud-download-fallback').text()).toContain('点此保存')
    expect(revoke).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(60000)
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:recovery-test-only')
    wrapper.unmount()
  })
  it('can start the first download without selecting or approving local uploads', async () => {
    holder.store.session = { user: { username: 'author', usedBytes: 0, quotaBytes: 100, role: 'user' } }
    const wrapper = mountPanel()
    const toggle = wrapper.findComponent(NSwitch)
    expect(toggle.props('disabled')).toBe(false)
    toggle.vm.$emit('update:value', true)
    await flushPromises()
    expect(holder.store.setEnabled).toHaveBeenCalledWith(true)
    expect(holder.store.approveUploads).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('首次开启先下载云端内容')
    wrapper.unmount()
  })
  it('approves only checked local works and requires a fresh selection afterwards', async () => {
    holder.store.session = { user: { username: 'author', usedBytes: 0, quotaBytes: 100, role: 'user' } }
    holder.store.state.enabled = true
    holder.store.pendingUploads = [
      { key: 'novel:first', title: '第一本', kind: 'novel' },
      { key: 'novel:second', title: '第二本', kind: 'novel' },
    ]
    const wrapper = mountPanel()
    const approveButton = () => wrapper.findAll('button').find(button => button.text() === '将所选内容加入云同步')!
    expect(approveButton().attributes('disabled')).toBeDefined()
    wrapper.findAllComponents(NCheckbox)[0].vm.$emit('update:checked', true)
    await flushPromises()
    expect(approveButton().attributes('disabled')).toBeUndefined()
    await approveButton().trigger('click')
    await flushPromises()
    expect(holder.store.approveUploads).toHaveBeenCalledExactlyOnceWith(['novel:first'])
    expect(approveButton().attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
  it.each([false, true])('does not expose a server address or editable server control (signed in=%s)', signedIn => {
    if (signedIn) holder.store.session = { endpoint: 'https://example.test', user: { username: 'author', usedBytes: 0, quotaBytes: 100, role: 'user' } }
    const wrapper = mountPanel()
    expect(wrapper.find('[aria-label="同步服务器地址"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('https://example.test')
    expect(wrapper.find('.cloud-server').exists()).toBe(false)
    wrapper.unmount()
  })
  it('requires a repeated six-character password on registration even for direct submit', async () => {
    const wrapper = mountPanel()
    wrapper.findComponent(NRadioGroup).vm.$emit('update:value', 'register')
    await flushPromises()
    await wrapper.get('input[aria-label="云同步账号"]').setValue('author')
    await wrapper.get('input[aria-label="云同步密码"]').setValue('123456')
    await wrapper.get('input[aria-label="确认云同步密码"]').setValue('654321')
    await wrapper.get('form').trigger('submit')
    expect(holder.store.authenticate).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('两次输入')
    await wrapper.get('input[aria-label="确认云同步密码"]').setValue('123456')
    await wrapper.get('input[aria-label="注册邀请码"]').setValue('invite')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(holder.store.authenticate).toHaveBeenCalledWith('register', 'author', '123456', 'invite')
    wrapper.unmount()
  })
  it('requires old password and confirmation for changes and returns to login on success', async () => {
    holder.store.session = { endpoint: 'https://example.test', user: { username: 'author', usedBytes: 0, quotaBytes: 100, role: 'user' } }
    const wrapper = mountPanel()
    await wrapper.findAll('button').find(button => button.text() === '修改密码')!.trigger('click')
    await wrapper.get('input[aria-label="当前云同步密码"]').setValue('old-password')
    await wrapper.get('input[aria-label="新的云同步密码"]').setValue('123456')
    await wrapper.get('input[aria-label="确认新的云同步密码"]').setValue('123457')
    await wrapper.get('.cloud-password-form').trigger('submit')
    expect(holder.store.changePassword).not.toHaveBeenCalled()
    await wrapper.get('input[aria-label="确认新的云同步密码"]').setValue('123456')
    await wrapper.get('.cloud-password-form').trigger('submit')
    await flushPromises()
    expect(holder.store.changePassword).toHaveBeenCalledWith('old-password', '123456')
    expect(wrapper.text()).toContain('密码已修改')
    expect(wrapper.find('.cloud-password-form').exists()).toBe(false)
    wrapper.unmount()
  })
})
