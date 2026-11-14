<template>
  <div ref="editorViewport" class="pte" :class="{ readonly }" @scroll.passive="emit('scroll')">
    <EditorContent :editor="editor" class="pte-content" />
    <slot />
  </div>
</template>

<script setup lang="ts">
// 纯文本稿纸编辑器。对外是 v-model 字符串，内部用 doc → paragraph → text 的 Tiptap 文档。
// 标记（审校发现、候选位置）只作为装饰显示，不写进正文。偏移一律是纯文本 UTF-16 偏移。
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import { Extension } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { Placeholder, UndoRedo } from '@tiptap/extensions'
import { EditorState, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { Fragment, Slice, type Schema } from '@tiptap/pm/model'
import { docToPlainText, offsetToPos, plainTextToDoc, posToOffset, splitLines } from './plainText'
import { caretAnchorScrollTop } from './caretAnchor'

export interface EditorMark {
  id: string
  start: number
  end: number
  /** CSS 类名，如 mk-block、mk-cand */
  cls: string
  title?: string
}

export interface SelectionInfo {
  start: number
  end: number
  text: string
  /** 选区末端的视口坐标；无选区或不可见时为 null */
  rect: { left: number; right: number; top: number; bottom: number } | null
}

const props = withDefaults(defineProps<{
  modelValue: string
  readonly?: boolean
  marks?: EditorMark[]
  placeholder?: string
}>(), { readonly: false, marks: () => [], placeholder: '' })

const emit = defineEmits<{
  'update:modelValue': [value: string]
  selection: [info: SelectionInfo]
  scroll: []
  markClick: [id: string]
  /** 文档或装饰变化后触发，页边批注据此重新排布 */
  layout: []
  ready: []
  blur: []
}>()

const markKey = new PluginKey<DecorationSet>('v3-marks')
const editorViewport = ref<HTMLElement>()

function buildDecorations(doc: EditorState['doc'], marks: EditorMark[]): DecorationSet {
  const max = docToPlainText(doc).length
  const list: Decoration[] = []
  for (const m of marks) {
    const start = Math.max(0, Math.min(m.start, max)), end = Math.max(start, Math.min(m.end, max))
    const attrs = { class: m.cls, 'data-mark': m.id, ...(m.title ? { title: m.title } : {}) }
    if (start === end) {
      const span = document.createElement('span')
      span.className = `mk-pin ${m.cls}`
      span.dataset.mark = m.id
      list.push(Decoration.widget(offsetToPos(doc, start), span, { key: `pin-${m.id}`, side: 1 }))
      continue
    }
    // 跨段的范围按段拆开，避免装饰包住段落边界
    const from = offsetToPos(doc, start), to = offsetToPos(doc, end)
    doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isTextblock) return true
      const a = Math.max(from, pos + 1), b = Math.min(to, pos + 1 + node.content.size)
      if (b > a) list.push(Decoration.inline(a, b, attrs, { id: m.id }))
      return false
    })
  }
  return DecorationSet.create(doc, list)
}

const MarkPlugin = Extension.create({
  name: 'v3Marks',
  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      key: markKey,
      state: {
        init: (_, state) => buildDecorations(state.doc, props.marks),
        apply(tr, set) {
          const next = tr.getMeta(markKey) as EditorMark[] | undefined
          if (next) return buildDecorations(tr.doc, next)
          return tr.docChanged ? set.map(tr.mapping, tr.doc) : set
        },
      },
      props: { decorations: state => markKey.getState(state) },
    })]
  },
})

function textSlice(schema: Schema, text: string): Slice {
  const lines = splitLines(text.replace(/\r\n?/g, '\n'))
  const nodes = lines.map(line => schema.nodes.paragraph.create(null, line ? schema.text(line) : null))
  return new Slice(Fragment.from(nodes), 1, 1)
}

function insertPlain(view: EditorView, text: string): boolean {
  if (!view.editable) return true
  view.dispatch(view.state.tr.replaceSelection(textSlice(view.state.schema, text)).scrollIntoView())
  return true
}

let pendingMarks: EditorMark[] | null = null
let lastEmitted = props.modelValue
let documentReady = false
let lastSelectionOffsets = { start: 0, end: 0 }
let caretAnchorFrame = 0
let viewportObserver: ResizeObserver | undefined

