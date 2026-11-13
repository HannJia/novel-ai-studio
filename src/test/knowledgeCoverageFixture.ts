import type { KBEntry } from '@/types/knowledge'
import { entrySourceVersion } from '@/services/knowledgeSources'
import { buildKnowledgeSummaryChunks, createKnowledgeSummaryCoverage } from '@/services/knowledgeSummaryCoverage'

/** Synthetic coverage for source/persistence fixtures; this does not invoke a model. */
export function testKnowledgeCoverage(kbId: string, entries: KBEntry[]) {
  const chunks = buildKnowledgeSummaryChunks(entries.map(entry => ({
    entryId: entry.id, sourceVersionId: entrySourceVersion(kbId, entry), content: entry.content,
    title: entry.title, category: entry.category, tags: entry.tags,
  })))
  return createKnowledgeSummaryCoverage(chunks, { requestCount: chunks.length * 2 - 1, inputTokens: 100, outputTokens: 50, usageEstimated: false })
}

