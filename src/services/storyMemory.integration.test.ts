import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createRequire } from 'node:module'
import { characterStateFixture } from '@/test/characterStateFixture'
import { createTestProjectBackup, emptyProjectWorkspace } from '@/test/projectBackupFixture'
import type { Novel } from '@/types/novel'
import type { StoryMemoryRecord, StoryMemoryScope } from '@/types/storyMemory'
import { createStoryMemoryBinding, getStoryMemoryStatus } from './storyMemory'
import { planStoryMemorySummary } from './storyMemoryGeneration'
import { generateKnowledgeSummary, createKnowledgeSummaryBudget } from './knowledgeSummary'
import { buildWritingContext, buildReviewContext, augmentWritingContextWithVectorMemory } from './context'
import { buildReviewContextVersion } from './reconstructionReviewVersion'
import { buildSemanticRecords, retrieveSemanticEvidence } from './semanticIndex'
import { validateProjectBackup } from './projectBackupValidation'
import { callAI } from './ai'
import { embedTextsWithProvider } from './embeddings'

vi.mock('./ai', async original => ({ ...await original<object>(), callAI: vi.fn() }))
vi.mock('./embeddings', async original => ({ ...await original<object>(), embedTextsWithProvider: vi.fn() }))
const require = createRequire(import.meta.url)
const kernelValidate = require('../../app-main/kernel-validation/projectBackupValidation.js').validateProjectBackup
const now = '2026-10-28T00:00:00.000Z'
const model = { id: 'test', name: '测试', baseUrl: 'http://test.invalid', apiKey: 'test', modelName: 'test', maxTokens: 5000, contextWindow: 64000, temperature: 0, topP: 1 }
beforeEach(() => { setActivePinia(createPinia()); vi.mocked(callAI).mockReset(); vi.mocked(embedTextsWithProvider).mockReset() })
function record(novel: Novel, scope: StoryMemoryScope, summary = '渡口停航，林澈转往山城。'): StoryMemoryRecord {
  return { id: 'memory', novelId: novel.id, title: '旅途回顾', scope, summary, source: createStoryMemoryBinding(novel, scope, summary, 'author', now), history: [] }
}

