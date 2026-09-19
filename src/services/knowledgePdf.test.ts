// @vitest-environment happy-dom
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertPdfImagesDecoded, pdfDocumentOptions, readKnowledgePdf, recognizePdfPage, type PdfReadProgress } from './knowledgePdf'
import type { PDFPageProxy } from 'pdfjs-dist'
import { callAI, serializeChatMessages } from './ai'
import type { ModelConfig } from '@/stores/config'
import type { PdfPageText } from './knowledgePdfCache'
import { savePdfPage } from './knowledgePdfCache'
import { splitKnowledgeText } from './knowledgeText'

const state = vi.hoisted(() => ({
  cache: new Map<string, Map<number, PdfPageText>>(), texts: ['原有文字层', '', ''],
  destroy: vi.fn(async () => {}), render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
}))
vi.mock('./ai', async original => ({ ...await original<object>(), callAI: vi.fn() }))
vi.mock('./knowledgePdfCache', () => ({
  loadPdfPages: vi.fn(async (key: string) => new Map(state.cache.get(key))),
  savePdfPage: vi.fn(async (key: string, value: PdfPageText) => {
    const pages = state.cache.get(key) || new Map()
    pages.set(value.page, value)
    state.cache.set(key, pages)
  }),
}))
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  OPS: { paintImageXObject: 85, paintImageXObjectRepeat: 88 },
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: state.texts.length,
      getPage: async (page: number) => ({
        getTextContent: async () => ({ items: state.texts[page - 1] ? [{ str: state.texts[page - 1], hasEOL: true }] : [] }),
        getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
        render: state.render, cleanup: vi.fn(), getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
      }),
    }),
    destroy: state.destroy,
  }),
}))
const model: ModelConfig = { id: 'test', name: '视觉模型', baseUrl: 'https://example.test', apiKey: 'test-only',
  modelName: 'vision', maxTokens: 8000, temperature: 0.7, topP: 1 }
