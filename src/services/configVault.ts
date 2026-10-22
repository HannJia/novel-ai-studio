/**
 * Secure cloud vault encryption for API keys and model configurations.
 * 
 * Uses WebCrypto PBKDF2-HMAC-SHA256 (600k iterations) -> AES-256-GCM with AAD.
 * Each seal operation generates fresh random salt and IV.
 * AAD binds ciphertext to specific sync endpoint and user ID.
 */

import { normalizeSyncEndpoint } from './cloudSyncModel'

export interface VaultContext {
  endpoint: string
  userId: string
  settingsHash: string
}

export interface VaultEnvelope {
  schema: 1
  kdf: 'PBKDF2-SHA256'
  iterations: 600000
  salt: string
  iv: string
  ciphertext: string
}

export interface VaultSecrets {
  models: Record<string, string>
  embedding: string
}

const SCHEMA_VERSION = 1
const KDF_ALGORITHM = 'PBKDF2-SHA256'
const KDF_ITERATIONS = 600000
const SALT_BYTES = 16
const IV_BYTES = 12
const MIN_PASSWORD_LENGTH = 12
const MAX_PASSWORD_LENGTH = 256
const MAX_SECRETS_BYTES = 128 * 1024
const MAX_MODEL_COUNT = 200
const MIN_MODEL_ID_LENGTH = 1
const MAX_MODEL_ID_LENGTH = 200
const MAX_KEY_VALUE_BYTES = 8192
const MIN_CIPHERTEXT_BYTES = 16
const MAX_CIPHERTEXT_BYTES = 131072 + 16

const ENVELOPE_FIELDS = new Set(['schema', 'kdf', 'iterations', 'salt', 'iv', 'ciphertext'])
const SECRETS_FIELDS = new Set(['models', 'embedding'])

/**
 * Validates that a value is a VaultEnvelope with correct structure and bounds.
 * Rejects extra fields, invalid base64, wrong lengths, and unsupported parameters.
 * Performs all cheap validation before expensive cryptographic operations.
 */
export function validateVaultEnvelope(value: unknown): VaultEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('配置保险箱格式错误。')
  }

  const obj = value as Record<string, unknown>
  
  // Reject extra fields
  for (const key of Object.keys(obj)) {
    if (!ENVELOPE_FIELDS.has(key)) {
      throw new Error('配置保险箱格式错误。')
    }
  }

  // Validate required fields and types
  if (obj.schema !== 1) {
    throw new Error('配置保险箱格式错误。')
  }
  if (obj.kdf !== KDF_ALGORITHM) {
    throw new Error('配置保险箱格式错误。')
  }
  if (obj.iterations !== KDF_ITERATIONS) {
    throw new Error('配置保险箱格式错误。')
  }
  if (typeof obj.salt !== 'string' || typeof obj.iv !== 'string' || typeof obj.ciphertext !== 'string') {
    throw new Error('配置保险箱格式错误。')
  }

  // Validate base64 format and decode to check lengths
  let saltBytes: Uint8Array
  let ivBytes: Uint8Array
  let ciphertextBytes: Uint8Array

  try {
    saltBytes = decodeBase64(obj.salt)
    ivBytes = decodeBase64(obj.iv)
    ciphertextBytes = decodeBase64(obj.ciphertext)
  } catch {
    throw new Error('配置保险箱格式错误。')
  }

  if (saltBytes.byteLength !== SALT_BYTES) {
    throw new Error('配置保险箱格式错误。')
  }
  if (ivBytes.byteLength !== IV_BYTES) {
    throw new Error('配置保险箱格式错误。')
  }
  if (ciphertextBytes.byteLength < MIN_CIPHERTEXT_BYTES || 
      ciphertextBytes.byteLength > MAX_CIPHERTEXT_BYTES) {
    throw new Error('配置保险箱格式错误。')
  }

  // Re-encode to verify canonical base64
  if (obj.salt !== encodeBase64(saltBytes) ||
      obj.iv !== encodeBase64(ivBytes) ||
      obj.ciphertext !== encodeBase64(ciphertextBytes)) {
    throw new Error('配置保险箱格式错误。')
  }

  return {
    schema: obj.schema,
    kdf: obj.kdf,
    iterations: obj.iterations,
    salt: obj.salt,
    iv: obj.iv,
    ciphertext: obj.ciphertext,
  }
}

