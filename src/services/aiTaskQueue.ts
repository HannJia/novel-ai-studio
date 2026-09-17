import { createAiTaskRecord, markInterruptedTasksFailed, updateAiTaskRecord } from '@/services/db/aiTasks'
import { appUpdateInstalling, cloudApplyBusy } from './appLifecycle'

type AiTaskStatus = 'idle' | 'pending' | 'running' | 'completed' | 'failed'

type QueueTask = () => Promise<void>

interface QueueItem {
  name: string
  task: QueueTask
  taskRecord: Promise<string | null>
}

export class AiTaskQueue {
  private queue: QueueItem[] = []
  private running = 0
  private listeners = new Set<() => void>()
  currentTaskName = ''
  status: AiTaskStatus = 'idle'

  constructor(private readonly concurrency = 1) {}

  enqueue(name: string, task: QueueTask, groupName = ''): void {
    if (cloudApplyBusy.value) throw new Error('正在合并云端内容，请稍后重试。')
    if (appUpdateInstalling.value) throw new Error('正在准备安装更新，暂时不能启动后台任务。')
    const taskRecord = createAiTaskRecord(name, groupName).catch(err => {
      console.warn('AI task record create failed', err)
      return null
    })
    this.queue.push({ name, task, taskRecord })

    if (this.status === 'idle' || this.status === 'completed' || this.status === 'failed') {
      this.status = 'pending'
      this.emit()
    }
    void this.runNext()
  }

  enqueueBatch(groupName: string, items: Array<{ name: string; task: QueueTask }>): void {
    for (const item of items) this.enqueue(item.name, item.task, groupName)
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  get pendingCount(): number {
    return this.queue.length + this.running
  }

  private async runNext(): Promise<void> {
    if (this.running >= this.concurrency) return
    const item = this.queue.shift()
    if (!item) {
      if (this.running === 0 && this.status !== 'idle') {
        this.currentTaskName = ''
        this.status = 'completed'
        this.emit()
      }
      return
    }

    this.running++
    this.currentTaskName = item.name
    this.status = 'running'
    this.emit()
    const taskId = await item.taskRecord
    try {
      if (taskId) {
        await updateAiTaskRecord(taskId, 'running').catch(err => {
          console.warn('AI task running state update failed', err)
        })
      }
      await item.task()
      if (taskId) {
        await updateAiTaskRecord(taskId, 'completed').catch(err => {
          console.warn('AI task completion state update failed', err)
        })
      }
    } catch (err) {
      this.status = 'failed'
      if (taskId) {
        const message = err instanceof Error ? err.message : String(err)
        await updateAiTaskRecord(taskId, 'failed', message).catch(updateError => {
          console.warn('AI task failure state update failed', updateError)
        })
      }
      this.emit()
      console.warn(`AI 后台任务失败：${item.name}`, err)
    } finally {
      this.running--
      void this.runNext()
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}

export async function initializeAiTaskHistory(): Promise<void> {
  await markInterruptedTasksFailed()
}

export const chapterBackgroundQueue = new AiTaskQueue(1)
