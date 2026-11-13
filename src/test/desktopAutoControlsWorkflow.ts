// Development-only acceptance of the normal run-center controls across real
// Electron process restarts. All data and responses belong to this fixture.
import { nextTick } from 'vue'
import router from '@/router'
import { useConfigStore, type ConfigData } from '@/stores/config'
import { useNovelStore } from '@/stores/novel'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { readStoryAggregate } from '@/services/storyAggregate'
import type { AiRun } from '@/types/reconstruction'
import { desktopAutoFixtureModel, installDeterministicFetch, type DesktopAutoWorkflowPhase, type FixtureStats } from './desktopAutoWorkflow'

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error('V3 desktop auto controls: ' + message)
}

async function until(check: () => unknown, label: string) {
  const deadline = Date.now() + 30000
  while (!check()) {
    if (Date.now() >= deadline) throw new Error(label + ': ' + (document.querySelector('.autonomous-run-panel')?.textContent || '').slice(-1600))
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  await nextTick()
}

async function click(text: string) {
  const find = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
    .find(button => button.textContent?.trim() === text && !button.disabled && button.getClientRects().length > 0)
  await until(find, '找不到正常任务按钮：' + text)
  find()!.click()
  await nextTick()
}

async function clickRunbarControl(text: string) {
  const find = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.runbar-actions button'))
    .find(button => button.textContent?.trim() === text && !button.disabled && button.getClientRects().length > 0)
  await until(find, '找不到运行条任务控制按钮：' + text)
  find()!.click()
  await nextTick()
}

async function setNumber(label: string, value: number) {
  const field = Array.from(document.querySelectorAll<HTMLLabelElement>('.autonomous-run-form label'))
    .find(element => element.textContent?.trim().startsWith(label))?.querySelector('input')
  assert(field, '找不到任务配置字段：' + label)
  field.focus()
  field.value = String(value)
  field.dispatchEvent(new Event('input', { bubbles: true }))
  field.dispatchEvent(new Event('change', { bubbles: true }))
  field.blur()
  await nextTick()
}

function currentRun(novelId: string): AiRun {
  const runs = useReconstructionWorkspaceStore().getAiRuns(novelId)
  assert(runs.length === 1, '独立按钮验收作品应只有一个任务')
  return runs[0]
}

async function openControls(novelId: string, existing: boolean) {
  await router.push(`/auto/${novelId}`)
  await until(() => document.querySelector('.auto-page'), '运行中心未渲染')
  await click(existing ? '任务控制' : '设置并开始任务')
  await click('自动写作任务')
  await until(() => document.querySelector('.autonomous-run-panel'), '正常任务弹窗未显示')
}

function assertCompletedDrafts(run: AiRun) {
  assert(run.status === 'completed' && run.requests?.length === 7, '双章任务未以七次实际尝试完成')
  assert(run.chapterDrafts?.length === 2 && run.chapterDrafts.every(draft => draft.stage === 'analyzed'
    && draft.review?.status === 'ready_to_finalize' && draft.reviewCoverage?.status === 'complete'
    && draft.review.candidateChanges.length > 0), '候选稿的审核、覆盖或分析不完整')
  assert(run.requests.filter(request => request.chapterIndex === 0).length === 3,
    '已完成的第一章请求在续跑时被重复执行')
  assert(run.requests.slice(0, 3).every(request => request.status === 'completed')
    && run.requests[3].status !== 'completed' && run.requests.slice(4).every(request => request.status === 'completed'),
  '完成、在途中断和重试的请求账本顺序错误')
}

export async function runDesktopAutoControlsWorkflow(phase: DesktopAutoWorkflowPhase, novelId: string) {
  assert(import.meta.env.DEV && window.electronAPI?.projectRequest, '需要开发版桌面 IPC 环境')
  const novels = useNovelStore(), workspace = useReconstructionWorkspaceStore(), config = useConfigStore()
  const novel = novels.getNovel(novelId)
  assert(novel?.chapters.length === 2 && novel.chapters.every(chapter => chapter.content === ''),
    '按钮验收必须使用专属双空章作品')
  await workspace.hydrateFromPersistence(novelId)
  const clone = (value: ConfigData): ConfigData => JSON.parse(JSON.stringify(value))
  const original = clone(config.exportConfig()), temporary = clone(original)
  const model = desktopAutoFixtureModel()
  temporary.models = [...temporary.models.filter(item => item.id !== model.id), model]
  temporary.assignments = { ...temporary.assignments, writing: model.id, review: model.id, outline: model.id }
  await config.importConfig(temporary, () => JSON.stringify(config.exportConfig()) === JSON.stringify(original))
  const stats: FixtureStats = { fetchPhaseCounts: { writing: 0, review: 0, analysis: 0 } }
  const restoreFetch = installDeterministicFetch(stats, phase === 'write' ? { holdWritingChapter: 2 } : {})

  try {
    if (phase === 'write') {
      assert(workspace.getAiRuns(novelId).length === 0, '按钮验收拒绝覆盖已有任务')
      await openControls(novelId, false)
      await setNumber('结束章节', 2)
      await setNumber('Token 预算', 120000)
      await setNumber('请求次数上限', 20)
      await setNumber('每几章停下检查', 1)
      await click('开始自动写作')
      await until(() => workspace.getAiRuns(novelId)[0]?.status === 'needs_author', '正常开始按钮没有到达第一章检查点')
      const checkpoint = currentRun(novelId)
      assert(checkpoint.checkpoint === 'chapter-0:checkpoint' && checkpoint.requests?.length === 3,
        '第一章检查点或请求账本错误')
      assert(document.querySelector('.ckpt')?.textContent?.includes('每 1 章暂停'), '运行中心没有显示作者检查点')
      const completedIds = checkpoint.requests.map(request => request.id)
      await clickRunbarControl('继续任务')
      await until(() => stats.fetchPhaseCounts.writing === 2, '继续按钮没有发起第二章请求')
      await clickRunbarControl('暂停')
      await until(() => currentRun(novelId).status === 'paused', '暂停按钮没有中断在途请求')
      const paused = currentRun(novelId)
      assert(paused.requests?.length === 4 && completedIds.every((id, index) => paused.requests![index].id === id),
        '暂停时已完成请求身份变化或请求数错误')
      assert(paused.chapterDrafts?.length === 1 && paused.chapterDrafts[0].stage === 'analyzed', '暂停时第一章候选丢失或第二章提前写入')
    } else {
      const before = currentRun(novelId)
      if (phase === 'reopen') {
        assert(before.status === 'paused' && before.requests?.length === 4, '跨进程重开没有恢复在途暂停任务')
        const firstCompletedIds = before.requests.slice(0, 3).map(request => request.id)
        await openControls(novelId, true)
        assert(Object.values(stats.fetchPhaseCounts).every(count => count === 0), '重开正常任务控件意外请求了模型')
        await clickRunbarControl('继续任务')
        await until(() => currentRun(novelId).status === 'completed', '重开后正常继续按钮没有完成任务')
        const completed = currentRun(novelId)
        assertCompletedDrafts(completed)
        assert(firstCompletedIds.every((id, index) => completed.requests![index].id === id), '重启后已完成请求的身份变化')
        assert(Object.values(stats.fetchPhaseCounts).every(count => count === 1), '重开后应只执行第二章的三个阶段')
      } else {
        assertCompletedDrafts(before)
        assert(Object.values(stats.fetchPhaseCounts).every(count => count === 0), '第三进程读取不应发起请求')
      }
    }

    await workspace.flushPendingSaves([novelId])
    const stored = await readStoryAggregate(novelId)
    const run = currentRun(novelId), durable = stored.workspace.aiRuns?.find(item => item.id === run.id)
    assert(durable?.status === run.status && durable.requests?.length === run.requests?.length,
      'IPC 持久层的任务状态或账本不一致')
    assert(stored.novel?.chapters.every(chapter => chapter.content === '') && stored.workspace.canonMutations.length === 0,
      '自动候选提前修改了正式正文或典籍')
    if (phase !== 'write') assertCompletedDrafts(durable)
    return { phase, novelId, runId: run.id, buttonControls: true, status: run.status, checkpoint: run.checkpoint,
      requestCount: run.requests?.length, requestStatuses: run.requests?.map(request => request.status),
      fetchPhaseCounts: stats.fetchPhaseCounts, crossProcessResume: phase !== 'write',
      chapterDraftCount: run.chapterDrafts?.length, manuscriptUnchanged: true }
  } finally {
    restoreFetch()
    await config.importConfig(original, () => true)
  }
}
