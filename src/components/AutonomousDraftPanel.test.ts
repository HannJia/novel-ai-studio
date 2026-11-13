// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AutonomousDraftPanel from './AutonomousDraftPanel.vue'
import type { AiChapterDraft, AiRun } from '@/types/reconstruction'

const { decideAiDraft } = vi.hoisted(() => ({ decideAiDraft: vi.fn() }))

vi.mock('@/stores/reconstructionWorkspace', () => ({
  useReconstructionWorkspaceStore: () => ({ decideAiDraft }),
}))

const now = '2026-10-30T00:00:00.000Z'

function makeDraft(overrides: Partial<AiChapterDraft> = {}): AiChapterDraft {
  return {
    id: 'draft-1', chapterId: 'chapter-1', chapterIndex: 1, baseContent: '原正文', content: '候选正文',
    contextVersion: 'context-1', status: 'pending', stage: 'analyzed', report: '事实报告',
    createdAt: now, updatedAt: now, history: [{ content: '历史正文', updatedAt: '2026-10-29T00:00:00.000Z' }], ...overrides,
  }
}

function makeRun(drafts: AiChapterDraft[], overrides: Partial<AiRun> = {}): AiRun {
  return {
    id: 'run-1', mode: 'autonomous', taskType: 'draft', status: 'paused', createdAt: now, updatedAt: now,
    chapterDrafts: drafts, ...overrides,
  }
}

function mountPanel(runs: AiRun[], props: Record<string, unknown> = {}) {
  return mount(AutonomousDraftPanel, { props: { novelId: 'novel-1', runs, ...props } })
}

beforeEach(() => { decideAiDraft.mockReset() })

describe('AutonomousDraftPanel', () => {
  it('passes the complete original JSON snapshot to edit and refreshes the form after success', async () => {
    const original = makeDraft()
    const edited = { ...original, content: '修改后的正文', updatedAt: '2026-10-30T01:00:00.000Z' }
    decideAiDraft.mockResolvedValue(edited)
    const wrapper = mountPanel([makeRun([original])])

    await wrapper.get('[data-action="view-draft"]').trigger('click')
    await wrapper.get<HTMLTextAreaElement>('[aria-label="候选正文"]').setValue('修改后的正文')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(decideAiDraft).toHaveBeenCalledWith('novel-1', 'run-1', original, 'edit', '修改后的正文')
    expect(decideAiDraft.mock.calls[0][2]).not.toBe(original)
    expect(wrapper.get<HTMLTextAreaElement>('[aria-label="候选正文"]').element.value).toBe('修改后的正文')
    expect(wrapper.get('[role="status"]').text()).toContain('已保存')
    wrapper.unmount()
  })

  it('requires saving dirty text before accepting and then uses the refreshed expected draft', async () => {
    const original = makeDraft()
    const edited = { ...original, content: '先保存的正文', updatedAt: '2026-10-30T01:00:00.000Z' }
    const accepted = { ...edited, status: 'accepted' as const, acceptedAt: '2026-10-30T02:00:00.000Z' }
    decideAiDraft.mockImplementation((_novelId: string, _runId: string, _expected: AiChapterDraft, action: string) =>
      Promise.resolve(action === 'edit' ? edited : accepted))
    const wrapper = mountPanel([makeRun([original])])

    await wrapper.get('[data-action="view-draft"]').trigger('click')
    await wrapper.get<HTMLTextAreaElement>('[aria-label="候选正文"]').setValue('先保存的正文')
    await wrapper.get('[data-action="accept"]').trigger('click')
    await flushPromises()

    expect(decideAiDraft).toHaveBeenCalledTimes(0)
    expect(wrapper.get('[role="alert"]').text()).toContain('请先保存候选修改，再接受为正文')

    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await wrapper.get('[data-action="accept"]').trigger('click')
    await flushPromises()

    expect(decideAiDraft.mock.calls.map(call => call[3])).toEqual(['edit', 'accept'])
    expect(decideAiDraft.mock.calls[1][2]).toEqual(edited)
    expect(wrapper.get('[role="status"]').text()).toContain('事实审核与定稿')
    wrapper.unmount()
  })

  it('keeps user input when saving an edit fails', async () => {
    const original = makeDraft()
    decideAiDraft.mockRejectedValue(new Error('保存失败'))
    const wrapper = mountPanel([makeRun([original])])

    await wrapper.get('[data-action="view-draft"]').trigger('click')
    await wrapper.get<HTMLTextAreaElement>('[aria-label="候选正文"]').setValue('暂不丢失的输入')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get<HTMLTextAreaElement>('[aria-label="候选正文"]').element.value).toBe('暂不丢失的输入')
    expect(wrapper.get('[role="alert"]').text()).toContain('保存失败')
    expect(decideAiDraft).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('shows every historical draft and allows writes only for pending drafts', async () => {
    const pending = makeDraft({ id: 'draft-pending', chapterIndex: 2 })
    const accepted = makeDraft({ id: 'draft-accepted', status: 'accepted', chapterIndex: 3, content: '已接受正文' })
    const wrapper = mountPanel([makeRun([pending, accepted])])

    expect(wrapper.findAll('[data-action="view-draft"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('待处理')
    expect(wrapper.text()).toContain('已接受为正文')
    expect(wrapper.text()).toContain('查看历史报告')
    expect(wrapper.text()).toContain('查看历史正文')

    await wrapper.findAll('[data-action="view-draft"]')[1].trigger('click')
    expect(wrapper.get<HTMLTextAreaElement>('[aria-label="候选正文"]').element.readOnly).toBe(true)
    expect(wrapper.find('[data-action="accept"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('blocks writes while a task is running or the panel is disabled', async () => {
    const draft = makeDraft()
    const running = mountPanel([makeRun([draft], { status: 'running' })])
    await running.get('[data-action="view-draft"]').trigger('click')
    expect(running.get<HTMLTextAreaElement>('[aria-label="候选正文"]').element.readOnly).toBe(true)
    expect(running.find('[data-action="save-edit"]').exists()).toBe(false)
    running.unmount()

    const disabled = mountPanel([makeRun([draft])], { disabled: true })
    await disabled.get('[data-action="view-draft"]').trigger('click')
    expect(disabled.get<HTMLTextAreaElement>('[aria-label="候选正文"]').element.readOnly).toBe(true)
    expect(disabled.find('[data-action="reject"]').exists()).toBe(false)
    disabled.unmount()
  })
})
