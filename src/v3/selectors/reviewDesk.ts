import { normalizeStoredReviewCoverage } from '@/services/chapterReviewAcceptance'

/** The badge describes a committed review, not just a full-looking progress bar. */
export function deriveDeskReview(input: { signature: string; characters: number; coverage: unknown;
  reviewCurrent: boolean; running: boolean; hasPreviousReview: boolean }) {
  const coverage = normalizeStoredReviewCoverage(input.coverage)
  const matches = !!coverage && coverage.signature === input.signature && coverage.totalCharacters === input.characters
  const total = matches ? coverage.totalChunks : 1
  const completed = matches ? coverage.completedChunks : 0
  if (input.running) return { label: '审校中', detail: `正在审校 ${completed}/${total} 个分段`, valid: false, total, completed }
  if (input.reviewCurrent && matches && coverage.status === 'complete') {
    return { label: '有效', detail: '当前正文与写作依据的审校报告有效', valid: true, total, completed }
  }
  if (matches) return { label: '未完成', detail: '当前输入已有分段进度，完整审校尚未完成', valid: false, total, completed }
  if (coverage || input.hasPreviousReview) return { label: '已失效', detail: '正文或写作依据已变化，旧报告仅供参考', valid: false, total, completed }
  return { label: '尚未审校', detail: '当前正文尚无有效审校报告', valid: false, total, completed }
}
