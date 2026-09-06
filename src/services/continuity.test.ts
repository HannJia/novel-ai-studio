import { describe, expect, it } from 'vitest'
import { scanContinuity } from './continuity'
import type { Chapter, Novel } from '@/types/novel'

function fixture(overrides: Partial<Novel> = {}): Novel {
  const chapter: Chapter = {
    id: 'chapter-1', volumeIndex: 0, chapterIndex: 0, title: '第一章', content: '', summary: '',
    wordCount: 0, status: 'draft', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }
  return {
    id: 'novel-1', title: '测试小说', genre: 'fantasy', subGenre: 'xuanhuan', genreLabel: '玄幻', subGenreLabel: '东方玄幻',
    tags: [], targetWordCountMin: 10, targetWordCountMax: 20, currentWordCount: 0,
    writingStyle: {} as Novel['writingStyle'], settings: {} as Novel['settings'], outline: '', synopsis: '', volumes: [],
    chapters: [chapter], characters: [], chatHistory: [], knowledgeBaseIds: [], eventLog: [], dataPanels: [], dataPanelChanges: [],
    status: 'writing', createdAt: chapter.createdAt, updatedAt: chapter.updatedAt, ...overrides,
  }
}

describe('本地连续性扫描', () => {
  it('提示正文数值与数据面板不一致，并提示死亡角色冲突', () => {
    const novel = fixture({
      dataPanels: [{
        id: 'panel-1', category: '角色', name: '林澈', relatedKeywords: ['林澈'],
        fields: [{ id: 'level', name: '等级', value: '3', unit: '级', note: '', type: 'number' }],
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      }],
      characters: [{
        id: 'char-1', name: '顾沉', aliases: [], identity: '', personality: '', powerLevel: '', faction: '', status: '死亡',
        firstAppearChapter: 0, description: '', relationships: [], events: [], avatarColor: '#000',
      }],
    })
    const alerts = scanContinuity(novel, novel.chapters[0], '林澈的等级 5 级，顾沉说道。')
    expect(alerts.map(alert => alert.title)).toEqual(expect.arrayContaining(['林澈 · 等级', '顾沉 状态冲突']))
  })

  it('正文为空时不产生提醒', () => {
    const novel = fixture()
    expect(scanContinuity(novel, novel.chapters[0], '   ')).toEqual([])
  })
})