const file = (body = 'document') => new File([body], '资料.pdf')
beforeEach(() => {
  vi.clearAllMocks()
  state.cache.clear()
  state.texts = ['原有文字层', '', '']
  vi.stubGlobal('crypto', webcrypto)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,YWJj')
  vi.mocked(callAI).mockResolvedValue({ content: '{"text":"扫描资料：经过20天，成熟度20%。","blank":false}', finishReason: 'stop' })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('PDF visual imports', () => {
  it.each([undefined, false])('never sends images without explicit permission (%s)', async allowVision => {
    await expect(readKnowledgePdf(file(), { model, allowVision })).rejects.toThrow('视觉识别开关已关闭')
    expect(callAI).not.toHaveBeenCalled()
    expect(state.render).not.toHaveBeenCalled()
    expect([...state.cache.values()][0].size).toBe(1)
    expect([...state.cache.values()][0].get(1)?.text).toBe('原有文字层')
  })
  it('blocks full-vision mode when disabled while still allowing cached results', async () => {
    await expect(readKnowledgePdf(file(), { model, mode: 'vision', allowVision: false })).rejects.toThrow('视觉识别开关已关闭')
    expect(callAI).not.toHaveBeenCalled()
    const original = await readKnowledgePdf(file(), { model, mode: 'vision', allowVision: true })
    vi.mocked(callAI).mockClear()
    expect(await readKnowledgePdf(file(), { model, mode: 'vision', allowVision: false })).toBe(original)
    expect(callAI).not.toHaveBeenCalled()
  })
  it('configures local character maps, fonts and image decoders and rejects silently missing images', async () => {
    const options = pdfDocumentOptions(new ArrayBuffer(0))
    expect(options).toMatchObject({ cMapPacked: true, stopAtErrors: true })
    expect(options.cMapUrl).toContain('/pdfjs-assets/cmaps/')
    expect(options.wasmUrl).toContain('/pdfjs-assets/wasm/')
    expect(options.standardFontDataUrl).toContain('/pdfjs-assets/standard_fonts/')
    const page = { pageNumber: 7, getOperatorList: async () => ({ fnArray: [85], argsArray: [['image']] }),
      objs: { has: () => true, get: () => null } } as unknown as PDFPageProxy
    await expect(assertPdfImagesDecoded(page)).rejects.toThrow('第 7 页图像解码失败')
    expect(callAI).not.toHaveBeenCalled()
  })
  it('waits for image data that resolves after its operator list without treating it as blank', async () => {
    const page = { pageNumber: 7, getOperatorList: async () => ({ fnArray: [85], argsArray: [['image']] }),
      objs: { has: () => false, get: (_id: string, callback: (value: unknown) => void) => queueMicrotask(() => callback({ width: 500 })) },
    } as unknown as PDFPageProxy
    await expect(assertPdfImagesDecoded(page)).resolves.toBeUndefined()
    const controller = new AbortController()
    controller.abort()
    await expect(assertPdfImagesDecoded(page, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('preserves valid old OCR but rereads legacy blank results using the repaired native text path for free', async () => {
    state.texts = ['封面文字', '修复中文映射后可读取的正文']
    await readKnowledgePdf(file(), { model })
    const pages = [...state.cache.values()][0]
    pages.set(1, { page: 1, method: 'vision', text: '之前成功识别的封面' })
    pages.set(2, { page: 2, method: 'vision', text: '' })
    const progress: PdfReadProgress[] = []
    const result = await readKnowledgePdf(file(), { onProgress: value => progress.push(value) })
    expect(result).toContain('之前成功识别的封面')
    expect(result).toContain('修复中文映射后可读取的正文')
    expect(progress[progress.length - 1]).toMatchObject({ staleBlankPages: 1, textPages: 2, blankPages: 0, completed: 2, cached: 1 })
    expect(pages.get(2)?.decoderVersion).toBe(2)
    expect(callAI).not.toHaveBeenCalled()
  })
  it('does not reinterpret legacy blank caches during cache-only inspection', async () => {
    await readKnowledgePdf(file(), { model, allowVision: true })
    const pages = [...state.cache.values()][0]
    pages.set(2, { page: 2, method: 'vision', text: '' })
    vi.mocked(callAI).mockClear()
    const progress: PdfReadProgress[] = []
    await readKnowledgePdf(file(), { cacheOnly: true, onProgress: value => progress.push(value) })
    expect(progress[progress.length - 1]).toMatchObject({ staleBlankPages: 1, blankPages: 1, completed: 3 })
    expect(pages.get(2)?.decoderVersion).toBeUndefined()
    expect(callAI).not.toHaveBeenCalled()
  })
  it('joins and splits all 857 populated pages without dropping them, including cache-only recovery', async () => {
    state.texts = Array.from({ length: 857 }, (_, index) => `第${index + 1}页有效文字`)
    const progress: PdfReadProgress[] = []
    const first = await readKnowledgePdf(file(), { model })
    expect(splitKnowledgeText(first)).toHaveLength(857)
    const recovered = await readKnowledgePdf(file(), { cacheOnly: true, onProgress: item => progress.push(item) })
    expect(recovered).toBe(first)
    expect(progress[progress.length - 1]).toMatchObject({ textPages: 857, blankPages: 0, missingPages: 0 })
    expect(callAI).not.toHaveBeenCalled()
  })
  it('reports a cover-only result as one text page and 856 blank results', async () => {
    state.texts = Array.from({ length: 857 }, (_, index) => index ? '' : '书名封面')
    vi.mocked(callAI).mockResolvedValue({ content: '{"text":"","blank":true}' })
    const progress: PdfReadProgress[] = []
    const text = await readKnowledgePdf(file(), { model, allowVision: true, onProgress: item => progress.push(item) })
    expect(splitKnowledgeText(text)).toHaveLength(1)
    expect(progress[progress.length - 1]).toMatchObject({ completed: 857, textPages: 1, blankPages: 856 })
  })
  it('reports missing cached pages without starting recognition and delivers each available page', async () => {
    const progress: PdfReadProgress[] = []
    const onPage = vi.fn()
    expect(await readKnowledgePdf(file(), { cacheOnly: true, onPage, onProgress: item => progress.push(item) })).toBe('')
    expect(progress[progress.length - 1]).toMatchObject({ missingPages: 3, textPages: 0, completed: 0 })
    expect(onPage).not.toHaveBeenCalled()
    expect(callAI).not.toHaveBeenCalled()
  })
  it('extracts text directly, sends only scan pages to the chosen model, and reuses persistent pages', async () => {
    const progress: PdfReadProgress[] = []
    const text = await readKnowledgePdf(file(), { model, allowVision: true, onProgress: value => progress.push(value) })
    expect(text).toContain('## 第 1 页\n原有文字层')
    expect(text).toContain('## 第 2 页\n扫描资料')
    expect(text).toContain('## 第 3 页\n扫描资料')
    expect(callAI).toHaveBeenCalledTimes(2)
    expect(vi.mocked(callAI).mock.calls[0][0]).toMatchObject({ model, redactErrors: true })
    expect(vi.mocked(callAI).mock.calls[0][0].messages[1].imageDataUrls).toEqual(['data:image/jpeg;base64,YWJj'])
    expect(progress[progress.length - 1]).toMatchObject({ phase: 'complete', completed: 3, total: 3 })
    const again: PdfReadProgress[] = []
    expect(await readKnowledgePdf(file(), { model, onProgress: value => again.push(value) })).toBe(text)
    expect(callAI).toHaveBeenCalledTimes(2)
    expect(again[again.length - 1].cached).toBe(3)
  })
  it('resumes after cancellation without charging for completed pages again', async () => {
    const controller = new AbortController()
    await expect(readKnowledgePdf(file(), { model, allowVision: true, signal: controller.signal, onProgress: progress => {
      if (progress.completed === 2) controller.abort()
    } })).rejects.toMatchObject({ name: 'AbortError' })
    expect(callAI).toHaveBeenCalledTimes(1)
    expect(state.destroy).toHaveBeenCalled()
    await readKnowledgePdf(file(), { model, allowVision: true })
    expect(callAI).toHaveBeenCalledTimes(2)
  })
  it('uses content fingerprints rather than names and keeps full-vision mode independent', async () => {
    await readKnowledgePdf(file('first'), { model, allowVision: true })
    await readKnowledgePdf(file('second'), { model, allowVision: true })
    expect(callAI).toHaveBeenCalledTimes(4)
    await readKnowledgePdf(file('first'), { model, mode: 'vision', allowVision: true })
    expect(callAI).toHaveBeenCalledTimes(7)
  })
  it('rejects incomplete replies and resumes from the failed page', async () => {
    vi.mocked(callAI).mockResolvedValueOnce({ content: '{"text":"半截文字","blank":false}', finishReason: 'length' })
    await expect(readKnowledgePdf(file(), { model, allowVision: true })).rejects.toThrow('截断')
    expect([...state.cache.values()][0].size).toBe(1)
    await readKnowledgePdf(file(), { model, allowVision: true })
    expect(callAI).toHaveBeenCalledTimes(3)
  })
  it('requires a configured model for scans but still caches text pages for retry', async () => {
    await expect(readKnowledgePdf(file(), { allowVision: true })).rejects.toThrow('选择已配置密钥')
    expect(callAI).not.toHaveBeenCalled()
    expect([...state.cache.values()][0].size).toBe(1)
  })
  it('rejects unknown or contradictory OCR output and caches confirmed blank pages', async () => {
    for (const content of ['', '普通聊天回复', '{"text":"","blank":false}', '{"text":"文字","blank":true}']) {
      vi.mocked(callAI).mockResolvedValueOnce({ content })
      await expect(recognizePdfPage('data:image/jpeg;base64,YWJj', 1, model, new AbortController().signal)).rejects.toThrow('未返回完整')
    }
    state.texts = ['']
    vi.mocked(callAI).mockResolvedValue({ content: '{"text":"","blank":true}' })
    expect(await readKnowledgePdf(file(), { model, allowVision: true })).toBe('')
    expect([...state.cache.values()][0].get(1)?.text).toBe('')
  })
  it('sanitizes relay errors and propagates cancellation without leaking response data', async () => {
    vi.mocked(callAI).mockRejectedValueOnce(new Error('secret-key image-base64'))
    await expect(readKnowledgePdf(file(), { model, allowVision: true })).rejects.toThrow('视觉识别请求失败')
    const controller = new AbortController()
    controller.abort()
    await expect(readKnowledgePdf(file(), { model, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('stops if cache persistence fails and enforces page and text limits with cleanup', async () => {
    vi.mocked(savePdfPage).mockRejectedValueOnce(new Error('写盘失败'))
    await expect(readKnowledgePdf(file(), { model })).rejects.toThrow('写盘失败')
    expect(callAI).not.toHaveBeenCalled()
    await expect(readKnowledgePdf(file(), { model }, { pages: 2, characters: 5000 })).rejects.toThrow('超过 2 页')
    await expect(readKnowledgePdf(file(), { model }, { pages: 1000, characters: 3 })).rejects.toThrow('500 万')
    expect(state.destroy).toHaveBeenCalledTimes(3)
  })
})

describe('image transport', () => {
  it('keeps text-only callers unchanged and serializes high-detail image parts without exposing internal fields', () => {
    expect(serializeChatMessages([{ role: 'user', content: '普通消息' }])).toEqual([{ role: 'user', content: '普通消息' }])
    const result = serializeChatMessages([{ role: 'user', content: '文字识别', imageDataUrls: ['data:image/jpeg;base64,YWJj'] }])
    expect(result).toEqual([{ role: 'user', content: [
      { type: 'text', text: '文字识别' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,YWJj', detail: 'high' } },
    ] }])
    expect(() => serializeChatMessages([{ role: 'system', content: '', imageDataUrls: ['data:image/jpeg;base64,YWJj'] }])).toThrow()
    expect(() => serializeChatMessages([{ role: 'user', content: '', imageDataUrls: ['https://example.test/image'] }])).toThrow()
  })
})
