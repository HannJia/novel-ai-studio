import { defineConfig, mergeConfig } from 'vitest/config'
import base from './vitest.config'

export default mergeConfig(base, defineConfig({
  test: {
    include: ['src/test/cloudSync.http.acceptance.ts'],
    fileParallelism: false,
  },
}))
