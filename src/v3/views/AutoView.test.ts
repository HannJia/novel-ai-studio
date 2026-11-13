// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import AutoView from './AutoView.vue'
import { useNovelStore } from '@/stores/novel'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import type { AiRun } from '@/types/reconstruction'

const { route } = vi.hoisted(() => ({ route: { params: { novelId: '' } } }))
vi.mock('vue-router', async () => {
  const { reactive } = await import('vue')
  route.params = reactive(route.params)
  return { useRoute: () => route }
})

const runControlSpies = {
  ensureWorkspace: vi.fn().mockResolvedValue(undefined),
  pauseAutonomousRun: vi.fn(),
  resumeAutonomousRun: vi.fn(),
  cancelAutonomousRun: vi.fn(),
  recoverAutonomousRun: vi.fn(),
}
const stubs = {
  Teleport: true,
  RouterLink: true,
  ChapterList: defineComponent({
    props: { focusLastChapter: Boolean },
    setup(props, { expose }) {
      expose(runControlSpies)
      return () => h('div', { 'data-test': 'chapter-list-stub', 'data-focus-last': String(props.focusLastChapter) }, '章节任务')
    },
  }),
}
function seed(runs: AiRun[] = []) {
  setActivePinia(createPinia())
  const novels = useNovelStore(), workspace = useReconstructionWorkspaceStore()
  vi.spyOn(workspace, 'hydrateFromPersistence').mockResolvedValue({ candidates: [], reviewFindings: [], canonMutations: [], chapterReviews: [], aiRuns: [] })
  const novel = novels.addNovel({ genre: 'fantasy', subGenre: 'xuanhuan', tags: [], targetWordCountMin: 20, targetWordCountMax: 30, writingStyle: novels.defaultWritingStyle(), settings: novels.defaultSettings() })
  for (const title of ['天台', '旧档案', '第七个证人']) novels.addChapter(novel.id, { title, content: '' })
  vi.spyOn(workspace, 'getAiRuns').mockReturnValue(runs)
  route.params.novelId = novel.id
  return { novels, workspace, novel }
}
const autonomousRun = (over: Partial<AiRun> = {}): AiRun => ({ id: 'r1', mode: 'autonomous', taskType: 'draft', chapterStart: 0, chapterEnd: 2, tokenBudget: 600000, requestLimit: 200, usedTokens: 250000, checkpointEvery: 2,
  requests: [{ id: 'q1', chapterIndex: 0, phase: 'writing', modelId: 'm', status: 'completed', reservedTokens: 0, inputTokens: 40000, outputTokens: 12140, usageSource: 'reported', startedAt: '2026-11-09T12:41:07Z', completedAt: '2026-11-09T12:41:09Z' }],
  status: 'needs_author', checkpoint: 'chapter-1:checkpoint', error: '已完成 2 章，达到每 2 章检查点，请作者确认后继续。', createdAt: '', updatedAt: '2026-11-09T12:42:00Z', ...over })

