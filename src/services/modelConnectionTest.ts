import type { ModelConfig } from '@/stores/config'
import { openAiV1BaseUrl } from './ai'

type ConnectionFingerprintInput = Pick<ModelConfig, 'baseUrl' | 'modelName' | 'apiKey' | 'kind'>

/** Hashes the effective connection inputs without persisting any credential material. */
export async function modelConnectionFingerprint(model: ConnectionFingerprintInput): Promise<string> {
  const payload = JSON.stringify({
    schema: 1,
    baseUrl: model.baseUrl.trim(),
    endpoint: openAiV1BaseUrl(model.baseUrl).toLowerCase(),
    model: model.modelName.trim(),
    kind: model.kind || 'chat',
    key: model.apiKey.trim(),
  })
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
