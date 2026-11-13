// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import ProjectHistoryPanel from './ProjectHistoryPanel.vue'
import { useNovelStore } from '@/stores/novel'
import type { ProjectHistoryRetentionPreview, ProjectHistoryRetentionState } from '@/types/projectHistory'

const mocks = vi.hoisted(() => ({
  desktop: true,
  readRetention: vi.fn(),
  previewRetention: vi.fn(),
  confirmRetention: vi.fn(),
  listHistory: vi.fn(),
  readSnapshot: vi.fn(),
  previewHistory: vi.fn(),
  restoreHistory: vi.fn(),
  createPoint: vi.fn(),
  rebuildIndex: vi.fn(),
  previewCapacity: vi.fn(),
  cleanupCapacity: vi.fn(),
  inspectIndex: vi.fn(),
  projectIndexWarnings: [] as Array<{ projectId: string; message: string }>,
}))

vi.mock('@/services/projectKernelClient', () => ({
  usesProjectKernel: () => mocks.desktop,
  inspectProjectIndex: mocks.inspectIndex,
  projectIndexWarnings: mocks.projectIndexWarnings,
  readKernelHistoryRetention: mocks.readRetention,
  previewKernelHistoryRetention: mocks.previewRetention,
  confirmKernelHistoryRetention: mocks.confirmRetention,
}))
vi.mock('@/services/projectHistory', () => ({
  listProjectHistory: mocks.listHistory,
  readHistorySnapshot: mocks.readSnapshot,
  previewProjectHistory: mocks.previewHistory,
  restoreProjectHistory: mocks.restoreHistory,
  createProjectHistoryPoint: mocks.createPoint,
  rebuildCurrentProjectIndex: mocks.rebuildIndex,
  previewProjectHistoryCapacity: mocks.previewCapacity,
  cleanupProjectHistoryCapacity: mocks.cleanupCapacity,
}))

const firstRevision = '0000000000000001-' + 'a'.repeat(64)
const latestRevision = '0000000000000003-' + 'c'.repeat(64)
const retentionState: ProjectHistoryRetentionState = {
  supported: true, policy: { keepLatest: null, keepSince: null }, pinnedRevisions: [], fingerprint: 'f'.repeat(64), limitations: [],
}
const retentionPreview: ProjectHistoryRetentionPreview = {
  token: '11111111-1111-4111-8111-111111111111', baseRevision: latestRevision, fingerprint: retentionState.fingerprint,
  policy: { keepLatest: 1, keepSince: null }, pinnedRevisions: [], prunedRevisions: [firstRevision],
  archiveSources: [{ revision: firstRevision, projectId: 'book-a', snapshot: 'b'.repeat(64) }],
}
const history = [
  { revision: latestRevision, parentRevision: firstRevision, createdAt: '2026-11-04T10:00:00.000Z', projectCount: 1, projectIds: ['book-a'], prunedAt: null, pinned: false },
  { revision: firstRevision, parentRevision: null, createdAt: '2026-11-03T10:00:00.000Z', projectCount: 1, projectIds: ['book-a'], prunedAt: null, pinned: false },
]
let wrapper: ReturnType<typeof mount>

function mountPanel() {
  const store = useNovelStore()
  const book = store.addNovel({ genre: '', subGenre: '', tags: [], targetWordCountMin: 1, targetWordCountMax: 2,
    settings: store.defaultSettings(), writingStyle: store.defaultWritingStyle() })
  book.id = 'book-a'
  book.title = '渡口档案'
  wrapper = mount(ProjectHistoryPanel)
  return book
}

beforeEach(() => {
  setActivePinia(createPinia())
  mocks.desktop = true
  vi.clearAllMocks()
  mocks.projectIndexWarnings = []
  mocks.readRetention.mockResolvedValue({ ...retentionState })
  mocks.listHistory.mockResolvedValue(history.map(row => ({ ...row })))
  mocks.previewRetention.mockResolvedValue({ ...retentionPreview })
  mocks.confirmRetention.mockResolvedValue({ revision: '0000000000000004-' + 'd'.repeat(64), ...retentionPreview.policy,
    pinnedRevisions: [], prunedRevisions: [firstRevision] })
  mocks.previewCapacity.mockResolvedValue({ token: 'capacity-token', baseRevision: latestRevision, totalFiles: 0, totalBytes: 0,
    reclaimableFiles: 0, reclaimableBytes: 0, protectedVersions: 2, protectedReasons: [], limitations: [] })
})
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks() })

