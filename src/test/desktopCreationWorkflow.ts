// Development-only normal creation controls backed by the real desktop IPC.
// The parent smoke command owns an isolated library across all three processes.
import { nextTick } from 'vue'
import router from '@/router'
import { useConfigStore, type ConfigData } from '@/stores/config'
import { useNovelStore } from '@/stores/novel'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { readProjectLibrary } from '@/services/projectKernelClient'
import { readStoryAggregate } from '@/services/storyAggregate'
import { contractCards } from '@/services/storyContract'
import { creationTitle, endings, skeletons, volume, outline, planResponse } from './fixtures/creationPipeline'

type Phase = 'write' | 'reopen' | 'verify-stale'
const endpoint = 'http://127.0.0.1:1/desktop-creation-fixture'
const mixedTitle = '作者混合·共同核对'
const chapterTitle = '清点木箱·作者核对'
const revisedConflict = '黎安与值守人共同追查两份交接记录的改动来源。'
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error('V3 desktop creation: ' + message)
}

async function until(check: () => unknown | Promise<unknown>, label: string) {
  const deadline = Date.now() + 30000
  while (!await check()) {
    if (Date.now() >= deadline) throw new Error(label + ': ' + document.body.innerText.slice(-1600))
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  await nextTick()
}

function enabledButton(text: string, aria = false) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
    .find(button => (aria ? button.getAttribute('aria-label') : button.textContent?.trim()) === text
      && !button.matches(':disabled') && button.getAttribute('aria-disabled') !== 'true'
      && button.getClientRects().length > 0)
}

async function click(text: string, aria = false) {
  await until(() => enabledButton(text, aria), '找不到创建控件：' + text)
  enabledButton(text, aria)!.click()
  await nextTick()
}

async function fill(selector: string, value: string) {
  await until(() => {
    const field = document.querySelector(selector)
    return field && !field.matches(':disabled')
  }, '找不到可编辑创建输入：' + selector)
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!
  input.focus()
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  input.blur()
  await nextTick()
}

async function assertStoredCreation(novelId: string, invalidated: boolean) {
  const stored = await readStoryAggregate(novelId)
  const novel = stored.novel, draft = stored.workspace.creationDraft
  assert(novel && draft, 'IPC 未保存作品或创建草稿')
  assert(novel.chapters.length === 1 && novel.chapters[0].content === '' && novel.chapters[0].title === chapterTitle,
    '单空章或作者标题没有保留')
  assert(novel.outline === outline && novel.volumes.length === 1 && novel.volumes[0].theme === '共同核对证据',
    '已采纳大纲或分卷没有保留')
  assert(novel.chapterPlans?.length === 1 && novel.chapterPlans[0].source === 'ai'
    && stored.workspace.canonMutations.length === 0, '章节计划来源丢失或提前写入典籍')
  const first = draft.skeletons.find(row => row.title === skeletons[0].title)
  const second = draft.skeletons.find(row => row.title === skeletons[1].title)
  const mixed = draft.skeletons.find(row => row.title === mixedTitle)
  const revision = draft.skeletonHistory?.find(row => row.kind === 'mixed')
  assert(first && second && mixed && revision, '原方案、混合候选或来源历史缺失')
  assert(mixed.premise === first.premise && mixed.ending === second.ending,
    '混合候选的逐字段选择没有保留')
  assert(revision.sources.find(row => row.field === 'ending')?.revisionId === second.revisionId
    && revision.sources.filter(row => row.field === 'beat').length === first.beats.length
    && revision.sources.filter(row => row.field !== 'ending').every(row => row.revisionId === first.revisionId),
  '混合方案的字段或节点来源不一致')
  const attempt = draft.skeletonAttempts?.[0]
  assert(attempt?.status === 'completed' && attempt.finishReason === 'stop' && attempt.candidateIds?.length === 3,
    '生成尝试或三个候选记录缺失')
  if (invalidated) {
    assert(draft.stage === 'contract' && draft.contract.centralConflict === revisedConflict
      && draft.approval.contract !== 'approved' && draft.approval.skeleton !== 'approved'
      && draft.approval['chapter-outline'] !== 'approved' && !novel.chapterPlanConfirmed,
    '修改契约后旧方向或规划仍被视为已确认')
  } else {
    assert(novel.chapterPlanConfirmed && draft.approval.contract === 'approved'
      && draft.approval.skeleton === 'approved' && draft.approval['chapter-outline'] === 'approved',
    '正式规划未经过作者确认或确认记录丢失')
  }
  return stored
}

