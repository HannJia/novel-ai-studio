import { defineStore } from 'pinia'
import { ref, reactive } from 'vue'
import type { WritingSkill, WritingSkillTask } from '@/types/skill'
import { createBuiltInSkills } from '@/data/skills'
import { normalizeAiWorkflowMode, type AiWorkflowMode } from '@/services/aiWorkflow'
import type { ChatSearchProtocol } from '@/types/chat'

// API 模型配置
export interface ModelConfig {
  id: string
  name: string         // 配置备注；无备注时使用模型 ID，不作为实际模型名称
  baseUrl: string      // API 基地址
  apiKey: string       // API Key
  modelName: string    // 模型名称
  maxTokens: number
  temperature: number
  topP: number
  contextWindow?: number // 模型上下文窗口大小（token 数），用于动态分配上下文
  chatSearchProtocol?: ChatSearchProtocol // 仅影响书内/灵感对话的联网请求
}

// 模型用途映射
export interface ModelAssignments {
  outline: string    // 大纲生成模型 ID
  writing: string    // 写作模型 ID
  review: string     // 审查模型 ID
  chat: string       // 对话 / 联网模型 ID；空值动态跟随大纲模型
}

export interface EmbeddingConfig {
  enabled: boolean
  baseUrl: string
  apiKey: string
  modelName: string
  batchSize: number
}

interface ConfigData {
  models: ModelConfig[]
  assignments: Partial<ModelAssignments>
  embedding?: Partial<EmbeddingConfig>
  skills?: WritingSkill[]
  aiWorkflowMode?: AiWorkflowMode
  pdfVisionEnabled?: boolean
}

interface SessionSecrets {
  models: Record<string, string>
  embedding: string
}

export interface ConfigSecurityStatus {
  environment: 'electron' | 'browser'
  storage: 'encrypted' | 'session-only' | 'local-development'
  encryptionAvailable: boolean
}

const STORAGE_KEY = 'novel-writer-config'
const SESSION_SECRET_KEY = 'novel-writer-session-secrets'

function hasElectronConfig(): boolean {
  return !!window.electronAPI?.configRead && !!window.electronAPI?.configWrite
}

function hasSecureConfig(): boolean {
  return hasElectronConfig() && !!window.electronAPI?.configEncrypt && !!window.electronAPI?.configDecrypt
}

function isLocalDevelopment(): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false
  const hostname = window.location?.hostname
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
}

function emptySessionSecrets(): SessionSecrets {
  return { models: {}, embedding: '' }
}

function readSessionSecrets(): SessionSecrets {
  if (typeof sessionStorage === 'undefined') return emptySessionSecrets()
  try {
    const parsed = JSON.parse(sessionStorage.getItem(SESSION_SECRET_KEY) || '{}') as Partial<SessionSecrets>
    return {
      models: parsed.models && typeof parsed.models === 'object' ? parsed.models : {},
      embedding: typeof parsed.embedding === 'string' ? parsed.embedding : '',
    }
  } catch {
    return emptySessionSecrets()
  }
}

function writeSessionSecrets(data: ConfigData) {
  if (typeof sessionStorage === 'undefined') return
  const secrets: SessionSecrets = {
    models: Object.fromEntries(data.models
      .filter(model => model.apiKey && !model.apiKey.startsWith('enc:'))
      .map(model => [model.id, model.apiKey])),
    embedding: data.embedding?.apiKey && !data.embedding.apiKey.startsWith('enc:') ? data.embedding.apiKey : '',
  }
  sessionStorage.setItem(SESSION_SECRET_KEY, JSON.stringify(secrets))
}

function redactConfigSecrets(data: ConfigData): ConfigData {
  return {
    ...data,
    models: data.models.map(model => ({ ...model, apiKey: '' })),
    embedding: data.embedding ? { ...data.embedding, apiKey: '' } : undefined,
  }
}

