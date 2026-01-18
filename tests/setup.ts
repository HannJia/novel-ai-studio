/**
 * 测试环境配置
 * 在所有测试运行前执行的设置
 */

import { beforeAll, afterAll, vi } from 'vitest'

// 模拟 Electron API
vi.mock('electron', () => ({
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    send: vi.fn()
  },
  contextBridge: {
    exposeInMainWorld: vi.fn()
  }
}))

// 模拟 window.electronAPI
const mockElectronAPI = {
  fs: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    exists: vi.fn(),
    mkdir: vi.fn(),
    readDir: vi.fn(),
    stat: vi.fn(),
    delete: vi.fn(),
    rename: vi.fn(),
    copy: vi.fn()
  },
  app: {
    getPath: vi.fn(),
    getVersion: vi.fn()
  }
}

beforeAll(() => {
  // 设置全局 electronAPI
  Object.defineProperty(window, 'electronAPI', {
    value: mockElectronAPI,
    writable: true
  })
})

afterAll(() => {
  // 清理
  vi.clearAllMocks()
})

// 导出 mock 对象供测试使用
export { mockElectronAPI }
