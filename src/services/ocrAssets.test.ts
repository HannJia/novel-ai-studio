import { describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import { ocrAssets } from '../../scripts/ocr-assets.mts'
describe('bundled local OCR assets', () => {
  it('packages pinned models, core variants, workers and notices without relying on runtime CDN downloads', () => {
    const plugin = ocrAssets(path.resolve('.'))
    const emitFile = vi.fn()
    ;(plugin.generateBundle as Function).call({ emitFile, error: (message: string) => { throw new Error(message) } })
    const files = emitFile.mock.calls.map(([item]) => item.fileName)
    for (const file of ['worker.min.js', 'models/chi_sim.traineddata', 'models/eng.traineddata', 'models/LICENSE',
      'core/tesseract-core-lstm.wasm.js', 'core/tesseract-core-simd-lstm.wasm.js', 'LICENSE_TESSERACT_JS']) {
      expect(files).toContain(`ocr-assets/${file}`)
    }
    expect(files.some(file => file.includes('config') || file.includes('.sqlite'))).toBe(false)
  })
  it('rejects unlisted paths in the development asset endpoint', () => {
    const plugin = ocrAssets(path.resolve('.'))
    let handle!: Function
    ;(plugin.configureServer as Function)({ middlewares: { use: (handler: Function) => { handle = handler } } })
    const response = { statusCode: 200, end: vi.fn() }
    handle({ url: '/ocr-assets/models/unlisted.traineddata', method: 'GET' }, response, vi.fn())
    expect(response.statusCode).toBe(404)
  })
})
