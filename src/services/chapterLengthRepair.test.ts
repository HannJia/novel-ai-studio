import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callAI } from './ai'
import { requestChapterLengthRepair } from './chapterLengthRepair'
import type { ModelConfig } from '@/stores/config'
vi.mock('./ai', () => ({ callAI: vi.fn() }))
beforeEach(() => vi.clearAllMocks())
const options = { model: { maxTokens: 6000 } as ModelConfig, source: '甲'.repeat(2600), factCard: '主角已抵达', guidance: '抵达并获得回应' }

describe('bounded length candidates', () => {
  it('does not charge for an already valid draft', async () => {
    const source = '甲'.repeat(2100)
    expect(await requestChapterLengthRepair({ ...options, source })).toBe(source)
    expect(callAI).not.toHaveBeenCalled()
  })
  it('requests one full compressed candidate while preserving original', async () => {
    const candidate = '乙'.repeat(2200)
    vi.mocked(callAI).mockResolvedValue({ content: '```text\n' + candidate + '\n```', finishReason: 'stop' })
    expect(await requestChapterLengthRepair(options)).toBe(candidate)
    const request = vi.mocked(callAI).mock.calls[0][0]
    expect(request).toMatchObject({ noAutomaticRetry: true, taskName: '压缩章节长度候选稿' })
    expect(request.messages[1].content).toContain('保留核心事件')
    expect(request.messages[1].content).toContain(options.source)
    expect(callAI).toHaveBeenCalledOnce()
  })
  it('expands existing events instead of creating a next-chapter conflict', async () => {
    vi.mocked(callAI).mockResolvedValue({ content: '乙'.repeat(2200), finishReason: 'stop' })
    await requestChapterLengthRepair({ ...options, source: '甲'.repeat(1500) })
    expect(vi.mocked(callAI).mock.calls[0][0].messages[1].content).toContain('不新增场景')
  })
  it.each(['', '甲'.repeat(1800), '甲'.repeat(2600)])('rejects empty, unchanged or out-of-range output without retries', async content => {
    vi.mocked(callAI).mockResolvedValue({ content, finishReason: 'stop' })
    await expect(requestChapterLengthRepair(options)).rejects.toThrow()
    expect(options.source).toHaveLength(2600)
    expect(callAI).toHaveBeenCalledOnce()
  })
  it.each(['length', 'content_filter'])('does not accept incomplete output: %s', async finishReason => {
    vi.mocked(callAI).mockResolvedValue({ content: '乙'.repeat(2200), finishReason })
    await expect(requestChapterLengthRepair(options)).rejects.toThrow('未正常完成')
  })
  it('rejects a cancelled request even when transport ignores cancellation', async () => {
    const controller = new AbortController()
    vi.mocked(callAI).mockImplementation(async () => { controller.abort(); return { content: '乙'.repeat(2200) } })
    await expect(requestChapterLengthRepair({ ...options, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
})
