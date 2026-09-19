import type { InspirationMessage } from './inspiration'

export const LEGACY_INSPIRATION_KEY = 'novel-writer-inspiration-sessions'
export const MAX_INSPIRATION_SESSIONS = 5
export interface InspirationSession {
  id: string
  title: string
  updatedAt: string
  messages: InspirationMessage[]
  knowledgeIds: string[] | null
  draft: string
  webSearch: boolean
  context?: { content: string; messageCount: number }
}

export function parseInspirationSession(raw: unknown): InspirationSession {
  const value = raw as InspirationSession
  const invalid = () => { throw new Error('灵感会话数据不完整或无效。') }
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !/^[^\x00-\x1f\x7f]{1,200}$/.test(value.id)
    || ['__proto__', 'constructor', 'prototype'].includes(value.id)
    || typeof value.title !== 'string' || value.title.length > 200 || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))
    || !Array.isArray(value.messages) || value.messages.length > 30000
    || (value.draft !== undefined && (typeof value.draft !== 'string' || value.draft.length > 4000))
    || (value.webSearch !== undefined && typeof value.webSearch !== 'boolean')
    || (value.knowledgeIds != null && (!Array.isArray(value.knowledgeIds) || value.knowledgeIds.length > 1000
      || value.knowledgeIds.some(id => typeof id !== 'string' || id.length > 200)))) invalid()
  let characters = 0
  const messages = value.messages.map(message => {
    if (!message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') invalid()
    characters += message.content.length
    if (characters > 5_000_000) invalid()
    const next: InspirationMessage = { role: message.role, content: message.content }
    if (message.search !== undefined) {
      const search = message.search
      if (!search || !['responses', 'anthropic', 'openrouter', 'chat-completions'].includes(search.protocol)
        || !['searched', 'not-used', 'unverified'].includes(search.status)
        || !Array.isArray(search.sources) || search.sources.length > 30) invalid()
      next.search = { protocol: search.protocol, status: search.status, sources: search.sources.map(source => {
        if (!source || typeof source.url !== 'string' || source.url.length > 8000 || typeof source.title !== 'string'
          || source.title.length > 2000 || (source.excerpt !== undefined && (typeof source.excerpt !== 'string' || source.excerpt.length > 20000))) invalid()
        return { url: source.url, title: source.title, ...(source.excerpt === undefined ? {} : { excerpt: source.excerpt }) }
      }) }
    }
    return next
  })
  const context = value.context
  if (context && (typeof context.content !== 'string' || context.content.length > 100000
    || !Number.isSafeInteger(context.messageCount) || context.messageCount < 1 || context.messageCount > messages.length)) invalid()
  return { id: value.id, title: value.title, updatedAt: value.updatedAt, messages,
    knowledgeIds: value.knowledgeIds == null ? null : [...value.knowledgeIds],
    draft: value.draft || '', webSearch: value.webSearch || false,
    ...(context ? { context: { content: context.content, messageCount: context.messageCount } } : {}) }
}

export function latestInspirationSessions(sessions: InspirationSession[]) {
  return [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
    .slice(0, MAX_INSPIRATION_SESSIONS)
}
