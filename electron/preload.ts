import { contextBridge, ipcRenderer } from 'electron'

// 文件系统API
const fsAPI = {
  readFile: (path: string): Promise<string> => ipcRenderer.invoke('fs:readFile', path),
  writeFile: (path: string, content: string): Promise<void> => ipcRenderer.invoke('fs:writeFile', path, content),
  exists: (path: string): Promise<boolean> => ipcRenderer.invoke('fs:exists', path),
  mkdir: (path: string): Promise<void> => ipcRenderer.invoke('fs:mkdir', path),
  readDir: (path: string): Promise<Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>> =>
    ipcRenderer.invoke('fs:readDir', path),
  stat: (path: string): Promise<{ isFile: boolean; isDirectory: boolean; size: number; mtime: string; ctime: string }> =>
    ipcRenderer.invoke('fs:stat', path),
  delete: (path: string): Promise<void> => ipcRenderer.invoke('fs:delete', path),
  rename: (oldPath: string, newPath: string): Promise<void> => ipcRenderer.invoke('fs:rename', oldPath, newPath),
  copy: (src: string, dest: string): Promise<void> => ipcRenderer.invoke('fs:copy', src, dest)
}

// 应用API
const appAPI = {
  getPath: (name: string): Promise<string> => ipcRenderer.invoke('app:getPath', name),
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion')
}

// 暴露API到渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  fs: fsAPI,
  app: appAPI
})

// 类型声明
export type ElectronAPI = {
  fs: typeof fsAPI
  app: typeof appAPI
}
