// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ChatSearchEvidence from './ChatSearchEvidence.vue'

it('shares safe evidence rendering between inspiration and book chats', async () => {
  const wrapper = mount(ChatSearchEvidence, { props: { record: {
    protocol: 'responses', status: 'searched', sources: [
      { title: '正常出处', url: 'https://example.org/event', excerpt: '来自接口的原文摘录' },
      { title: '不安全出处', url: 'javascript:alert(1)' },
    ],
  } } })
  expect(wrapper.findAll('a')).toHaveLength(1)
  expect(wrapper.find('a').attributes()).toMatchObject({
    href: 'https://example.org/event', target: '_blank', rel: 'noopener noreferrer', referrerpolicy: 'no-referrer',
  })
  expect(wrapper.text()).toContain('不安全出处（无效链接）')
  expect(wrapper.find('q').text()).toBe('来自接口的原文摘录')
  await wrapper.setProps({ record: { protocol: 'responses', status: 'not-used', sources: [] } })
  expect(wrapper.text()).toContain('本轮未执行搜索')
  expect(wrapper.find('details').exists()).toBe(false)
  wrapper.unmount()
})

it('keeps URLs only in clickable hrefs, not in titles or excerpts', () => {
  const url = 'https://example.org/very/long/article?utm_source=provider'
  const wrapper = mount(ChatSearchEvidence, { props: { record: {
    protocol: 'responses', status: 'searched', sources: [
      { title: `[${url}](${url})`, url, excerpt: `原文：详见 ${url}` },
      { title: '<img src=x onerror=alert(1)>', url: 'https://example.org/second' },
    ],
  } } })
  expect(wrapper.text()).not.toContain('https://')
  expect(wrapper.find('a').text()).toBe('网页来源 1')
  expect(wrapper.find('a').attributes('href')).toBe(url)
  expect(wrapper.find('img').exists()).toBe(false)
  wrapper.unmount()
})
