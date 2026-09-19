import type { Novel, ChapterRevision } from '@/types/novel'
import type { KnowledgeBase } from '@/stores/knowledge'
import { createProjectBackup, parseProjectBackup, type ProjectBackup } from './projectBackup'
import { latestInspirationSessions, parseInspirationSession, type InspirationSession } from './inspirationSessions'

export const DEFAULT_SYNC_ENDPOINT = 'https://154.94.227.164'
export const MAX_SYNC_DOCUMENT_BYTES = 50 * 1024 * 1024
export interface CloudUser { id: string; username: string; role: 'user' | 'admin'; quotaBytes: number; usedBytes: number }
export interface CloudSession { endpoint: string; token: string; expiresAt: number; user: CloudUser }
export interface CloudRecord { key: string; version: number; hash: string | null; bytes: number; updatedAt: number; payload?: string | null }
export interface SyncBase { version: number; hash: string | null }
export interface SyncBinding { endpoint: string; userId: string; username: string }
export interface SyncState { binding: SyncBinding | null; enabled: boolean; bases: Record<string, SyncBase>; lastSync: string }
export interface SyncConflict {
  id: string; key: string; title: string; local: string | null; remote: string | null
  remoteVersion: number; remoteHash: string | null; createdAt: string; resolution?: 'local' | 'remote'
}
export type SyncDocument =
  | { kind: 'novel'; novel: Novel; chapterRevisions: ChapterRevision[] }
  | { kind: 'knowledge'; knowledge: KnowledgeBase }
  | { kind: 'inspiration'; inspiration: InspirationSession }
export const emptySyncState = (): SyncState => ({ binding: null, enabled: false, bases: {}, lastSync: '' })

export function normalizeSyncEndpoint(raw: string): string {
  let url: URL
  try { url = new URL(raw.trim()) }
  catch { throw new Error('请输入有效的 HTTPS 同步服务器地址。') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('同步服务器必须是 HTTPS 地址，不能包含账号、路径或查询参数。')
  }
  return url.origin
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]))
    }
    return item
  })
}

