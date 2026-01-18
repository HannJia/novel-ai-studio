/**
 * AI 相关 IPC 处理器
 * 预留给未来的本地 AI 模型调用
 * 当前项目 AI 调用通过后端服务进行
 */
import { ipcMain } from 'electron'

export function registerAIHandlers(): void {
  // 预留：本地 Ollama 模型调用
  // 当需要直接从 Electron 调用本地模型时使用

  // 检查本地 Ollama 服务是否可用
  ipcMain.handle('ai:checkOllama', async () => {
    try {
      const response = await fetch('http://localhost:11434/api/tags')
      return response.ok
    } catch {
      return false
    }
  })

  // 获取本地 Ollama 模型列表
  ipcMain.handle('ai:listOllamaModels', async () => {
    try {
      const response = await fetch('http://localhost:11434/api/tags')
      if (response.ok) {
        const data = await response.json()
        return data.models || []
      }
      return []
    } catch {
      return []
    }
  })
}