export async function runDesktopCreationWorkflow(phase: Phase) {
  assert(import.meta.env.DEV && window.electronAPI?.projectRequest, '需要开发版桌面 IPC')
  await readProjectLibrary(true)
  const novels = useNovelStore(), workspace = useReconstructionWorkspaceStore(), config = useConfigStore()
  const clone = (value: ConfigData): ConfigData => JSON.parse(JSON.stringify(value))
  const original = clone(config.exportConfig()), temporary = clone(original)
  const model = { id: 'desktop-creation-deterministic', name: '桌面创建确定性响应', baseUrl: endpoint,
    apiKey: '', modelName: 'synthetic-creation', maxTokens: 4096, temperature: 0, topP: 1, contextWindow: 32000 }
  temporary.models = [...temporary.models.filter(row => row.id !== model.id), model]
  temporary.assignments = { ...temporary.assignments, outline: model.id }
  await config.importConfig(temporary, () => JSON.stringify(config.exportConfig()) === JSON.stringify(original))
  const outputs = [JSON.stringify({ skeletons }), outline, volume, planResponse]
  const requests: Array<{ stream?: boolean; messages: Array<{ content: string }> }> = []
  const previousFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url !== endpoint + '/v1/chat/completions') {
      assert(new URL(url, location.href).origin === location.origin, '创建夹具拒绝非同源网络请求')
      return previousFetch(input, init)
    }
    assert(phase === 'write' && requests.length < outputs.length, '重开或额外请求被创建夹具拒绝')
    const payload = JSON.parse(String(init?.body))
    const content = outputs[requests.length]
    requests.push(payload)
    const usage = { prompt_tokens: 200, completion_tokens: 150, total_tokens: 350 }
    if (payload.stream) {
      const midpoint = Math.floor(content.length / 2)
      const chunks = [content.slice(0, midpoint), content.slice(midpoint)]
      return new Response([
        ...chunks.map(chunk => 'data: ' + JSON.stringify({ choices: [{ delta: { content: chunk }, finish_reason: null }] })),
        'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage }),
        'data: [DONE]', '',
      ].join('\n\n'), { headers: { 'Content-Type': 'text/event-stream' } })
    }
    return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage }),
      { headers: { 'Content-Type': 'application/json' } })
  }

  try {
    let novelId: string
    let contractLayout: { width: number; contentWidth: number; sourceBelow: boolean } | undefined
    if (phase === 'write') {
      assert(novels.novels.length === 0, '创建夹具拒绝修改非空书架')
      await router.push('/create')
      document.querySelector<HTMLButtonElement>('.v3 .m-modal.guide [aria-label="关闭"]')?.click()
      await until(() => document.querySelector('input[name="creation-setup-method"][value="blank"]'), '创建起点未显示')
      document.querySelector<HTMLInputElement>('input[name="creation-setup-method"][value="blank"]')!.click()
      await click('准备空白作品 →')
      await fill('[aria-label="新作品名称"] input, input[aria-label="新作品名称"]', creationTitle)
      await click('保存输入并创建，进入作品契约')
      await until(() => document.querySelector('.story-contract'), '契约页未显示')
      novelId = String(router.currentRoute.value.params.novelId)
      await click('编辑类型与读者', true)
      await fill('textarea[aria-label="作品类型"]', '悬疑')
      await click('编辑主线冲突', true)
      await fill('textarea[aria-label="主线冲突"]', '黎安追查码头失踪木箱的来源。')
      await fill('textarea[aria-label="结局方向"]', endings[1])
      for (const card of contractCards) await click('确认' + card.title, true)
      assert(document.querySelector('.confirmation-count')?.textContent?.includes('8 / 8'), '八卡确认未完成')
      await click('确认契约并继续')
      await until(() => document.querySelector('.manual-outline'), '确认契约后未进入骨架阶段')
      assert(Number(requests.length) === 0, '确认契约前不应自动生成')
      await click('生成故事骨架候选')
      await until(() => workspace.getCreationDraft(novelId)?.skeletons.length === 3, '没有生成三个候选')
      await click('整列选用：收据追查', true)
      await click('结局方向 · 双册对照', true)
      await click('组合为新的可编辑候选')
      await until(() => workspace.getCreationDraft(novelId)?.skeletons.length === 4, '混合候选未保存')
      await fill('.skeleton-edit textarea[aria-label="方案名称"]', mixedTitle)
      await click('保存作者版本')
      await click('确认此方案为正式方向')
      assert(novels.getNovel(novelId)?.outline === '', '确认骨架时提前写入大纲')
      await click('按已确认方向生成大纲')
      await until(() => workspace.getCreationDraft(novelId)?.outlineCandidate?.complete, '大纲未生成完成')
      const prompt = requests[1]?.messages.map(row => row.content).join('\n') || ''
      assert(Number(requests.length) === 2 && prompt.includes(mixedTitle) && prompt.includes(endings[1]) && !prompt.includes(endings[0]),
        '大纲请求没有遵循已确认的混合方向')
      assert(novels.getNovel(novelId)?.outline === '', '大纲候选在作者确认前写入作品')
      await click('确认并规划分卷')
      await until(() => document.querySelector('.creation-planning'), '规划页未显示')
      assert(novels.getNovel(novelId)?.chapters.length === 0, '规划入口提前生成正文')
      await click('AI 生成分卷规划')
      await until(() => novels.getNovel(novelId)?.volumes[0]?.theme === '共同核对证据', 'AI 分卷没有保存')
      await click('编辑章节计划')
      await click('AI 生成计划')
      await until(() => document.querySelector('[aria-label="待确认章节计划建议"]'), '章节计划建议未显示')
      assert(novels.getNovel(novelId)?.chapterPlans?.length === 0, 'AI 章纲未确认就写入规划')
      await click('确认这些章节计划')
      await until(() => novels.getNovel(novelId)?.chapterPlans?.length === 1, '章纲确认未保存')
      await click('确认分卷与章节计划')
      await until(() => document.querySelector('.ready-card'), '规划确认后未就绪')
      await click('开始写第一章')
      await until(() => document.querySelector('.pte-doc[aria-label="正文"]'), '没有进入真实 V3 编辑器')
      await fill('input[aria-label="章节标题"]', chapterTitle)
      await until(async () => (await readStoryAggregate(novelId)).novel?.chapters[0]?.title === chapterTitle,
        '作者修改的章节标题没有持久化')
      assert(Number(requests.length) === 4 && requests.map(row => Boolean(row.stream)).join(',') === 'true,true,true,false',
        '创建链路请求数或流式协议错误')
    } else {
      assert(novels.novels.length === 1 && novels.novels[0].title === creationTitle, '创建作品没有跨进程恢复')
      novelId = novels.novels[0].id
      await workspace.hydrateFromPersistence(novelId)
      if (phase === 'reopen') {
        await assertStoredCreation(novelId, false)
        const expectedChapterId = novels.getNovel(novelId)!.chapters[0].id
        await router.push('/generate/' + novelId)
        await until(() => document.querySelector('.ready-card'), '重启后已确认规划没有显示就绪')
        await click('打开写作台')
        await until(() => document.querySelector('.pte-doc') && router.currentRoute.value.params.chapterId === expectedChapterId,
          '重开写作台没有复用原章节')
        assert(document.querySelector<HTMLInputElement>('input[aria-label="章节标题"]')?.value === chapterTitle,
          '重开写作台没有恢复作者标题')
        await router.push({ path: '/generate/' + novelId, query: { edit: 'direction' } })
        await click('查看或修改作品契约')
        await click('编辑主线冲突', true)
        await fill('textarea[aria-label="主线冲突"]', revisedConflict)
        await click('保存草稿')
        await until(() => workspace.getCreationDraft(novelId)?.contract.centralConflict === revisedConflict
          && !novels.getNovel(novelId)?.chapterPlanConfirmed, '修改契约没有使旧规划确认失效')
      } else {
        await assertStoredCreation(novelId, true)
        await router.push('/generate/' + novelId)
        await until(() => document.querySelector('.story-contract'), '第三进程没有显示待确认契约')
        assert(document.querySelector('.confirmation-count')?.textContent?.includes('7 / 8')
          && !document.querySelector('.ready-card'), '修改契约后的确认数或规划门槛错误')
        const contract = document.querySelector('.story-contract')!.getBoundingClientRect()
        const content = document.querySelector('.flow-content')!.getBoundingClientRect()
        const source = document.querySelector('.creation-entry-source')!.getBoundingClientRect()
        contractLayout = { width: contract.width, contentWidth: content.width,
          sourceBelow: Math.abs(source.x - contract.x) < 1 && source.y >= contract.bottom }
        assert(!document.querySelector('#generate-outline-page.outline-ready')
          && Math.abs(contract.width - content.width) < 1 && contractLayout.sourceBelow,
        '重开待确认契约误套大纲两栏布局，契约或来源面板被挤窄')
      }
      assert(requests.length === 0, '重启读取或修改契约意外请求模型')
    }

    await novels.flushPendingSaves()
    await workspace.flushPendingSaves([novelId])
    const stored = await assertStoredCreation(novelId, phase !== 'write')
    return { phase, kind: 'creation', passed: true, novelId, chapterId: stored.novel!.chapters[0].id,
      chapterTitle: stored.novel!.chapters[0].title, requestCount: requests.length,
      requestStreams: requests.map(row => Boolean(row.stream)), normalControls: true, mixedSourcesPersisted: true,
      singleEmptyChapter: true, canonCount: 0, directionInvalidated: phase !== 'write', contractLayout }
  } finally {
    window.fetch = previousFetch
    await config.importConfig(original, () => true)
  }
}
