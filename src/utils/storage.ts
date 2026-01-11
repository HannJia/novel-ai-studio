/**
 * 本地存储工具
 */

const STORAGE_PREFIX = 'novel_ai_studio_'

/**
 * 存储数据
 * @param key 存储键
 * @param value 存储值
 */
export function setStorage<T>(key: string, value: T): void {
  try {
    const serialized = JSON.stringify(value)
    localStorage.setItem(STORAGE_PREFIX + key, serialized)
  } catch (error) {
    console.error('Failed to save to localStorage:', error)
  }
}

/**
 * 获取存储数据
 * @param key 存储键
 * @param defaultValue 默认值
 * @returns 存储值或默认值
 */
export function getStorage<T>(key: string, defaultValue: T): T {
  try {
    const serialized = localStorage.getItem(STORAGE_PREFIX + key)
    if (serialized === null) {
      return defaultValue
    }
    return JSON.parse(serialized) as T
  } catch (error) {
    console.error('Failed to read from localStorage:', error)
    return defaultValue
  }
}

/**
 * 删除存储数据
 * @param key 存储键
 */
export function removeStorage(key: string): void {
  localStorage.removeItem(STORAGE_PREFIX + key)
}

/**
 * 清除所有存储数据
 */
export function clearStorage(): void {
  const keys = Object.keys(localStorage)
  keys.forEach((key) => {
    if (key.startsWith(STORAGE_PREFIX)) {
      localStorage.removeItem(key)
    }
  })
}

/**
 * 获取所有存储键
 * @returns 存储键数组
 */
export function getStorageKeys(): string[] {
  const keys = Object.keys(localStorage)
  return keys
    .filter((key) => key.startsWith(STORAGE_PREFIX))
    .map((key) => key.slice(STORAGE_PREFIX.length))
}

/**
 * 检查存储键是否存在
 * @param key 存储键
 * @returns 是否存在
 */
export function hasStorage(key: string): boolean {
  return localStorage.getItem(STORAGE_PREFIX + key) !== null
}

/**
 * 获取存储使用量
 * @returns 使用量（字节）
 */
export function getStorageSize(): number {
  let size = 0
  const keys = Object.keys(localStorage)
  keys.forEach((key) => {
    if (key.startsWith(STORAGE_PREFIX)) {
      const value = localStorage.getItem(key) || ''
      size += key.length + value.length
    }
  })
  return size * 2 // UTF-16
}