describe('manuscript memory consumption', () => {
  it('rejects a stale context before vector lookup when a memory was replaced', async () => {
    const { novel } = characterStateFixture(), target = novel.chapters[2]
    const memory = record(novel, { kind: 'book', throughChapterId: novel.chapters[0].id })
    const context = buildWritingContext(novel, target, 8000, undefined, [], [memory])
    const updated = record(novel, memory.scope, '重新确认的不同回顾。')
    await expect(augmentWritingContextWithVectorMemory(novel, target, context,
      { enabled: true, baseUrl: 'https://memory.example.test', apiKey: '', modelName: 'test', batchSize: 64 }, () => [updated])).rejects.toThrow('记忆来源')
    expect(embedTextsWithProvider).not.toHaveBeenCalled()
  })

  it('uses current prior memory in writing/review/retrieval and invalidates all after editing its source', () => {
    const { novel } = characterStateFixture(), target = novel.chapters[2]
    const memory = record(novel, { kind: 'book', throughChapterId: novel.chapters[1].id })
    const writing = buildWritingContext(novel, target, 8000, undefined, [], [memory])
    expect(writing.previousSummary).toContain(memory.summary)
    expect(buildReviewContext(novel, target, target.content, 8000, undefined, undefined, [], [memory]).previousSummary).toContain(memory.summary)
    const version = buildReviewContextVersion(novel, target, [], undefined, [], [memory])
    const entries = buildSemanticRecords(novel, [], target.chapterIndex, [memory])
    expect(retrieveSemanticEvidence('渡口停航山城', entries).some(row => row.sourceType === 'story_memory' && row.content === memory.summary)).toBe(true)
    novel.chapters[0].content += '作者改稿。'
    expect(buildWritingContext(novel, target, 8000, undefined, [], [memory]).previousSummary).not.toContain(memory.summary)
    expect(buildSemanticRecords(novel, [], target.chapterIndex, [memory]).some(row => row.sourceType === 'story_memory')).toBe(false)
    expect(buildReviewContextVersion(novel, target, [], undefined, [], [memory])).not.toBe(version)
  })

  it('never exposes current/future chapter facts from book or scene memories, and re-confirmation changes review versions', () => {
    const { novel } = characterStateFixture(), target = novel.chapters[1]
    const memory = record(novel, { kind: 'book', throughChapterId: novel.chapters[2].id }, '未来终局秘密。')
    expect(buildWritingContext(novel, target, 8000, undefined, [], [memory]).previousSummary).not.toContain(memory.summary)
    expect(buildSemanticRecords(novel, [], 1, [memory]).some(row => row.sourceType === 'story_memory')).toBe(false)
    expect(buildReviewContextVersion(novel, target, [], undefined, [], [memory])).toBe(buildReviewContextVersion(novel, target))
    const prior = record(novel, { kind: 'scene', chapterId: novel.chapters[0].id, startOffset: 0, endOffset: 12 })
    const oldVersion = buildReviewContextVersion(novel, target, [], undefined, [], [prior])
    const edited = record(novel, prior.scope, '作者重新核对后的回顾。')
    expect(buildReviewContextVersion(novel, target, [], undefined, [], [edited])).not.toBe(oldVersion)
    expect(buildWritingContext(novel, target, 8000, undefined, [], [edited]).previousSummary).toContain(edited.summary)
  })

  it('reads all manuscript chunks without planned outline and produces a valid covered AI binding', async () => {
    const { novel } = characterStateFixture()
    novel.chapters[0].content = '原文'.repeat(15000) + '段尾事实'
    novel.outline = '此规划不应进入回顾请求'
    const scope = { kind: 'book' as const, throughChapterId: novel.chapters[1].id }, plan = planStoryMemorySummary(novel, scope)
    expect(plan.level).toBe('brief')
    expect(plan.chunks.filter(c => c.entryId === novel.chapters[0].id).map(c => c.text).join('')).toBe(novel.chapters[0].content)
    expect(plan.chunks.some(c => c.entryId === novel.chapters[2].id)).toBe(false)
    vi.mocked(callAI).mockImplementation(async options => {
      expect(JSON.stringify(options.messages)).not.toContain(novel.outline)
      return { content: '已写故事回顾。', finishReason: 'stop', usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } }
    })
    const result = await generateKnowledgeSummary(plan, { model, budget: createKnowledgeSummaryBudget(64, 500000) })
    const memory = record(novel, scope, result.summary)
    memory.source = createStoryMemoryBinding(novel, scope, result.summary, 'ai', now, result.coverage)
    expect(getStoryMemoryStatus(novel, memory)).toBe('current')
    expect(result.coverage.requestCount).toBe(plan.plannedRequests)
  })
})

describe.each([['renderer', validateProjectBackup], ['kernel', kernelValidate]] as const)('story memory backups (%s)', (_, validate) => {
  function fixture() {
    const { novel } = characterStateFixture(), memory = record(novel, { kind: 'book', throughChapterId: novel.chapters[1].id })
    const backup = createTestProjectBackup([novel], [], [], [], [{ ...emptyProjectWorkspace(novel.id), storyMemories: [memory] }])
    return { backup, memory: backup.reconstructionWorkspaces[0].storyMemories![0] }
  }
  it('preserves stale records through a complete project snapshot', () => {
    const { backup, memory } = fixture()
    backup.novels[0].chapters[0].content += '修改。'
    expect(() => validate(backup)).not.toThrow()
    expect(getStoryMemoryStatus(backup.novels[0], memory)).toBe('stale')
  })
  it.each(['owner', 'date', 'range', 'value', 'duplicate', 'foreign-chapter'] as const)('rejects invalid %s', fault => {
    const { backup, memory } = fixture()
    if (fault === 'owner') memory.novelId = 'other'
    if (fault === 'date') memory.source.confirmedAt = '2026-02-30T00:00:00Z'
    if (fault === 'range') memory.scope = { kind: 'scene', chapterId: backup.novels[0].chapters[0].id, startOffset: 10, endOffset: 5 }
    if (fault === 'value') memory.source.value = '伪造另一摘要'
    if (fault === 'duplicate') backup.reconstructionWorkspaces[0].storyMemories!.push(memory)
    if (fault === 'foreign-chapter') {
      const other = characterStateFixture().novel
      backup.novels.push(other); backup.reconstructionWorkspaces.push(emptyProjectWorkspace(other.id))
      memory.scope = { kind: 'book', throughChapterId: other.chapters[0].id }
    }
    expect(() => validate(backup)).toThrow()
  })
})
