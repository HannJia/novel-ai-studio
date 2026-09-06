import type { EmbeddingConfig } from '@/stores/config'

const EMBEDDING_TIMEOUT = 120_000

export function embeddingEndpoint(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  return normalized.endsWith('/v1') ? `${normalized}/embeddings` : `${normalized}/v1/embeddings`
}

export function isRemoteEmbeddingEnabled(config?: Partial<EmbeddingConfig> | null): config is EmbeddingConfig {
  return Boolean(config?.enabled && config.baseUrl?.trim() && config.modelName?.trim())
}

function normalizeVector(vector: number[]): number[] {
  const values = vector.map(Number)
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1
  return values.map(value => Number((value / norm).toFixed(8)))
}

async function requestBatch(config: EmbeddingConfig, inputs: string[]): Promise<number[][]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('Embedding 请求超时')), EMBEDDING_TIMEOUT)
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (config.apiKey.trim()) headers.Authorization = `Bearer ${config.apiKey.trim()}`
    const response = await fetch(embeddingEndpoint(config.baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: config.modelName.trim(), input: inputs, encoding_format: 'float' }),
      signal: controller.signal,
    })
    if (!response.ok) {
      const detail = await response.text()
      throw new Error(`Embedding API 请求失败 (${response.status}): ${detail.slice(0, 500)}`)
    }
    const payload = await response.json() as { data?: Array<{ index?: number; embedding?: number[] }> }
    if (!Array.isArray(payload.data) || payload.data.length !== inputs.length) {
      throw new Error('Embedding API 返回的数据数量不正确')
    }
    return [...payload.data]
      .sort((a, b) => (a.index || 0) - (b.index || 0))
      .map(item => {
        if (!Array.isArray(item.embedding) || item.embedding.length === 0 || item.embedding.some(value => !Number.isFinite(Number(value)))) {
          throw new Error('Embedding API 返回了无效向量')
        }
        return normalizeVector(item.embedding)
      })
  } finally {
    clearTimeout(timer)
  }
}

export async function embedTextsWithProvider(config: EmbeddingConfig, inputs: string[]): Promise<number[][]> {
  if (!isRemoteEmbeddingEnabled(config)) throw new Error('Embedding 配置未启用或不完整')
  if (inputs.length === 0) return []
  const batchSize = Math.min(64, Math.max(1, Math.round(config.batchSize || 16)))
  const vectors: number[][] = []
  for (let index = 0; index < inputs.length; index += batchSize) {
    vectors.push(...await requestBatch(config, inputs.slice(index, index + batchSize)))
  }
  const dimensions = vectors[0]?.length || 0
  if (vectors.some(vector => vector.length !== dimensions)) {
    throw new Error('Embedding API 返回的向量维度不一致')
  }
  return vectors
}

export async function testEmbeddingConnection(config: EmbeddingConfig): Promise<{ dimensions: number; latency: number }> {
  const startedAt = Date.now()
  const [vector] = await embedTextsWithProvider(config, ['长篇小说语义记忆连接测试'])
  return { dimensions: vector.length, latency: Date.now() - startedAt }
}
