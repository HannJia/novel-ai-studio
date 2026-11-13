// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import CharacterStateHistory from './CharacterStateHistory.vue'
import { characterStateFixture, knowledgeCandidate, relationshipCandidate, stateTestTime as now } from '@/test/characterStateFixture'
import { acceptCandidateChange } from '@/services/reconstructionReview'
import { applyCandidateChangeToCanon } from '@/services/reconstructionCanon'

beforeEach(() => setActivePinia(createPinia()))
describe('character memory history view', () => {
  it('switches historical state by chapter and exposes source quotes and links', async () => {
    const { novel } = characterStateFixture()
    const first = applyCandidateChangeToCanon(novel, acceptCandidateChange(knowledgeCandidate(novel, 0), now), now).record
    const second = applyCandidateChangeToCanon(novel, acceptCandidateChange(knowledgeCandidate(novel, 1), now), now, [first]).record
    const relation = applyCandidateChangeToCanon(novel, acceptCandidateChange(relationshipCandidate(novel, 1), now), now).record
    const wrapper = mount(CharacterStateHistory, { props: { novel, records: [first, second, relation] }, global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } })
    expect(wrapper.find('ul').text()).toContain('已知')
    expect(wrapper.find('ul').text()).toContain('林澈 → 苏禾')
    await wrapper.get('select[aria-label="回看章节"]').setValue(novel.chapters[0].id)
    expect(wrapper.find('ul').text()).toContain('错误信念')
    expect(wrapper.find('ul').text()).not.toContain('获知途径')
    expect(wrapper.text()).not.toContain('书信')
    expect(wrapper.get('blockquote').text()).toBe('林澈以为城主已经死了。')
    expect(wrapper.find('a').text()).toBe('打开来源章节')
    await wrapper.get('select[aria-label="历史角色筛选"]').setValue('person-1')
    expect(wrapper.find('ul').exists()).toBe(false)
    await wrapper.get('select[aria-label="回看章节"]').setValue(novel.chapters[1].id)
    expect(wrapper.find('ul').text()).toContain('林澈 → 苏禾')
    wrapper.unmount()
  })

  it('marks changed source material for re-review and retains its old quote as history', async () => {
    const { novel } = characterStateFixture()
    const record = applyCandidateChangeToCanon(novel, acceptCandidateChange(knowledgeCandidate(novel, 0), now), now).record
    novel.chapters[0].content = '重写后的正文。'
    const wrapper = mount(CharacterStateHistory, { props: { novel, records: [record] }, global: { stubs: ['RouterLink'] } })
    expect(wrapper.find('ul').exists()).toBe(false)
    expect(wrapper.get('[role="status"]').text()).toContain('需要重新审核')
    expect(wrapper.get('blockquote').text()).toContain('城主已经死了')
    wrapper.unmount()
  })
})
