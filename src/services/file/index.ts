/**
 * 文件系统服务
 * 封装Electron IPC调用，提供统一的文件操作接口
 */

/**
 * 文件信息接口
 */
export interface FileInfo {
  name: string
  path: string
  isFile: boolean
  isDirectory: boolean
  size: number
  mtime: string
  ctime: string
}

/**
 * 目录项接口
 */
export interface DirectoryEntry {
  name: string
  isFile: boolean
  isDirectory: boolean
}

/**
 * 检查是否在Electron环境中
 */
function isElectron(): boolean {
  return typeof window !== 'undefined' && typeof window.electronAPI !== 'undefined'
}

/**
 * 读取文件内容
 * @param path 文件路径
 * @returns 文件内容
 */
export async function readFile(path: string): Promise<string> {
  if (!isElectron()) {
    throw new Error('文件操作仅在Electron环境中可用')
  }
  return window.electronAPI.fs.readFile(path)
}

/**
 * 写入文件内容
 * @param path 文件路径
 * @param content 文件内容
 */
export async function writeFile(path: string, content: string): Promise<void> {
  if (!isElectron()) {
    throw new Error('文件操作仅在Electron环境中可用')
  }
  return window.electronAPI.fs.writeFile(path, content)
}

/**
 * 检查文件或目录是否存在
 * @param path 路径
 * @returns 是否存在
 */
export async function exists(path: string): Promise<boolean> {
  if (!isElectron()) {
    throw new Error('文件操作仅在Electron环境中可用')
  }
  return window.electronAPI.fs.exists(path)
}

/**
 * 创建目录
 * @param path 目录路径
 */
export async function mkdir(path: string): Promise<void> {
  if (!isElectron()) {
    throw new Error('文件操作仅在Electron环境中可用')
  }
  return window.electronAPI.fs.mkdir(path)
}

/**
 * 读取目录内容
 * @param path 目录路径
 * @returns 目录项列表
 */
export async function readDir(path: string): Promise<DirectoryEntry[]> {
  if (!isElectron()) {
    throw new Error('文件操作仅在Electron环境中可用')
  }
  const entries = await window.electronAPI.fs.readDir(path)
  return entries.map(entry => ({
    name: entry.name,
    isFile: entry.isFile(),
    isDirectory: entry.isDirectory()
  }))
}

/**
 * 获取文件/目录信息
 * @param path 路径
 * @returns 文件信息
 */
export async function stat(path: string): Promise<FileInfo> {
  if (!isElectron()) {
    throw new Error('文件操作仅在Electron环境中可用')
  }
  const info = await window.electronAPI.fs.stat(path)
  const name = path.split(/[/\\]/).pop() || ''
  return {
    name,
    path,
    ...info
  }
}

/**
 * 删除文件或目录
 * @param path 路径
 */
export async function remove(path: string): Promise<void> {
  if (!isElectron()) {
    throw new Error('文件操作仅在Electron环境中可用')
  }
  return window.electronAPI.fs.delete(path)
}

/**
 * 重命名文件或目录
 * @param oldPath 原路径
 * @param newPath 新路径
 */
export async function rename(oldPath: string, newPath: string): Promise<void> {
  if (!isElectron()) {
    throw new Error('文件操作仅在Electron环境中可用')
  }
  return window.electronAPI.fs.rename(oldPath, newPath)
}

/**
 * 复制文件
 * @param src 源路径
 * @param dest 目标路径
 */
export async function copy(src: string, dest: string): Promise<void> {
  if (!isElectron()) {
    throw new Error('文件操作仅在Electron环境中可用')
  }
  return window.electronAPI.fs.copy(src, dest)
}

/**
 * 获取应用路径
 * @param name 路径名称
 * @returns 路径字符串
 */
export async function getAppPath(name: string): Promise<string> {
  if (!isElectron()) {
    throw new Error('文件操作仅在Electron环境中可用')
  }
  return window.electronAPI.app.getPath(name)
}

/**
 * 获取应用版本
 * @returns 版本字符串
 */
export async function getAppVersion(): Promise<string> {
  if (!isElectron()) {
    return '1.0.0'
  }
  return window.electronAPI.app.getVersion()
}

/**
 * 获取用户数据目录
 * @returns 用户数据目录路径
 */
export async function getUserDataPath(): Promise<string> {
  return getAppPath('userData')
}

/**
 * 获取文档目录
 * @returns 文档目录路径
 */
export async function getDocumentsPath(): Promise<string> {
  return getAppPath('documents')
}

/**
 * 递归读取目录
 * @param path 目录路径
 * @param maxDepth 最大深度
 * @returns 文件信息列表
 */
export async function readDirRecursive(
  path: string,
  maxDepth: number = 10
): Promise<FileInfo[]> {
  const result: FileInfo[] = []

  async function traverse(currentPath: string, depth: number): Promise<void> {
    if (depth > maxDepth) return

    const entries = await readDir(currentPath)

    for (const entry of entries) {
      const fullPath = `${currentPath}/${entry.name}`
      const info = await stat(fullPath)
      result.push(info)

      if (entry.isDirectory) {
        await traverse(fullPath, depth + 1)
      }
    }
  }

  await traverse(path, 0)
  return result
}

/**
 * 确保目录存在
 * @param path 目录路径
 */
export async function ensureDir(path: string): Promise<void> {
  const pathExists = await exists(path)
  if (!pathExists) {
    await mkdir(path)
  }
}

/**
 * 读取JSON文件
 * @param path 文件路径
 * @returns 解析后的对象
 */
export async function readJSON<T>(path: string): Promise<T> {
  const content = await readFile(path)
  return JSON.parse(content) as T
}

/**
 * 写入JSON文件
 * @param path 文件路径
 * @param data 要写入的数据
 * @param pretty 是否格式化
 */
export async function writeJSON<T>(
  path: string,
  data: T,
  pretty: boolean = true
): Promise<void> {
  const content = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data)
  await writeFile(path, content)
}

/**
 * 获取文件扩展名
 * @param path 文件路径
 * @returns 扩展名（不含点）
 */
export function getExtension(path: string): string {
  const parts = path.split('.')
  if (parts.length < 2) return ''
  return parts[parts.length - 1].toLowerCase()
}

/**
 * 获取文件名（不含扩展名）
 * @param path 文件路径
 * @returns 文件名
 */
export function getBasename(path: string): string {
  const name = path.split(/[/\\]/).pop() || ''
  const dotIndex = name.lastIndexOf('.')
  if (dotIndex === -1) return name
  return name.slice(0, dotIndex)
}

/**
 * 获取父目录路径
 * @param path 路径
 * @returns 父目录路径
 */
export function getParentDir(path: string): string {
  const parts = path.split(/[/\\]/)
  parts.pop()
  return parts.join('/')
}

/**
 * 连接路径
 * @param parts 路径部分
 * @returns 完整路径
 */
export function joinPath(...parts: string[]): string {
  return parts
    .map((part, index) => {
      if (index === 0) {
        return part.replace(/[/\\]+$/, '')
      }
      return part.replace(/^[/\\]+|[/\\]+$/g, '')
    })
    .filter(Boolean)
    .join('/')
}
