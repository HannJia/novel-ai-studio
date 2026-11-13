import { nextTick } from 'vue'
import router from '@/router'
import { useNovelStore } from '@/stores/novel'
import { readProjectLibrary } from '@/services/projectKernelClient'
import type { Chapter, Novel } from '@/types/novel'

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number }

export interface SelectionToolbarState {
  viewportWidth: number
  documentWidth: number
  bodyWidth: number
  toolbar: Rect
  writingColumn: Rect
  selectedText: string
  toolbarText: string
}

const paragraph = '雨是从黄昏开始下的，河面上的灯影被风揉碎。林澈停在门边，没有急着进屋。桌上那封信还没有拆开，灯芯偶尔发出轻微的爆响。'
const selectedPhrase = '雨是从黄昏开始下的，'

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error('Selection toolbar: ' + message)
}

async function until(check: () => unknown, label: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() >= deadline) throw new Error(label)
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  await nextTick()
}

function dismissGuide() {
  document.querySelector<HTMLButtonElement>('.v3 .m-modal.guide [aria-label="关闭"]')?.click()
}

async function normalizePanelsForViewport() {
  if (window.innerWidth <= 1120) {
    document.querySelector<HTMLButtonElement>('button[aria-label="切换案头"][aria-pressed="true"]')?.click()
  }
  if (window.innerWidth <= 800) {
    document.querySelector<HTMLButtonElement>('button[aria-label="切换目录"][aria-pressed="true"]')?.click()
  }
  await nextTick()
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
}

async function selectPhrase(editor: HTMLElement) {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    const text = node.textContent || ''
    const start = text.indexOf(selectedPhrase)
    if (start < 0) continue
    const selection = window.getSelection()
    assert(selection, '浏览器未提供文本选区')
    const reset = document.createRange()
    reset.setStart(node, 0)
    reset.collapse(true)
    selection.removeAllRanges()
    selection.addRange(reset)
    document.dispatchEvent(new Event('selectionchange', { bubbles: true }))
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    const range = document.createRange()
    range.setStart(node, start)
    range.setEnd(node, start + selectedPhrase.length)
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange', { bubbles: true }))
    editor.dispatchEvent(new Event('select', { bubbles: true }))
    assert(selection.toString() === selectedPhrase, '选区文本不一致')
    return
  }
  throw new Error('Selection toolbar: 目标正文片段未找到')
}

function rect(element: Element): Rect {
  const value = element.getBoundingClientRect()
  return { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height }
}

export async function runDesktopSelectionWorkflow(options: { seed?: boolean } = {}): Promise<{
  phase: 'selection'
  kind: 'selection'
  passed: true
  states: SelectionToolbarState[]
}> {
  assert(import.meta.env.DEV && window.electronAPI?.projectRequest, '需要开发版 Electron 和项目 IPC')
  const seed = options.seed !== false
  if (seed) await readProjectLibrary(true)
  const novels = useNovelStore()
  let created: Novel | undefined = novels.novels[0]
  let chapter: Chapter | null = created?.chapters[0] ?? null
  if (seed) {
    assert(novels.novels.length === 0, '拒绝在非空作品库中执行选区视觉验收')
    created = novels.addNovel({
      workingTitle: '选区工具条合成验收', genre: 'urban', subGenre: 'mystery', tags: [],
      targetWordCountMin: 100, targetWordCountMax: 500,
      settings: novels.defaultSettings(), writingStyle: novels.defaultWritingStyle(),
    })
    novels.updateTitle(created.id, '选区工具条合成验收')
    chapter = novels.addChapter(created.id, {
      title: '雨夜', content: Array.from({ length: 12 }, () => paragraph).join('\n'),
    })
    assert(chapter, '合成章节创建失败')
    await novels.saveNovelNow(created.id)
  }
  assert(created && chapter, '选区视觉验收作品或章节不存在')

  await router.push(`/write/${created.id}/${chapter.id}`)
  dismissGuide()
  await until(() => document.querySelector<HTMLElement>('.pte-doc'), 'V3 写作台未加载')
  await normalizePanelsForViewport()
  await document.fonts.ready
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  await selectPhrase(document.querySelector<HTMLElement>('.pte-doc')!)
  await until(() => document.querySelector('.selection-tools'), `选区工具条未出现（${window.innerWidth}px）`)
  await new Promise(resolve => setTimeout(resolve, 150))

  const toolbar = document.querySelector<HTMLElement>('.selection-tools')!
  const editor = document.querySelector<HTMLElement>('.pte-doc')!
  const selection = window.getSelection()
  const range = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null
  assert(range, '选区没有可测量的视口范围')
  const state: SelectionToolbarState = {
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    toolbar: rect(toolbar),
    writingColumn: rect(editor),
    selectedText: selection?.toString() || '',
    toolbarText: toolbar.innerText.replace(/\s+/g, ' ').trim(),
  }
  assert(state.selectedText === selectedPhrase, '最终选区内容已变化')
  assert(state.toolbar.left >= state.writingColumn.left - 1 && state.toolbar.right <= state.writingColumn.right + 1,
    '工具条超出正文写作列')
  assert(state.documentWidth === state.viewportWidth && state.bodyWidth === state.viewportWidth,
    '选区状态产生横向溢出')
  assert(state.toolbarText.includes('润色') && state.toolbarText.includes('改写') && state.toolbarText.includes('问 AI'),
    '工具条操作不完整')

  return { phase: 'selection', kind: 'selection', passed: true, states: [state] }
}
