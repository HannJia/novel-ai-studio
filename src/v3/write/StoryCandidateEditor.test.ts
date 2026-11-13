// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import StoryCandidateEditor from '@/v3/write/StoryCandidateEditor.vue'
import type { CandidateChange } from '@/types/reconstruction'
const candidate: CandidateChange = { id: 'event', type: 'fact', proposedValue: JSON.stringify({ title: '取得钥匙', description: '旧提案' }),
  evidence: [{ id: 'evidence', sourceType: 'chapter', sourceId: 'chapter', quote: '林澈拿到了钥匙。' }], status: 'proposed', createdAt: '', updatedAt: '' }
beforeEach(() => setActivePinia(createPinia()))
describe('author candidate editor', () => {
  it('keeps the opening baseline and draft across same-id refresh and failed-save retry', async () => {
    const wrapper = mount(StoryCandidateEditor, { props: { candidate } })
    await wrapper.get('[aria-label="事件标题"]').setValue('作者确认的钥匙')
    await wrapper.get('[aria-label="候选修改说明"]').setValue('证据只是取得，没有使用')
    await wrapper.setProps({ candidate: { ...candidate, proposedValue: JSON.stringify({ title: '另一次分析' }) }, busy: true })
    expect(wrapper.get<HTMLButtonElement>('[type="submit"]').element.disabled).toBe(true)
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('confirm')).toBeUndefined()
    await wrapper.setProps({ busy: false })
    expect(wrapper.get<HTMLInputElement>('[aria-label="事件标题"]').element.value).toBe('作者确认的钥匙')
    await wrapper.get('form').trigger('submit')
    const result = wrapper.emitted('confirm')![0]
    expect(result[0]).toEqual(candidate)
    expect(JSON.parse(result[1] as string).title).toBe('作者确认的钥匙')
    expect(result[2]).toBe('证据只是取得，没有使用')
    expect(wrapper.find('form').exists()).toBe(true)
    wrapper.unmount()
  })
  it('resets only on a different candidate and blocks invalid or disabled confirmation', async () => {
    const wrapper = mount(StoryCandidateEditor, { props: { candidate } })
    await wrapper.get('[aria-label="事件标题"]').setValue(' ')
    expect(wrapper.get('[role="alert"]').text()).toContain('标题')
    expect(wrapper.get<HTMLButtonElement>('[type="submit"]').element.disabled).toBe(true)
    await wrapper.setProps({ candidate: { ...candidate, id: 'other', type: 'timeline', proposedValue: '{"elapsedDays":2}' }, disabled: true })
    expect(wrapper.find('[aria-label="事件标题"]').exists()).toBe(false)
    expect(wrapper.get<HTMLInputElement>('[aria-label="故事推进天数"]').element.value).toBe('2')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('confirm')).toBeUndefined()
    wrapper.unmount()
  })
  it('shows malformed payload errors instead of a writable raw JSON field', () => {
    const wrapper = mount(StoryCandidateEditor, { props: { candidate: { ...candidate, proposedValue: 'not json' } } })
    expect(wrapper.get('[role="alert"]').text()).toContain('重新分析')
    expect(wrapper.get<HTMLButtonElement>('[type="submit"]').element.disabled).toBe(true)
    expect(wrapper.find('input').exists()).toBe(false)
    wrapper.unmount()
  })
})