/**
 * Encrypts secrets with password-derived key.
 * Generates fresh random salt and IV for each call.
 * Binds ciphertext to sync endpoint and user ID via AAD.
 */
export async function sealVault(
  secrets: VaultSecrets,
  password: string,
  context: VaultContext
): Promise<VaultEnvelope> {
  validatePassword(password)
  validateSecrets(secrets)
  validateContext(context)

  const plaintextBytes = new TextEncoder().encode(JSON.stringify(secrets))
  if (plaintextBytes.byteLength > MAX_SECRETS_BYTES) {
    throw new Error('配置数据超过大小限制。')
  }

  // Generate fresh random values
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))

  // Derive encryption key from password and salt
  const key = await deriveKey(password, salt)

  // Construct AAD binding ciphertext to context
  const aad = constructAAD(context)

  // Encrypt with AES-GCM
  const ciphertextBytes = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: aad,
    },
    key,
    plaintextBytes
  )

  return {
    schema: SCHEMA_VERSION,
    kdf: KDF_ALGORITHM,
    iterations: KDF_ITERATIONS,
    salt: encodeBase64(salt),
    iv: encodeBase64(iv),
    ciphertext: encodeBase64(new Uint8Array(ciphertextBytes)),
  }
}

/**
 * Decrypts vault envelope with password.
 * Validates envelope structure and crypto parameters before key derivation.
 * Verifies AAD matches current context before accepting decrypted payload.
 */
export async function openVault(
  envelope: unknown,
  password: string,
  context: VaultContext
): Promise<VaultSecrets> {
  const validated = validateVaultEnvelope(envelope)
  validatePassword(password)
  validateContext(context)

  const salt = decodeBase64(validated.salt)
  const iv = decodeBase64(validated.iv)
  const ciphertextBytes = decodeBase64(validated.ciphertext)

  // Derive key with same salt as used during seal
  const key = await deriveKey(password, salt)

  // Construct AAD - must match what was used during seal
  const aad = constructAAD(context)

  let plaintextBytes: ArrayBuffer
  try {
    plaintextBytes = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: aad,
      },
      key,
      ciphertextBytes
    )
  } catch {
    // Could be wrong password, tampered data, or wrong context
    throw new Error('无法解密配置保险箱。')
  }

  const plaintext = new TextDecoder().decode(plaintextBytes)
  let secrets: unknown
  try {
    secrets = JSON.parse(plaintext)
  } catch {
    throw new Error('配置保险箱内容损坏。')
  }

  return validateSecrets(secrets)
}

/**
 * Derives AES-256-GCM key from password using PBKDF2-HMAC-SHA256.
 * Key is non-extractable and usable only for AES-GCM encryption/decryption.
 */
async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const passwordBytes = new TextEncoder().encode(password)
  
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    passwordBytes,
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  )

  return await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: KDF_ITERATIONS,
      hash: 'SHA-256',
    },
    passwordKey,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false, // non-extractable
    ['encrypt', 'decrypt']
  )
}

/**
 * Constructs Additional Authenticated Data binding ciphertext to context.
 * Fixed array format: ['mojian-config-keys', 1, normalizedEndpoint, userId]
 */
function constructAAD(context: VaultContext): Uint8Array<ArrayBuffer> {
  const normalizedEndpoint = normalizeSyncEndpoint(context.endpoint)
  const aadArray = ['mojian-config-keys', 1, normalizedEndpoint, context.userId, context.settingsHash]
  return new TextEncoder().encode(JSON.stringify(aadArray))
}

