import { describe, expect, it } from 'vitest'
import { parsePlotSkeletonResponse } from './plotSkeletonResponse'
import type { Novel } from '@/types/novel'

const novel = { id: 'synthetic' } as Novel
const now = '2026-10-31T00:00:00Z'
const skeletons = [{ title: '渡口', premise: '他问“父亲在哪里”，陈伯决定先核对登记册。', ending: '找到记录', beats: [] }, { title: '旧信', premise: '一封旧信引出调查。', ending: '开信', beats: [] }]

describe('plot skeleton response acceptance', () => {
  it.each([JSON.stringify({ skeletons }), JSON.stringify(skeletons)])('accepts object and array envelopes with intact Chinese dialogue', content => {
    const result = parsePlotSkeletonResponse(novel, { content, finishReason: 'stop' }, now)
    expect(result).toHaveLength(2)
    expect(result[0].premise).toBe(skeletons[0].premise)
    expect(result.every(item => item.approval === 'draft')).toBe(true)
  })

  it('rejects even parseable payloads when the response was truncated', () => {
    expect(() => parsePlotSkeletonResponse(novel, { content: JSON.stringify({ skeletons }), finishReason: 'length' }, now)).toThrow('结束原因：length')
  })

  it('explains schema failure without including the private response', () => {
    expect(() => parsePlotSkeletonResponse(novel, { content: '{"private":"secret-manuscript"}', finishReason: 'stop' }, now)).toThrow('title、premise')
    try { parsePlotSkeletonResponse(novel, { content: 'secret-manuscript', finishReason: 'stop' }, now) } catch (error) {
      expect(String(error)).not.toContain('secret-manuscript')
    }
  })
})
