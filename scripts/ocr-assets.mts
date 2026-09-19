import { createReadStream, existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { Plugin } from 'vite'

export function ocrAssets(root: string): Plugin {
  const manifest = JSON.parse(readFileSync(path.join(root, 'resources/ocr/manifest.json'), 'utf8')) as { files: Record<string, string> }
  const assets = new Map<string, string>([['ocr-assets/worker.min.js', path.join(root, 'node_modules/tesseract.js/dist/worker.min.js')],
    ['ocr-assets/LICENSE_TESSERACT_JS', path.join(root, 'node_modules/tesseract.js/LICENSE.md')],
    ['ocr-assets/core/LICENSE', path.join(root, 'node_modules/tesseract.js-core/LICENSE')]])
  for (const entry of readdirSync(path.join(root, 'node_modules/tesseract.js-core'))) {
    if (entry.endsWith('.wasm.js')) assets.set(`ocr-assets/core/${entry}`, path.join(root, 'node_modules/tesseract.js-core', entry))
  }
  for (const name of ['chi_sim.traineddata', 'eng.traineddata', 'LICENSE']) {
    assets.set(`ocr-assets/models/${name}`, path.join(root, 'resources/ocr', name))
  }
  const license = path.join(root, 'node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt')
  if (existsSync(license)) assets.set('ocr-assets/worker.min.js.LICENSE.txt', license)
  return {
    name: 'local-ocr-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url || '/', 'http://localhost')
        if (!url.pathname.startsWith('/ocr-assets/')) return next()
        const file = assets.get(url.pathname.slice(1))
        if (!file || !existsSync(file) || !['GET', 'HEAD'].includes(request.method || '')) {
          response.statusCode = 404; response.end(); return
        }
        response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream')
        response.setHeader('X-Content-Type-Options', 'nosniff')
        if (request.method === 'HEAD') { response.end(); return }
        createReadStream(file).on('error', () => response.end()).pipe(response)
      })
    },
    generateBundle() {
      for (const [fileName, file] of assets) {
        if (!existsSync(file)) this.error('缺少本地 OCR 资源，请先运行 npm run prepare:ocr。')
        const source = readFileSync(file)
        const expected = manifest.files[path.basename(file)]
        if (expected && createHash('sha256').update(source).digest('hex') !== expected) this.error('本地 OCR 模型校验失败。')
        this.emitFile({ type: 'asset', fileName, source })
      }
    },
  }
}
