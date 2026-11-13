export interface KnowledgeSummaryCoverageSource {
  entryId: string
  sourceVersionId: string
  contentLength: number
  ranges: Array<{ start: number; end: number }>
}

export interface KnowledgeSummaryLeafBinding {
  entryId: string
  sourceVersionId: string
  start: number
  end: number
  contentLength: number
}

export interface KnowledgeSummaryCoverage {
  version: 1
  strategy: 'full-source-hierarchical'
  sources: KnowledgeSummaryCoverageSource[]
  leafEvidence?: Array<{ nodeId: string; signature: string; runId: string; requestId: string; binding: KnowledgeSummaryLeafBinding; originalBinding: KnowledgeSummaryLeafBinding }>
  leafCount: number
  requestCount: number
  inputTokens: number
  outputTokens: number
  usageEstimated: boolean
}

export interface KnowledgeSummarySource {
  kind: 'entry' | 'base'
  knowledgeBaseId: string
  entryId?: string
  sourceVersionId: string
  derivedValue: string
  origin: 'ai' | 'author'
  createdAt: string
  coverage?: KnowledgeSummaryCoverage
}

export interface KnowledgeSummaryHistory {
  id: string
  summary: string
  summarySource?: KnowledgeSummarySource
  summaryLevel?: 'brief' | 'standard' | 'detailed'
  savedAt: string
}

// 知识库条目
export interface KBEntry {
  id: string
  category: string    // 分类：世界观/人物/势力/功法/道具/其他
  title: string       // 标题
  content: string     // 内容（Markdown）— 原始完整内容
  summary: string     // 摘要缓存：仅来源有效时可消费；原文检索不会被 summary 替代
  tags: string[]      // 标签
  createdAt: string
  updatedAt: string
  summarySource?: KnowledgeSummarySource
  summaryHistory?: KnowledgeSummaryHistory[]
}

// 知识库
export interface KnowledgeBase {
  id: string
  name: string
  description: string
  entries: KBEntry[]
  summary?: string
  summaryLevel?: 'brief' | 'standard' | 'detailed'
  summaryUpdatedAt?: string
  createdAt: string
  summarySource?: KnowledgeSummarySource
  summaryHistory?: KnowledgeSummaryHistory[]
}
