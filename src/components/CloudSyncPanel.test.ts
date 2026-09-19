// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { reactive } from 'vue'
import { NRadioGroup } from 'naive-ui'
import CloudSyncPanel from './CloudSyncPanel.vue'

const holder = vi.hoisted(() => ({ store: null as any }))
vi.mock('@/stores/cloudSync', () => ({ useCloudSyncStore: () => holder.store }))
vi.mock('naive-ui', async original => ({ ...await original<object>(), useDialog: () => ({ warning: vi.fn() }) }))
beforeEach(() => {
  holder.store = reactive({ session: null, error: '', busy: false, state: { binding: null, enabled: false }, endpoint: 'https://example.test',
    conflicts: [], pendingConflicts: [], authenticate: vi.fn().mockResolvedValue(''), recover: vi.fn().mockResolvedValue({ recoveryCode: 'test-recovery' }),
    changePassword: vi.fn().mockImplementation(async () => { holder.store.session = null }) })
})
function mountPanel() {
  return shallowMount(CloudSyncPanel, { global: { renderStubDefaultSlot: true, stubs: {
    Input: { props: ['value'], emits: ['update:value'], template: '<input :value="value" @input="$emit(\'update:value\', $event.target.value)" />' },
    Button: { props: ['disabled'], template: '<button :disabled="disabled"><slot /></button>' },
    Modal: { props: ['show'], template: '<section v-if="show"><slot /><slot name="footer" /></section>' },
  } } })
}
describe('cloud password forms', () => {
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
