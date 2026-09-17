// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { shallowMount } from '@vue/test-utils'
import { NConfigProvider, zhCN, dateZhCN } from 'naive-ui'
import App from './App.vue'

describe('application language', () => {
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
