/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

// Electron API类型声明
interface ElectronAPI {
  fs: {
    readFile: (path: string) => Promise<string>
    writeFile: (path: string, content: string) => Promise<void>
    exists: (path: string) => Promise<boolean>
    mkdir: (path: string) => Promise<void>
    readDir: (path: string) => Promise<Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>>
    stat: (path: string) => Promise<{ isFile: boolean; isDirectory: boolean; size: number; mtime: string; ctime: string }>
    delete: (path: string) => Promise<void>
    rename: (oldPath: string, newPath: string) => Promise<void>
    copy: (src: string, dest: string) => Promise<void>
  }
  app: {
    getPath: (name: string) => Promise<string>
    getVersion: () => Promise<string>
  }
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
