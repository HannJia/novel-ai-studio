import { defineConfig } from 'vitest/config'
import path from 'path'
import { availableParallelism } from 'node:os'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'node',
    // Real fsync/child-process tests share the host with Vue transforms. On
    // Windows, CPU-count fan-out caused disk tests to miss unchanged deadlines.
    // Keep parallel files and the explicit multi-process/CAS cases; the CLI can
    // override this resource cap for stress diagnostics.
    maxWorkers: process.platform === 'win32' ? Math.min(4, availableParallelism()) : undefined,
    exclude: ['.compare/**', '.local-recovery/**', 'node_modules/**', 'scripts/model-team/*.test.cjs'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