describe('ProjectHistoryPanel retention controls', () => {
  it('explains browser quota failure without claiming the checkpoint was saved', async () => {
    mocks.desktop = false
    mocks.createPoint.mockRejectedValueOnce(new DOMException('quota', 'QuotaExceededError'))
    mountPanel(); await flushPromises()
    await wrapper.get('.history-actions select').setValue('book-a')
    await wrapper.findAll('button').find(button => button.text() === '为该作品保存手动恢复点')!.trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('本次操作未完成')
    expect(wrapper.text()).not.toContain('手动恢复点已保存')
    expect(mocks.createPoint).toHaveBeenCalledWith('book-a')
  })

  it('shows the retention write path only for desktop projects', async () => {
    mocks.desktop = false
    mountPanel()
    await flushPromises()
    expect(wrapper.text()).toContain('浏览器存储不支持作者控制的版本裁剪')
    expect(wrapper.text()).not.toContain('预览保留策略')
    expect(mocks.readRetention).not.toHaveBeenCalled()
  })

  it('previews revisions and ledger sources, then confirms and refreshes policy/history', async () => {
    mountPanel()
    await flushPromises()
    expect(mocks.readRetention).toHaveBeenCalledTimes(1)
    await wrapper.get('input[type="number"]').setValue('1')
    await wrapper.get('button').trigger('click')
    const previewButton = wrapper.findAll('button').find(button => button.text() === '预览保留策略')!
    await previewButton.trigger('click')
    await flushPromises()
    expect(mocks.previewRetention).toHaveBeenCalledWith({ keepLatest: 1, keepSince: null }, [])
    expect(wrapper.text()).toContain(firstRevision.slice(0, 16))
    expect(wrapper.text()).toContain('渡口档案')
    expect(wrapper.text()).toContain('提交记录及正文不会删除')
    const acknowledge = wrapper.findAll('input[type="checkbox"]').find(input => input.element.parentElement?.textContent?.includes('以上版本将不可恢复'))!
    await acknowledge.setValue(true)
    const confirmButton = wrapper.findAll('button').find(button => button.text() === '确认应用保留策略')!
    await confirmButton.trigger('click')
    await flushPromises()
    expect(mocks.confirmRetention).toHaveBeenCalledWith(retentionPreview.token, latestRevision)
    expect(mocks.readRetention).toHaveBeenCalledTimes(2)
    expect(mocks.listHistory).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('保留策略已保存')
  })

  it('invalidates the prior preview when any policy input changes', async () => {
    mountPanel()
    await flushPromises()
    await wrapper.get('input[type="number"]').setValue('1')
    await wrapper.findAll('button').find(button => button.text() === '预览保留策略')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('将停止恢复 1 个版本')
    await wrapper.get('input[type="number"]').setValue('2')
    expect(wrapper.text()).not.toContain('将停止恢复 1 个版本')
    const confirmButton = wrapper.findAll('button').find(button => button.text() === '确认应用保留策略')
    expect(confirmButton?.attributes('disabled')).toBeUndefined()
    expect(wrapper.text()).toContain('保留条件已更改')
    expect(wrapper.text()).toContain('保留条件已更改')
    await wrapper.findAll('button').find(button => button.text() === '关闭过期预览')!.trigger('click')
    expect(mocks.confirmRetention).not.toHaveBeenCalled()
  })

  it('keeps policy inputs after a preview failure and does not confirm', async () => {
    mocks.previewRetention.mockRejectedValueOnce(new Error('版本已变化'))
    mountPanel()
    await flushPromises()
    await wrapper.get('input[type="number"]').setValue('7')
    await wrapper.findAll('button').find(button => button.text() === '预览保留策略')!.trigger('click')
    await flushPromises()
    expect(wrapper.get('input[type="number"]').element).toHaveProperty('value', '7')
    expect(wrapper.text()).toContain('版本已变化')
    expect(mocks.confirmRetention).not.toHaveBeenCalled()
  })

  it('keeps policy inputs and current history if confirmation succeeds but refresh fails', async () => {
    mocks.readRetention.mockResolvedValueOnce({ ...retentionState }).mockResolvedValueOnce({ ...retentionState, policy: { keepLatest: 9, keepSince: null } })
    mocks.listHistory.mockResolvedValueOnce(history.map(row => ({ ...row }))).mockRejectedValueOnce(new Error('历史刷新失败'))
    mountPanel()
    await flushPromises()
    await wrapper.get('input[type="number"]').setValue('1')
    await wrapper.findAll('button').find(button => button.text() === '预览保留策略')!.trigger('click')
    await flushPromises()
    const acknowledge = wrapper.findAll('input[type="checkbox"]').find(input => input.element.parentElement?.textContent?.includes('以上版本将不可恢复'))!
    await acknowledge.setValue(true)
    await wrapper.findAll('button').find(button => button.text() === '确认应用保留策略')!.trigger('click')
    await flushPromises()
    expect(mocks.confirmRetention).toHaveBeenCalledOnce()
    expect(wrapper.get('input[type="number"]').element).toHaveProperty('value', '1')
    expect(wrapper.text()).toContain('历史刷新失败')
    expect(wrapper.text()).not.toContain('保留策略已保存')
  })

  it('marks pruned versions and blocks snapshot preview', async () => {
    mocks.listHistory.mockResolvedValueOnce([{ ...history[0] }, { ...history[1], prunedAt: '2026-11-04T11:00:00.000Z' }])
    mountPanel()
    await flushPromises()
    const select = wrapper.findAll('select').find(item => item.element.options.length === 3)!
    await select.setValue(firstRevision)
    await flushPromises()
    expect(wrapper.text()).toContain('此版本已裁剪')
    const previewButton = wrapper.findAll('button').find(button => button.text() === '只读预览与当前版本比较')!
    expect(previewButton.attributes('disabled')).toBeDefined()
    expect(mocks.readSnapshot).not.toHaveBeenCalled()
  })
})
