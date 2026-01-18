/**
 * HTTP请求工具
 * 封装axios实例，提供统一的请求方法
 */
import axios from 'axios'
import type { AxiosInstance, AxiosResponse } from 'axios'
import type { ApiResponse } from '@/types'

// 创建axios实例
const request: AxiosInstance = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
})

// 请求拦截器
request.interceptors.request.use(
  (config) => {
    // 可以在这里添加token等认证信息
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// 响应拦截器
request.interceptors.response.use(
  (response: AxiosResponse<ApiResponse>) => {
    const data = response.data
    if (data.code !== 200) {
      return Promise.reject(new Error(data.message || '请求失败'))
    }
    return response
  },
  (error) => {
    const message = error.response?.data?.message || error.message || '网络错误'
    return Promise.reject(new Error(message))
  }
)

// 封装请求方法
const requestWrapper = {
  async get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
    const response = await request.get<ApiResponse<T>>(url, { params })
    return response.data.data
  },

  async post<T>(url: string, data?: unknown): Promise<T> {
    const response = await request.post<ApiResponse<T>>(url, data)
    return response.data.data
  },

  async put<T>(url: string, data?: unknown): Promise<T> {
    const response = await request.put<ApiResponse<T>>(url, data)
    return response.data.data
  },

  async delete<T>(url: string): Promise<T> {
    const response = await request.delete<ApiResponse<T>>(url)
    return response.data.data
  }
}

export default requestWrapper
