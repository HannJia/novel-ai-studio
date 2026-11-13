import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requestCoveredContentReview } from './chapterReview'
import type { AiRequestLifecycle } from './ai'
import type { ModelConfig } from '@/stores/config'
import type { ReviewContext } from './context'
import type { ReviewCoverage } from './chapterReviewCoverage'

const pass = '## 审核结论\n总体判断：可通过\n必改数量：0\n## 必改问题\n无'
const model = { id: 'review', modelName: 'review' } as ModelConfig
const lifecycle: AiRequestLifecycle = { beforeRequest: vi.fn(async () => undefined), afterRequest: vi.fn(async () => undefined) }

vi.mock('./ai', () => ({
  callAI: vi.fn(async (options: { onChunk?: (chunk: string) => void }) => {
    const report = pass + '\n## 本段事实摘要\n角色进入小镇，随后获得回复。'
    options.onChunk?.(report)
    return { content: report, finishReason: 'stop' }
  }),
}))

import { callAI } from './ai'

function reviewOptions(source: string) {
  return {
    source, chapterIndex: 0, model,
    buildContext: (text: string) => ({ chapterContent: text } as ReviewContext),
    ensureCurrent: vi.fn(), requestLifecycle: lifecycle,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(callAI).mockImplementation(async (options: { onChunk?: (chunk: string) => void }) => {
    const report = pass + '\n## 本段事实摘要\n角色进入小镇，随后获得回复。'
    options.onChunk?.(report)
    return { content: report, finishReason: 'stop' }
  })
})

