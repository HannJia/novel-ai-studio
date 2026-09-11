import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useConfigStore } from './config'

function storage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size },
  }
}

const local = storage()
const session = storage()

function setBrowserLocation(hostname = '') {
  Object.defineProperty(globalThis, 'window', {
    value: { electronAPI: undefined, location: { hostname } },
    configurable: true,
  })
}

beforeEach(() => {
  local.clear()
  session.clear()
  setBrowserLocation()
  Object.defineProperty(globalThis, 'localStorage', { value: local, configurable: true })
  Object.defineProperty(globalThis, 'sessionStorage', { value: session, configurable: true })
  setActivePinia(createPinia())
})

describe('模型密钥存储', () => {
  it('浏览器模式持久化脱敏配置并把密钥留在会话中', async () => {
    const store = useConfigStore()
    store.addModel({
      name: '测试模型', baseUrl: 'https://example.test', apiKey: 'session-secret', modelName: 'test-model',
      maxTokens: 4096, temperature: 0.7, topP: 0.9,
    })
    await store.saveConfig()

    expect(local.getItem('novel-writer-config')).not.toContain('session-secret')
    expect(session.getItem('novel-writer-session-secrets')).toContain('session-secret')
    expect(store.securityStatus.storage).toBe('session-only')
  })

  it('加载旧版明文配置时自动迁移并保持本次会话可用', async () => {
    local.setItem('novel-writer-config', JSON.stringify({
      models: [{
        id: 'legacy', name: '旧配置', baseUrl: 'https://example.test', apiKey: 'legacy-secret', modelName: 'test-model',
        maxTokens: 4096, temperature: 0.7, topP: 0.9,
      }],
      assignments: { writing: 'legacy' },
    }))
    const store = useConfigStore()
    await store.loadConfig()

    expect(store.models[0].apiKey).toBe('legacy-secret')
    expect(local.getItem('novel-writer-config')).not.toContain('legacy-secret')
    expect(session.getItem('novel-writer-session-secrets')).toContain('legacy-secret')
  })
})

describe('本地开发环境', () => {
  it('在本机 Vite 地址持久化 API Key，重载后仍可用', async () => {
    setBrowserLocation('127.0.0.1')
    const store = useConfigStore()
    store.addModel({
      name: '本地开发模型', baseUrl: 'https://example.test', apiKey: 'local-dev-secret', modelName: 'test-model',
      maxTokens: 4096, temperature: 0.7, topP: 0.9,
    })
    await store.saveConfig()

    expect(local.getItem('novel-writer-config')).toContain('local-dev-secret')
    expect(store.securityStatus.storage).toBe('local-development')

    setActivePinia(createPinia())
    const restored = useConfigStore()
    await restored.loadConfig()
    expect(restored.models[0].apiKey).toBe('local-dev-secret')
    expect(restored.securityStatus.storage).toBe('local-development')
  })

  it('本地开发环境可从会话密钥恢复旧版脱敏配置', async () => {
    setBrowserLocation('localhost')
    local.setItem('novel-writer-config', JSON.stringify({
      models: [{
        id: 'redacted', name: '旧配置', baseUrl: 'https://example.test', apiKey: '', modelName: 'test-model',
        maxTokens: 4096, temperature: 0.7, topP: 0.9,
      }],
      assignments: { writing: 'redacted' },
    }))
    session.setItem('novel-writer-session-secrets', JSON.stringify({
      models: { redacted: 'recovered-secret' },
      embedding: '',
    }))

    const store = useConfigStore()
    await store.loadConfig()

    expect(store.models[0].apiKey).toBe('recovered-secret')
    expect(store.securityStatus.storage).toBe('local-development')
  })
})

describe('对话 / 联网模型分配', () => {
  function addModels() {
    const store = useConfigStore()
    const data = { name: '测试', baseUrl: 'https://example.test', apiKey: 'session-secret',
      maxTokens: 4096, temperature: 0.7, topP: 0.9 }
    const first = store.addModel({ ...data, modelName: 'first' })
    const outline = store.addModel({ ...data, modelName: 'outline' })
    const chat = store.addModel({ ...data, modelName: 'chat' })
    return { store, first, outline, chat }
  }

  it('defaults to following the outline assignment dynamically, not the writing or first model', async () => {
    const { store, first, outline } = addModels()
    expect(store.assignments.chat).toBe('')
    store.setAssignment('outline', outline.id)
    expect(store.getModelForTask('chat')?.id).toBe(outline.id)
    expect(store.getModelForTask('writing')?.id).toBe(first.id)
    store.setAssignment('outline', first.id)
    expect(store.getModelForTask('chat')?.id).toBe(first.id)
    await store.saveConfig()
  })

  it('persists an explicit chat choice without changing outline/writing/review or persisting secrets', async () => {
    const { store, first, outline, chat } = addModels()
    store.setAssignment('outline', outline.id)
    store.setAssignment('chat', chat.id)
    await store.saveConfig()
    setActivePinia(createPinia())
    const restored = useConfigStore()
    await restored.loadConfig()
    expect(restored.getModelForTask('chat')?.id).toBe(chat.id)
    expect(restored.getModelForTask('outline')?.id).toBe(outline.id)
    expect(restored.getModelForTask('writing')?.id).toBe(first.id)
    expect(restored.getModelForTask('review')?.id).toBe(first.id)
    expect(local.getItem('novel-writer-config')).not.toContain('session-secret')
    restored.setAssignment('chat', '')
    expect(restored.getModelForTask('chat')?.id).toBe(outline.id)
    await restored.saveConfig()
  })

  it('deleting the chosen chat model restores outline-following rather than first-model fallback', async () => {
    const { store, outline, chat } = addModels()
    store.setAssignment('outline', outline.id)
    store.setAssignment('chat', chat.id)
    store.deleteModel(chat.id)
    expect(store.assignments.chat).toBe('')
    expect(store.getModelForTask('chat')?.id).toBe(outline.id)
    await store.saveConfig()
  })

  it.each([undefined, 'deleted-model'])('loads missing or stale chat assignments safely: %s', async chat => {
    const { store, outline } = addModels()
    await store.saveConfig()
    const saved = JSON.parse(local.getItem('novel-writer-config')!)
    saved.assignments = { ...saved.assignments, outline: outline.id, chat }
    local.setItem('novel-writer-config', JSON.stringify(saved))
    setActivePinia(createPinia())
    const restored = useConfigStore()
    await restored.loadConfig()
    expect(restored.getModelForTask('chat')?.id).toBe(outline.id)
    expect(restored.assignments.chat).toBe('')
  })
})
