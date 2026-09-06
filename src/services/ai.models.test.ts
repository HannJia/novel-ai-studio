import { afterEach, describe, expect, it, vi } from 'vitest'
import { listAvailableModels, openAiV1BaseUrl } from './ai'

afterEach(() => vi.unstubAllGlobals())

describe('OpenAI 兼容模型发现', () => {
  it('规范化根地址和已带 v1 的地址', () => {
    expect(openAiV1BaseUrl('https://example.test')).toBe('https://example.test/v1')
    expect(openAiV1BaseUrl('https://example.test/v1/')).toBe('https://example.test/v1')
    expect(openAiV1BaseUrl('')).toBe('')
  })

  it('从 /models 响应提取、去重并排序模型', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [
        { id: 'claude-sonnet-5', owned_by: 'anthropic' },
        { id: 'gpt-4o' },
        { id: 'claude-sonnet-5' },
        { id: '' },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const models = await listAvailableModels({ baseUrl: 'https://api.example.test/v1/', apiKey: 'sk-test' })
    expect(models.map(model => model.id)).toEqual(['claude-sonnet-5', 'gpt-4o'])
    expect(models[0].ownedBy).toBe('anthropic')
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.test/v1/models', expect.objectContaining({
      method: 'GET',
      headers: { Authorization: 'Bearer sk-test' },
    }))
  })

  it('未填写地址或密钥时不发起请求', async () => {
    await expect(listAvailableModels({ baseUrl: '', apiKey: 'sk-test' })).rejects.toThrow('API Base URL')
    await expect(listAvailableModels({ baseUrl: 'https://api.example.test', apiKey: '' })).rejects.toThrow('API Key')
  })

  it('服务返回错误时保留状态码和简短原因', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('invalid key', { status: 401 })))
    await expect(listAvailableModels({ baseUrl: 'https://api.example.test', apiKey: 'sk-test' }))
      .rejects.toThrow('获取模型失败（401）')
  })
})
