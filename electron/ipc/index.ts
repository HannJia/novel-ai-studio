/**
 * IPC 处理器入口
 * 统一注册所有 IPC 通信处理器
 */
import { registerFileHandlers } from './file'
import { registerAppHandlers } from './app'
import { registerDatabaseHandlers } from './database'
import { registerAIHandlers } from './ai'

/**
 * 注册所有 IPC 处理器
 */
export function registerAllHandlers(): void {
  // 文件系统处理器
  registerFileHandlers()

  // 应用信息处理器
  registerAppHandlers()

  // 数据库处理器（预留）
  registerDatabaseHandlers()

  // AI 处理器（预留）
  registerAIHandlers()
}

// 导出各模块
export { registerFileHandlers } from './file'
export { registerAppHandlers } from './app'
export { registerDatabaseHandlers } from './database'
export { registerAIHandlers } from './ai'
