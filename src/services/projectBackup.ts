import type { ChapterRevision, Novel } from '@/types/novel'
import type { KnowledgeBase } from '@/stores/knowledge'
import { validateProjectBackup } from './projectBackupValidation'
import type { InspirationSession } from './inspirationSessions'

export const MAX_PROJECT_BACKUP_BYTES = 256 * 1024 * 1024

export interface ProjectBackup {
  format: 'ai-novel-writer-backup'
  version: 1
  exportedAt: string
  novels: Novel[]
  knowledgeBases: KnowledgeBase[]
  chapterRevisions?: ChapterRevision[] // Backward-compatible extension for pending AI drafts.
  inspirationSessions?: InspirationSession[]
}

export function createProjectBackup(novels: Novel[], knowledgeBases: KnowledgeBase[], chapterRevisions: ChapterRevision[] = [], inspirationSessions?: InspirationSession[]): ProjectBackup {
  return {
    format: 'ai-novel-writer-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    novels: JSON.parse(JSON.stringify(novels)),
    knowledgeBases: JSON.parse(JSON.stringify(knowledgeBases)),
    chapterRevisions: JSON.parse(JSON.stringify(chapterRevisions)),
    ...(inspirationSessions === undefined ? {} : { inspirationSessions: JSON.parse(JSON.stringify(inspirationSessions)) }),
  }
}

export function parseProjectBackup(raw: string): ProjectBackup {
  if (raw.length > MAX_PROJECT_BACKUP_BYTES || new Blob([raw]).size > MAX_PROJECT_BACKUP_BYTES) throw new Error('备份文件超过 256 MB 安全上限')
  const value = JSON.parse(raw) as Partial<ProjectBackup>
  if (value.format !== 'ai-novel-writer-backup' || value.version !== 1 || !Array.isArray(value.novels) || !Array.isArray(value.knowledgeBases)) {
    throw new Error('不是有效的 AI Novel Writer 备份文件')
  }
  validateProjectBackup(value)
  return value as ProjectBackup
}

export function downloadProjectBackup(backup: ProjectBackup, filename = 'ai-novel-writer-backup.json') {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
