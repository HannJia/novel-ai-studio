// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { shallowMount } from '@vue/test-utils'
import CreationModePicker from '@/v3/create/CreationModePicker.vue'
import CreationEntrySource from '@/components/CreationEntrySource.vue'
import { createNovelDraft } from '@/stores/novel'
import { prepareStoryCreation } from './storyCreation'

describe('three creation entry contract', () => {
  it.each([
    ['inspiration', 'idea', { method: 'inspiration', idea: '雾中的渡口', includeDiscussion: false }],
    ['blank', 'blank', { method: 'blank' }],
  ] as const)('persists %s source into the first atomic aggregate without granting approval', (method, entry, input) => {
    setActivePinia(createPinia())
    const novel = createNovelDraft({ genre: 'urban', subGenre: 'mystery', tags: [], targetWordCountMin: 10, targetWordCountMax: 20,
      writingMode: 'manual', writingStyle: { narrativePov: '', toneStyle: '', descriptionDensity: '', dialogueStyle: '', combatStyle: '', pacingControl: '', emotionExpression: '' },
      settings: { protagonist: { name: '', gender: '', age: '', background: '', personality: [], initialPower: '', cheatDescription: '', romanceTendency: '' },
        supportingCharacters: [], worldBuilding: { worldType: '', worldScale: '', socialStructure: '', techLevel: '', specialRules: '' },
        powerSystem: { systemName: '', levelHierarchy: '', combatStyleDesc: '', auxiliarySystems: '' }, coreConflict: { mainConflict: '', mainVillain: '', factionConflicts: '', coreSuspense: '' },
        romance: { romanceType: '', developmentPace: '', toneChanges: '', emotionalConflict: '' }, payoff: { faceSlapFrequency: '', levelUpPace: '', patterns: [] }, structure: { foreshadowingDensity: '' }, otherSettings: '' } } as never, '2026-11-02T00:00:00.000Z', method)
    const prepared = prepareStoryCreation({ ...novel, genre: 'urban', subGenre: 'mystery', tags: [], targetWordCountMin: 10, targetWordCountMax: 20,
      writingMode: 'manual', writingStyle: novel.writingStyle, settings: novel.settings, creationInput: { ...input, savedAt: '2026-11-02T00:00:00.000Z' } }, [], method as 'inspiration' | 'blank')
    expect(prepared.workspace.creationDraft).toMatchObject({ entry, initialInput: { method } })
    expect(prepared.workspace.creationDraft?.approval.contract).not.toBe('approved')
    expect(prepared.workspace.creationDraft?.selectedSkeletonId).toBeUndefined()
    const view = shallowMount(CreationEntrySource, { props: { input: prepared.workspace.creationDraft!.initialInput! } })
    expect(view.text()).toContain(method === 'blank' ? '空白' : '雾中的渡口')
    view.unmount()
  })

  it('exposes file and paste import as one selectable entry and keeps source preview separate from approval', async () => {
    const wrapper = shallowMount(CreationModePicker, { props: { setupMethod: null } })
    expect(wrapper.text()).toContain('已有大纲文件 / 粘贴')
    await wrapper.get('input[name="creation-setup-method"][value="outline"]').setValue(true)
    const emitted = wrapper.emitted('update:setupMethod') || []
    expect(emitted[emitted.length - 1]).toEqual(['outline'])
    wrapper.unmount()
  })
})