function validatePassword(password: string): void {
  if (typeof password !== 'string') {
    throw new Error('密码格式错误。')
  }
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`密码长度必须在 ${MIN_PASSWORD_LENGTH} 到 ${MAX_PASSWORD_LENGTH} 个字符之间。`)
  }
}

function validateContext(context: VaultContext): void {
  if (!context || typeof context !== 'object') {
    throw new Error('同步上下文格式错误。')
  }
  if (typeof context.endpoint !== 'string' || typeof context.userId !== 'string') {
    throw new Error('同步上下文格式错误。')
  }
  // Validate endpoint format
  normalizeSyncEndpoint(context.endpoint)
  
  if (!context.userId || context.userId.length > 200) {
    throw new Error('同步上下文格式错误。')
  }
  if (!/^[a-f0-9]{64}$/.test(context.settingsHash)) throw new Error('同步上下文格式错误。')
}

function validateSecrets(value: unknown): VaultSecrets {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('配置数据格式错误。')
  }

  const obj = value as Record<string, unknown>

  // Check for extra fields
  for (const key of Object.keys(obj)) {
    if (!SECRETS_FIELDS.has(key)) {
      throw new Error('配置数据格式错误。')
    }
  }

  if (!obj.models || typeof obj.models !== 'object' || Array.isArray(obj.models)) {
    throw new Error('配置数据格式错误。')
  }
  if (typeof obj.embedding !== 'string') {
    throw new Error('配置数据格式错误。')
  }

  const models = obj.models as Record<string, unknown>
  const modelKeys = Object.keys(models)

  if (modelKeys.length > MAX_MODEL_COUNT) {
    throw new Error(`模型数量超过限制（最多 ${MAX_MODEL_COUNT} 个）。`)
  }

  for (const key of modelKeys) {
    // Check for prototype pollution
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new Error('配置数据格式错误。')
    }

    // Validate key format
    if (key.length < MIN_MODEL_ID_LENGTH || key.length > MAX_MODEL_ID_LENGTH) {
      throw new Error('模型标识符长度错误。')
    }

    // Check for control characters
    if (/[\x00-\x1F\x7F]/.test(key)) {
      throw new Error('模型标识符包含非法字符。')
    }

    // Reject keys that look like encrypted values
    if (key.startsWith('enc:')) {
      throw new Error('配置数据格式错误。')
    }

    const value = models[key]
    if (typeof value !== 'string') {
      throw new Error('配置数据格式错误。')
    }
    if (value.startsWith('enc:')) throw new Error('配置数据格式错误。')

    if (new TextEncoder().encode(value).byteLength > MAX_KEY_VALUE_BYTES) {
      throw new Error('单个配置值超过大小限制。')
    }
  }

  // Validate embedding value
  const embeddingBytes = new TextEncoder().encode(obj.embedding)
  if (obj.embedding.startsWith('enc:')) throw new Error('配置数据格式错误。')
  if (embeddingBytes.byteLength > MAX_KEY_VALUE_BYTES) {
    throw new Error('配置值超过大小限制。')
  }

  return {
    models: models as Record<string, string>,
    embedding: obj.embedding,
  }
}

/**
 * Encodes bytes to base64 in chunks to avoid stack limits.
 */
function encodeBase64(bytes: Uint8Array): string {
  const CHUNK_SIZE = 8192
  let result = ''
  
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.slice(i, i + CHUNK_SIZE)
    result += String.fromCharCode(...chunk)
  }
  
  return btoa(result)
}

/**
 * Decodes base64 to bytes in chunks to avoid stack limits.
 */
function decodeBase64(base64: string): Uint8Array<ArrayBuffer> {
  if (base64.length > 174784 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error('配置保险箱格式错误。')
  const binaryString = atob(base64)
  const bytes = new Uint8Array(binaryString.length)
  
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  
  return bytes
}