export async function hashPayload(payload: string | null): Promise<string | null> {
  if (payload === null) return null
  const bytes = new TextEncoder().encode(payload)
  if (bytes.byteLength > MAX_SYNC_DOCUMENT_BYTES) throw new Error('单本小说或单个知识库超过 50 MiB 同步上限，请先导出备份并精简历史版本。')
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export function projectDocuments(project: ProjectBackup): Map<string, string> {
  const result = new Map<string, string>()
  const knownLibraries = new Set(project.knowledgeBases.map(kb => kb.id))
  for (const novel of project.novels) {
    result.set(`novel:${novel.id}`, canonicalJson({
      kind: 'novel', novel: { ...novel, knowledgeBaseIds: novel.knowledgeBaseIds.filter(id => knownLibraries.has(id)) },
      chapterRevisions: (project.chapterRevisions || []).filter(item => item.novelId === novel.id).sort((a, b) => a.id.localeCompare(b.id)),
    }))
  }
  for (const knowledge of project.knowledgeBases) result.set(`knowledge:${knowledge.id}`, canonicalJson({ kind: 'knowledge', knowledge }))
  for (const inspiration of project.inspirationSessions || []) result.set(`inspiration:${inspiration.id}`, canonicalJson({ kind: 'inspiration', inspiration }))
  return result
}

export function parseCloudDocument(key: string, payload: string): SyncDocument {
  if (new TextEncoder().encode(payload).byteLength > MAX_SYNC_DOCUMENT_BYTES) throw new Error('云端文档超过同步上限。')
  const value = JSON.parse(payload) as SyncDocument
  const now = new Date().toISOString()
  if (value?.kind === 'inspiration' && key === `inspiration:${value.inspiration?.id}`) {
    return { kind: 'inspiration', inspiration: parseInspirationSession(value.inspiration) }
  }
  if (value?.kind === 'knowledge' && key === `knowledge:${value.knowledge?.id}`) {
    parseProjectBackup(JSON.stringify(createProjectBackup([], [value.knowledge])))
    return value
  }
  if (value?.kind === 'novel' && key === `novel:${value.novel?.id}` && Array.isArray(value.chapterRevisions)) {
    // References are checked against the complete project again before application.
    const placeholders = (value.novel.knowledgeBaseIds || []).map(id => ({
      id, name: '', description: '', entries: [], createdAt: now,
    }))
    parseProjectBackup(JSON.stringify(createProjectBackup([value.novel], placeholders, value.chapterRevisions)))
    return value
  }
  throw new Error('云端文档类型或编号不匹配。')
}

export function documentTitle(key: string, payload: string | null): string {
  if (payload === null) return key.startsWith('novel:') ? '已删除的小说' : key.startsWith('inspiration:') ? '已删除的灵感会话' : '已删除的知识库'
  const doc = parseCloudDocument(key, payload)
  return doc.kind === 'novel' ? doc.novel.title || '未命名小说'
    : doc.kind === 'inspiration' ? doc.inspiration.title || '未命名灵感会话' : doc.knowledge.name || '未命名知识库'
}

export type SyncDecision = 'same' | 'push' | 'pull' | 'conflict'
export function decideSync(localHash: string | null, remote: SyncBase | undefined, base: SyncBase | undefined): SyncDecision {
  if (base && (remote?.version || 0) < base.version) throw new Error('云端版本低于本机已同步记录，可能发生过服务器恢复。已停止同步以保护两边的数据。')
  if (localHash === (remote?.hash ?? null)) return 'same'
  const previous = base?.hash ?? null
  const localChanged = localHash !== previous
  const remoteChanged = (remote?.hash ?? null) !== previous || (!base && !!remote)
  if (localChanged && remoteChanged) return 'conflict'
  return localChanged ? 'push' : 'pull'
}

export function mergeCloudDocuments(project: ProjectBackup, updates: Map<string, string | null>): ProjectBackup {
  let novels = [...project.novels]
  let libraries = [...project.knowledgeBases]
  let revisions = [...(project.chapterRevisions || [])]
  let sessions = project.inspirationSessions ? [...project.inspirationSessions] : undefined
  for (const [key, payload] of updates) {
    const id = key.slice(key.indexOf(':') + 1)
    if (key.startsWith('novel:')) {
      novels = novels.filter(book => book.id !== id)
      revisions = revisions.filter(item => item.novelId !== id)
      if (payload !== null) {
        const doc = parseCloudDocument(key, payload)
        if (doc.kind !== 'novel') throw new Error('小说类型错误。')
        novels.push(doc.novel)
        revisions.push(...doc.chapterRevisions)
      }
    } else if (key.startsWith('knowledge:')) {
      libraries = libraries.filter(kb => kb.id !== id)
      if (payload !== null) {
        const doc = parseCloudDocument(key, payload)
        if (doc.kind !== 'knowledge') throw new Error('知识库类型错误。')
        libraries.push(doc.knowledge)
      }
    } else if (key.startsWith('inspiration:')) {
      sessions = (sessions || []).filter(session => session.id !== id)
      if (payload !== null) {
        const doc = parseCloudDocument(key, payload)
        if (doc.kind !== 'inspiration') throw new Error('灵感会话类型错误。')
        sessions.push(doc.inspiration)
      }
    } else throw new Error('不支持的同步数据类型。')
  }
  // A deleted library leaves no dangling link, but never deletes book content.
  const available = new Set(libraries.map(kb => kb.id))
  novels = novels.map(novel => ({ ...novel, knowledgeBaseIds: novel.knowledgeBaseIds.filter(id => available.has(id)) }))
  return parseProjectBackup(JSON.stringify(createProjectBackup(novels, libraries, revisions,
    sessions ? latestInspirationSessions(sessions) : undefined)))
}
