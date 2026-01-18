import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { registerAllHandlers } from './ipc'

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
    // 注册所有 IPC 处理器
    registerAllHandlers()

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
}
