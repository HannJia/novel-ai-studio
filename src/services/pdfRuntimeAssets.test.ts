import { describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import { pdfjsAssets } from '../../scripts/pdfjs-assets.mts'

describe('local PDF runtime assets', () => {
  it('includes Chinese maps, JBIG2/JPX decoders, fonts and license notices in production builds', () => {
    const plugin = pdfjsAssets(path.resolve('node_modules/pdfjs-dist'))
    const emitFile = vi.fn()
    ;(plugin.generateBundle as Function).call({ emitFile })
    const files = emitFile.mock.calls.map(([asset]) => asset.fileName)
    for (const name of ['cmaps/GBK-EUC-H.bcmap', 'cmaps/Adobe-GB1-UCS2.bcmap', 'wasm/jbig2.wasm',
      'wasm/openjpeg.wasm', 'wasm/jbig2_nowasm_fallback.js', 'wasm/LICENSE_JBIG2', 'standard_fonts/LiberationSans-Regular.ttf']) {
      expect(files).toContain(`pdfjs-assets/${name}`)
    }
    expect(emitFile.mock.calls.every(([asset]) => asset.source.byteLength > 0)).toBe(true)
  })
  it('does not let the development asset handler read arbitrary paths', () => {
    const plugin = pdfjsAssets(path.resolve('node_modules/pdfjs-dist'))
    let handler!: Function
    ;(plugin.configureServer as Function)({ middlewares: { use: (value: Function) => { handler = value } } })
    for (const url of ['/pdfjs-assets/unknown', '/pdfjs-assets/wasm/%2e%2e%2fpackage.json']) {
      const response = { statusCode: 200, end: vi.fn() }
      handler({ url, method: 'GET' }, response, vi.fn())
      expect(response.statusCode).toBe(404)
      expect(response.end).toHaveBeenCalledOnce()
    }
  })
})