function mergeSessionSecrets(data: ConfigData): ConfigData {
  const secrets = readSessionSecrets()
  return {
    ...data,
    models: data.models.map(model => ({ ...model, apiKey: secrets.models[model.id] || model.apiKey || '' })),
    embedding: data.embedding ? { ...data.embedding, apiKey: secrets.embedding || data.embedding.apiKey || '' } : undefined,
  }
}

function containsPersistedSecrets(data: ConfigData): boolean {
  return data.models.some(model => Boolean(model.apiKey)) || Boolean(data.embedding?.apiKey)
}

async function encryptConfig(data: ConfigData): Promise<ConfigData> {
  if (!hasSecureConfig()) return data
  return {
    ...data,
    models: await Promise.all(data.models.map(async model => ({
      ...model,
      apiKey: await window.electronAPI!.configEncrypt(model.apiKey),
    }))),
    embedding: data.embedding ? {
      ...data.embedding,
      apiKey: await window.electronAPI!.configEncrypt(data.embedding.apiKey || ''),
    } : undefined,
  }
}

async function decryptConfig(data: ConfigData | null): Promise<ConfigData | null> {
  if (!data || !hasSecureConfig()) return data
  return {
    ...data,
    models: await Promise.all(data.models.map(async model => ({
      ...model,
      apiKey: await window.electronAPI!.configDecrypt(model.apiKey),
    }))),
    embedding: data.embedding ? {
      ...data.embedding,
      apiKey: await window.electronAPI!.configDecrypt(data.embedding.apiKey || ''),
    } : undefined,
  }
}

const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  enabled: false,
  baseUrl: 'http://127.0.0.1:11434',
  apiKey: '',
  modelName: 'bge-m3',
  batchSize: 16,
}

function mergeSkills(saved: WritingSkill[] | undefined): WritingSkill[] {
  const builtIns = createBuiltInSkills()
  const savedById = new Map((saved || []).map(skill => [skill.id, skill]))
  const mergedBuiltIns = builtIns.map(skill => ({ ...skill, ...savedById.get(skill.id), builtIn: true }))
  const custom = (saved || []).filter(skill => !skill.builtIn && !builtIns.some(item => item.id === skill.id))
  return [...mergedBuiltIns, ...custom]
}

