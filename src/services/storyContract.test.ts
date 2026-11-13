import { describe, expect, it } from 'vitest'
import { createEmptyCreationDraft } from '@/types/reconstruction'
import { contractCards, contractCardConfirmed, contractCardSignature, materializeContractConfirmations, toggleContractCard,
  parseContractExploration, adoptContractSuggestion, contractExplorationMessages } from './storyContract'
import { confirmStoryContract, reviseStoryContract } from './reconstructionCreation'
import { creationDirectionSignature } from './creationTransactions'
import { getApprovedPlanning } from './reconstructionPlanning'
import { validateReconstructionCreationDraft } from './reconstructionBackupValidation'
import { applyCreationRecovery } from './creationDraft'

const now = '2026-11-10T00:00:00.000Z'
function fixture() {
  const draft = createEmptyCreationDraft({ id: 'test', now })
  Object.assign(draft.contract, { title: '渡口', genre: '悬疑', centralConflict: '追查旧信', endingDirection: '暂不确定' })
  return draft
}
function allConfirmed(contract = fixture().contract) {
  return contractCards.reduce((value, card) => toggleContractCard(value, card.id, now), contract)
}
describe('author contract cards and exploration', () => {
  it('requires eight explicit author confirmations for every contract approval', () => {
    const draft = fixture()
    expect(() => confirmStoryContract(draft, draft.contract, now)).toThrow('八张')
    expect(() => confirmStoryContract(draft, materializeContractConfirmations(draft.contract), now)).toThrow('八张')
    const confirmed = confirmStoryContract(draft, allConfirmed(draft.contract), now)
    expect(confirmed.stage).toBe('skeleton')
    expect(contractCards.every(card => contractCardConfirmed(confirmed.contract, card.id))).toBe(true)
  })
  it('drops changed-card confirmations and keeps other cards confirmed after list normalization', () => {
    const draft = fixture(), contract = allConfirmed({ ...draft.contract, worldRules: [' 代价 ', ''] })
    const revised = reviseStoryContract(draft, { ...contract, centralConflict: '寻找失踪的人' }, now)
    expect(contractCardConfirmed(revised.contract, 'conflict')).toBe(false)
    expect(contractCardConfirmed(revised.contract, 'rules')).toBe(true)
    expect(revised.contract.worldRules).toEqual(['代价'])
    expect(revised.contract.cardConfirmations).toHaveLength(7)
  })
  it('keeps confirmed plans and semantic signatures on reopening, and invalidates on withdrawal', () => {
    const draft = confirmStoryContract(fixture(), allConfirmed(fixture().contract), now)
    draft.approval.skeleton = 'approved'
    draft.skeletons = [{ id: 's', title: '渡口', premise: '旧信', logline: '查信', promise: '解谜', ending: '离开', beats: [], approval: 'approved', updatedAt: now }]
    draft.selectedSkeletonId = 's'
    const signature = creationDirectionSignature(draft), projection = getApprovedPlanning(draft, 0)
    const revised = reviseStoryContract(draft, materializeContractConfirmations(draft.contract), now)
    expect(creationDirectionSignature(revised)).toBe(signature)
    expect(getApprovedPlanning(revised, 0)).toEqual(projection)
    expect(revised.selectedSkeletonId).toBe('s')
    expect(revised.approval.skeleton).toBe('approved')
    const withdrawn = reviseStoryContract(revised, toggleContractCard(revised.contract, 'voice', now), now)
    expect(withdrawn.contract.approval).toBe('draft')
    expect(withdrawn.selectedSkeletonId).toBeUndefined()
    expect(withdrawn.skeletons[0].approval).toBe('draft')
  })
  it('never changes a card until adoption, then withdraws only that card and rejects stale suggestions', () => {
    const contract = allConfirmed()
    const { suggestions } = parseContractExploration(JSON.stringify({ reply: '可以改为第一人称。', suggestions: [{ cardId: 'voice', values: { pointOfView: '第一人称' } }] }), contract)
    expect(contract.pointOfView).toBeUndefined()
    expect(contractCardConfirmed(contract, 'voice')).toBe(true)
    const adopted = adoptContractSuggestion(contract, suggestions[0])
    expect(adopted.pointOfView).toBe('第一人称')
    expect(contractCardConfirmed(adopted, 'voice')).toBe(false)
    expect(contractCardConfirmed(adopted, 'theme')).toBe(true)
    expect(() => adoptContractSuggestion({ ...contract, pointOfView: '作者刚填的视角' }, suggestions[0])).toThrow('已有修改')
    expect(contractCardSignature(contract, 'voice')).toBe(suggestions[0].baseline)
  })
  it.each([{ approval: 'approved' }, { title: '别的卡片' }, { pointOfView: 3 }])('rejects model fields outside the card whitelist', values => {
    expect(() => parseContractExploration(JSON.stringify({ reply: '建议', suggestions: [{ cardId: 'voice', values }] }), fixture().contract)).toThrow()
  })
  it('round-trips contract recovery without advancing the formal direction or original baseline', () => {
    const draft = fixture(), formal = JSON.stringify(draft.contract)
    const recovery = { id: 'editor', surface: 'contract' as const, baseline: 'original-baseline', contract: allConfirmed(),
      exploration: { input: '尚未发送的想法', messages: [{ id: 'm', role: 'assistant' as const, status: 'interrupted' as const, content: '{"reply":"部分' }] },
      manualOutline: '', outlineText: '', updatedAt: now }
    const saved = applyCreationRecovery(draft, { kind: 'editor', value: recovery })
    expect(JSON.stringify(saved.contract)).toBe(formal)
    expect(() => validateReconstructionCreationDraft(JSON.parse(JSON.stringify(saved)))).not.toThrow()
    expect(saved.editorDrafts![0]).toEqual(recovery)
    saved.editorDrafts![0].contract!.id = 'another-contract'
    expect(() => validateReconstructionCreationDraft(saved)).toThrow('contract')
  })
  it('excludes partial model turns from future context and does not include confirmation metadata', () => {
    const messages = contractExplorationMessages(allConfirmed(), { input: '', messages: [
      { id: 'u', role: 'user', content: '主角是谁', status: 'completed' },
      { id: 'a', role: 'assistant', content: '残缺JSON', status: 'partial' },
      { id: 'b', role: 'assistant', content: '{"reply":"已解析"}', reply: '建议先确定身份', status: 'completed' },
    ] })
    expect(messages.map(message => message.content).join('\n')).not.toContain('残缺JSON')
    expect(messages[0].content).not.toContain('cardConfirmations')
    expect(messages[2].content).toBe('建议先确定身份')
  })
})
