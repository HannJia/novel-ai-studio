// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createEmptyCreationDraft, type StoryContract } from '@/types/reconstruction'
import StoryContractEditor from './StoryContractEditor.vue'
import { confirmTestContractCards } from '@/test/contractCardsFixture'

beforeEach(() => setActivePinia(createPinia()))
describe('contract card author confirmation', () => {
  it('uses compact cards, expands editing and revokes only the changed card until explicitly confirmed', async () => {
    const contract = createEmptyCreationDraft({ id: 'test', now: '2026-11-10T00:00:00.000Z' }).contract
    Object.assign(contract, { approval: 'approved', title: '渡口', genre: '悬疑', centralConflict: '查信', endingDirection: '离开' })
    Object.assign(contract, confirmTestContractCards(contract, contract.updatedAt))
    const wrapper = mount(StoryContractEditor, { props: { contract, cancelable: true } })
    await wrapper.get('footer .cancel').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('confirm')).toBeUndefined()
    expect(wrapper.findAll('.card-summary')).toHaveLength(8)
    expect(wrapper.text()).toContain('已确认 8 / 8')
    await wrapper.get('[aria-label="编辑视角与文风"]').trigger('click')
    await wrapper.get('[aria-label="叙事视角"]').setValue('第一人称')
    expect(wrapper.text()).toContain('已确认 7 / 8')
    const changed = wrapper.emitted('change')!.slice(-1)[0][0] as StoryContract
    expect(changed.cardConfirmations).toHaveLength(7)
    expect(changed.cardConfirmations!.some(item => item.cardId === 'theme')).toBe(true)
    await wrapper.get('[aria-label="确认视角与文风"]').trigger('click')
    expect(wrapper.text()).toContain('已确认 8 / 8')
    expect(wrapper.findAll('.card-summary')).toHaveLength(8)
    await wrapper.get('.story-contract > form').trigger('submit')
    expect(wrapper.emitted('confirm')).toHaveLength(1)
    wrapper.unmount()
  })
})
