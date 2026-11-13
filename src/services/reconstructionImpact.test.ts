import { describe, expect, it } from 'vitest'
import { analyzeCandidateImpact } from './reconstructionImpact'
import type { CandidateChange } from '@/types/reconstruction'
import type { Novel } from '@/types/novel'

function makeNovel(): Novel {
  return {
    id: 'novel-1',
    eventLog: [
      { id: 'event-1', chapterIndex: 1, title: '密信出现', description: '密信指向城主', characters: [], type: '主线', targetChapter: 3, status: 'developing', timestamp: '2026-10-26' },
    ],
    storyArcs: [{
      id: 'arc-1', title: '赤月旧案', description: '查清旧案', type: 'main', importance: 5, status: 'active', reactivateAt: '', characterIds: [],
      nodes: [{ id: 'node-1', title: '找到密信', description: '找到线索', targetChapter: 3, status: 'pending', createdAt: '2026-10-26', updatedAt: '2026-10-26' }],
      createdAt: '2026-10-26', updatedAt: '2026-10-26',
    }],
    chapterPlans: [{
      id: 'plan-1', horizon: 'near', title: '追查密信', objective: '找到线索', summary: '进入城主府', beats: [], targetChapterStart: 3, targetChapterEnd: 4,
      relatedArcIds: ['arc-1'], relatedEventIds: [], status: 'planned', source: 'ai', createdAt: '2026-10-26', updatedAt: '2026-10-26',
    }],
    chapters: [0, 1, 2, 3, 4].map(index => ({
      id: 'chapter-' + index, volumeIndex: 0, chapterIndex: index, title: '第' + (index + 1) + '章',
      content: index === 3 ? '林青在城主府寻找密信。' : '', summary: index === 1 ? '密信出现，指向城主。' : '', wordCount: 0,
      status: 'writing' as const, createdAt: '2026-10-26', updatedAt: '2026-10-26',
    })),
  } as unknown as Novel
}

function makeCandidate(overrides: Partial<CandidateChange> = {}): CandidateChange {
  return {
    id: 'candidate-1', novelId: 'novel-1', chapterId: 'chapter-1', type: 'fact',
    proposedValue: JSON.stringify({ name: '密信', description: '密信指向城主' }), evidence: [], status: 'proposed',
    createdAt: '2026-10-26', updatedAt: '2026-10-26', ...overrides,
  }
}

describe('reconstruction candidate impact analysis', () => {
  it('finds future chapters that mention entities in a fact candidate', () => {
    const report = analyzeCandidateImpact(makeNovel(), makeCandidate())

    expect(report.hasFutureImpact).toBe(true)
    expect(report.affectedChapterIds).toContain('chapter-3')
    expect(report.items.find(item => item.chapterId === 'chapter-3')?.reasons.join('')).toContain('相关实体')
  })

  it('follows plotline nodes and related chapter plans', () => {
    const report = analyzeCandidateImpact(makeNovel(), makeCandidate({ id: 'candidate-plot', type: 'plotline', targetId: 'arc-1', proposedValue: '{"status":"completed"}' }))

    const item = report.items.find(item => item.chapterId === 'chapter-3')
    expect(item?.severity).toBe('high')
    expect(item?.reasons.join('')).toContain('剧情线节点')
  })

  it('marks downstream chapters for a timeline candidate', () => {
    const report = analyzeCandidateImpact(makeNovel(), makeCandidate({ id: 'candidate-time', type: 'timeline', proposedValue: '{"elapsedDays":3}' }))

    expect(report.items.filter(item => item.chapterIndex > 1).every(item => item.severity === 'high')).toBe(true)
    expect(report.summary).toContain('后续章节')
  })
})
