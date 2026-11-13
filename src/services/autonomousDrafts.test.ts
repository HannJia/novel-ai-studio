import { describe, expect, it } from 'vitest'
import type { Novel } from '@/types/novel'
import type { AiChapterDraft, AiRun } from '@/types/reconstruction'
import { buildAutonomousDraftNovel, editAutonomousDraft } from './autonomousDrafts'

const now = '2026-10-30T00:00:00.000Z'

function makeNovel(): Novel {
  return {
    id: 'novel-1', title: '雾城回响', genre: 'fantasy', subGenre: 'urban-fantasy', genreLabel: '玄幻', subGenreLabel: '东方玄幻',
    tags: [], targetWordCountMin: 80, targetWordCountMax: 120, currentWordCount: 12,
    writingStyle: { narrativePov: 'third-limited', toneStyle: 'dark', descriptionDensity: 'balanced', dialogueStyle: 'crisp', combatStyle: 'strategic', pacingControl: 'normal', emotionExpression: 'nuanced' },
    writingMode: 'manual', settings: {} as Novel['settings'], outline: '', synopsis: '', volumes: [],
    chapters: [
      { id: 'chapter-0', volumeIndex: 0, chapterIndex: 0, title: '旧门', content: '原始第一章', summary: '旧摘要', summarySource: { chapterId: 'chapter-0', sourceVersionId: 'source-0', derivedValue: '旧摘要', createdAt: now, origin: 'ai' }, wordCount: 5, status: 'completed', createdAt: now, updatedAt: now },
      { id: 'chapter-1', volumeIndex: 0, chapterIndex: 1, title: '夜行', content: '原始第二章', summary: '第二章摘要', wordCount: 5, status: 'draft', createdAt: now, updatedAt: now },
      { id: 'chapter-2', volumeIndex: 0, chapterIndex: 2, title: '黑塔', content: '原始第三章', summary: '第三章摘要', wordCount: 5, status: 'draft', createdAt: now, updatedAt: now },
    ],
    characters: [], chatHistory: [], knowledgeBaseIds: [], eventLog: [], dataPanels: [], dataPanelChanges: [], status: 'writing', createdAt: now, updatedAt: now,
  } as Novel
}

function makeDraft(overrides: Partial<AiChapterDraft> = {}): AiChapterDraft {
  return {
    id: 'draft-0', chapterId: 'chapter-0', chapterIndex: 0, baseContent: '原始第一章', content: '自动 第一章', contextVersion: 'context-1',
    status: 'pending', stage: 'generated', createdAt: now, updatedAt: now, history: [], ...overrides,
  }
}

function makeRun(chapterDrafts: AiChapterDraft[]): AiRun {
  return {
    id: 'run-1', mode: 'autonomous', taskType: 'draft', status: 'running', createdAt: now, updatedAt: now, chapterDrafts,
  }
}

