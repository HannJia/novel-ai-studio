import type { KBEntry, KnowledgeBase } from '@/types/knowledge'
import { baseSourceVersion, getCurrentBaseSummary, getCurrentEntrySummary } from './knowledgeSources'

const byId = (left: { id: string }, right: { id: string }) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0

/** Explicit data only. Equal-score choices must survive SQL reload order changes. */
export function selectKnowledgeEntries(bases: KnowledgeBase[], ids: string[], keywords: string[], maximum = 5): KBEntry[] {
  const all = ids.flatMap(id => (bases.find(base => base.id === id)?.entries || []).slice().sort(byId)
    .map(entry => ({ ...entry, summary: getCurrentEntrySummary(id, entry) })))
  if (!keywords.length) return all.slice(0, maximum)
  const scored = all.map(entry => {
    let score = 0
    for (const keyword of keywords) {
      const word = keyword.toLowerCase()
      if (entry.title.toLowerCase().includes(word)) score += 3
      if (entry.content.toLowerCase().includes(word)) score += 1
      if (entry.summary.toLowerCase().includes(word)) score += 2
      if (entry.tags.some(tag => tag.toLowerCase().includes(word))) score += 2
    }
    return { entry, score }
  }).sort((left, right) => right.score - left.score)
  const matches = scored.filter(row => row.score > 0).slice(0, maximum).map(row => row.entry)
  return matches.length ? matches : all.slice(0, Math.min(maximum, 3))
}

/** Shared by review identity and the context cache; stored but stale summaries are excluded. */
export function knowledgeReferenceInput(bases: KnowledgeBase[], ids: string[]) {
  return ids.map(id => {
    const base = bases.find(base => base.id === id)
    return [id, base ? baseSourceVersion(base) : null, base ? getCurrentBaseSummary(base) : '']
  })
}

export function orderKnowledgeSources(bases: KnowledgeBase[]): KnowledgeBase[] {
  return bases.slice().sort(byId).map(base => ({ ...base, entries: base.entries.slice().sort(byId) }))
}
