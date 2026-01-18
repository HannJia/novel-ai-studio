/**
 * 应用相关 IPC 处理器
 * 处理应用信息、路径等
 */
import { ipcMain, app } from 'electron'

export function registerAppHandlers(): void {
  // 获取应用路径
  ipcMain.handle('app:getPath', async (_event, name: string) => {
    return app.getPath(name as Parameters<typeof app.getPath>[0])
  })

  // 获取应用版本
  ipcMain.handle('app:getVersion', async () => {
    return app.getVersion()
  })

  // 获取应用名称
  ipcMain.handle('app:getName', async () => {
    return app.getName()
  })

  // 获取应用是否打包
  ipcMain.handle('app:isPackaged', async () => {
    return app.isPackaged
  })
}
