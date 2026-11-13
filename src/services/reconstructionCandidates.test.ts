import { describe, expect, it } from 'vitest'
import { buildChapterAnalysisCandidates } from './reconstructionCandidates'
import type { Chapter, Novel } from '@/types/novel'

describe('chapter analysis candidate extraction', () => {
  it('keeps AI story changes out of Canon and attaches chapter evidence when present', () => {
    const chapter = {
      id: 'chapter-1',
      chapterIndex: 0,
      title: '封存室',
      content: '林澈从封存室取走黑色徽章。',
      status: 'writing',
      wordCount: 15,
    } as Chapter
    const novel = { id: 'novel-1' } as Novel
    const candidates = buildChapterAnalysisCandidates(novel, chapter, 'version-1', {
      events: [{ title: '取走徽章', description: '主角获得黑色徽章', type: '主线', evidence: '取走黑色徽章' }],
      characters: [{ name: '守门人', identity: '封存室守卫', evidence: '守门人' }],
      timeAdvanceDays: 2,
    })

    expect(candidates).toHaveLength(3)
    expect(candidates.every(candidate => candidate.status === 'proposed')).toBe(true)
    expect(candidates.every(candidate => candidate.novelId === 'novel-1')).toBe(true)
    expect(candidates[0].evidence[0].sourceVersionId).toBe('version-1')
    expect(candidates[0].type).toBe('fact')
    expect(candidates[2].type).toBe('timeline')
    expect(candidates[0].id).toContain('version-1')

    const revised = buildChapterAnalysisCandidates(novel, chapter, 'version-2', {
      events: [{ title: '取走徽章', description: '主角获得黑色徽章', type: '主线', evidence: '取走黑色徽章' }],
    })
    expect(revised[0].id).not.toBe(candidates[0].id)
  })
})