describe('autonomous draft work views', () => {
  it('projects pending drafts into a new novel and excludes future drafts', () => {
    const novel = makeNovel()
    const future = makeDraft({ id: 'draft-2', chapterId: 'chapter-2', chapterIndex: 2, baseContent: '原始第三章', content: '未来自动第三章' })
    const result = buildAutonomousDraftNovel(novel, makeRun([makeDraft(), future]), 1)

    expect(result).not.toBe(novel)
    expect(result.chapters).not.toBe(novel.chapters)
    expect(result.chapters[0]).not.toBe(novel.chapters[0])
    expect(result.chapters[0]).toMatchObject({ content: '自动 第一章', wordCount: 5, status: 'writing', summary: '', summarySource: undefined })
    expect(result.chapters[1]).toEqual(novel.chapters[1])
    expect(result.chapters[2]).toEqual(novel.chapters[2])
    expect(novel.chapters[0]).toMatchObject({ content: '原始第一章', summary: '旧摘要', wordCount: 5, status: 'completed' })
  })

  it.each([
    ['正文变化', (novel: Novel) => { novel.chapters[0].content = '作者新正文' }, '正式正文已变化'],
    ['章节锁定', (novel: Novel) => { novel.chapters[0].status = 'locked' }, '正式章节已锁定'],
    ['章节删除', (novel: Novel) => { novel.chapters = novel.chapters.slice(1) }, '章节已删除'],
    ['章节重排', (novel: Novel) => { novel.chapters[0].chapterIndex = 4 }, '章节索引已变化'],
  ])('rejects pending drafts when the canonical chapter has %s', (_caseName, change, message) => {
    const novel = makeNovel()
    change(novel)

    expect(() => buildAutonomousDraftNovel(novel, makeRun([makeDraft()]), 0)).toThrow(message)
  })

  it('rejects a previous rejected chapter until the earlier chapter is handled', () => {
    const rejected = makeDraft({ status: 'rejected', content: '被拒绝的正文' })

    expect(() => buildAutonomousDraftNovel(makeNovel(), makeRun([rejected]), 1)).toThrow('请先处理前章')
  })

  it('checks accepted drafts against the canonical text without overlaying them', () => {
    const novel = makeNovel()
    const accepted = makeDraft({ status: 'accepted', content: '已接受正文' })

    expect(() => buildAutonomousDraftNovel(novel, makeRun([accepted]), 0)).toThrow('正式正文与草稿正文不一致')

    const consistentNovel = makeNovel()
    consistentNovel.chapters[0].content = '已接受正文'
    const result = buildAutonomousDraftNovel(consistentNovel, makeRun([accepted]), 0)
    expect(result.chapters[0].content).toBe('已接受正文')
    expect(result.chapters[0].status).toBe('completed')
  })
})

describe('editAutonomousDraft', () => {
  it('edits pending content, clears prior review state, and keeps only the latest 20 history entries', () => {
    const draft = makeDraft({
      stage: 'analyzed', report: '旧报告', review: {} as AiChapterDraft['review'], analysisError: '旧错误', updatedAt: '2026-10-29T00:00:00.000Z',
      history: Array.from({ length: 20 }, (_, index) => ({ content: `历史${index}`, updatedAt: `2026-10-${String(index + 1).padStart(2, '0')}T00:00:00.000Z` })),
    })
    const result = editAutonomousDraft(draft, '修订后的正文', 'context-2', '2026-10-30T01:00:00.000Z')

    expect(result).toMatchObject({ content: '修订后的正文', contextVersion: 'context-2', stage: 'generated', report: undefined, review: undefined, analysisError: undefined, updatedAt: '2026-10-30T01:00:00.000Z' })
    expect(result.history).toHaveLength(20)
    expect(result.history[0]).toEqual({ content: '历史1', updatedAt: '2026-10-02T00:00:00.000Z' })
    expect(result.history[result.history.length - 1]).toEqual({ content: '自动 第一章', updatedAt: '2026-10-29T00:00:00.000Z' })
    expect(draft.content).toBe('自动 第一章')
    expect(draft.history).toHaveLength(20)
    expect(draft.stage).toBe('analyzed')
  })

  it('does not add history for the same content and context version', () => {
    const draft = makeDraft({ history: [{ content: '旧版本', updatedAt: '2026-10-28T00:00:00.000Z' }] })
    const result = editAutonomousDraft(draft, draft.content, draft.contextVersion, '2026-10-30T02:00:00.000Z')

    expect(result.history).toEqual(draft.history)
    expect(result.updatedAt).toBe('2026-10-30T02:00:00.000Z')
  })

  it('only accepts non-empty edits to pending drafts', () => {
    expect(() => editAutonomousDraft(makeDraft({ status: 'accepted' }), '新正文', 'context-2', now)).toThrow('只有 pending')
    expect(() => editAutonomousDraft(makeDraft(), ' \n\t', 'context-2', now)).toThrow('正文不能为空')
  })
})
