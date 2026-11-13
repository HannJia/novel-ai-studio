import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useKnowledgeStore } from '@/stores/knowledge'
import { characterStateFixture } from '@/test/characterStateFixture'
import { createEntrySummarySource, createBaseSummarySource } from './knowledgeSources'
import { testKnowledgeCoverage } from '@/test/knowledgeCoverageFixture'
import { buildBoundKnowledgeContext, buildBoundKnowledgeSignature } from './knowledgeContext'
import { buildChatKnowledgeContext } from './softwareAssistantContext'
import { buildWritingContext } from './context'
import { buildSemanticRecords, retrieveSemanticEvidence, formatEvidence } from './semanticIndex'
import { buildReviewContextVersion } from './reconstructionReviewVersion'

beforeEach(() => setActivePinia(createPinia()))
function fixture() {
  const { novel } = characterStateFixture()
  const store = useKnowledgeStore(), base = store.createKB('钥匙资料')
  const entry = store.addEntry(base.id, { title: '钥匙去向', category: '事件', content: '黑钥匙在旅馆。',
    summary: '条目压缩标记。', tags: [] })!
  entry.summarySource = createEntrySummarySource(base.id, entry, entry.summary, 'author', novel.createdAt)
  base.summary = '整库压缩标记。'
  base.summarySource = createBaseSummarySource(base, base.summary, 'ai', novel.createdAt, testKnowledgeCoverage(base.id, base.entries))
  novel.knowledgeBaseIds = [base.id]
  return { novel, base, entry, store, chapter: novel.chapters[2] }
}

describe('knowledge derived-source consumers', () => {
  it('invalidates bound writing, review, chat and retrieval on equal-length raw edits without changing timestamps', () => {
    const { novel, base, entry, store, chapter } = fixture()
    const boundBefore = buildBoundKnowledgeContext(novel)
    expect(boundBefore).toContain('条目压缩标记。')
    expect(boundBefore).toContain('整库压缩标记。')
    const writingBefore = buildWritingContext(novel, chapter)
    expect(writingBefore.outlineContext).toContain('条目压缩标记。')
    const signature = buildBoundKnowledgeSignature(novel)
    const review = buildReviewContextVersion(novel, chapter, store.knowledgeBases)
    entry.content = '黑钥匙在城门。'
    const all = [buildBoundKnowledgeContext(novel), buildChatKnowledgeContext([base], [base.id], '钥匙'),
      JSON.stringify(buildWritingContext(novel, chapter)), JSON.stringify(buildSemanticRecords(novel, [base]))].join('\n')
    expect(all).not.toContain('条目压缩标记。')
    expect(all).not.toContain('整库压缩标记。')
    expect(all).toContain('黑钥匙在城门。')
    expect(buildBoundKnowledgeSignature(novel)).not.toBe(signature)
    expect(buildReviewContextVersion(novel, chapter, store.knowledgeBases)).not.toBe(review)
    expect(entry.summary).toBe('条目压缩标记。')
    expect(base.summary).toBe('整库压缩标记。')
  })

  it('refreshes signatures and chat cache when the same summary becomes confirmed', () => {
    const { novel, base, entry, store, chapter } = fixture()
    entry.summarySource = undefined
    const context = buildChatKnowledgeContext([base], [base.id], '压缩标记')
    expect(context).not.toContain('条目压缩标记。')
    const signature = buildBoundKnowledgeSignature(novel), review = buildReviewContextVersion(novel, chapter, store.knowledgeBases)
    entry.summarySource = createEntrySummarySource(base.id, entry, entry.summary, 'author', novel.createdAt)
    expect(buildChatKnowledgeContext([base], [base.id], '压缩标记')).toContain('条目压缩标记。')
    expect(buildBoundKnowledgeSignature(novel)).not.toBe(signature)
    expect(buildReviewContextVersion(novel, chapter, store.knowledgeBases)).not.toBe(review)
  })

  it('retrieves a late original fact even when an otherwise valid summary omitted it', () => {
    const { novel, base, entry } = fixture()
    const fact = '白鹿镇渡船每逢初七停航，修缮由西岸木匠负责。'
    entry.content = '村民记录了一次普通出行。'.repeat(4500) + fact
    entry.summary = '记录了村民的日常出行。'
    entry.summarySource = createEntrySummarySource(base.id, entry, entry.summary, 'ai', novel.createdAt, testKnowledgeCoverage(base.id, [entry]))
    const records = buildSemanticRecords(novel, [base]).filter(record => record.sourceType === 'knowledge')
    expect(records.some(record => record.metadata?.chunkType === 'summary')).toBe(true)
    expect(records.some(record => record.metadata?.chunkType === 'content' && record.content.includes(fact))).toBe(true)
    const results = retrieveSemanticEvidence('白鹿镇初七渡船停航西岸木匠', records, 5)
    expect(results.some(result => result.content.includes(fact))).toBe(true)
    expect(formatEvidence(results, 2000, '白鹿镇初七停航')).toContain(fact)
    novel.knowledgeBaseIds = []
    expect(buildSemanticRecords(novel, [base]).some(record => record.sourceType === 'knowledge')).toBe(false)
  })
})
