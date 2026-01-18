/**
 * 文件系统 IPC 处理器
 * 处理文件读写、目录操作等
 */
import { ipcMain } from 'electron'

export function registerFileHandlers(): void {
  // 读取文件
  ipcMain.handle('fs:readFile', async (_event, path: string) => {
    const fs = await import('fs/promises')
    return fs.readFile(path, 'utf-8')
  })

  // 写入文件
  ipcMain.handle('fs:writeFile', async (_event, path: string, content: string) => {
    const fs = await import('fs/promises')
    return fs.writeFile(path, content, 'utf-8')
  })

  // 检查文件是否存在
  ipcMain.handle('fs:exists', async (_event, path: string) => {
    const fs = await import('fs/promises')
    try {
      await fs.access(path)
      return true
    } catch {
      return false
    }
  })

  // 创建目录
  ipcMain.handle('fs:mkdir', async (_event, path: string) => {
    const fs = await import('fs/promises')
    return fs.mkdir(path, { recursive: true })
  })

  // 读取目录
  ipcMain.handle('fs:readDir', async (_event, path: string) => {
    const fs = await import('fs/promises')
    return fs.readdir(path, { withFileTypes: true })
  })

  // 获取文件状态
  ipcMain.handle('fs:stat', async (_event, path: string) => {
    const fs = await import('fs/promises')
    const stat = await fs.stat(path)
    return {
      isFile: stat.isFile(),
      isDirectory: stat.isDirectory(),
      size: stat.size,
      mtime: stat.mtime.toISOString(),
      ctime: stat.ctime.toISOString()
    }
  })

  // 删除文件或目录
  ipcMain.handle('fs:delete', async (_event, path: string) => {
    const fs = await import('fs/promises')
    return fs.rm(path, { recursive: true, force: true })
  })

  // 重命名文件
  ipcMain.handle('fs:rename', async (_event, oldPath: string, newPath: string) => {
    const fs = await import('fs/promises')
    return fs.rename(oldPath, newPath)
  })

  // 复制文件
  ipcMain.handle('fs:copy', async (_event, src: string, dest: string) => {
    const fs = await import('fs/promises')
    return fs.copyFile(src, dest)
  })
}
