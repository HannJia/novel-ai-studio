// Development-only Electron smoke fixture. All manuscripts and model replies
// are synthetic. Imported by main.js only for an explicit isolated smoke run.
import { nextTick } from 'vue'
import router from '@/router'
import { useNovelStore } from '@/stores/novel'
import { useConfigStore } from '@/stores/config'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { getStoryMemoryStatus, formatStoryMemoryContext, resolveStoryMemorySource } from '@/services/storyMemory'
import { getCurrentChapterSummary } from '@/services/derivedSources'
import { withCurrentStoryEntities } from '@/services/effectiveStory'
import { storyDecisionSourceVersion } from '@/services/storyDecisions'
import { canFinalizeChapter } from '@/services/reconstructionReview'
import { readStoryAggregate } from '@/services/storyAggregate'
import { readProjectLibrary } from '@/services/projectKernelClient'
import { contractCards, contractCardConfirmed, toggleContractCard } from '@/services/storyContract'
import type { StoryContract } from '@/types/reconstruction'
import { runDesktopAutoWorkflow } from './desktopAutoWorkflow'
import { runDesktopReviewWorkflow } from './desktopReviewWorkflow'
import { runDesktopAutoControlsWorkflow } from './desktopAutoControlsWorkflow'

const title = 'V3桌面验收·渡口钥匙（合成作品）'
const reviewTitle = 'V3桌面验收·独立批量审校（合成作品）'
const controlsTitle = 'V3桌面验收·自动任务按钮（合成作品）'
const prose = '林澈拿到了钥匙。雨水沿着桥栏流进河里，他停在渡口，向守夜人打听最后一班船。守夜人摇了摇头，说雾没有散，船不会开。\n\n林澈取出衣袋里的信，封口还留着一层薄蜡。他没有拆开，只把潮湿的边角压平。桥对岸的灯亮了一次，随即熄灭。他不认识约他来的人，也不愿把信交给任何陌生人。\n\n守夜人收好绳索，提醒他天亮以后再来。林澈点头，转身走向街角的客栈。他决定先找个干燥的地方，再仔细看看信封上的字。'
const revised = prose.replace('雨水沿着桥栏流进河里', '细雨顺着桥栏流进河里')
const summary = '林澈取得钥匙后在渡口等待，守夜人因雾停船。他带着未拆封的信离开渡口，决定在客栈过夜后再来。'
const eventTitle = '取得渡口钥匙'
const contractRecoveryInput = '合成桌面恢复输入：先讨论渡口视角，尚未发送。'
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error('V3 desktop: ' + message)
}

