import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'

// 禁用硬件加速（可选，解决某些显卡兼容性问题）
// app.disableHardwareAcceleration()

// 单例锁
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  let mainWindow: BrowserWindow | null = null

  const createWindow = (): void => {
    mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 1200,
      minHeight: 700,
      title: 'NovelAI Studio',
      icon: join(__dirname, '../resources/icons/icon.png'),
      webPreferences: {
        preload: join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false
      },
      frame: true,
      show: false
    })

    // 窗口准备好后显示
    mainWindow.once('ready-to-show', () => {
      mainWindow?.show()
    })

    // 开发模式加载本地服务，生产模式加载打包文件
    if (process.env.VITE_DEV_SERVER_URL) {
      mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
      mainWindow.webContents.openDevTools()
    } else {
      mainWindow.loadFile(join(__dirname, '../dist/index.html'))
    }

    mainWindow.on('closed', () => {
      mainWindow = null
    })
  }

  // 应用准备就绪
  app.whenReady().then(() => {
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  })

  // 尝试打开第二个实例时，聚焦到主窗口
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
      mainWindow.focus()
    }
  })

  // 所有窗口关闭时退出（macOS除外）
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  // 注册IPC处理器
  // 文件系统相关
  ipcMain.handle('fs:readFile', async (_event, path: string) => {
    const fs = await import('fs/promises')
    return fs.readFile(path, 'utf-8')
  })

  ipcMain.handle('fs:writeFile', async (_event, path: string, content: string) => {
    const fs = await import('fs/promises')
    return fs.writeFile(path, content, 'utf-8')
  })

  ipcMain.handle('fs:exists', async (_event, path: string) => {
    const fs = await import('fs/promises')
    try {
      await fs.access(path)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('fs:mkdir', async (_event, path: string) => {
    const fs = await import('fs/promises')
    return fs.mkdir(path, { recursive: true })
  })

  ipcMain.handle('fs:readDir', async (_event, path: string) => {
    const fs = await import('fs/promises')
    return fs.readdir(path, { withFileTypes: true })
  })

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

  ipcMain.handle('fs:delete', async (_event, path: string) => {
    const fs = await import('fs/promises')
    return fs.rm(path, { recursive: true, force: true })
  })

  ipcMain.handle('fs:rename', async (_event, oldPath: string, newPath: string) => {
    const fs = await import('fs/promises')
    return fs.rename(oldPath, newPath)
  })

  ipcMain.handle('fs:copy', async (_event, src: string, dest: string) => {
    const fs = await import('fs/promises')
    return fs.copyFile(src, dest)
  })

  // 应用信息
  ipcMain.handle('app:getPath', async (_event, name: string) => {
    return app.getPath(name as Parameters<typeof app.getPath>[0])
  })

  ipcMain.handle('app:getVersion', async () => {
    return app.getVersion()
  })
}
