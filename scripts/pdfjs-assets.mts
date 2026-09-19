import { createReadStream, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

// PDF.js requests these by their original names; bundling only its worker is not sufficient.
export function pdfjsAssets(pdfDirectory: string): Plugin {
  const assets = new Map<string, string>()
  for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
    for (const entry of readdirSync(path.join(pdfDirectory, directory), { withFileTypes: true })) {
      if (entry.isFile()) assets.set(`pdfjs-assets/${directory}/${entry.name}`, path.join(pdfDirectory, directory, entry.name))
    }
  }
  return {
    name: 'pdfjs-runtime-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url || '/', 'http://localhost').pathname
        if (!pathname.startsWith('/pdfjs-assets/')) return next()
        const filename = assets.get(pathname.slice(1))
        if (!filename || !['GET', 'HEAD'].includes(request.method || '')) {
          response.statusCode = 404
          response.end()
          return
        }
        response.setHeader('Content-Type', filename.endsWith('.wasm') ? 'application/wasm'
          : filename.endsWith('.js') ? 'text/javascript' : 'application/octet-stream')
        response.setHeader('X-Content-Type-Options', 'nosniff')
        if (request.method === 'HEAD') { response.end(); return }
        const stream = createReadStream(filename)
        stream.on('error', () => { response.statusCode = 500; response.end() })
        stream.pipe(response)
      })
    },
    generateBundle() {
      for (const [fileName, filename] of assets) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(filename) })
      }
    },
  }
}
