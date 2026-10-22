// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { shallowMount } from '@vue/test-utils'
import { NConfigProvider, zhCN, dateZhCN } from 'naive-ui'
import App from './App.vue'
import { nextTick } from 'vue'
import { cloudApplyBusy, cloudConfigApplying, cloudPreferencesBusy } from './services/appLifecycle'

describe('application language', () => {
  it('opens settings with focus and restores the invoking control on Escape', async () => {
    setActivePinia(createPinia())
    const w = shallowMount(App, { attachTo: document.body, global: { renderStubDefaultSlot: true, stubs: {
      RouterView: { template: '<div />' },
      AppHeader: { emits: ['open-settings'], template: '<button @click="$emit(\'open-settings\')">设置</button>' },
    } } })
    try {
      const trigger = w.get('button')
      trigger.element.focus()
      await trigger.trigger('click')
      await nextTick()
      expect(w.get('.app-shell').attributes('inert')).toBeDefined()
      expect(document.activeElement).toBe(w.get('.settings-overlay-close').element)
      await w.get('.settings-overlay').trigger('keydown', { key: 'Escape' })
      await nextTick()
      expect(w.find('.settings-overlay').exists()).toBe(false)
      expect(document.activeElement).toBe(trigger.element)
    } finally { w.unmount() }
  })

  it('keeps focused content and scroll during background config sync, retaining project merge protection', async () => {
    setActivePinia(createPinia())
    const wrapper = shallowMount(App, { attachTo: document.body, global: { renderStubDefaultSlot: true, stubs: {
      RouterView: { template: '<div />' }, AppHeader: { template: '<input aria-label="正在编辑的内容" />' },
    } } })
    try {
      const field = wrapper.get('input').element as HTMLInputElement
      field.value = '保留输入'
      field.focus()
      const content = wrapper.get('.main-content').element as HTMLElement
      content.scrollTop = 120
      cloudPreferencesBusy.value = true
      await nextTick()
      expect(wrapper.find('.project-transfer-overlay').exists()).toBe(false)
      expect(document.activeElement).toBe(field)
      expect(field.value).toBe('保留输入')
      expect(content.scrollTop).toBe(120)
      cloudConfigApplying.value = true
      cloudApplyBusy.value = true
      await nextTick()
      expect(wrapper.find('.project-transfer-overlay').exists()).toBe(false)
      expect(document.activeElement).toBe(field)
      cloudConfigApplying.value = false
      await nextTick()
      expect(wrapper.find('.project-transfer-overlay').exists()).toBe(true)
      expect(wrapper.get('.app-shell').attributes('inert')).toBeDefined()
    } finally {
      cloudApplyBusy.value = false; cloudConfigApplying.value = false; cloudPreferencesBusy.value = false
      wrapper.unmount()
    }
  })
  it('sets Chinese component and date locales globally, including confirmation popovers', () => {
    setActivePinia(createPinia())
    const wrapper = shallowMount(App, { global: { stubs: { RouterView: true } } })
    const config = wrapper.getComponent(NConfigProvider)
    expect(config.props('locale')).toEqual(zhCN)
    expect(config.props('dateLocale')).toEqual(dateZhCN)
    expect(config.props('locale')?.Popconfirm).toMatchObject({ positiveText: '确认', negativeText: '取消' })
    wrapper.unmount()
  })
})
