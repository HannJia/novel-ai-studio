// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useConfigStore, type ModelConfig } from './config'
import { joinConfig, splitConfig, validatePublicSettings } from '@/services/configSync'

const makeModel = (kind: 'chat' | 'embedding' = 'chat'): Omit<ModelConfig, 'id'> => ({
  name: kind === 'embedding' ? '资料检索' : '日常写作', kind,
  baseUrl: 'https://example.test/v1', modelName: kind === 'embedding' ? 'synthetic-vector' : 'synthetic-chat',
  apiKey: 'synthetic-session-secret', maxTokens: 4096, temperature: 0.7, topP: 0.9,
})

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  setActivePinia(createPinia())
  vi.stubGlobal('window', { location: { hostname: 'writer.example.test' }, electronAPI: undefined })
})

afterEach(() => vi.unstubAllGlobals())

describe('统一模型的向量用途', () => {
  it('does not offer an embedding-only configuration to writing tasks', async () => {
    const store = useConfigStore()
    const vector = store.addModel(makeModel('embedding'))
    expect(store.assignments.outline).toBe('')
    expect(store.getModelForTask('writing')).toBeNull()
    expect(store.getModelForTask('chat')).toBeNull()
    expect(store.getModelForTask('embedding')?.id).toBe(vector.id)
    expect(store.embedding.enabled).toBe(false)
    const chat = store.addModel(makeModel())
    expect(store.getModelForTask('writing')?.id).toBe(chat.id)
    store.setAssignment('writing', vector.id)
    store.setAssignment('embedding', chat.id)
    expect(store.assignments.writing).toBe(chat.id)
    expect(store.assignments.embedding).toBe(vector.id)
    await store.saveConfig()
  })

  it('shares assigned connection changes and disables retrieval when the assignment is removed', async () => {
    const store = useConfigStore()
    const vector = store.addModel(makeModel('embedding'))
    store.updateEmbeddingConfig({ enabled: true, batchSize: 8 })
    store.updateModel(vector.id, { baseUrl: 'https://other.example.test/v1', modelName: 'second-vector', apiKey: 'replacement-synthetic-secret' })
    expect(store.embedding).toMatchObject({ enabled: true, batchSize: 8, baseUrl: 'https://other.example.test/v1', modelName: 'second-vector', apiKey: 'replacement-synthetic-secret' })
    store.setAssignment('embedding', '')
    store.updateEmbeddingConfig({ enabled: true })
    expect(store.embedding.enabled).toBe(false)
    expect(store.embedding.apiKey).toBe('')
    expect(store.getModelForTask('embedding')).toBeNull()
    await store.saveConfig()
    setActivePinia(createPinia())
    const restored = useConfigStore()
    await restored.loadConfig()
    expect(restored.assignments.embedding).toBe('')
    expect(restored.embedding.enabled).toBe(false)
  })

  it('does not silently switch to another vector service after deleting or changing the assigned model', async () => {
    const store = useConfigStore()
    const first = store.addModel(makeModel('embedding'))
    store.addModel({ ...makeModel('embedding'), baseUrl: 'https://second.example.test/v1' })
    store.updateEmbeddingConfig({ enabled: true })
    store.deleteModel(first.id)
    expect(store.getModelForTask('embedding')).toBeNull()
    expect(store.embedding.enabled).toBe(false)
    const remaining = store.models[0]
    store.setAssignment('embedding', remaining.id)
    store.updateModel(remaining.id, { kind: 'chat' })
    expect(store.getModelForTask('embedding')).toBeNull()
    expect(store.embedding.apiKey).toBe('')
    await store.saveConfig()
  })

  it('never returns an embedding model from malformed legacy chat assignments', async () => {
    const store = useConfigStore()
    localStorage.setItem('novel-writer-config', JSON.stringify({ models: [{ id: 'vector', ...makeModel('embedding') }], assignments: { outline: 'vector', writing: 'vector', review: 'vector', chat: 'vector' } }))
    await store.loadConfig()
    for (const task of ['outline', 'writing', 'review', 'chat'] as const) expect(store.getModelForTask(task)).toBeNull()
  })

  it('migrates configured legacy vectors once and keeps their key in the existing secret store', async () => {
    const store = useConfigStore()
    localStorage.setItem('novel-writer-config', JSON.stringify({ models: [], assignments: {}, embedding: {
      enabled: true, baseUrl: 'https://legacy.example.test/v1', modelName: 'legacy-vector', apiKey: 'legacy-synthetic-secret', batchSize: 4,
    } }))
    await store.loadConfig()
    const id = store.assignments.embedding
    expect(store.models).toHaveLength(1)
    expect(store.getModelForTask('embedding')).toMatchObject({ kind: 'embedding', apiKey: 'legacy-synthetic-secret', modelName: 'legacy-vector' })
    expect(store.embedding).toMatchObject({ enabled: true, batchSize: 4 })
    await store.saveConfig()
    expect(localStorage.getItem('novel-writer-config')).not.toContain('legacy-synthetic-secret')
    setActivePinia(createPinia())
    const restored = useConfigStore()
    await restored.loadConfig()
    expect(restored.models).toHaveLength(1)
    expect(restored.assignments.embedding).toBe(id)
    expect(restored.getModelForTask('embedding')?.apiKey).toBe('legacy-synthetic-secret')
  })

  it('does not create a default disabled vector model and preserves ordinary legacy models', async () => {
    const chat = { id: 'old-chat', ...makeModel() }
    delete chat.kind
    localStorage.setItem('novel-writer-config', JSON.stringify({ models: [chat], assignments: { outline: chat.id }, embedding: {
      enabled: false, baseUrl: 'http://127.0.0.1:11434', modelName: 'bge-m3', apiKey: '', batchSize: 16,
    } }))
    const store = useConfigStore()
    await store.loadConfig()
    expect(store.models).toEqual([chat])
    expect(store.assignments.embedding).toBe('')
    expect(store.getModelForTask('outline')?.id).toBe(chat.id)
  })

  it('round-trips model kinds and vector assignment through the cloud settings/secret split', async () => {
    const store = useConfigStore()
    store.addModel(makeModel())
    const vector = store.addModel(makeModel('embedding'))
    const original = store.exportConfig()
    const parts = splitConfig(original, 'fanqie')
    expect(JSON.stringify(parts.settings)).not.toContain('synthetic-session-secret')
    expect(parts.settings.assignments.embedding).toBe(vector.id)
    const joined = joinConfig(validatePublicSettings(JSON.parse(JSON.stringify(parts.settings))), parts.secrets)
    expect(joined.models).toEqual(original.models.map(item => item.kind === 'chat' ? (({ kind: _kind, ...rest }) => rest)(item) : item))
    expect(joined.assignments).toEqual(original.assignments)
    expect(() => validatePublicSettings({ ...parts.settings, assignments: { ...parts.settings.assignments, writing: vector.id } })).toThrow()
    expect(() => validatePublicSettings({ ...parts.settings, assignments: { ...parts.settings.assignments, embedding: store.models[0].id } })).toThrow()
    await store.saveConfig()
  })

  it('keeps ordinary chat configuration compatible with the old server wire shape', () => {
    const store = useConfigStore()
    store.addModel(makeModel())
    const parts = splitConfig(store.exportConfig(), 'fanqie')
    expect(parts.settings.models[0]).not.toHaveProperty('kind')
    expect(parts.settings.assignments).not.toHaveProperty('embedding')
    const joined = joinConfig(parts.settings, parts.secrets)
    expect(joined.models[0].apiKey).toBe(store.models[0].apiKey)
    expect(joined.models[0].modelName).toBe(store.models[0].modelName)
  })

  it('keeps local connection test records out of cloud settings and restores no remote test result', () => {
    const store = useConfigStore()
    const configured = store.addModel(makeModel())
    configured.connectionTest = {
      status: 'ok', testedAt: '2026-11-10T00:00:00.000Z', fingerprint: 'a'.repeat(64), environment: 'browser',
    }

    const parts = splitConfig(store.exportConfig(), 'fanqie')
    expect(parts.settings.models[0]).not.toHaveProperty('connectionTest')
    const joined = joinConfig(parts.settings, parts.secrets)
    expect(joined.models[0]).not.toHaveProperty('connectionTest')
  })
})