export const useConfigStore = defineStore('config', () => {
  // 模型配置列表
  const models = ref<ModelConfig[]>([])

  // 模型用途分配
  const assignments = reactive<ModelAssignments>({
    outline: '',
    writing: '',
    review: '',
    chat: '',
  })
  const embedding = reactive<EmbeddingConfig>({ ...DEFAULT_EMBEDDING_CONFIG })
  const skills = ref<WritingSkill[]>(createBuiltInSkills())
  const aiWorkflowMode = ref<AiWorkflowMode>('balanced')
  const pdfVisionEnabled = ref(false)
  const securityStatus = reactive<ConfigSecurityStatus>({
    environment: 'browser',
    storage: isLocalDevelopment() ? 'local-development' : 'session-only',
    encryptionAvailable: false,
  })

  // 当前是否已配置
  const isConfigured = ref(false)
  const isInitialized = ref(false)
  let saveQueue: Promise<void> = Promise.resolve()

  function applyConfig(data: ConfigData | null) {
    models.value = data?.models || []
    Object.assign(assignments, {
      outline: '',
      writing: '',
      review: '',
      chat: '',
      ...(data?.assignments || {}),
    })
    if (!models.value.some(model => model.id === assignments.chat)) assignments.chat = ''
    Object.assign(embedding, DEFAULT_EMBEDDING_CONFIG, data?.embedding || {})
    skills.value = mergeSkills(data?.skills)
    aiWorkflowMode.value = normalizeAiWorkflowMode(data?.aiWorkflowMode)
    pdfVisionEnabled.value = data?.pdfVisionEnabled === true
    isConfigured.value = models.value.length > 0
  }

  function readLocalConfig(): ConfigData | null {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? JSON.parse(saved) : null
  }

  async function loadConfig() {
    try {
      let data: ConfigData | null = null
      if (hasElectronConfig()) {
        const status = window.electronAPI?.configSecurityStatus
          ? await window.electronAPI.configSecurityStatus()
          : { encryptionAvailable: hasSecureConfig() }
        Object.assign(securityStatus, {
          environment: 'electron',
          storage: status.encryptionAvailable ? 'encrypted' : 'session-only',
          encryptionAvailable: status.encryptionAvailable,
        })
        const saved = await window.electronAPI!.configRead()
        const persisted = saved ? JSON.parse(saved) as ConfigData : null
        if (persisted && status.encryptionAvailable) {
          const needsEncryptionMigration = persisted.models.some(model => Boolean(model.apiKey) && !model.apiKey.startsWith('enc:'))
            || Boolean(persisted.embedding?.apiKey && !persisted.embedding.apiKey.startsWith('enc:'))
          data = await decryptConfig(persisted)
          if (needsEncryptionMigration) {
            await window.electronAPI!.configWrite(JSON.stringify(await encryptConfig(data!)))
          }
        } else if (persisted) {
          writeSessionSecrets(persisted)
          data = mergeSessionSecrets(redactConfigSecrets(persisted))
          if (containsPersistedSecrets(persisted)) {
            await window.electronAPI!.configWrite(JSON.stringify(redactConfigSecrets(persisted)))
          }
        }
        if (!data) {
          data = readLocalConfig()
          if (data) {
            writeSessionSecrets(data)
            const stored = status.encryptionAvailable ? await encryptConfig(data) : redactConfigSecrets(data)
            await window.electronAPI!.configWrite(JSON.stringify(stored))
            localStorage.removeItem(STORAGE_KEY)
          }
        }
      } else {
        const persisted = readLocalConfig()
        if (persisted) {
          if (isLocalDevelopment()) {
            // Keep local development convenient even if an earlier build
            // redacted the browser copy and left the secret in sessionStorage.
            data = mergeSessionSecrets(persisted)
          } else if (containsPersistedSecrets(persisted)) {
            writeSessionSecrets(persisted)
            localStorage.setItem(STORAGE_KEY, JSON.stringify(redactConfigSecrets(persisted)))
            data = mergeSessionSecrets(redactConfigSecrets(persisted))
          } else {
            data = mergeSessionSecrets(persisted)
          }
        }
        if (isLocalDevelopment()) securityStatus.storage = 'local-development'
      }
      applyConfig(data)
    } catch {
      console.warn('配置加载失败，使用默认值')
      applyConfig(null)
    } finally {
      isInitialized.value = true
    }
  }

  async function saveConfig() {
    const data: ConfigData = {
      models: JSON.parse(JSON.stringify(models.value)),
      assignments: { ...assignments },
      embedding: { ...embedding },
      skills: JSON.parse(JSON.stringify(skills.value)),
      aiWorkflowMode: aiWorkflowMode.value,
      pdfVisionEnabled: pdfVisionEnabled.value,
    }
    const write = async () => {
      if (hasElectronConfig()) {
        if (securityStatus.encryptionAvailable) {
          await window.electronAPI!.configWrite(JSON.stringify(await encryptConfig(data)))
        } else {
          writeSessionSecrets(data)
          await window.electronAPI!.configWrite(JSON.stringify(redactConfigSecrets(data)))
        }
        localStorage.removeItem(STORAGE_KEY)
      } else if (isLocalDevelopment()) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
      } else {
        writeSessionSecrets(data)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(redactConfigSecrets(data)))
      }
    }
    const next = saveQueue.then(write, write)
    saveQueue = next.catch(() => undefined)
    await next
    isConfigured.value = models.value.length > 0
  }

  // 添加模型配置
  function addModel(config: Omit<ModelConfig, 'id'>): ModelConfig {
    const model: ModelConfig = {
      ...config,
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
    }
    models.value.push(model)

    // 首个模型分配给原有用途；对话保持空值，以后仍动态跟随大纲
    if (models.value.length === 1) {
      assignments.outline = model.id
      assignments.writing = model.id
      assignments.review = model.id
    }

    saveConfig()
    return model
  }

  // 更新模型配置
  function updateModel(id: string, updates: Partial<ModelConfig>) {
    const model = models.value.find(m => m.id === id)
    if (model) {
      Object.assign(model, updates)
      saveConfig()
    }
  }

  // 删除模型配置
  function deleteModel(id: string) {
    models.value = models.value.filter(m => m.id !== id)
    // 清理分配引用
    if (assignments.outline === id) assignments.outline = models.value[0]?.id || ''
    if (assignments.writing === id) assignments.writing = models.value[0]?.id || ''
    if (assignments.review === id) assignments.review = models.value[0]?.id || ''
    if (assignments.chat === id) assignments.chat = ''
    saveConfig()
  }

  // 获取指定用途的模型配置
  function getModelForTask(task: keyof ModelAssignments): ModelConfig | null {
    const modelId = assignments[task]
    if (task === 'chat') {
      return models.value.find(m => m.id === modelId) || getModelForTask('outline')
    }
    return models.value.find(m => m.id === modelId) || models.value[0] || null
  }

  // 更新模型分配
  function setAssignment(task: keyof ModelAssignments, modelId: string) {
    assignments[task] = modelId
    saveConfig()
  }

  function updateEmbeddingConfig(updates: Partial<EmbeddingConfig>) {
    Object.assign(embedding, updates)
    void saveConfig()
  }

  function setAiWorkflowMode(mode: AiWorkflowMode) {
    aiWorkflowMode.value = normalizeAiWorkflowMode(mode)
    void saveConfig()
  }

  function setPdfVisionEnabled(enabled: boolean) {
    pdfVisionEnabled.value = enabled
    void saveConfig().catch(() => undefined)
  }

  function addSkill(data: Pick<WritingSkill, 'name' | 'description' | 'task' | 'instructions'>): WritingSkill {
    const now = new Date().toISOString()
    const skill: WritingSkill = {
      ...data,
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
      enabled: true,
      builtIn: false,
      createdAt: now,
      updatedAt: now,
    }
    skills.value.push(skill)
    void saveConfig().catch(() => undefined)
    return skill
  }

  function updateSkill(id: string, updates: Partial<Pick<WritingSkill, 'name' | 'description' | 'task' | 'instructions' | 'enabled'>>) {
    const skill = skills.value.find(item => item.id === id)
    if (!skill) return
    Object.assign(skill, updates)
    skill.updatedAt = new Date().toISOString()
    void saveConfig().catch(() => undefined)
  }

  function deleteSkill(id: string) {
    const skill = skills.value.find(item => item.id === id)
    if (!skill || skill.builtIn) return
    skills.value = skills.value.filter(item => item.id !== id)
    void saveConfig()
  }

  function getSkillPrompt(task: Exclude<WritingSkillTask, 'all'>): string {
    const active = skills.value
      .filter(skill => skill.enabled && (skill.task === task || skill.task === 'all'))
      .slice(0, 12)
    if (active.length === 0) return ''
    return active
      .map(skill => `【${skill.name.slice(0, 80)}】\n${skill.instructions.trim().slice(0, 1500)}`)
      .join('\n\n')
      .slice(0, 6000)
  }

  return {
    models,
    assignments,
    embedding,
    skills,
    aiWorkflowMode,
    pdfVisionEnabled,
    securityStatus,
    isConfigured,
    isInitialized,
    loadConfig,
    saveConfig,
    addModel,
    updateModel,
    deleteModel,
    getModelForTask,
    setAssignment,
    updateEmbeddingConfig,
    setAiWorkflowMode,
    setPdfVisionEnabled,
    addSkill,
    updateSkill,
    deleteSkill,
    getSkillPrompt,
  }
})
