import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callAI } from './ai'
import { requestSelectionReplacement } from './selectionAssistant'
import { captureSelectionSnapshot } from './selectionRevision'
import type { ModelConfig } from '@/stores/config'

vi.mock('./ai', () => ({ callAI: vi.fn() }))
const snapshot = captureSelectionSnapshot({ novelId: 'book', chapterId: 'chapter', baseContent: '前文。目标片段。后文。',
  startOffset: 3, endOffset: 8, mode: 'polish', contextVersion: 'context-1' })
const options = { snapshot, model: { id: 'model', modelName: 'test', maxTokens: 2000 } as ModelConfig,
  authorInstruction: '保留对白', factCard: '林澈尚不知道真相。', guidance: '本场景只揭示线索。' }
beforeEach(() => vi.mocked(callAI).mockReset())

describe('selection AI request', () => {
  it('preserves prose punctuation and whitespace while sending bounded context and author intent', async () => {
    const replacement = '\n他说：“等等。”\r\n'
    vi.mocked(callAI).mockResolvedValue({ content: JSON.stringify({ replacement }), finishReason: 'stop' })
    expect(await requestSelectionReplacement(options)).toBe(replacement)
    const request = vi.mocked(callAI).mock.calls[0][0]
    const prompt = JSON.parse(String(request.messages[1].content))
    expect(prompt).toMatchObject({ authorInstruction: '保留对白', establishedFacts: '林澈尚不知道真相。', approvedPlan: '本场景只揭示线索。',
      before: '前文。', selectedText: '目标片段。', after: '后文。' })
    expect(request.noAutomaticRetry).toBe(true)
    expect(request.maxTokens).toBeLessThanOrEqual(2000)
  })

  it.each(['bad json', '{}', '{"replacement":42}', '{"replacement":"  "}', JSON.stringify({ replacement: snapshot.selectedText })])(
    'rejects unusable output %s instead of producing a manuscript edit', async content => {
      vi.mocked(callAI).mockResolvedValue({ content })
      await expect(requestSelectionReplacement(options)).rejects.toThrow()
      expect(callAI).toHaveBeenCalledTimes(1)
    })

  it('rejects truncated output and does not retry it', async () => {
    vi.mocked(callAI).mockResolvedValue({ content: '{"replacement":"新文字"}', finishReason: 'length' })
    await expect(requestSelectionReplacement(options)).rejects.toThrow('未完整结束')
    expect(callAI).toHaveBeenCalledTimes(1)
  })

  it('does not send an already cancelled request and rejects a late reply after cancellation', async () => {
    const early = new AbortController(); early.abort()
    await expect(requestSelectionReplacement({ ...options, signal: early.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(callAI).not.toHaveBeenCalled()
    const during = new AbortController()
    vi.mocked(callAI).mockImplementation(async () => { during.abort(); return { content: '{"replacement":"新文字"}' } })
    await expect(requestSelectionReplacement({ ...options, signal: during.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
})
