export const MAX_CHAPTER_DRAFT_REQUESTS = 3

export function chapterOutputTokenBudget(modelMaxTokens: number | undefined, remainingWords: number): number {
  const limit = Number.isFinite(modelMaxTokens) && modelMaxTokens! > 0 ? Math.floor(modelMaxTokens!) : 6000
  return Math.min(limit, Math.max(1200, Math.ceil(remainingWords * 2.5) + 512))
}
