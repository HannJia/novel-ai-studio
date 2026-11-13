import type { ChapterRevision, Novel } from '@/types/novel'
import type { KnowledgeBase } from '@/stores/knowledge'
import { validateProjectBackup } from './projectBackupValidation'
import type { InspirationSession } from './inspirationSessions'
import type { ReconstructionWorkspaceSnapshot } from '@/types/reconstruction'

export const MAX_PROJECT_BACKUP_BYTES = 256 * 1024 * 1024

export interface ProjectWorkspaceSnapshot extends ReconstructionWorkspaceSnapshot {
  novelId: string
  chapterReviews: NonNullable<ReconstructionWorkspaceSnapshot['chapterReviews']>
  aiRuns: NonNullable<ReconstructionWorkspaceSnapshot['aiRuns']>
}

export interface ProjectBackup {
  format: 'ai-novel-writer-backup'
  version: 2
  exportedAt: string
  novels: Novel[]
  knowledgeBases: KnowledgeBase[]
  chapterRevisions: ChapterRevision[]
  inspirationSessions: InspirationSession[]
  reconstructionWorkspaces: ProjectWorkspaceSnapshot[]
}

export type ProjectSnapshotInput = Pick<ProjectBackup, 'novels' | 'knowledgeBases' | 'chapterRevisions' | 'inspirationSessions' | 'reconstructionWorkspaces'>

// Callers must explicitly supply every collection; an omitted workspace must
// never masquerade as a complete backup of a V2 novel.
export function createProjectBackup(input: ProjectSnapshotInput): ProjectBackup {
  return {
    format: 'ai-novel-writer-backup',
    version: 2,
    exportedAt: new Date().toISOString(),
    novels: JSON.parse(JSON.stringify(input.novels)),
    knowledgeBases: JSON.parse(JSON.stringify(input.knowledgeBases)),
    chapterRevisions: JSON.parse(JSON.stringify(input.chapterRevisions)),
    inspirationSessions: JSON.parse(JSON.stringify(input.inspirationSessions)),
    reconstructionWorkspaces: JSON.parse(JSON.stringify(input.reconstructionWorkspaces)),
  }
}

export function parseProjectBackup(raw: string): ProjectBackup {
  if (raw.length > MAX_PROJECT_BACKUP_BYTES || new Blob([raw]).size > MAX_PROJECT_BACKUP_BYTES) throw new Error('备份文件超过 256 MB 安全上限')
  const value = JSON.parse(raw) as Partial<ProjectBackup>
  if (value?.format === 'ai-novel-writer-backup' && (value as { version?: number }).version === 1) {
    throw new Error('旧版备份缺少 V2 创作工作区，无法作为完整项目恢复；请使用包含规划、审核和正式设定的 V2 备份。')
  }
  if (!value || value.format !== 'ai-novel-writer-backup' || value.version !== 2 || !Array.isArray(value.novels) || !Array.isArray(value.knowledgeBases)) {
    throw new Error('不是有效的墨笺项目备份文件')
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
