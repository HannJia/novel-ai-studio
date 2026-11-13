export const MAX_CHAPTER_DRAFT_REQUESTS = 3

export function chapterOutputTokenBudget(modelMaxTokens: number | undefined, remainingWords: number): number {
  const limit = Number.isFinite(modelMaxTokens) && modelMaxTokens! > 0 ? Math.floor(modelMaxTokens!) : 6000
  // Some providers count reasoning and prose against the same output limit.
  // Keep headroom for short chapters while respecting the author's model cap.
  return Math.min(limit, Math.max(6000, Math.ceil(remainingWords * 2.5) + 512))
}
