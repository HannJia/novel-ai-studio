import { mergeConfig } from 'vite'
import base from '../../vite.config.mts'

export default mergeConfig(base, {
  server: {
    host: '127.0.0.1', port: 5175, strictPort: true,
    proxy: { '/__fixture': { target: 'http://127.0.0.1:5185', rewrite: path => path.replace(/^\/__fixture/, '') } },
  },
})
