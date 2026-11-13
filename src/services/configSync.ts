import type { ModelConfig, ModelAssignments, EmbeddingConfig } from '@/stores/config'
import type { WritingSkill } from '@/types/skill'
import type { AiWorkflowMode } from './aiWorkflow'
import { canonicalJson, hashPayload } from './cloudSyncModel'
import { validateVaultEnvelope, type VaultEnvelope, type VaultSecrets } from './configVault'

export interface PortableConfig {
  models: ModelConfig[]
  assignments: Partial<ModelAssignments>
  embedding?: Partial<EmbeddingConfig>
  skills?: WritingSkill[]
  aiWorkflowMode?: AiWorkflowMode
  pdfVisionEnabled?: boolean
}
export interface PublicSettings {
  schema: 1
  models: Omit<ModelConfig, 'apiKey' | 'connectionTest'>[]
  assignments: ModelAssignments
  embedding: Omit<EmbeddingConfig, 'apiKey'>
  skills: WritingSkill[]
  aiWorkflowMode: AiWorkflowMode
  pdfVisionEnabled: boolean
  theme: 'fanqie' | 'eyecare' | 'dark'
}
// Schema 1 uses a legacy recovery password; schema 2 uses account authorization.
export interface PreferencesBundle { schema: 1 | 2; settings: PublicSettings; vault: VaultEnvelope | null }
export interface PreferencesRecord { version: number; hash: string; updatedAt: number; payload: string }
const invalid = () => new Error('云端配置格式不兼容或包含不能同步的字段，本机配置已保留。')
function object(value: unknown, fields: string[]): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid()
  const result = value as Record<string, any>
  if (Object.keys(result).some(key => !fields.includes(key))) throw invalid()
  return result
}
function text(value: unknown, max: number, nonempty = false): string {
  if (typeof value !== 'string' || value.length > max || (nonempty && !value.length)) throw invalid()
  return value
}
function identifier(value: unknown): string {
  const result = text(value, 200, true)
  if (/[\u0000-\u001f\u007f]/.test(result) || ['__proto__', 'prototype', 'constructor'].includes(result)) throw invalid()
  return result
}
function number(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw invalid()
  return value
}
function bool(value: unknown): boolean { if (typeof value !== 'boolean') throw invalid(); return value }
function url(value: unknown): string {
  const result = text(value, 2000, true)
  let parsed: URL
  try { parsed = new URL(result) } catch { throw invalid() }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw invalid()
  return result
}
export function validatePublicSettings(value: unknown): PublicSettings {
  const data = object(value, ['schema', 'models', 'assignments', 'embedding', 'skills', 'aiWorkflowMode', 'pdfVisionEnabled', 'theme'])
  if (data.schema !== 1 || !Array.isArray(data.models) || data.models.length > 200) throw invalid()
  const ids = new Set<string>()
  const models = data.models.map((raw: unknown) => {
    const m = object(raw, ['id', 'name', 'baseUrl', 'modelName', 'maxTokens', 'temperature', 'topP', 'contextWindow', 'chatSearchProtocol', 'kind'])
    const id = identifier(m.id)
    if (ids.has(id)) throw invalid()
    ids.add(id)
    const model: Omit<ModelConfig, 'apiKey' | 'connectionTest'> = { id, name: text(m.name, 200), baseUrl: url(m.baseUrl), modelName: text(m.modelName, 200, true),
      maxTokens: number(m.maxTokens, 1, 2000000), temperature: number(m.temperature, 0, 2), topP: number(m.topP, 0, 1) }
    if (m.contextWindow !== undefined) model.contextWindow = number(m.contextWindow, 1, 10000000)
    if (m.chatSearchProtocol !== undefined) {
      if (!['auto', 'responses', 'anthropic', 'openrouter', 'chat-completions'].includes(m.chatSearchProtocol)) throw invalid()
      model.chatSearchProtocol = m.chatSearchProtocol
    }
    if (m.kind !== undefined) {
      if (!['chat', 'embedding'].includes(m.kind)) throw invalid()
      model.kind = m.kind
    }
    return model
  })
  const embeddingIds = new Set(models.filter(m => m.kind === 'embedding').map(m => m.id))
  const chatIds = new Set(models.filter(m => (m.kind || 'chat') === 'chat').map(m => m.id))
  const assignment = object(data.assignments, ['outline', 'writing', 'review', 'chat', 'embedding'])
  const assignments = {} as ModelAssignments
  for (const task of ['outline', 'writing', 'review', 'chat'] as const) {
    const id = text(assignment[task], 200)
    if (id && !chatIds.has(id)) throw invalid()
    assignments[task] = id
  }
  if (assignment.embedding !== undefined) {
    const embId = text(assignment.embedding, 200)
    if (embId && !embeddingIds.has(embId)) throw invalid()
    assignments.embedding = embId
  }
  const e = object(data.embedding, ['enabled', 'baseUrl', 'modelName', 'batchSize'])
  const embedding = { enabled: bool(e.enabled), baseUrl: url(e.baseUrl), modelName: text(e.modelName, 200), batchSize: number(e.batchSize, 1, 2048) }
  if (!Array.isArray(data.skills) || data.skills.length > 100) throw invalid()
  const skillIds = new Set<string>()
  const skills: WritingSkill[] = data.skills.map((raw: unknown) => {
    const s = object(raw, ['id', 'name', 'description', 'task', 'instructions', 'enabled', 'builtIn', 'createdAt', 'updatedAt'])
    const id = identifier(s.id)
    if (skillIds.has(id) || !['planning', 'writing', 'review', 'analysis', 'all'].includes(s.task)) throw invalid()
    skillIds.add(id)
    return { id, name: text(s.name, 200), description: text(s.description, 2000), task: s.task, instructions: text(s.instructions, 16000),
      enabled: bool(s.enabled), builtIn: bool(s.builtIn), createdAt: text(s.createdAt, 64), updatedAt: text(s.updatedAt, 64) }
  })
  if (!['fast', 'balanced', 'strict'].includes(data.aiWorkflowMode) || !['fanqie', 'eyecare', 'dark'].includes(data.theme)) throw invalid()
  return { schema: 1, models, assignments, embedding, skills, aiWorkflowMode: data.aiWorkflowMode, pdfVisionEnabled: bool(data.pdfVisionEnabled), theme: data.theme }
}
export function splitConfig(config: PortableConfig, theme: PublicSettings['theme']): { settings: PublicSettings; secrets: VaultSecrets } {
  const models = config.models.map(({ apiKey: _secret, connectionTest: _localTest, ...model }) => {
    // Omitted kind already means chat; retain the old wire shape when possible.
    if (model.kind === 'chat') delete model.kind
    return model
  })
  const assignments = { ...config.assignments }
  if (!assignments.embedding) delete assignments.embedding
  const { apiKey: _embeddingSecret, ...embedding } = config.embedding || {}
  const settings = validatePublicSettings({ schema: 1, models, assignments, embedding,
    skills: config.skills, aiWorkflowMode: config.aiWorkflowMode, pdfVisionEnabled: config.pdfVisionEnabled, theme })
  return { settings, secrets: { models: Object.fromEntries(config.models.map(model => [model.id, model.apiKey])), embedding: config.embedding?.apiKey || '' } }
}
export function joinConfig(settings: PublicSettings, secrets: VaultSecrets): PortableConfig {
  const ids = new Set(settings.models.map(model => model.id))
  if (Object.keys(secrets.models).some(id => !ids.has(id)) || settings.models.some(model => !Object.prototype.hasOwnProperty.call(secrets.models, model.id))) throw invalid()
  return { models: settings.models.map(model => ({ ...model, apiKey: secrets.models[model.id] })), assignments: { ...settings.assignments },
    embedding: { ...settings.embedding, apiKey: secrets.embedding }, skills: settings.skills, aiWorkflowMode: settings.aiWorkflowMode, pdfVisionEnabled: settings.pdfVisionEnabled }
}
export function parsePreferences(payload: string): PreferencesBundle {
  if (typeof payload !== 'string' || new TextEncoder().encode(payload).length > 512 * 1024) throw invalid()
  let raw: unknown
  try { raw = JSON.parse(payload) } catch { throw invalid() }
  const b = object(raw, ['schema', 'settings', 'vault'])
  if ((b.schema !== 1 && b.schema !== 2) || !Object.prototype.hasOwnProperty.call(b, 'vault') || (b.schema === 2 && b.vault === null)) throw invalid()
  return { schema: b.schema, settings: validatePublicSettings(b.settings), vault: b.vault === null ? null : validateVaultEnvelope(b.vault) }
}
export const settingsDigest = async (settings: PublicSettings) => (await hashPayload(canonicalJson(settings)))!
export async function checkPreferencesRecord(value: unknown): Promise<PreferencesRecord | null> {
  if (value === null) return null
  const r = object(value, ['version', 'hash', 'updatedAt', 'payload'])
  if (!Number.isSafeInteger(r.version) || r.version < 1 || !Number.isFinite(r.updatedAt) || typeof r.hash !== 'string' || !/^[a-f0-9]{64}$/.test(r.hash)
    || typeof r.payload !== 'string' || await hashPayload(r.payload) !== r.hash) throw invalid()
  parsePreferences(r.payload)
  return r as PreferencesRecord
}