async function until(check: () => unknown, label: string, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() >= deadline) {
      const selection = window.getSelection()
      const editor = document.querySelector<HTMLElement>('.pte-doc')
      const diagnostics = label.includes('Selection toolbar') ? JSON.stringify({
        selectedText: selection?.toString(),
        selectionRect: selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect().toJSON() : null,
        editorEditable: editor?.getAttribute('contenteditable'),
        toolbar: document.querySelector('.selection-tools')?.outerHTML,
      }) : ''
      throw new Error(label + diagnostics + ': ' + document.body.innerText.slice(-1800))
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  await nextTick()
}
async function click(text: string, scope = document.body) {
  const button = () => Array.from(scope.querySelectorAll<HTMLButtonElement>('button'))
    .find(item => item.textContent?.trim() === text && !item.disabled)
  await until(button, 'Missing enabled button ' + text)
  button()!.click()
}
async function clickLabel(label: string, scope = document.body) {
  const button = () => Array.from(scope.querySelectorAll<HTMLButtonElement>('button[aria-label]'))
    .find(item => item.getAttribute('aria-label') === label && !item.disabled)
  await until(button, 'Missing enabled button with aria-label ' + label)
  button()!.click()
}
async function clickPrefix(prefix: string, scope = document.body) {
  const button = () => Array.from(scope.querySelectorAll<HTMLButtonElement>('button'))
    .find(item => item.textContent?.trim().startsWith(prefix) && !item.disabled)
  await until(button, 'Missing enabled button starting with ' + prefix)
  button()!.click()
}
function dismissV3Guide() {
  document.querySelector<HTMLButtonElement>('.v3 .m-modal.guide [aria-label="关闭"]')?.click()
}
async function openEditor(novelId: string, chapterId: string) {
  await router.push(`/write/${novelId}/${chapterId}`)
  dismissV3Guide()
  await until(() => document.querySelector('.pte-doc'), 'V3 editor not rendered')
  // Let the initial empty chapter recovery checkpoint finish before typing.
  await new Promise(resolve => setTimeout(resolve, 750))
}
async function setContentSelection(root: HTMLElement, start: number, end: number, expectedText: string) {
  await document.fonts.ready
  // Focusing the previous end-of-document caret can queue a scroll event that
  // dismisses the toolbar after this new selection has already been emitted.
  root.focus({ preventScroll: true })
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let cursor = 0, startNode: Node | null = null, endNode: Node | null = null, startOffset = 0, endOffset = 0
  while (walker.nextNode()) {
    const node = walker.currentNode
    const length = node.textContent?.length || 0
    if (!startNode && start >= cursor && start <= cursor + length) { startNode = node; startOffset = start - cursor }
    if (!endNode && end >= cursor && end <= cursor + length) { endNode = node; endOffset = end - cursor; break }
    cursor += length
  }
  if (!startNode || !endNode) throw new Error('V3 editor selection range could not be resolved')
  const range = document.createRange()
  range.setStart(startNode, startOffset); range.setEnd(endNode, endOffset)
  const selection = window.getSelection()!
  selection.removeAllRanges(); selection.addRange(range)
  document.dispatchEvent(new Event('selectionchange', { bubbles: true }))
  root.dispatchEvent(new Event('select', { bubbles: true }))
  if (selection.toString() !== expectedText) {
    throw new Error(`V3 editor selected unexpected text: expected=${JSON.stringify(expectedText)} actual=${JSON.stringify(selection.toString())}`)
  }
}
async function typeManuscript(text: string, novelId: string, chapterId: string) {
  const editor = document.querySelector<HTMLElement>('.pte-doc')!
  assert(editor && editor.getAttribute('contenteditable') !== 'false', 'V3 author editor is not writable')
  editor.focus()
  const selection = window.getSelection()!
  const range = document.createRange(); range.selectNodeContents(editor)
  selection.removeAllRanges(); selection.addRange(range)
  if (!document.execCommand('insertText', false, text)) throw new Error('V3 editor did not accept plain-text input')
  await nextTick()
  await clickLabel('保存正文')
  await until(() => useNovelStore().getNovel(novelId)?.chapters.find(item => item.id === chapterId)?.content === text, 'Manuscript not saved')
  await until(() => {
    const button = document.querySelector<HTMLButtonElement>('[aria-label="保存正文"]')
    return button && !button.disabled && button.textContent?.trim() === '已保存'
  }, 'Manuscript durable save has not settled')
}

async function saveContractRecovery(novelId: string) {
  const workspace = useReconstructionWorkspaceStore()
  const initialized = await workspace.commitCreationEdit(novelId, { action: 'initialize' }, workspace.captureCreationEditBaseline(novelId))
  const draft = workspace.getCreationDraft(novelId)!
  const now = new Date().toISOString()
  const contract = contractCards.reduce<StoryContract>((value, card) => toggleContractCard(value, card.id, now), {
    ...draft.contract, protagonistFear: '担心旧信被夺走', pacingDirection: '逐章揭示线索',
  })
  await workspace.saveCreationRecovery(novelId, { kind: 'editor', value: {
    id: 'desktop-contract-recovery', surface: 'contract', baseline: initialized.baseline, contract,
    exploration: { input: contractRecoveryInput, messages: [
      { id: 'desktop-user', role: 'user', content: '讨论渡口视角', status: 'completed' },
      { id: 'desktop-partial', role: 'assistant', content: '{"reply":"保留的部分输出', status: 'running' },
    ] }, manualOutline: '', outlineText: '', updatedAt: now,
  } })
  assert(workspace.getCreationDraft(novelId)?.contract.protagonistFear !== contract.protagonistFear, 'Recovery changed the formal contract')
}

