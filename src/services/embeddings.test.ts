import { afterEach, describe, expect, it, vi } from 'vitest'
import { embedTextsWithProvider, embeddingEndpoint } from './embeddings'
import type { EmbeddingConfig } from '@/stores/config'

const config: EmbeddingConfig = {
  enabled: true,
  baseUrl: 'http://127.0.0.1:11434/v1/',
  apiKey: '',
  modelName: 'bge-m3',
  batchSize: 2,
}

afterEach(() => vi.unstubAllGlobals())

describe('Embedding 服务', () => {
  it('规范化 OpenAI 兼容接口地址', () => {
    expect(embeddingEndpoint('http://127.0.0.1:11434/v1/')).toBe('http://127.0.0.1:11434/v1/embeddings')
    expect(embeddingEndpoint('https://example.com')).toBe('https://example.com/v1/embeddings')
  })

  it('按批次请求并归一化向量', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { input: string[] }
      return new Response(JSON.stringify({
        data: body.input.map((_, index) => ({ index, embedding: index === 0 ? [3, 4] : [0, 2] })),
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const vectors = await embedTextsWithProvider(config, ['a', 'b', 'c'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(vectors).toHaveLength(3)
    expect(vectors[0]).toEqual([0.6, 0.8])
    expect(vectors[1]).toEqual([0, 1])
  })
})
