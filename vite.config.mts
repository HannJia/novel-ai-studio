import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pdfjsAssets } from './scripts/pdfjs-assets.mts'
import { ocrAssets } from './scripts/ocr-assets.mts'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const localModelOrigin = 'http://127.0.0.1:5173'
const localModelPrefix = '/__model_gateway'

export default defineConfig({
  cacheDir: process.env.MOJIAN_VITE_CACHE_DIR,
  plugins: [vue(), pdfjsAssets(path.join(rootDir, 'node_modules/pdfjs-dist')), ocrAssets(rootDir), {
    name: 'local-model-gateway-origin-guard',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith(localModelPrefix + '/')) return next()
        const sameOrigin = request.headers.origin === localModelOrigin
          || (!request.headers.origin && request.headers['sec-fetch-site'] === 'same-origin')
        if (request.headers.host !== '127.0.0.1:5173' || !sameOrigin) {
          response.writeHead(403); response.end('Local model requests require the MoJian development origin.'); return
        }
        if (!/^\/__model_gateway\/v1\/(models|chat\/completions|responses|messages|embeddings)$/.test(request.url)) {
          response.writeHead(404); response.end('Unsupported local model endpoint.'); return
        }
        next()
      })
    },
  }],
  base: './',
  server: {
    watch: { ignored: ['**/.local-recovery/**', '**/.compare/**', '**/release/**'] },
    // Same-origin development transport; the separate gateway has a fixed
    // HTTPS provider and never stores credentials. Production CSP is unchanged.
    proxy: {
      [localModelPrefix + '/']: {
        target: 'http://127.0.0.1:5174',
        changeOrigin: true,
        rewrite: pathname => pathname.slice(localModelPrefix.length),
        configure(proxy) {
          proxy.on('proxyReq', request => {
            request.setHeader('Origin', localModelOrigin)
            request.removeHeader('cookie')
          })
        },
      },
    },
  },
  optimizeDeps: {
    include: [
      '@tiptap/vue-3', '@tiptap/core', '@tiptap/extension-document', '@tiptap/extension-paragraph',
      '@tiptap/extension-text', '@tiptap/extensions', '@tiptap/pm/state', '@tiptap/pm/view', '@tiptap/pm/model',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/vue/') || id.includes('/node_modules/vue-router/') || id.includes('/node_modules/pinia/')) return 'vue-core'
          if (id.includes('/node_modules/sql.js/')) return 'sqlite'
          return undefined
        },
      },
    },
  },
})