async function verifyContractRecovery(novelId: string) {
  const workspace = useReconstructionWorkspaceStore()
  const draft = workspace.getCreationDraft(novelId)!
  const recovery = draft.editorDrafts?.find(item => item.id === 'desktop-contract-recovery')
  assert(recovery?.contract && recovery.exploration?.input === contractRecoveryInput, 'Contract input missing after process restart')
  assert(contractCards.every(card => contractCardConfirmed(recovery.contract!, card.id)), 'Card confirmations missing after process restart')
  assert(recovery.contract.pacingDirection === '逐章揭示线索', 'Pacing input missing after process restart')
  assert(draft.contract.protagonistFear !== recovery.contract.protagonistFear && draft.approval.contract !== 'approved', 'Recovery advanced formal approval')
  const baseline = recovery.baseline
  await router.push(`/generate/${novelId}?edit=direction`)
  dismissV3Guide()
  await until(() => {
    const input = document.querySelector<HTMLTextAreaElement>('[aria-label="探索对话输入"]')
    return input?.value === contractRecoveryInput && !input.disabled
  }, 'Contract recovery not restored in the creation page')
  assert(document.querySelector('.confirmation-count')?.textContent?.includes('8 / 8'), 'Restored card count not visible')
  assert(document.querySelector('.explore')?.textContent?.includes('本轮中断'), 'Interrupted conversation not shown')
  const restored = workspace.getCreationDraft(novelId)?.editorDrafts?.find(item => item.id === recovery.id)
  assert(restored?.baseline === baseline, 'Reopening rebound the recovery baseline')
}

function installSyntheticModel() {
  const config = useConfigStore()
  assert(config.models.length === 0, 'Expected an empty isolated model configuration')
  const endpoint = 'http://127.0.0.1:1/v2-desktop-fixture'
  config.addModel({ name: '本地确定性验收替身', baseUrl: endpoint, apiKey: 'synthetic-not-a-real-key',
    modelName: 'synthetic-desktop', maxTokens: 4096, temperature: 0, topP: 1, contextWindow: 32000 })
  const originalFetch = window.fetch.bind(window), phases: string[] = []
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!url.startsWith(endpoint + '/')) {
      assert(new URL(url, location.href).origin === location.origin, 'Unexpected external request: ' + url)
      return originalFetch(input, init)
    }
    const payload = JSON.parse(String(init?.body))
    const prompt = payload.messages.map((message: { content: string }) => message.content).join('\n')
    let phase: string, content: string
    if (prompt.includes('"replacement"')) {
      phase = 'selection'
      content = JSON.stringify({ replacement: '细雨顺着桥栏流进河里，' })
    } else if (prompt.includes('全维度审查')) {
      // The review context can contain the literal `knowledgeChanges` field
      // from the structured story state. Match the review protocol before the
      // analysis schema so the fixture cannot accidentally return the wrong
      // JSON shape and leave the completion flow waiting for a verdict.
      phase = 'review'
      content = '## 结论\n总体判断：可通过\n必改数量：0\n## 必改问题\n无\n## 建议修改\n无\n## 编辑建议\n无'
    } else if (prompt.includes('knowledgeChanges')) {
      phase = 'analysis'
      content = JSON.stringify({ events: phases.includes('analysis') ? [] : [{ title: eventTitle, description: '林澈取得渡口钥匙。',
        type: '主线', characters: ['林澈'], evidence: '林澈拿到了钥匙。' }], characters: [], globalPlans: [],
        timeAdvanceDays: 0, knowledgeChanges: [], relationshipChanges: [] })
    } else if (prompt.includes('"isComplete"')) {
      phase = 'ending'
      content = JSON.stringify({ isComplete: true, isValidCliffhanger: false, openAction: '', reason: '本地验收替身：本章已结束等待并离开渡口。', continuationInstruction: '' })
    } else if (prompt.includes('"summary"')) {
      phase = 'summary'
      content = JSON.stringify({ title: '雾中渡口', summary })
    } else throw new Error('Unrecognized synthetic request: ' + prompt.slice(0, 180))
    phases.push(phase)
    const usage = { prompt_tokens: 300, completion_tokens: 100, total_tokens: 400 }
    if (payload.stream) return new Response(
      'data: ' + JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] }) + '\n\n' +
      'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage }) + '\n\n' + 'data: [DONE]\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } })
    return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage }),
      { headers: { 'Content-Type': 'application/json' } })
  }
  return phases
}