const editor = useEditor({
  extensions: [
    Document, Paragraph, Text, UndoRedo, MarkPlugin,
    ...(props.placeholder ? [Placeholder.configure({ placeholder: props.placeholder, showOnlyWhenEditable: false })] : []),
  ],
  content: null,
  editable: !props.readonly,
  enableInputRules: false,
  enablePasteRules: false,
  coreExtensionOptions: { clipboardTextSerializer: { blockSeparator: '\n' } },
  editorProps: {
    attributes: { class: 'pte-doc', spellcheck: 'false', 'aria-label': '正文', 'aria-multiline': 'true', role: 'textbox' },
    clipboardTextParser: (text, _ctx, _plain, view) => textSlice(view.state.schema, text),
    handlePaste(view, event) {
      const text = event.clipboardData?.getData('text/plain')
      if (text == null) return false
      event.preventDefault()
      return insertPlain(view, text)
    },
    handleDrop(view, event, _slice, moved) {
      if (moved) return false
      const text = event.dataTransfer?.getData('text/plain')
      if (!text) return true
      const at = view.posAtCoords({ left: event.clientX, top: event.clientY })
      if (at) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at.pos)))
      event.preventDefault()
      return insertPlain(view, text)
    },
    handleClick(_view, _pos, event) {
      const el = (event.target as HTMLElement | null)?.closest?.('[data-mark]') as HTMLElement | null
      if (el?.dataset.mark) emit('markClick', el.dataset.mark)
      return false
    },
    handleDOMEvents: {
      compositionend: () => { setTimeout(flushMarks); return false },
    },
  },
  onCreate({ editor: ed }) {
    replaceDocument(props.modelValue, ed.view)
    documentReady = true
    emit('ready')
  },
  onUpdate({ editor: ed }) {
    const text = docToPlainText(ed.state.doc)
    if (text === lastEmitted) return
    lastEmitted = text
    emit('update:modelValue', text)
    emit('layout')
    keepCaretAtReadingLine()
  },
  onSelectionUpdate() { emitSelection() },
  onBlur() { emit('blur') },
})

/** 整体替换文档并清空撤销栈（切章、接受候选、恢复版本）。 */
function replaceDocument(text: string, view = editor.value?.view) {
  if (!view) return
  const doc = plainTextToDoc(view.state.schema, text)
  const state = EditorState.create({ doc, plugins: view.state.plugins })
  view.updateState(state)
  lastEmitted = text
  pendingMarks = props.marks
  flushMarks()
}

function flushMarks() {
  const view = editor.value?.view
  if (!view || !pendingMarks) return
  if (view.composing) return
  const marks = pendingMarks
  pendingMarks = null
  view.dispatch(view.state.tr.setMeta(markKey, marks).setMeta('addToHistory', false))
  emit('layout')
}

function updateCaretAnchorSpace(view = editor.value?.view) {
  const viewport = editorViewport.value
  if (!view || !viewport) return
  const height = viewport.clientHeight
  view.dom.style.paddingBottom = height ? `${Math.ceil(height / 3)}px` : ''
}

function keepCaretAtReadingLine() {
  cancelAnimationFrame(caretAnchorFrame)
  caretAnchorFrame = requestAnimationFrame(() => {
    caretAnchorFrame = 0
    const view = editor.value?.view
    const viewport = editorViewport.value
    if (!view?.hasFocus() || !viewport?.clientHeight) return
    updateCaretAnchorSpace(view)
    try {
      const caret = view.coordsAtPos(view.state.selection.head)
      viewport.scrollTop = caretAnchorScrollTop(viewport, viewport.getBoundingClientRect().top, caret.top)
    } catch { /* Layout may not be measurable while the editor is being mounted. */ }
  })
}

watch(() => props.modelValue, value => {
  if (value !== lastEmitted) replaceDocument(value)
})
watch(() => props.marks, marks => { pendingMarks = marks; flushMarks() })
watch(() => props.readonly, ro => editor.value?.setEditable(!ro, false))

function emitSelection() {
  const view = editor.value?.view
  if (!view) return
  const { from, to } = view.state.selection
  const start = posToOffset(view.state.doc, from), end = posToOffset(view.state.doc, to)
  let rect: SelectionInfo['rect'] = null
  if (to > from) {
    try {
      const a = view.coordsAtPos(from), b = view.coordsAtPos(to)
      rect = { left: Math.min(a.left, b.left), right: Math.max(a.right, b.right), top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom) }
    } catch { rect = null }
  }
  if (end > start) lastSelectionOffsets = { start, end }
  emit('selection', { start, end, text: docToPlainText(view.state.doc).slice(start, end), rect })
}

/** Keep programmatic or native DOM selections in sync with ProseMirror. */
function syncDomSelection() {
  const view = editor.value?.view, selection = window.getSelection()
  if (!view || !selection?.rangeCount || !selection.anchorNode || !selection.focusNode
    || !view.dom.contains(selection.anchorNode) || !view.dom.contains(selection.focusNode)) return
  try {
    const anchor = view.posAtDOM(selection.anchorNode, selection.anchorOffset)
    const focus = view.posAtDOM(selection.focusNode, selection.focusOffset)
    const from = Math.min(anchor, focus), to = Math.max(anchor, focus)
    if (from === view.state.selection.from && to === view.state.selection.to) return
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)).setMeta('addToHistory', false))
  } catch { /* Ignore transient selections while the editor is remapping DOM nodes. */ }
}

