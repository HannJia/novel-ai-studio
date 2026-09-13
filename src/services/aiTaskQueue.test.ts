import { describe, expect, it, vi } from 'vitest'

const taskState = vi.hoisted(() => ({
  events: [] as string[],
  resolveRecord: () => undefined,
}))

vi.mock('@/services/db/aiTasks', () => ({
  createAiTaskRecord: () => new Promise<string>(resolve => {
    taskState.resolveRecord = () => {
      taskState.events.push('record-created')
      resolve('task-1')
    }
  }),
  updateAiTaskRecord: async (_id: string, status: string) => {
    taskState.events.push(status)
  },
  markInterruptedTasksFailed: async () => undefined,
}))

import { AiTaskQueue } from './aiTaskQueue'
import { appUpdateInstalling } from './appLifecycle'

describe('AI background task queue', () => {
  it('does not queue work after update preparation has started', () => {
    appUpdateInstalling.value = true
    const queue = new AiTaskQueue(1)
    try {
      expect(() => queue.enqueue('late task', async () => undefined)).toThrow('准备安装更新')
      expect(queue.pendingCount).toBe(0)
    } finally { appUpdateInstalling.value = false }
  })
  it('persists the task record before starting the queued work', async () => {
    taskState.events.length = 0
    taskState.resolveRecord = () => undefined
    const queue = new AiTaskQueue(1)
    queue.enqueue('test task', async () => {
      taskState.events.push('task-ran')
    })

    await Promise.resolve()
    expect(taskState.events).toEqual([])
    taskState.resolveRecord()

    await vi.waitFor(() => expect(queue.status).toBe('completed'))
    expect(taskState.events).toEqual(['record-created', 'running', 'task-ran', 'completed'])
  })
})
