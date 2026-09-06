// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useNovelStore } from '@/stores/novel'
import InspirationArchive from './InspirationArchive.vue'
import { exportInspirationArchive } from '@/services/export'

const { route } = vi.hoisted(() => ({ route: { params: { novelId: '' } } }))
vi.mock('vue-router', () => ({ useRoute: () => reactive(route) }))
vi.mock('@/services/export', () => ({ exportInspirationArchive: vi.fn() }))
beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks() })

function setup() {
  const store = useNovelStore()
  const book = store.addNovel({ genre: '', subGenre: '', tags: [], targetWordCountMin: 1, targetWordCountMax: 2,
    writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() })
  route.params.novelId = book.id
  const wrapper = mount(InspirationArchive)
  return { store, book, wrapper }
}

it('shows an archive-specific empty state and disables export', () => {
  const { wrapper } = setup()
  expect(wrapper.text()).toContain('这本书没有灵感对话记录')
  expect(wrapper.findAll('button').every(button => button.attributes('disabled') !== undefined)).toBe(true)
  wrapper.unmount()
})

it('separates roles, safely displays archives and exports all messages beyond the current page', async () => {
  const { wrapper, store, book } = setup()
  const messages = Array.from({ length: 45 }, (_, index) => ({
    id: `idea-${index}`, role: index % 2 ? 'assistant' as const : 'user' as const,
    content: `想法${index}<script>alert(1)</script>`, timestamp: book.createdAt,
  }))
  store.setInspirationHistory(book.id, messages)
  store.addChatMessage(book.id, { id: 'private-chat', role: 'user', content: '书内聊天不应显示', timestamp: book.createdAt })
  await flushPromises()
  expect(wrapper.findAll('.archive-message')).toHaveLength(20)
  expect(wrapper.findAll('.archive-message.user')).toHaveLength(10)
  expect(wrapper.findAll('.archive-message.assistant')).toHaveLength(10)
  expect(wrapper.find('script').exists()).toBe(false)
  expect(wrapper.text()).not.toContain('书内聊天不应显示')
  await wrapper.findAll('button').find(button => button.text() === '下一页')!.trigger('click')
  expect(wrapper.findAll('.archive-message')[0].text()).toContain('想法20')
  await wrapper.findAll('button').find(button => button.text() === '导出 JSON')!.trigger('click')
  expect(exportInspirationArchive).toHaveBeenCalledWith(book, 'json')
  expect(vi.mocked(exportInspirationArchive).mock.calls[0][0].inspirationHistory).toHaveLength(45)
  store.clearChatHistory(book.id)
  await flushPromises()
  expect(wrapper.text()).toContain('共 45 条')
  reactive(route).params.novelId = 'another-book'
  await flushPromises()
  expect(wrapper.text()).toContain('没有灵感对话记录')
  wrapper.unmount()
})