function getSelectionOffsets(): { start: number; end: number } {
  const view = editor.value?.view
  if (!view) return { start: 0, end: 0 }
  const { from, to } = view.state.selection
  const stored = { start: posToOffset(view.state.doc, from), end: posToOffset(view.state.doc, to) }
  if (stored.end > stored.start) return stored
  if (lastSelectionOffsets.end > lastSelectionOffsets.start) return lastSelectionOffsets
  const selection = window.getSelection()
  if (!selection?.rangeCount || !selection.anchorNode || !selection.focusNode
    || !view.dom.contains(selection.anchorNode) || !view.dom.contains(selection.focusNode)) return stored
  try {
    const anchor = view.posAtDOM(selection.anchorNode, selection.anchorOffset)
    const focus = view.posAtDOM(selection.focusNode, selection.focusOffset)
    const start = Math.min(anchor, focus), end = Math.max(anchor, focus)
    return { start: posToOffset(view.state.doc, start), end: posToOffset(view.state.doc, end) }
  } catch { return stored }
}

/** 选中纯文本范围并滚动到可见处。 */
function revealRange(start: number, end = start, options: { focus?: boolean } = {}) {
  const view = editor.value?.view
  if (!view || !documentReady) return false
  const doc = view.state.doc
  const sel = TextSelection.create(doc, offsetToPos(doc, start), offsetToPos(doc, end))
  view.dispatch(view.state.tr.setSelection(sel).scrollIntoView().setMeta('addToHistory', false))
  const viewport = editorViewport.value
  if (viewport) {
    const caret = view.coordsAtPos(offsetToPos(doc, start))
    const bounds = viewport.getBoundingClientRect()
    viewport.scrollTop += caret.top - (bounds.top + viewport.clientHeight / 2)
  }
  if (options.focus !== false) view.focus()
  return true
}

function focus() { editor.value?.view.focus() }

/** 偏移处的视口坐标，页边批注排布用；不可用时返回 null。 */
function coordsAtOffset(offset: number): { top: number; bottom: number; left: number } | null {
  const view = editor.value?.view
  if (!view) return null
  try {
    const c = view.coordsAtPos(offsetToPos(view.state.doc, offset))
    return { top: c.top, bottom: c.bottom, left: c.left }
  } catch { return null }
}

function getText(): string {
  const view = editor.value?.view
  return view ? docToPlainText(view.state.doc) : props.modelValue
}

onMounted(() => {
  document.addEventListener('selectionchange', syncDomSelection)
  const viewport = editorViewport.value
  if (viewport && typeof ResizeObserver !== 'undefined') {
    viewportObserver = new ResizeObserver(() => updateCaretAnchorSpace())
    viewportObserver.observe(viewport)
  }
  updateCaretAnchorSpace()
})
onBeforeUnmount(() => {
  document.removeEventListener('selectionchange', syncDomSelection)
  cancelAnimationFrame(caretAnchorFrame)
  viewportObserver?.disconnect()
  editor.value?.destroy()
})

defineExpose({ getSelectionOffsets, revealRange, focus, coordsAtOffset, replaceDocument, getText })
</script>

<style>
.v3 .pte { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain }
.v3 .pte-content { display: flex; flex-direction: column; flex: 1 0 auto; min-height: 0 }
.v3 .pte .pte-doc { flex: 1 0 auto; outline: none; white-space: pre-wrap; word-break: break-word; caret-color: var(--zhu); font: var(--write-font-size, 18px)/2 var(--f-serif); letter-spacing: var(--write-letter-spacing, .03em); padding-right: 24px }
.v3 .pte .pte-doc p { margin: 0 0 var(--write-paragraph-spacing, .9em); text-indent: 2em; min-height: 2em }
.v3 .pte [data-mark] { cursor: pointer; border-radius: 2px; text-underline-offset: 6px }
.v3 .pte .mk-block { text-decoration: underline wavy var(--zhu) 1.5px; background: var(--zhu-soft) }
.v3 .pte .mk-warn { text-decoration: underline solid var(--jin) 2px }
.v3 .pte .mk-hint { text-decoration: underline dotted var(--dai) 2px }
.v3 .pte .mk-fs { text-decoration: underline double var(--qing) 1.5px }
.v3 .pte .mk-ok { text-decoration: underline solid color-mix(in srgb, var(--qing) 45%, transparent) 1px }
.v3 .pte .mk-off { text-decoration: none; background: none; cursor: text }
.v3 .pte .mk-cand { background: var(--slip); box-shadow: 0 0 0 2px var(--slip-line); text-decoration: none }
.v3 .pte.readonly .pte-doc { caret-color: transparent }
.v3 .pte .pte-doc p.is-editor-empty:first-child::before { content: attr(data-placeholder); color: var(--ink-4); float: left; height: 0; pointer-events: none }
.v3 .pte .mk-pin { display: inline-block; width: 0; height: 1.2em; vertical-align: text-bottom; border-left: 2px solid var(--zhu) }
</style>
