// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { modelConnectionFingerprint } from './modelConnectionTest'

const model = {
  baseUrl: 'https://provider.example',
  modelName: 'synthetic-model',
  apiKey: 'synthetic-private-key',
  kind: 'chat' as const,
}

beforeEach(() => vi.stubGlobal('crypto', webcrypto))
afterEach(() => vi.unstubAllGlobals())

describe('模型连接配置指纹', () => {
  it('hashes the effective connection inputs without exposing the key', async () => {
    const fingerprint = await modelConnectionFingerprint(model)
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(fingerprint).not.toContain(model.apiKey)
    expect(fingerprint).not.toContain(model.baseUrl)
    expect(fingerprint).not.toContain(model.modelName)
    await expect(modelConnectionFingerprint({ ...model, baseUrl: 'https://provider.example/v1' })).resolves.not.toBe(fingerprint)
  })

  it('changes when the endpoint, model, key, or kind changes', async () => {
    const fingerprint = await modelConnectionFingerprint(model)
    await expect(modelConnectionFingerprint({ ...model, baseUrl: 'https://other.example' })).resolves.not.toBe(fingerprint)
    await expect(modelConnectionFingerprint({ ...model, modelName: 'other-model' })).resolves.not.toBe(fingerprint)
    await expect(modelConnectionFingerprint({ ...model, apiKey: 'other-key' })).resolves.not.toBe(fingerprint)
    await expect(modelConnectionFingerprint({ ...model, kind: 'embedding' })).resolves.not.toBe(fingerprint)
  })
})
