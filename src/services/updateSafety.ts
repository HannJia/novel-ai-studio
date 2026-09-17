import { useNovelStore } from '@/stores/novel'
import { useKnowledgeStore } from '@/stores/knowledge'
import { useConfigStore } from '@/stores/config'
import { activeAiCount } from './aiActivity'
import { chapterBackgroundQueue } from './aiTaskQueue'
import { projectTransferBusy } from './projectTransfer'
import { appUpdateInstalling, cloudApplyBusy, flushEditorDrafts } from './appLifecycle'

export async function prepareUpdateInstall(): Promise<void> {
  const assertIdle = () => {
    if (activeAiCount.value || chapterBackgroundQueue.pendingCount) {
      throw new Error('AI 任务仍在运行，请等待任务结束后再安装更新。')
    }
    if (projectTransferBusy.value) throw new Error('项目导入尚未结束，请稍后再安装更新。')
    if (cloudApplyBusy.value) throw new Error('云端内容正在合并，请稍后再安装更新。')
  }
  try {
    assertIdle()
    appUpdateInstalling.value = true
    await flushEditorDrafts()
    await Promise.all([
      useNovelStore().flushPendingSaves(),
      useKnowledgeStore().flushPendingSaves(),
      useConfigStore().saveConfig(),
    ])
    assertIdle()
  } catch (error) {
    appUpdateInstalling.value = false
    throw error
  }
}
