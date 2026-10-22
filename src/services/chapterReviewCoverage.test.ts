import { describe, expect, it, vi } from 'vitest'
import { contentReviewVerdict } from './contentReview'
import { ChapterReviewCoverageError, requestChapterReviewWithCoverage, splitReviewChunks, type ReviewCoverage } from './chapterReviewCoverage'
const pass = '## 结论\n总体判断：可通过\n必改数量：0\n## 必改问题\n无。'
const partPass = pass + '\n## 本段事实摘要\n角色进入小镇，随后获得回复。'

describe('review coverage', () => {
  it('keeps short chapter review to a single request', async () => {
    const review = vi.fn().mockResolvedValue(pass)
    const result = await requestChapterReviewWithCoverage('甲'.repeat(2400), review)
    expect(review).toHaveBeenCalledOnce()
    expect(result).toContain('2400/2400')
    expect(contentReviewVerdict(result)).toBe('passed')
  })
  it('covers the middle and end without cutting a surrogate pair', () => {
    const source = '甲'.repeat(3199) + '😀' + '乙'.repeat(7000)
    const chunks = splitReviewChunks(source)
    let covered = 0
    for (const chunk of chunks) {
      expect(chunk.start).toBeLessThanOrEqual(covered)
      expect(chunk.text).toBe(source.slice(chunk.start, chunk.end))
      expect(chunk.text.length).toBeLessThanOrEqual(3200)
      expect(chunk.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/)
      covered = chunk.end
    }
    expect(covered).toBe(source.length)
  })
  it('preflights the actual overlapping chunk count before any API call', async () => {
    const review = vi.fn()
    // ceil(25000/3200)=8, but the overlapping slices need 9.
    await expect(requestChapterReviewWithCoverage('甲'.repeat(25000), review)).rejects.toBeInstanceOf(ChapterReviewCoverageError)
    expect(review).not.toHaveBeenCalled()
  })
  it('does not let a passing first chunk or global report hide a later hard issue', async () => {
    const review = vi.fn(async (part, kind, _facts?: string) => kind === 'global' ? pass : part.index === 1
      ? '总体判断：必须修改\n必改数量：1\n## 必改问题\n1. [时间] 冲突\n原文证据：次日\n## 本段事实摘要\n次日到达。' : partPass)
    const result = await requestChapterReviewWithCoverage('甲'.repeat(6500), review)
    expect(contentReviewVerdict(result)).toBe('changes-required')
    expect(review).toHaveBeenCalledTimes(4)
    const global = review.mock.calls[review.mock.calls.length - 1]!
    expect(global[1]).toBe('global')
    expect(global[0].text).toBe('')
    expect(global[2]).toContain('第 3 段')
  })
  it('marks a failed middle chunk as incomplete and skips global review', async () => {
    const progress: ReviewCoverage[] = []
    const review = vi.fn(async (part) => { if (part.index === 1) throw new Error('网络失败'); return partPass })
    await expect(requestChapterReviewWithCoverage('甲'.repeat(6500), review, coverage => progress.push(coverage))).rejects.toMatchObject({
      coverage: { status: 'failed', completedChunks: 1, coveredCharacters: 3200, failedChunk: 2 },
    })
    expect(review).toHaveBeenCalledTimes(2)
    expect(progress[0].completedChunks).toBe(0)
    expect(progress[progress.length - 1]?.status).toBe('failed')
  })
  it.each([pass, partPass.replace('角色进入小镇，随后获得回复。', '甲'.repeat(601))])('requires usable summaries for all chunks', async report => {
    await expect(requestChapterReviewWithCoverage('甲'.repeat(5000), vi.fn().mockResolvedValue(report))).rejects.toThrow('事实摘要')
  })
  it('treats missing conclusions as unknown, never a default pass', async () => {
    await expect(requestChapterReviewWithCoverage('正文', vi.fn().mockResolvedValue('正在分析'))).rejects.toThrow('无法识别')
  })
  it('marks relation review failure even when all prose chunks were reviewed', async () => {
    const review = vi.fn(async (_part, kind) => { if (kind === 'global') throw new Error('关系复核失败'); return partPass })
    await expect(requestChapterReviewWithCoverage('甲'.repeat(5000), review)).rejects.toMatchObject({
      coverage: { status: 'failed', completedChunks: 2, coveredCharacters: 5000, globalStatus: 'failed' },
    })
  })
})