describe('V3 autonomous writing center', () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.clearAllMocks() })

  it('keeps the page as three fixed columns and mounts the task controls only when opened', async () => {
    seed()
    const wrapper = shallowMount(AutoView, { global: { stubs } })
    await flushPromises()
    expect(wrapper.get('.crumb-b').text()).toContain('自动写作')
    expect(wrapper.find('.auto-view > .auto-page').exists()).toBe(true)
    expect(wrapper.find('.auto-view > .control-drawer').exists()).toBe(true)
    expect([...wrapper.get('.auto-page').element.children].map(node => node.className.split(' ')[0])).toEqual(expect.arrayContaining(['auto-config', 'auto-main', 'auto-ledger']))
    expect(wrapper.find('[data-test="chapter-list-stub"]').exists()).toBe(false)
    await wrapper.get('.runbar .m-btn').trigger('click')
    expect(wrapper.get('[data-test="chapter-list-stub"]').text()).toBe('章节任务')
    expect(wrapper.get('[data-test="chapter-list-stub"]').attributes('data-focus-last')).toBe('false')
    expect(wrapper.get('.control-drawer').classes()).toContain('open')
    await wrapper.get('.control-drawer header .m-ibtn').trigger('click')
    expect(wrapper.get('.control-drawer').classes()).not.toContain('open')
    expect((wrapper.get('.control-drawer').element as HTMLElement).style.display).toBe('none')
    // 关闭抽屉不卸载章节任务区，否则正在运行的任务会被当成“离开页面”而暂停。
    expect(wrapper.find('[data-test="chapter-list-stub"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('says plainly that no task exists yet instead of inventing a run', async () => {
    seed()
    const wrapper = shallowMount(AutoView, { global: { stubs } })
    await flushPromises()
    expect(wrapper.get('.runbar').text()).toContain('尚未开始任务')
    expect(wrapper.get('.runbar .m-btn').text()).toBe('设置并开始任务')
    expect(wrapper.get('.ledger-empty').text()).toContain('任务开始后')
    expect(wrapper.text()).toContain('暂无运行记录')
    expect(wrapper.findAll('.rch')).toHaveLength(3)
    expect(wrapper.find('.ckpt').exists()).toBe(false)
    expect(wrapper.get('.auto-config').text()).toContain('2,000 – 2,400 字（目标 2,200）')
    expect((wrapper.get('[aria-label="每章最低字数"]').element as HTMLInputElement).value).toBe('2000')
    expect((wrapper.get('[aria-label="每章目标字数"]').element as HTMLInputElement).value).toBe('2200')
    expect((wrapper.get('[aria-label="每章最高字数"]').element as HTMLInputElement).value).toBe('2400')
    wrapper.unmount()
  })

  it('validates and persists the per-chapter length policy', async () => {
    const { novels, novel } = seed()
    const saveNovel = vi.spyOn(novels, 'saveChapterLengthPolicy').mockImplementation(async (id, policy) => {
      novels.setChapterLengthPolicy(id, policy)
    })
    const wrapper = shallowMount(AutoView, { global: { stubs } })
    await flushPromises()

    await wrapper.get('[aria-label="每章最低字数"]').setValue('1800')
    await wrapper.get('[aria-label="每章目标字数"]').setValue('2100')
    await wrapper.get('[aria-label="每章最高字数"]').setValue('2500')
    expect((wrapper.get('.length-actions button').element as HTMLButtonElement).disabled).toBe(false)
    await wrapper.get('.length-policy').trigger('submit')
    await flushPromises()

    expect(saveNovel).toHaveBeenCalledWith(novel.id, { minWords: 1800, targetWords: 2100, maxWords: 2500 })
    expect(novels.getNovel(novel.id)?.chapterLengthPolicy).toEqual({ minWords: 1800, targetWords: 2100, maxWords: 2500 })
    expect(wrapper.get('.auto-config').text()).toContain('1,800 – 2,500 字（目标 2,100）')
    expect(wrapper.get('.length-state').text()).toBe('篇幅设置已保存。')
    wrapper.unmount()
  })

  it('rejects invalid ranges and locks settings while a run can resume', async () => {
    seed([autonomousRun({ status: 'paused' })])
    const wrapper = shallowMount(AutoView, { global: { stubs } })
    await flushPromises()

    expect((wrapper.get('.length-policy fieldset').element as HTMLFieldSetElement).disabled).toBe(true)
    expect(wrapper.find('.length-policy').text()).toContain('篇幅设置已锁定')
    wrapper.unmount()

    seed()
    const invalid = shallowMount(AutoView, { global: { stubs } })
    await flushPromises()
    await invalid.get('[aria-label="每章最低字数"]').setValue('2600')
    expect(invalid.get('.length-issue').text()).toContain('下限 ≤ 目标 ≤ 上限')
    expect((invalid.get('.length-actions button').element as HTMLButtonElement).disabled).toBe(true)
    invalid.unmount()
  })

  it('keeps a failed length save available for retry', async () => {
    const { novels } = seed()
    const saveNovel = vi.spyOn(novels, 'saveChapterLengthPolicy')
      .mockRejectedValueOnce(new Error('磁盘空间不足'))
      .mockImplementationOnce(async (id, policy) => { novels.setChapterLengthPolicy(id, policy) })
    const wrapper = shallowMount(AutoView, { global: { stubs } })
    await flushPromises()
    await wrapper.get('[aria-label="每章目标字数"]').setValue('2300')
    await wrapper.get('.length-policy').trigger('submit')
    await flushPromises()

    expect(wrapper.get('.length-state').text()).toContain('保存失败')
    expect((wrapper.get('.length-actions button').element as HTMLButtonElement).disabled).toBe(false)
    await wrapper.get('.length-policy').trigger('submit')
    await flushPromises()
    expect(saveNovel).toHaveBeenCalledTimes(2)
    expect(wrapper.get('.length-state').text()).toBe('篇幅设置已保存。')
    wrapper.unmount()
  })

  it('preserves edits made during a length save and does not report them as saved', async () => {
    const { novels } = seed()
    let finish!: () => void
    vi.spyOn(novels, 'saveChapterLengthPolicy').mockImplementationOnce(async (id, policy) => {
      await new Promise<void>(resolve => { finish = resolve })
      novels.setChapterLengthPolicy(id, policy)
    })
    const wrapper = shallowMount(AutoView, { global: { stubs } })
    await flushPromises()
    await wrapper.get('[aria-label="每章目标字数"]').setValue('2300')
    await wrapper.get('.length-policy').trigger('submit')
    await wrapper.get('[aria-label="每章目标字数"]').setValue('2350')
    finish()
    await flushPromises()
    expect((wrapper.get('[aria-label="每章目标字数"]').element as HTMLInputElement).value).toBe('2350')
    expect(wrapper.find('.length-state').exists()).toBe(false)
    expect((wrapper.get('.length-actions button').element as HTMLButtonElement).disabled).toBe(false)
    wrapper.unmount()
  })

  it('clears length status when switching books during an in-flight save', async () => {
    const { novels } = seed()
    const other = novels.addNovel({ genre: '', subGenre: '', tags: [], targetWordCountMin: 1, targetWordCountMax: 2,
      writingStyle: novels.defaultWritingStyle(), settings: novels.defaultSettings() })
    let finish!: () => void
    vi.spyOn(novels, 'saveChapterLengthPolicy').mockImplementationOnce(async (id, policy) => {
      await new Promise<void>(resolve => { finish = resolve })
      novels.setChapterLengthPolicy(id, policy)
    })
    const wrapper = shallowMount(AutoView, { global: { stubs } })
    await flushPromises()
    await wrapper.get('[aria-label="每章目标字数"]').setValue('2300')
    await wrapper.get('.length-policy').trigger('submit')
    route.params.novelId = other.id
    await flushPromises()
    finish()
    await flushPromises()
    expect((wrapper.get('[aria-label="每章目标字数"]').element as HTMLInputElement).value).toBe('2200')
    expect(wrapper.find('.length-state').exists()).toBe(false)
    expect(novels.getNovel(other.id)?.chapterLengthPolicy).toBeUndefined()
    wrapper.unmount()
  })

  it('projects the real run: budget, ledger, log and the checkpoint under the chapter that reached it', async () => {
    seed([autonomousRun()])
    const wrapper = shallowMount(AutoView, { global: { stubs } })
    await flushPromises()
    expect(wrapper.get('.runbar').text()).toContain('等待作者确认')
    expect(wrapper.get('.runbar .tiny').text()).toBe('第 2 章 · 达到作者检查点，等待你确认')
    expect(wrapper.get('.run-note').text()).toContain('请作者确认后继续')
    expect(wrapper.findAll('.runbar-actions button').map(button => button.text())).toEqual(['继续任务', '停止', '任务控制'])
    expect(wrapper.find('[data-test="chapter-list-stub"]').exists()).toBe(false)
    await wrapper.get('.runbar-actions button').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="chapter-list-stub"]').exists()).toBe(true)
    expect(runControlSpies.ensureWorkspace).toHaveBeenCalledOnce()
    expect(runControlSpies.resumeAutonomousRun).toHaveBeenCalledOnce()
    expect(wrapper.get('.auto-config').text()).toContain('每 2 章设检查点')
    expect(wrapper.get('.auto-config').text()).toContain('600,000')
    expect(wrapper.get('.budget').text()).toContain('250,000')
    expect(wrapper.get('.budget').text()).toContain('350,000')
    expect(wrapper.get('.ledger').text()).toContain('1 · 生成52,140')
    expect(wrapper.get('.log').text()).toContain('第 1 章 生成 · 已完成')
    const checkpoints = wrapper.findAll('.ckpt')
    expect(checkpoints).toHaveLength(1)
    expect(wrapper.findAll('.rch')[1].find('.ckpt').exists()).toBe(true)
    wrapper.unmount()
  })

  it('does not label a chapter that already has author prose as being generated', async () => {
    const { novels, novel } = seed([autonomousRun({ status: 'running', checkpoint: 'chapter-1:started', error: undefined, checkpointEvery: undefined })])
    novels.updateChapter(novel.id, novel.chapters[0].id, { content: '作者已经写好的正文', status: 'writing' })
    const wrapper = shallowMount(AutoView, { global: { stubs } })
    await flushPromises()
    const rows = wrapper.findAll('.rch')
    expect(wrapper.findAll('.runbar-actions button').map(button => button.text())).toEqual(['恢复中断任务', '停止', '任务控制'])
    expect(rows[0].text()).toContain('已有正文')
    expect(rows[0].text()).toContain('自动任务不会覆盖已有正文')
    expect(rows[1].text()).toContain('生成中')
    wrapper.unmount()
  })
})
