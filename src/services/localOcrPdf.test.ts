// @vitest-environment happy-dom
import { webcrypto } from 'node:crypto'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { readLocalOcrPdf, reviewOcrPages } from './localOcrPdf'
import { callAI } from './ai'
import { LOCAL_OCR_VERSION } from './ocrQuality'
import type { PdfPageText } from './knowledgePdfCache'
import type { ModelConfig } from '@/stores/config'
const mock = vi.hoisted(() => ({ pages: new Map<number, PdfPageText>(), keys: [] as string[], recognize: vi.fn(), dispose: vi.fn(), writes: 0 }))
vi.mock('./localOcr', () => ({ createLocalOcr: async () => ({ recognize: mock.recognize, dispose: mock.dispose }) }))
vi.mock('./knowledgePdf', () => ({ pdfDocumentOptions: (data: ArrayBuffer) => ({ data }), renderPdfPage: async () => 'data:image/png;base64,AA==' }))
vi.mock('./ai', () => ({ callAI: vi.fn() }))
vi.mock('./knowledgePdfCache', () => ({
  loadPdfPages: async (key: string) => { mock.keys.push(key); return structuredClone(mock.pages) },
  savePdfPage: async (_key: string, record: PdfPageText) => { mock.writes++; mock.pages.set(record.page, structuredClone(record)) },
}))
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({ promise: Promise.resolve({ numPages: 3, getPage: async () => ({
    getTextContent: async () => ({ items: [{ str: '原资料' }] }), cleanup: vi.fn(),
  }) }), destroy: vi.fn(async () => {}) }),
}))
const file = () => new File(['file-content'], 'test.pdf')
const model = { name: '测试模型', apiKey: 'test-secret', modelName: 'test', maxTokens: 5000 } as ModelConfig
function record(page = 1, count = 10): PdfPageText {
  return { page, method: 'local-ocr', text: 'draft', ocr: { engine: LOCAL_OCR_VERSION, width: 100, height: 200, warnings: [],
    lines: Array.from({ length: count }, (_, index) => ({ id: `line-${index}`, original: '县志资料', text: '县志资料',
      confidence: 50, box: { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.2 }, reasons: ['低置信度'], status: 'pending' })) } }
}
beforeEach(() => {
  vi.clearAllMocks()
  mock.pages.clear(); mock.keys = []; mock.writes = 0
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('Image', class { src = ''; width = 100; height = 200; naturalWidth = 100; naturalHeight = 200; decode() { return Promise.resolve() } })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,AA==')
  mock.recognize.mockResolvedValue({ text: '县志资料', blocks: [{ blocktype: 'text', paragraphs: [{ lines: [{
    text: '县志资料', confidence: 70, bbox: { x0: 10, y0: 20, x1: 90, y1: 40 }, words: [],
  }] }] }] })
  vi.mocked(callAI).mockImplementation(async options => {
    const inputs = JSON.parse(options.messages[1].content.split('：')[1].split('\n')[0])
    return { content: JSON.stringify({ items: inputs.map((item: { id: string }) => ({ id: item.id, text: '县志资料', verdict: 'confirmed', note: '' })) }) }
  })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('local OCR and bounded visual review', () => {
  it('reads only the requested pages, caches results and never calls AI for the local pass', async () => {
    const options = { pageStart: 2, pageEnd: 2, signal: new AbortController().signal }
    const text = await readLocalOcrPdf(file(), options, { pages: 1000, characters: 5000000 })
    expect(text).toContain('## 第 2 页')
    expect(text).not.toContain('## 第 1 页')
    expect(mock.recognize).toHaveBeenCalledOnce()
    expect(mock.dispose).toHaveBeenCalledOnce()
    await readLocalOcrPdf(file(), options, { pages: 1000, characters: 5000000 })
    expect(mock.recognize).toHaveBeenCalledOnce()
    expect(callAI).not.toHaveBeenCalled()
    expect(mock.keys.every(key => key.includes(LOCAL_OCR_VERSION))).toBe(true)
  })
  it('does not initialize OCR or AI in cache-only mode', async () => {
    await readLocalOcrPdf(file(), { cacheOnly: true }, { pages: 1000, characters: 5000000 })
    expect(mock.recognize).not.toHaveBeenCalled()
    expect(callAI).not.toHaveBeenCalled()
    expect(mock.writes).toBe(0)
  })
  it('groups up to eight issues and honors the explicit request cap across pages', async () => {
    mock.pages.set(1, record(1)); mock.pages.set(2, record(2))
    const options = { model, signal: new AbortController().signal, maxCalls: 1, consent: true, onPage: vi.fn(), onProgress: vi.fn() }
    await reviewOcrPages(file(), [record(1), record(2)], options)
    expect(callAI).toHaveBeenCalledOnce()
    expect(vi.mocked(callAI).mock.calls[0][0]).toMatchObject({ noAutomaticRetry: true, redactErrors: true })
    expect(mock.pages.get(1)!.ocr!.lines.filter(line => line.status === 'reviewed')).toHaveLength(8)
    expect(mock.pages.get(1)!.ocr!.lines.filter(line => line.status === 'pending')).toHaveLength(2)
    expect(mock.pages.get(2)!.ocr!.lines.filter(line => line.status === 'pending')).toHaveLength(10)
  })
  it('refuses unconsented calls and ignores late aborted results', async () => {
    mock.pages.set(1, record())
    const controller = new AbortController()
    const options = { model, signal: controller.signal, maxCalls: 1, consent: false, onPage: vi.fn(), onProgress: vi.fn() }
    await expect(reviewOcrPages(file(), [record()], options)).rejects.toThrow('确认')
    expect(callAI).not.toHaveBeenCalled()
    vi.mocked(callAI).mockImplementation(async () => { controller.abort(); return { content: '{}' } })
    await expect(reviewOcrPages(file(), [record()], { ...options, consent: true })).rejects.toMatchObject({ name: 'AbortError' })
    expect(mock.writes).toBe(0)
    expect(options.onPage).not.toHaveBeenCalled()
  })
  it('does not apply a batch with missing IDs or truncated model output', async () => {
    mock.pages.set(1, record())
    for (const result of [{ content: '{"items":[]}' }, { content: '{}', finishReason: 'length' }]) {
      vi.mocked(callAI).mockResolvedValueOnce(result)
      await expect(reviewOcrPages(file(), [record()], { model, signal: new AbortController().signal,
        maxCalls: 1, consent: true, onPage: vi.fn(), onProgress: vi.fn() })).rejects.toThrow()
    }
    expect(mock.writes).toBe(0)
    expect(mock.pages.get(1)!.ocr!.lines[0].status).toBe('pending')
  })
})