describe('covered content review request lifecycle forwarding', () => {
  it('explains a truncated response and retains partial text without retrying or checkpointing it', async () => {
    vi.mocked(callAI).mockImplementationOnce(async request => {
      request.onChunk?.(pass)
      return { content: pass, finishReason: 'length', usage: { completion_tokens: 1024 } }
    })
    const partial = vi.fn(), save = vi.fn()
    await expect(requestCoveredContentReview({ ...reviewOptions('正文'), model: { ...model, maxTokens: 1024 },
      onChunk: partial, onCheckpoint: save,
    })).rejects.toThrow('达到输出上限（length）；已输出 1024 tokens；设置上限 1024 tokens')
    expect(partial).toHaveBeenCalledWith(pass)
    expect(save).not.toHaveBeenCalled()
    expect(callAI).toHaveBeenCalledOnce()
  })

  it('resumes saved segments through the real coverage pipeline and forwards the budget hook only to new requests', async () => {
    const options = reviewOptions('甲'.repeat(6500))
    let saved: ReviewCoverage | undefined, calls = 0
    vi.mocked(callAI).mockImplementation(async (request: { onChunk?: (chunk: string) => void }) => {
      if (++calls === 2) throw new Error('网络中断')
      const report = pass + '\n## 本段事实摘要\n主角进入小镇。'
      request.onChunk?.(report)
      return { content: report, finishReason: 'stop' }
    })
    const onCheckpoint = async (coverage: ReviewCoverage) => { saved = JSON.parse(JSON.stringify(coverage)) }
    await expect(requestCoveredContentReview({ ...options, onCheckpoint })).rejects.toThrow('网络中断')
    expect(saved?.checkpoint?.chunks).toHaveLength(1)
    vi.mocked(callAI).mockClear()
    const report = await requestCoveredContentReview({ ...options, checkpoint: saved!.checkpoint, onCheckpoint })
    expect(report).toContain('全章审查汇总')
    expect(callAI).toHaveBeenCalledTimes(3)
    expect(vi.mocked(callAI).mock.calls[0][0].taskName).toContain('2/3')
    expect(vi.mocked(callAI).mock.calls.every(([request]) => request.requestLifecycle === lifecycle)).toBe(true)
    expect(saved?.status).toBe('complete')
  })

  it('does not reuse a saved report when the reviewer model changes', async () => {
    let saved: ReviewCoverage | undefined
    const options = { ...reviewOptions('正文'), onCheckpoint: async (value: ReviewCoverage) => { saved = value } }
    await requestCoveredContentReview(options)
    vi.mocked(callAI).mockClear()
    await requestCoveredContentReview({ ...options, checkpoint: saved!.checkpoint, model: { ...model, modelName: 'different-reviewer' } })
    expect(callAI).toHaveBeenCalledOnce()
  })

  it('stops after cancellation during checkpoint persistence and retains the finished segment', async () => {
    const controller = new AbortController()
    let saved: ReviewCoverage | undefined
    await expect(requestCoveredContentReview({ ...reviewOptions('甲'.repeat(6500)), signal: controller.signal,
      onCheckpoint: async value => { saved = value; controller.abort() },
    })).rejects.toThrow()
    expect(callAI).toHaveBeenCalledOnce()
    expect(saved?.checkpoint?.chunks).toHaveLength(1)
  })

  it('binds the selected context of every slice when resuming a completed checkpoint', async () => {
    let detail = '原角色设定', saved: ReviewCoverage | undefined
    const options = { ...reviewOptions('甲'.repeat(3200) + '乙'.repeat(3300)),
      buildContext: (text: string) => ({ chapterContent: text, characters: text.includes('乙') ? detail : '相同角色' } as ReviewContext),
      onCheckpoint: async (value: ReviewCoverage) => { saved = value },
    }
    await requestCoveredContentReview(options)
    detail = '后半章角色的新设定'
    vi.mocked(callAI).mockClear()
    await requestCoveredContentReview({ ...options, checkpoint: saved!.checkpoint })
    expect(callAI).toHaveBeenCalledTimes(4)
  })

  it('rejects a late response when only a nonempty slice context changes', async () => {
    let detail = '原角色设定'
    vi.mocked(callAI).mockImplementation(async (request: { onChunk?: (chunk: string) => void }) => {
      detail = '新角色设定'; request.onChunk?.(pass)
      return { content: pass, finishReason: 'stop' }
    })
    const save = vi.fn(async () => undefined)
    await expect(requestCoveredContentReview({ ...reviewOptions('正文'),
      buildContext: text => ({ chapterContent: text, characters: text ? detail : '相同角色' } as ReviewContext), onCheckpoint: save,
    })).rejects.toThrow('审核设定')
    expect(save).not.toHaveBeenCalled()
  })

  it('rejects changed context before saving a completed model response', async () => {
    let context = '原设定'
    vi.mocked(callAI).mockImplementation(async (request: { onChunk?: (chunk: string) => void }) => {
      context = '新设定'; request.onChunk?.(pass)
      return { content: pass, finishReason: 'stop' }
    })
    const save = vi.fn(async () => undefined)
    await expect(requestCoveredContentReview({ ...reviewOptions('正文'),
      buildContext: text => ({ chapterContent: text, outlineContext: context } as unknown as ReviewContext), onCheckpoint: save,
    })).rejects.toThrow('审核设定')
    expect(save).not.toHaveBeenCalled()
  })

  it('passes the hook through to the single request and explicit format retry', async () => {
    let attempt = 0
    vi.mocked(callAI).mockImplementation(async (options: { onChunk?: (chunk: string) => void }) => {
      attempt++
      const report = attempt === 1 ? '模型输出不完整' : pass
      options.onChunk?.(report)
      return { content: report, finishReason: 'stop' }
    })

    await requestCoveredContentReview(reviewOptions('正文'))

    expect(callAI).toHaveBeenCalledTimes(2)
    expect(vi.mocked(callAI).mock.calls.every(([request]) => request.requestLifecycle === lifecycle)).toBe(true)
  })

  it('passes the same hook to every chunk and global review request', async () => {
    await requestCoveredContentReview(reviewOptions('甲'.repeat(6500)))

    expect(callAI).toHaveBeenCalledTimes(4)
    expect(vi.mocked(callAI).mock.calls.every(([request]) => request.requestLifecycle === lifecycle)).toBe(true)
    for (const [request] of vi.mocked(callAI).mock.calls) {
      expect(request.messages[1].content).toContain('完整正文的确定性统计：6500 字')
    }
  })
})
