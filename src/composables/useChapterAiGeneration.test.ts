import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { getChapterGenerationStatus, useChapterAiGeneration } from '@/composables/useChapterAiGeneration'
import { callAI } from '@/services/ai'
import { chapterOutputTokenBudget } from '@/services/chapterGeneration'
import type { ModelConfig } from '@/stores/config'
vi.mock('@/services/ai', () => ({ callAI: vi.fn() }))
beforeEach(() => vi.clearAllMocks())
const model = { maxTokens: 4000 } as ModelConfig
function setup() {
  const content = ref('')
  const warning = vi.fn()
  const generation = useChapterAiGeneration({
    content, writing: ref(false), statusText: ref(''), minWords: 2000, softWords: 2200, hardWords: 2400,
    onWarning: warning,
  })
  generation.beginGeneration()
  return { generation, content, warning }
}

describe('chapter AI generation status', () => {
  it('keeps word targets advisory and reserves the hard limit for finishing the current beat', () => {
    expect(getChapterGenerationStatus(1999, 2000, 2500, 3000)).toBe('AI 正在生成中...')
    expect(getChapterGenerationStatus(2500, 2000, 2500, 3000)).toContain('自然收束本章')
    expect(getChapterGenerationStatus(3000, 2000, 2500, 3000)).toContain('不会按字数强行截断')
  })
  it('retains text and natural endings beyond the suggested count', async () => {
    const { generation, content } = setup()
    const full = '甲'.repeat(2450) + '。行动终于有了结果。'
    vi.mocked(callAI).mockImplementation(async options => {
      expect(options.shouldStop).toBeUndefined()
      options.onChunk?.(full)
      return { content: full, finishReason: 'stop' }
    })
    await generation.streamAppend(model, [])
    expect(content.value).toBe(full)
  })
  it('caps draft requests even when each response makes a little progress', async () => {
    const { generation } = setup()
    vi.mocked(callAI).mockImplementation(async options => { options.onChunk?.('新增。'); return { content: '新增。' } })
    for (let i = 0; i < 3; i++) await generation.streamAppend(model, [])
    await expect(generation.streamAppend(model, [])).rejects.toThrow('3 次请求上限')
    expect(callAI).toHaveBeenCalledTimes(3)
  })
  it('does not replace a cancelled signal with a fresh request', async () => {
    const { generation } = setup()
    generation.stopGeneration()
    await expect(generation.streamAppend(model, [])).rejects.toMatchObject({ name: 'AbortError' })
    expect(callAI).not.toHaveBeenCalled()
  })
  it('keeps partial output on errors and reports output-token truncation', async () => {
    const { generation, content, warning } = setup()
    vi.mocked(callAI).mockImplementationOnce(async options => { options.onChunk?.('尚未说完'); throw new Error('网络断开') })
    await expect(generation.streamAppend(model, [])).rejects.toThrow('网络断开')
    expect(content.value).toBe('尚未说完')
    vi.mocked(callAI).mockResolvedValueOnce({ content: '', finishReason: 'length' })
    expect((await generation.streamAppend(model, [])).finishReason).toBe('length')
    expect(warning).toHaveBeenCalled()
  })
  it('respects the configured model limit when budgeting output', () => {
    expect(chapterOutputTokenBudget(4000, 2000)).toBe(4000)
    expect(chapterOutputTokenBudget(800, 2000)).toBe(800)
    expect(chapterOutputTokenBudget(undefined, 2000)).toBeGreaterThan(3000)
  })
})
