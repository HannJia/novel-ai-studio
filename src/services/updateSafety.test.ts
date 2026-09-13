import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareUpdateInstall } from './updateSafety'
import { appUpdateInstalling, registerDraftSaver } from './appLifecycle'
import { activeAiCount, acknowledgeAiActivity, startAiActivity, finishAiActivity } from './aiActivity'
import { projectTransferBusy } from './projectTransfer'

const mocks = vi.hoisted(() => ({ novels: vi.fn(), knowledge: vi.fn(), config: vi.fn(), queue: { pendingCount: 0 } }))
vi.mock('@/stores/novel', () => ({ useNovelStore: () => ({ flushPendingSaves: mocks.novels }) }))
vi.mock('@/stores/knowledge', () => ({ useKnowledgeStore: () => ({ flushPendingSaves: mocks.knowledge }) }))
vi.mock('@/stores/config', () => ({ useConfigStore: () => ({ saveConfig: mocks.config }) }))
vi.mock('./aiTaskQueue', () => ({ chapterBackgroundQueue: mocks.queue }))
vi.mock('./projectTransfer', async () => ({ projectTransferBusy: (await import('vue')).ref(false) }))
beforeEach(() => {
  vi.clearAllMocks()
  mocks.queue.pendingCount = 0
  mocks.novels.mockResolvedValue(undefined)
  mocks.knowledge.mockResolvedValue(undefined)
  mocks.config.mockResolvedValue(undefined)
  appUpdateInstalling.value = false
  projectTransferBusy.value = false
})
afterEach(() => { appUpdateInstalling.value = false })

describe('saving safely before updating', () => {
  it('saves live editor drafts before flushing stores and prevents new AI work during installation', async () => {
    const order: string[] = []
    const unregister = registerDraftSaver(async () => { order.push('editor') })
    mocks.novels.mockImplementation(async () => { order.push('novels') })
    try {
      await prepareUpdateInstall()
      expect(order).toEqual(['editor', 'novels'])
      expect(mocks.knowledge).toHaveBeenCalledOnce()
      expect(mocks.config).toHaveBeenCalledOnce()
      expect(appUpdateInstalling.value).toBe(true)
      expect(() => startAiActivity('new')).toThrow('不能启动')
    } finally { unregister() }
  })
  it('blocks active AI even after its visible task was dismissed', async () => {
    const task = startAiActivity('writing')
    acknowledgeAiActivity(task.id)
    try {
      expect(activeAiCount.value).toBe(1)
      await expect(prepareUpdateInstall()).rejects.toThrow('AI 任务')
      expect(mocks.novels).not.toHaveBeenCalled()
    } finally { finishAiActivity(task) }
    expect(activeAiCount.value).toBe(0)
  })
  it('blocks background queues and project imports', async () => {
    mocks.queue.pendingCount = 1
    await expect(prepareUpdateInstall()).rejects.toThrow('AI 任务')
    mocks.queue.pendingCount = 0
    projectTransferBusy.value = true
    await expect(prepareUpdateInstall()).rejects.toThrow('导入')
  })
  it('unfreezes the app on an editor save failure without flushing stale store data', async () => {
    const unregister = registerDraftSaver(async () => { throw new Error('未保存正文') })
    try {
      await expect(prepareUpdateInstall()).rejects.toThrow('未保存正文')
      expect(mocks.novels).not.toHaveBeenCalled()
      expect(appUpdateInstalling.value).toBe(false)
    } finally { unregister() }
  })
  it.each(['novels', 'knowledge', 'config'] as const)('unfreezes and rejects on %s write failure', async store => {
    mocks[store].mockRejectedValueOnce(new Error('磁盘写入失败'))
    await expect(prepareUpdateInstall()).rejects.toThrow('磁盘写入失败')
    expect(appUpdateInstalling.value).toBe(false)
  })
})
