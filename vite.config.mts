import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pdfjsAssets } from './scripts/pdfjs-assets.mts'
import { ocrAssets } from './scripts/ocr-assets.mts'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [vue(), pdfjsAssets(path.join(rootDir, 'node_modules/pdfjs-dist')), ocrAssets(rootDir)],
  base: './',
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
