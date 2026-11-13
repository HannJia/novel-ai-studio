import type { CreationDraft, StoryContract } from '@/types/reconstruction'
import { confirmStoryContract } from '@/services/reconstructionCreation'
import { contractCards, contractCardSignature } from '@/services/storyContract'

/** Domain fixtures whose starting state already includes eight explicit author confirmations. */
export function confirmTestStoryContract(draft: CreationDraft, contract: StoryContract, now: string): CreationDraft {
  return confirmStoryContract(draft, confirmTestContractCards(contract, now), now)
}

export function confirmTestContractCards<T extends StoryContract>(contract: T, now: string): T {
  return { ...contract, cardConfirmations: contractCards.map(card => ({
    cardId: card.id, signature: contractCardSignature(contract, card.id), confirmedAt: now,
  })) }
}
