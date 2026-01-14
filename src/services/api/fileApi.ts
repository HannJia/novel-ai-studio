/**
 * 文件上传 API 服务
 */
import { upload, del } from './index'

/**
 * 上传封面响应
 */
export interface UploadCoverResponse {
  url: string
  filename: string
}

/**
 * 上传书籍封面
 */
export async function uploadCover(file: File): Promise<UploadCoverResponse> {
  return upload<UploadCoverResponse>('/files/cover', file)
}

/**
 * 删除书籍封面
 */
export async function deleteCover(filename: string): Promise<void> {
  return del<void>(`/files/cover/${filename}`)
}

/**
 * 获取封面完整 URL
 */
export function getCoverUrl(url: string): string {
  if (!url) return ''
  // 如果已经是完整URL，直接返回
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url
  }
  // 否则拼接API前缀
  return url
}
