import { chapterBackgroundQueue } from './aiTaskQueue'
import { replaceProjectInDb } from './db/project'
import { parseProjectBackup, type ProjectBackup } from './projectBackup'
import { appUpdateInstalling, cloudApplyBusy, projectTransferBusy, activeAutonomousRunCount, activeMemoryRunCount } from './appLifecycle'
import { activeAiCount } from './aiActivity'
import { adoptProjectSnapshot, captureProjectSnapshot, flushProjectState } from './projectSnapshot'

export { projectTransferBusy } from './appLifecycle'

export function assertProjectIdle(): void {
  if (cloudApplyBusy.value) throw new Error('正在合并云端内容，请稍后重试。')
  if (appUpdateInstalling.value) throw new Error('正在准备安装更新，暂时不能备份或恢复项目。')
  if (projectTransferBusy.value) throw new Error('项目备份或导入正在进行')
  if (chapterBackgroundQueue.pendingCount) throw new Error('请等待章节后台任务结束后再备份或恢复项目')
  if (activeAiCount.value || activeAutonomousRunCount.value || activeMemoryRunCount.value) throw new Error('请等待 AI、故事回顾和自动写作任务结束后再备份或恢复项目。')
}

export async function exportProjectSnapshot(): Promise<ProjectBackup> {
  assertProjectIdle()
  projectTransferBusy.value = true
  try {
    await flushProjectState()
    return await captureProjectSnapshot()
  } finally { projectTransferBusy.value = false }
}

export async function importProject(backup: ProjectBackup): Promise<void> {
  assertProjectIdle()
  const checked = parseProjectBackup(JSON.stringify(backup))
  projectTransferBusy.value = true
  try {
    await flushProjectState()
    // Keep a separate, validated restore point. The database transaction also
    // preserves its previous on-disk image; this reference documents the exact
    // project state that was present before import.
    const before = await captureProjectSnapshot()
    const { retainProjectRestorePoint } = await import('./database')
    await retainProjectRestorePoint(JSON.stringify(before))
    await replaceProjectInDb(checked)
    adoptProjectSnapshot(checked)
  } finally { projectTransferBusy.value = false }
}
