import type { Novel } from '@/types/novel'
import { useKnowledgeStore, type KBEntry } from '@/stores/knowledge'
import type { KnowledgeBase } from '@/types/knowledge'
import { getCurrentBaseSummary } from './knowledgeSources'
import { knowledgeReferenceInput } from './knowledgeSelection'

function splitKeywords(text: string): string[] {
  return Array.from(new Set(
    text
      .split(/[\s\n，。！？、；：,.!?;:《》“”‘’（）()【】\[\]-]+/)
      .map(value => value.trim())
      .filter(value => value.length >= 2),
  ))
}

function getBoundKnowledgeEntries(novel: Novel, query = '', maxEntries = 8): KBEntry[] {
  if (!novel.knowledgeBaseIds?.length) return []
  try {
    const store = useKnowledgeStore()
    return store.getRelevantEntries(novel.knowledgeBaseIds, splitKeywords(query).slice(0, 40), maxEntries)
  } catch {
    return []
  }
}

export function buildBoundKnowledgeContext(
  novel: Novel,
  query = '',
  maxEntries = 8,
  entryLimit = 700,
): string {
  const entries = getBoundKnowledgeEntries(novel, query, maxEntries)
  if (!entries.length) return ''
  try {
    const store = useKnowledgeStore()
    const boundIds = new Set(novel.knowledgeBaseIds || [])
    const summaries = store.knowledgeBases
      .filter(base => boundIds.has(base.id))
      .flatMap(base => {
        const summary = getCurrentBaseSummary(base)
        return summary ? ['• ' + base.name + '：' + summary.slice(0, Math.max(entryLimit * 2, 1200))] : []
      })
    return [
      '【当前小说已挂载知识库（仅供本书参考）】',
      summaries.length ? `知识库摘要：\n${summaries.join('\n')}` : '',
      '相关资料条目：',
      ...entries.map(entry => `• [${entry.category}] ${entry.title}：${(entry.summary || entry.content).slice(0, entryLimit)}`),
    ].filter(Boolean).join('\n')
  } catch {
    return entries.map(entry => `• [${entry.category}] ${entry.title}：${(entry.summary || entry.content).slice(0, entryLimit)}`).join('\n')
  }
}

// Include entry content so editing a bound entry invalidates cached AI context.
export function buildBoundKnowledgeSignature(novel: Novel, snapshot?: KnowledgeBase[]): string {
  if (!novel.knowledgeBaseIds?.length) return ''
  if (snapshot !== undefined) return JSON.stringify(knowledgeReferenceInput(snapshot, novel.knowledgeBaseIds))
  try {
    return JSON.stringify(knowledgeReferenceInput(useKnowledgeStore().knowledgeBases, novel.knowledgeBaseIds))
  } catch {
    return ''
  }
}
