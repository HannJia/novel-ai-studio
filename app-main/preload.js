// 预加载脚本 - 桥接主进程和渲染进程
const { contextBridge, ipcRenderer } = require('electron')

// 向渲染进程暴露安全的 API
contextBridge.exposeInMainWorld('electronAPI', {
  getVersion: () => process.versions.electron,
  // 数据库文件操作
  dbRead: () => ipcRenderer.invoke('db:read'),
  dbReadBackup: () => ipcRenderer.invoke('db:readBackup'),
  dbPrepareRecovery: () => ipcRenderer.invoke('db:prepareRecovery'),
  dbRetainProjectBackup: (serialized) => ipcRenderer.invoke('db:retainProjectBackup', serialized),
  dbWrite: (data) => ipcRenderer.invoke('db:write', data),
  dbGetPath: () => ipcRenderer.invoke('db:getPath'),
  // 配置文件操作
  configRead: () => ipcRenderer.invoke('config:read'),
  configWrite: (data) => ipcRenderer.invoke('config:write', data),
  configEncrypt: (value) => ipcRenderer.invoke('config:encrypt', value),
  configDecrypt: (value) => ipcRenderer.invoke('config:decrypt', value),
  configSecurityStatus: () => ipcRenderer.invoke('config:security-status'),
  cloudSessionRead: () => ipcRenderer.invoke('cloud-session:read'),
  cloudSessionWrite: (value) => ipcRenderer.invoke('cloud-session:write', value),
  updateGetState: () => ipcRenderer.invoke('update:state'),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateWake: () => ipcRenderer.invoke('update:wake'),
  updateDownload: () => ipcRenderer.invoke('update:download'),
  updateCancel: () => ipcRenderer.invoke('update:cancel'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  updateSetAutoCheck: (enabled) => ipcRenderer.invoke('update:auto-check', enabled),
  updateOpenRelease: () => ipcRenderer.invoke('update:open-release'),
  onUpdateState: (callback) => {
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('update:state', listener)
    return () => ipcRenderer.removeListener('update:state', listener)
  },
  onBeforeUpdate: (callback) => {
    const listener = (_event, { requestId }) => {
      Promise.resolve().then(callback)
        .then(() => ipcRenderer.send('app:update-ready', { requestId, ok: true }))
        .catch(error => ipcRenderer.send('app:update-ready', {
          requestId, ok: false, error: error instanceof Error ? error.message : String(error),
        }))
    }
    ipcRenderer.on('app:before-update', listener)
    return () => ipcRenderer.removeListener('app:before-update', listener)
  },
  onBeforeClose: (callback) => {
    const listener = () => {
      Promise.resolve()
        .then(callback)
        .then(() => ipcRenderer.send('app:close-ready', { ok: true }))
        .catch((error) => ipcRenderer.send('app:close-ready', {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }))
    }
    ipcRenderer.on('app:before-close', listener)
    return () => ipcRenderer.removeListener('app:before-close', listener)
  },
})
