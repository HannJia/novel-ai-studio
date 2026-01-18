/**
 * 数据库相关 IPC 处理器
 * 预留给未来的本地数据库操作
 * 当前项目使用 MySQL 后端，此文件为扩展预留
 */
import { ipcMain } from 'electron'

export function registerDatabaseHandlers(): void {
  // 预留：本地 SQLite 数据库操作
  // 当需要离线功能时可以在这里实现

  // 示例：获取本地缓存数据
  ipcMain.handle('db:getCache', async (_event, key: string) => {
    // TODO: 实现本地缓存读取
    console.log('db:getCache', key)
    return null
  })

  // 示例：设置本地缓存数据
  ipcMain.handle('db:setCache', async (_event, key: string, value: unknown) => {
    // TODO: 实现本地缓存写入
    console.log('db:setCache', key, value)
    return true
  })
}
