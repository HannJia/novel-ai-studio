// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalOcr } from './localOcr'
const mock = vi.hoisted(() => ({ create: vi.fn(), recognize: vi.fn(), terminate: vi.fn(), parameters: vi.fn() }))
vi.mock('tesseract.js', () => ({ createWorker: mock.create, OEM: { LSTM_ONLY: 1 }, PSM: { AUTO: '3' } }))
beforeEach(() => {
  vi.clearAllMocks()
  mock.create.mockResolvedValue({ recognize: mock.recognize, terminate: mock.terminate, setParameters: mock.parameters })
  mock.recognize.mockResolvedValue({ data: { text: '文字', blocks: [] } })
  mock.terminate.mockResolvedValue(undefined)
  mock.parameters.mockResolvedValue(undefined)
})
afterEach(() => vi.useRealTimers())
describe('offline OCR worker lifecycle', () => {
  it('uses local language/core/worker paths, no CDN, and releases workers after use', async () => {
    const engine = await createLocalOcr(new AbortController().signal)
    const options = mock.create.mock.calls[0][2]
    expect(options.workerPath).toContain('/ocr-assets/worker.min.js')
    expect(options.corePath).toContain('/ocr-assets/core/')
    expect(options.langPath).toContain('/ocr-assets/models')
    expect(options.cacheMethod).toBe('none')
    await engine.recognize('image')
    await engine.dispose()
    expect(mock.terminate).toHaveBeenCalled()
  })
  it('aborts a pending recognition without waiting for a worker result that will never arrive', async () => {
    const controller = new AbortController()
    const engine = await createLocalOcr(controller.signal)
    mock.recognize.mockImplementation(() => new Promise(() => {}))
    const recognizing = engine.recognize('image')
    controller.abort()
    await expect(recognizing).rejects.toMatchObject({ name: 'AbortError' })
    await engine.dispose()
    expect(mock.terminate).toHaveBeenCalled()
  })
  it('terminates late-created workers when initialization was cancelled', async () => {
    let finish!: (value: unknown) => void
    mock.create.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const controller = new AbortController()
    const pending = createLocalOcr(controller.signal)
    await vi.waitFor(() => expect(mock.create).toHaveBeenCalled())
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    finish({ terminate: mock.terminate })
    await Promise.resolve()
    expect(mock.terminate).toHaveBeenCalled()
  })
})