export async function runDesktopWorkflow(phase: 'write' | 'reopen' | 'verify-stale', kind: 'integrated' | 'creation' = 'integrated') {
  assert(import.meta.env.DEV && window.electronAPI?.projectRequest, 'Requires the development desktop and real project IPC')
  if (kind === 'creation') return (await import('./desktopCreationWorkflow')).runDesktopCreationWorkflow(phase)
  // The preceding IPC smoke deliberately appends an unchanged snapshot outside
  // the renderer cache. Reconcile its revision before testing application writes.
  await readProjectLibrary(true)
  const novels = useNovelStore(), workspace = useReconstructionWorkspaceStore()
  if (phase === 'write') {
    assert(novels.novels.length === 0, 'Refusing to modify a nonempty library')
    const requests = installSyntheticModel()
    const created = novels.addNovel({ genre: 'urban', subGenre: 'mystery', tags: [], targetWordCountMin: 50, targetWordCountMax: 100,
      settings: novels.defaultSettings(), writingStyle: novels.defaultWritingStyle(), storyTimeOrigin: { day: 0, label: '起点' } })
    const novel = novels.getNovel(created.id)!
    dismissV3Guide()
    assert(novel.writingMode === 'manual', 'New project does not default to author writing')
    novels.updateTitle(novel.id, title)
    novels.setChapterLengthPolicy(novel.id, { minWords: 100, targetWords: 250, maxWords: 600 })
    const chapter = novels.addChapter(novel.id, { title: '雾中渡口', content: '' })!
    await novels.saveNovelNow(novel.id)
    await workspace.hydrateFromPersistence(novel.id)
    await openEditor(novel.id, chapter.id)
    await typeManuscript(prose, novel.id, chapter.id)
    await until(() => novel.chapters[0].content === prose, 'Author input did not reach the store')
    const editor = document.querySelector<HTMLElement>('.pte-doc')!
    const selectionStart = prose.indexOf('雨水'), selectionEnd = prose.indexOf('他停在渡口')
    await setContentSelection(editor, selectionStart, selectionEnd, prose.slice(selectionStart, selectionEnd))
    await until(() => document.querySelector('.selection-tools span')?.textContent?.trim() === `${selectionEnd - selectionStart} 字`, 'Selection toolbar range is not current')
    await click('润色')
    await until(() => document.querySelector('.desk-tabs button.on')?.textContent?.includes('候选'), 'Selection candidate not shown; synthetic phases=' + requests.join(','))
    assert(chapter.content === prose, 'Candidate replaced author text before confirmation')
    await until(() => document.querySelector('.revision-card'), 'Selection candidate detail not shown')
    await click('采纳入正文')
    await until(() => chapter.content === revised, 'Accepted revision was not applied')
    await click('记忆')
    await click('重新读取来源')
    const timeInput = document.querySelector<HTMLInputElement>('.chapter-time-form input[type="number"]')
    assert(timeInput, 'Story time input not rendered')
    {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(timeInput, '0')
      timeInput.dispatchEvent(new Event('input', { bubbles: true }))
      timeInput.dispatchEvent(new Event('change', { bubbles: true }))
      const timeForm = timeInput.closest('form')!
      await click('确认本章时间', timeForm)
      await until(() => document.querySelector('.gate-list')?.textContent?.includes('故事时间已确认')
        || document.querySelector('.time-box')?.textContent?.includes('本章已记录故事日'),
      'Story time was not confirmed; input=' + timeInput.value + '; error=' + (document.querySelector('.write-toast')?.textContent || ''))
    }
    await click('完成本章 · 核对')
    await click('确认完成本章')
    await until(() => workspace.getPendingCandidates(novel.id, chapter.id).length === 1
      && document.querySelector('.desk-tabs')?.textContent?.includes('候选1')
      && (document.body.innerText.includes('候选待处理') || document.body.innerText.includes('待处理候选')),
    'Review did not produce a confirmable candidate in the V3 desk; synthetic phases=' + requests.join(','), 60000)
    assert(novel.eventLog.length === 0 && workspace.getCanonMutations(novel.id).length === 0, 'Analysis wrote Canon before confirmation')
    await clickPrefix('候选')
    await click('采纳入典')
    await until(() => workspace.getCanonMutations(novel.id).length === 1, 'Author confirmation did not persist Canon')
    assert(novel.eventLog.some(item => item.title === eventTitle), 'Confirmed fact missing')
    assert(chapter.status === 'completed', 'Candidate acceptance reset the source chapter status')
    await click('定稿 · 核对')
    await click('确认定稿')
    await until(() => chapter.status === 'finalized', 'Chapter did not finalize')
    const scope = { kind: 'book' as const, throughChapterId: chapter.id }
    await workspace.saveStoryMemory(novel.id, { id: 'desktop-memory', title: '渡口回顾', scope, summary,
      expectedSourceVersionId: resolveStoryMemorySource(novel, scope).versionId, expectedRecord: null })
    assert(getStoryMemoryStatus(novel, workspace.getStoryMemories(novel.id)[0]) === 'current', 'Memory was not bound to current prose')
    const autoChapters = [
      novels.addChapter(novel.id, { title: '自动验收·清点', content: '' })!,
      novels.addChapter(novel.id, { title: '自动验收·交接', content: '' })!,
    ]
    await novels.saveNovelNow(novel.id)
    const automatic = await runDesktopAutoWorkflow('write', { novelId: novel.id, chapterIds: autoChapters.map(item => item.id) })
    await saveContractRecovery(novel.id)
    // Review owns a separate project so contract recovery and edits to earlier
    // automatic chapters cannot invalidate its persisted context between phases.
    const reviewNovel = novels.addNovel({ genre: 'urban', subGenre: 'mystery', tags: [], targetWordCountMin: 50, targetWordCountMax: 100,
      settings: novels.defaultSettings(), writingStyle: novels.defaultWritingStyle(), storyTimeOrigin: { day: 0, label: '起点' } })
    novels.updateTitle(reviewNovel.id, reviewTitle)
    novels.setChapterLengthPolicy(reviewNovel.id, { minWords: 100, targetWords: 250, maxWords: 600 })
    await novels.saveNovelNow(reviewNovel.id)
    const batchReview = await runDesktopReviewWorkflow('write', reviewNovel.id)
    const controlsNovel = novels.addNovel({ genre: 'urban', subGenre: 'mystery', tags: [], targetWordCountMin: 50, targetWordCountMax: 100,
      settings: novels.defaultSettings(), writingStyle: novels.defaultWritingStyle(), storyTimeOrigin: { day: 0, label: '起点' } })
    novels.updateTitle(controlsNovel.id, controlsTitle)
    novels.setChapterLengthPolicy(controlsNovel.id, { minWords: 100, targetWords: 250, maxWords: 600 })
    for (const chapterTitle of ['按钮验收·核对收据', '按钮验收·渡口交接']) novels.addChapter(controlsNovel.id, { title: chapterTitle, content: '' })
    await novels.saveNovelNow(controlsNovel.id)
    const autoControls = await runDesktopAutoControlsWorkflow('write', controlsNovel.id)
    await novels.flushPendingSaves()
    await workspace.flushPendingSaves([novel.id, reviewNovel.id, controlsNovel.id])
    assert(['ending', 'review', 'summary', 'analysis'].every(item => requests.includes(item)), 'Incomplete model workflow')
    return { phase, passed: true, defaultMode: novel.writingMode, status: chapter.status, canonCount: 1, contractRecovery: 'saved', model: 'deterministic-fetch-double', requests, automatic, batchReview, autoControls }
  }
  assert(novels.novels.length === 3 && [title, reviewTitle, controlsTitle].every(name => novels.novels.filter(item => item.title === name).length === 1),
    'Isolated projects did not survive process restart')
  const novel = novels.novels.find(item => item.title === title)!, chapter = novel.chapters[0]
  const reviewNovel = novels.novels.find(item => item.title === reviewTitle)!
  const controlsNovel = novels.novels.find(item => item.title === controlsTitle)!
  await workspace.hydrateFromPersistence(novel.id)
  const memories = workspace.getStoryMemories(novel.id)
  assert(workspace.getCanonMutations(novel.id).length === 1, 'Canon history missing after restart')
  assert(workspace.getCandidates(novel.id).some(item => item.status === 'accepted'), 'Author decision missing after restart')
  assert((await novels.getChapterRevisions(chapter.id)).some(item => item.status === 'accepted'), 'Revision decision missing after restart')
  assert(workspace.getImpactReports(novel.id).length > 0, 'Impact reports missing after restart')
  const automatic = await runDesktopAutoWorkflow(phase, novel.id)
  const batchReview = await runDesktopReviewWorkflow(phase, reviewNovel.id)
  const autoControls = await runDesktopAutoControlsWorkflow(phase, controlsNovel.id)
  await verifyContractRecovery(novel.id)
  await openEditor(novel.id, chapter.id)
  if (phase === 'reopen') {
    assert(chapter.content === revised && chapter.status === 'finalized', 'Accepted manuscript/finalization missing')
    assert(getCurrentChapterSummary(chapter) === summary && getStoryMemoryStatus(novel, memories[0]) === 'current', 'Current summaries missing')
    assert(formatStoryMemoryContext(novel, memories, 1).includes(summary), 'Confirmed memory absent from later-chapter context')
    assert(formatStoryMemoryContext(novel, memories, 0) === '', 'Future/current chapter memory leaked into earlier context')
    await typeManuscript(revised.replace('钥匙', '木牌'), novel.id, chapter.id)
    await until(() => chapter.content.includes('木牌'), 'Edited evidence was not saved')
    await novels.flushPendingSaves()
  }
  assert(chapter.content === revised.replace('钥匙', '木牌'), 'Source edit missing after restart')
  assert(getStoryMemoryStatus(novel, memories[0]) === 'stale' && formatStoryMemoryContext(novel, memories, 1) === '', 'Stale memory still consumed')
  assert(getCurrentChapterSummary(chapter) === '', 'Stale chapter summary still consumed')
  assert(!withCurrentStoryEntities(novel, 1).eventLog.some(item => item.title === eventTitle), 'Stale Canon source still consumed')
  const aggregate = await readStoryAggregate(novel.id)
  assert(aggregate.novel, 'Stored novel is missing')
  const version = storyDecisionSourceVersion({ novel: aggregate.novel, workspace: aggregate.workspace }, chapter.id, [])
  assert(!workspace.getChapterReviews(novel.id, chapter.id).some(review => canFinalizeChapter(review, version)), 'Old review remains valid after editing evidence')
  await click('完成本章 · 核对')
  await until(() => document.querySelector('.gate-list')?.textContent?.includes('当前正文尚未审校'), 'Stale report still appears to describe current prose')
  return { phase, passed: true, status: chapter.status, canonHistory: 1, contractRecovery: 'reopened', memory: 'stale', staleSourcesExcluded: true, automatic, batchReview, autoControls }
}
