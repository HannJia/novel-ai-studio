/**
 * 错误处理工具
 */
import { ElMessage, ElMessageBox } from 'element-plus'

/**
 * 错误类型
 */
export enum ErrorType {
  NETWORK = 'network',
  API = 'api',
  VALIDATION = 'validation',
  UNKNOWN = 'unknown'
}

/**
 * 应用错误类
 */
export class AppError extends Error {
  type: ErrorType
  code?: number

  constructor(message: string, type: ErrorType = ErrorType.UNKNOWN, code?: number) {
    super(message)
    this.type = type
    this.code = code
    this.name = 'AppError'
  }
}

/**
 * 错误消息映射
 */
const errorMessages: Record<string, string> = {
  'Network Error': '网络连接失败，请检查网络设置',
  'timeout': '请求超时，请稍后重试',
  'Request failed with status code 401': '未授权，请重新登录',
  'Request failed with status code 403': '没有权限执行此操作',
  'Request failed with status code 404': '请求的资源不存在',
  'Request failed with status code 500': '服务器内部错误',
  'Request failed with status code 502': '服务器网关错误',
  'Request failed with status code 503': '服务暂时不可用',
}

/**
 * 解析错误消息
 */
function parseErrorMessage(error: unknown): string {
  if (error instanceof AppError) {
    return error.message
  }

  if (error instanceof Error) {
    // 检查是否有预定义的错误消息
    for (const [key, value] of Object.entries(errorMessages)) {
      if (error.message.includes(key)) {
        return value
      }
    }
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  return '发生未知错误'
}

/**
 * 显示错误消息
 */
export function showError(error: unknown, title?: string): void {
  const message = parseErrorMessage(error)

  if (title) {
    ElMessageBox.alert(message, title, {
      type: 'error',
      confirmButtonText: '确定'
    })
  } else {
    ElMessage.error(message)
  }
}

/**
 * 显示成功消息
 */
export function showSuccess(message: string): void {
  ElMessage.success(message)
}

/**
 * 显示警告消息
 */
export function showWarning(message: string): void {
  ElMessage.warning(message)
}

/**
 * 显示信息消息
 */
export function showInfo(message: string): void {
  ElMessage.info(message)
}

/**
 * 确认对话框
 */
export async function confirm(
  message: string,
  title: string = '确认',
  options?: {
    confirmButtonText?: string
    cancelButtonText?: string
    type?: 'warning' | 'info' | 'success' | 'error'
  }
): Promise<boolean> {
  try {
    await ElMessageBox.confirm(message, title, {
      confirmButtonText: options?.confirmButtonText || '确定',
      cancelButtonText: options?.cancelButtonText || '取消',
      type: options?.type || 'warning'
    })
    return true
  } catch {
    return false
  }
}

/**
 * 统一错误处理包装器
 * 用于包装异步操作，自动处理错误
 */
export async function handleAsync<T>(
  operation: () => Promise<T>,
  options?: {
    showError?: boolean
    errorTitle?: string
    successMessage?: string
    rethrow?: boolean
  }
): Promise<T | null> {
  try {
    const result = await operation()
    if (options?.successMessage) {
      showSuccess(options.successMessage)
    }
    return result
  } catch (error) {
    if (options?.showError !== false) {
      showError(error, options?.errorTitle)
    }
    if (options?.rethrow) {
      throw error
    }
    return null
  }
}

/**
 * 创建带错误处理的API调用
 */
export function withErrorHandling<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  errorTitle?: string
): T {
  return (async (...args: Parameters<T>) => {
    return handleAsync(() => fn(...args), { errorTitle })
  }) as T
}
