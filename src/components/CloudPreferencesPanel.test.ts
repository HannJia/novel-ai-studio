// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { reactive } from 'vue'
import { NSwitch } from 'naive-ui'
import CloudPreferencesPanel from './CloudPreferencesPanel.vue'

const holder = vi.hoisted(() => ({ prefs: null as any, cloud: null as any }))
vi.mock('@/stores/cloudPreferences', () => ({ useCloudPreferencesStore: () => holder.prefs }))
vi.mock('@/stores/cloudSync', () => ({ useCloudSyncStore: () => holder.cloud }))
vi.mock('@/stores/config', () => ({ useConfigStore: () => ({ models: [] }) }))
beforeEach(() => {
  holder.prefs = reactive({ enabled: false, busy: false, supported: true, status: '尚未启用配置同步', error: '', remote: null,
    conflict: false, archiveCount: 0, initialize: vi.fn().mockResolvedValue(undefined),
    setEnabled: vi.fn().mockResolvedValue(undefined), syncNow: vi.fn().mockResolvedValue(undefined),
    upload: vi.fn().mockResolvedValue(undefined), restore: vi.fn().mockResolvedValue(undefined) })
  holder.cloud = reactive({ busy: false, session: { token: 'fixture-login' } })
})
function mountPanel() {
  return shallowMount(CloudPreferencesPanel, { global: { renderStubDefaultSlot: true, stubs: {
    Button: { props: ['disabled'], template: '<button :disabled="disabled"><slot /></button>' },
    Input: { props: ['value', 'type'], emits: ['update:value'], template: '<input :value="value" :type="type" @input="$emit(\'update:value\', $event.target.value)" />' },
  } } })
}

describe('automatic cloud configuration controls', () => {
  it('keeps opt-in and enables automatic sync without another password form', async () => {
    const wrapper = mountPanel()
    await flushPromises()
    expect(wrapper.find('input[type="password"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('无需另外设置密码')
    wrapper.findComponent(NSwitch).vm.$emit('update:value', true)
    await flushPromises()
    expect(holder.prefs.setEnabled).toHaveBeenCalledExactlyOnceWith(true)
    expect(holder.prefs.upload).not.toHaveBeenCalled()
    expect(holder.prefs.restore).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('requires an explicit choice for different local and remote models', async () => {
    holder.prefs.enabled = true; holder.prefs.conflict = true
    const wrapper = mountPanel()
    await flushPromises()
    expect(holder.prefs.restore).not.toHaveBeenCalled()
    expect(wrapper.find('input[type="password"]').exists()).toBe(false)
    await wrapper.findAll('button').find(button => button.text() === '使用云端配置')!.trigger('click')
    await flushPromises()
    expect(holder.prefs.restore).toHaveBeenCalledExactlyOnceWith(true)
    wrapper.unmount()
  })
})
