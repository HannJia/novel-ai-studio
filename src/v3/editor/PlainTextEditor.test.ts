// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { EditorContent } from '@tiptap/vue-3'
import PlainTextEditor from './PlainTextEditor.vue'

let wrapper: ReturnType<typeof mount>
let nextFrame: number
const frames = new Map<number, FrameRequestCallback>()

beforeEach(() => {
  nextFrame = 0
  frames.clear()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback)
    return nextFrame
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})

afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

async function openEditor(text = '第一段。\n第二段。') {
  wrapper = mount(PlainTextEditor, { attachTo: document.body, props: { modelValue: text },
    slots: { default: '<section class="chapter-gate"><button>全章审校</button></section>' } })
  await flushPromises()
  await vi.waitFor(() => expect(wrapper.emitted('ready')).toHaveLength(1))
  const editor = wrapper.getComponent(EditorContent).props('editor')!
  // DOM test geometry cannot perform the browser's native selection scrolling.
  // Exercise our scrolling against an explicit viewport, leaving selection mapping real.
  editor.setOptions({ editorProps: { ...editor.options.editorProps, handleScrollToSelection: () => true } })
  const viewport = wrapper.element as HTMLElement
  Object.defineProperties(viewport, { clientHeight: { value: 600 }, scrollHeight: { value: 1800 } })
  vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 700, height: 600 } as DOMRect)
  vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ top: 510, bottom: 546, left: 100, right: 100 })
  return { editor, viewport, api: wrapper.vm as unknown as InstanceType<typeof PlainTextEditor> }
}

describe('正文与定稿检查共享滚动区域', () => {
  it('定稿检查位于编辑内容之外，不进入正文或历史恢复内容', async () => {
    const { api } = await openEditor()
    expect(wrapper.get('.pte-content').element.nextElementSibling).toBe(wrapper.get('.chapter-gate').element)
    expect(wrapper.get('.pte-doc').element.contains(wrapper.get('.chapter-gate').element)).toBe(false)
    expect(api.getText()).toBe('第一段。\n第二段。')
    api.replaceDocument('恢复的正文。')
    expect(api.getText()).toBe('恢复的正文。')
    expect(wrapper.get('.chapter-gate').text()).toBe('全章审校')
  })

  it('审校定位滚动共享区域，并保留正文偏移选区', async () => {
    const { viewport, api } = await openEditor()
    viewport.scrollTop = 200
    expect(api.revealRange(1, 3, { focus: false })).toBe(true)
    expect(viewport.scrollTop).toBe(310)
    expect(api.getSelectionOffsets()).toEqual({ start: 1, end: 3 })
    expect((wrapper.get('.pte-content').element as HTMLElement).scrollTop).toBe(0)
  })

  it('输入后在共享区域跟随光标，滚动能通知批注与选区工具', async () => {
    const { editor, viewport } = await openEditor()
    vi.spyOn(editor.view, 'hasFocus').mockReturnValue(true)
    viewport.scrollTop = 300
    editor.commands.insertContent('新')
    for (const callback of frames.values()) callback(0)
    expect(viewport.scrollTop).toBe(310)
    expect((wrapper.get('.pte-doc').element as HTMLElement).style.paddingBottom).toBe('200px')
    await wrapper.trigger('scroll')
    expect(wrapper.emitted('scroll')).toHaveLength(1)
    const updates = wrapper.emitted('update:modelValue')!
    expect(updates[updates.length - 1]).toEqual(['新第一段。\n第二段。'])
  })
})
