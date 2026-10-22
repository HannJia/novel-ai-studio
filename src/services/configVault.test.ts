import { describe, it, expect, beforeEach, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import {
  sealVault,
  openVault,
  validateVaultEnvelope,
  type VaultContext,
  type VaultSecrets,
} from './configVault'

// Polyfill WebCrypto for happy-dom environment
beforeEach(() => {
  if (!globalThis.crypto?.subtle) {
    vi.stubGlobal('crypto', webcrypto)
  }
})

const testContext: VaultContext = {
  endpoint: 'https://154.94.227.164',
  userId: 'test-user-123',
  settingsHash: 'a'.repeat(64),
}

const testSecrets: VaultSecrets = {
  models: {
    'gpt-4': 'sk-test-key-1234567890',
    'claude-3': 'sk-ant-test-key',
  },
  embedding: 'sk-embed-test-key',
}

const testPassword = 'SecurePassword123!'

describe('configVault', () => {
  describe('sealVault and openVault roundtrip', () => {
    it('should encrypt and decrypt secrets successfully', async () => {
      const envelope = await sealVault(testSecrets, testPassword, testContext)
      const decrypted = await openVault(envelope, testPassword, testContext)

      expect(decrypted).toEqual(testSecrets)
    })

    it('should produce different envelopes on repeated seals', async () => {
      const envelope1 = await sealVault(testSecrets, testPassword, testContext)
      const envelope2 = await sealVault(testSecrets, testPassword, testContext)

      // Different salt and IV
      expect(envelope1.salt).not.toBe(envelope2.salt)
      expect(envelope1.iv).not.toBe(envelope2.iv)
      expect(envelope1.ciphertext).not.toBe(envelope2.ciphertext)

      // Both decrypt correctly
      const decrypted1 = await openVault(envelope1, testPassword, testContext)
      const decrypted2 = await openVault(envelope2, testPassword, testContext)
      expect(decrypted1).toEqual(testSecrets)
      expect(decrypted2).toEqual(testSecrets)
    })

    it('should handle empty models', async () => {
      const secrets: VaultSecrets = { models: {}, embedding: 'test-key' }
      const envelope = await sealVault(secrets, testPassword, testContext)
      const decrypted = await openVault(envelope, testPassword, testContext)

      expect(decrypted).toEqual(secrets)
    })

    it('should handle many models', async () => {
      const models: Record<string, string> = {}
      for (let i = 1; i <= 200; i++) {
        models[`model-${i}`] = `key-${i}`
      }
      const secrets: VaultSecrets = { models, embedding: 'embed-key' }

      const envelope = await sealVault(secrets, testPassword, testContext)
      const decrypted = await openVault(envelope, testPassword, testContext)

      expect(decrypted).toEqual(secrets)
    })

    it('should handle maximum length values', async () => {
      const longValue = 'x'.repeat(8192)
      const secrets: VaultSecrets = {
        models: { 'model-1': longValue },
        embedding: longValue,
      }

      const envelope = await sealVault(secrets, testPassword, testContext)
      const decrypted = await openVault(envelope, testPassword, testContext)

      expect(decrypted).toEqual(secrets)
    })
  })

  describe('password validation', () => {
    it('should reject password too short', async () => {
      await expect(
        sealVault(testSecrets, 'short', testContext)
      ).rejects.toThrow('密码长度必须在')
    })

    it('should reject password too long', async () => {
      const longPassword = 'a'.repeat(257)
      await expect(
        sealVault(testSecrets, longPassword, testContext)
      ).rejects.toThrow('密码长度必须在')
    })

    it('should accept minimum length password', async () => {
      const minPassword = 'a'.repeat(12)
      const envelope = await sealVault(testSecrets, minPassword, testContext)
      const decrypted = await openVault(envelope, minPassword, testContext)

      expect(decrypted).toEqual(testSecrets)
    })

    it('should accept maximum length password', async () => {
      const maxPassword = 'a'.repeat(256)
      const envelope = await sealVault(testSecrets, maxPassword, testContext)
      const decrypted = await openVault(envelope, maxPassword, testContext)

      expect(decrypted).toEqual(testSecrets)
    })
  })

  describe('wrong password', () => {
    it('should fail to decrypt with wrong password', async () => {
      const envelope = await sealVault(testSecrets, testPassword, testContext)

      await expect(
        openVault(envelope, 'WrongPassword123!', testContext)
      ).rejects.toThrow('无法解密配置保险箱')
    })

    it('should not expose details about decryption failure', async () => {
      const envelope = await sealVault(testSecrets, testPassword, testContext)

      try {
        await openVault(envelope, 'WrongPassword123!', testContext)
        expect.fail('Should have thrown')
      } catch (error) {
        const message = (error as Error).message
        expect(message).not.toContain('password')
        expect(message).not.toContain('key')
        expect(message).not.toContain('auth')
        expect(message).toBe('无法解密配置保险箱。')
      }
    })
  })

  describe('AAD context binding', () => {
    it('should fail with different endpoint', async () => {
      const envelope = await sealVault(testSecrets, testPassword, testContext)

      const wrongContext: VaultContext = {
        endpoint: 'https://different-server.com',
        userId: testContext.userId,
  settingsHash: 'a'.repeat(64),
      }

      await expect(
        openVault(envelope, testPassword, wrongContext)
      ).rejects.toThrow('无法解密配置保险箱')
    })

    it('should fail with different userId', async () => {
      const envelope = await sealVault(testSecrets, testPassword, testContext)

      const wrongContext: VaultContext = {
        endpoint: testContext.endpoint,
        userId: 'different-user',
  settingsHash: 'a'.repeat(64),
      }

      await expect(
        openVault(envelope, testPassword, wrongContext)
      ).rejects.toThrow('无法解密配置保险箱')
    })

    it('should normalize endpoint before AAD construction', async () => {
      const context1: VaultContext = {
        endpoint: 'https://154.94.227.164/',
        userId: 'user-1',
  settingsHash: 'a'.repeat(64),
      }
      const context2: VaultContext = {
        endpoint: 'https://154.94.227.164',
        userId: 'user-1',
  settingsHash: 'a'.repeat(64),
      }

      const envelope = await sealVault(testSecrets, testPassword, context1)
      const decrypted = await openVault(envelope, testPassword, context2)

      expect(decrypted).toEqual(testSecrets)
    })
  })

  describe('tampering detection', () => {
    it('should detect modified ciphertext', async () => {
      const envelope = await sealVault(testSecrets, testPassword, testContext)

      const tamperedEnvelope = {
        ...envelope,
        ciphertext: envelope.ciphertext.slice(0, -4) + 'AAAA',
      }

      await expect(
        openVault(tamperedEnvelope, testPassword, testContext)
      ).rejects.toThrow('无法解密配置保险箱')
    })

    it('should detect modified salt', async () => {
      const envelope = await sealVault(testSecrets, testPassword, testContext)

      // Create a different valid base64 salt
      const differentSalt = btoa(String.fromCharCode(...Array(16).fill(0)))

      const tamperedEnvelope = {
        ...envelope,
        salt: differentSalt,
      }

      await expect(
        openVault(tamperedEnvelope, testPassword, testContext)
      ).rejects.toThrow('无法解密配置保险箱')
    })

    it('should detect modified IV', async () => {
      const envelope = await sealVault(testSecrets, testPassword, testContext)

      const differentIV = btoa(String.fromCharCode(...Array(12).fill(0)))

      const tamperedEnvelope = {
        ...envelope,
        iv: differentIV,
      }

      await expect(
        openVault(tamperedEnvelope, testPassword, testContext)
      ).rejects.toThrow('无法解密配置保险箱')
    })
  })

  describe('validateVaultEnvelope', () => {
    it('should accept valid envelope', async () => {
      const envelope = await sealVault(testSecrets, testPassword, testContext)
      const validated = validateVaultEnvelope(envelope)

      expect(validated).toEqual(envelope)
    })

    it('should reject non-object', () => {
      expect(() => validateVaultEnvelope(null)).toThrow('配置保险箱格式错误')
      expect(() => validateVaultEnvelope('string')).toThrow('配置保险箱格式错误')
      expect(() => validateVaultEnvelope(123)).toThrow('配置保险箱格式错误')
      expect(() => validateVaultEnvelope([])).toThrow('配置保险箱格式错误')
    })

    it('should reject extra fields', () => {
      const envelope: any = {
        schema: 1,
        kdf: 'PBKDF2-SHA256',
        iterations: 600000,
        salt: btoa(String.fromCharCode(...Array(16).fill(0))),
        iv: btoa(String.fromCharCode(...Array(12).fill(0))),
        ciphertext: btoa(String.fromCharCode(...Array(32).fill(0))),
        extraField: 'malicious',
      }

      expect(() => validateVaultEnvelope(envelope)).toThrow('配置保险箱格式错误')
    })

    it('should reject wrong schema version', () => {
      const envelope: any = {
        schema: 2,
        kdf: 'PBKDF2-SHA256',
        iterations: 600000,
        salt: btoa(String.fromCharCode(...Array(16).fill(0))),
        iv: btoa(String.fromCharCode(...Array(12).fill(0))),
        ciphertext: btoa(String.fromCharCode(...Array(32).fill(0))),
      }

      expect(() => validateVaultEnvelope(envelope)).toThrow('配置保险箱格式错误')
    })

    it('should reject unsupported KDF', () => {
      const envelope: any = {
        schema: 1,
        kdf: 'scrypt',
        iterations: 600000,
        salt: btoa(String.fromCharCode(...Array(16).fill(0))),
        iv: btoa(String.fromCharCode(...Array(12).fill(0))),
        ciphertext: btoa(String.fromCharCode(...Array(32).fill(0))),
      }

      expect(() => validateVaultEnvelope(envelope)).toThrow('配置保险箱格式错误')
    })

    it('should reject wrong iteration count', () => {
      const envelope: any = {
        schema: 1,
        kdf: 'PBKDF2-SHA256',
        iterations: 100000,
        salt: btoa(String.fromCharCode(...Array(16).fill(0))),
        iv: btoa(String.fromCharCode(...Array(12).fill(0))),
        ciphertext: btoa(String.fromCharCode(...Array(32).fill(0))),
      }

      expect(() => validateVaultEnvelope(envelope)).toThrow('配置保险箱格式错误')
    })

    it('should reject wrong salt length', () => {
      const envelope: any = {
        schema: 1,
        kdf: 'PBKDF2-SHA256',
        iterations: 600000,
        salt: btoa(String.fromCharCode(...Array(32).fill(0))), // Wrong length
        iv: btoa(String.fromCharCode(...Array(12).fill(0))),
        ciphertext: btoa(String.fromCharCode(...Array(32).fill(0))),
      }

      expect(() => validateVaultEnvelope(envelope)).toThrow('配置保险箱格式错误')
    })

    it('should reject wrong IV length', () => {
      const envelope: any = {
        schema: 1,
        kdf: 'PBKDF2-SHA256',
        iterations: 600000,
        salt: btoa(String.fromCharCode(...Array(16).fill(0))),
        iv: btoa(String.fromCharCode(...Array(16).fill(0))), // Wrong length
        ciphertext: btoa(String.fromCharCode(...Array(32).fill(0))),
      }

      expect(() => validateVaultEnvelope(envelope)).toThrow('配置保险箱格式错误')
    })

    it('should reject invalid base64', () => {
      const envelope: any = {
        schema: 1,
        kdf: 'PBKDF2-SHA256',
        iterations: 600000,
        salt: 'not-valid-base64!!!',
        iv: btoa(String.fromCharCode(...Array(12).fill(0))),
        ciphertext: btoa(String.fromCharCode(...Array(32).fill(0))),
      }

      expect(() => validateVaultEnvelope(envelope)).toThrow('配置保险箱格式错误')
    })

    it('should reject ciphertext too small', () => {
      const envelope: any = {
        schema: 1,
        kdf: 'PBKDF2-SHA256',
        iterations: 600000,
        salt: btoa(String.fromCharCode(...Array(16).fill(0))),
        iv: btoa(String.fromCharCode(...Array(12).fill(0))),
        ciphertext: btoa(String.fromCharCode(...Array(8).fill(0))), // Too small
      }

      expect(() => validateVaultEnvelope(envelope)).toThrow('配置保险箱格式错误')
    })

    it('should reject ciphertext too large', () => {
      const envelope: any = {
        schema: 1,
        kdf: 'PBKDF2-SHA256',
        iterations: 600000,
        salt: btoa(String.fromCharCode(...Array(16).fill(0))),
        iv: btoa(String.fromCharCode(...Array(12).fill(0))),
        ciphertext: btoa('\0'.repeat(131089)), // Too large
      }

      expect(() => validateVaultEnvelope(envelope)).toThrow('配置保险箱格式错误')
    })
  })

  describe('secrets validation', () => {
    it('should reject secrets with prototype pollution keys', async () => {
      const maliciousSecrets = JSON.parse('{"models":{"__proto__":"malicious","normal-key":"value"},"embedding":"key"}')

      await expect(
        sealVault(maliciousSecrets, testPassword, testContext)
      ).rejects.toThrow('配置数据格式错误')
    })

    it('should reject secrets with constructor key', async () => {
      const maliciousSecrets: any = {
        models: {
          'constructor': 'malicious',
        },
        embedding: 'key',
      }

      await expect(
        sealVault(maliciousSecrets, testPassword, testContext)
      ).rejects.toThrow('配置数据格式错误')
    })

    it('should reject secrets with prototype key', async () => {
      const maliciousSecrets: any = {
        models: {
          'prototype': 'malicious',
        },
        embedding: 'key',
      }

      await expect(
        sealVault(maliciousSecrets, testPassword, testContext)
      ).rejects.toThrow('配置数据格式错误')
    })

    it('should reject model keys with control characters', async () => {
      const maliciousSecrets: any = {
        models: {
          'key\x00with\x1Fnulls': 'value',
        },
        embedding: 'key',
      }

      await expect(
        sealVault(maliciousSecrets, testPassword, testContext)
      ).rejects.toThrow('模型标识符包含非法字符')
    })

    it('should reject model keys starting with enc:', async () => {
      const maliciousSecrets: any = {
        models: {
          'enc:already-encrypted': 'value',
        },
        embedding: 'key',
      }

      await expect(
        sealVault(maliciousSecrets, testPassword, testContext)
      ).rejects.toThrow('配置数据格式错误')
    })

    it('should reject too many models', async () => {
      const models: Record<string, string> = {}
      for (let i = 1; i <= 201; i++) {
        models[`model-${i}`] = 'key'
      }
      const secrets: any = { models, embedding: 'key' }

      await expect(
        sealVault(secrets, testPassword, testContext)
      ).rejects.toThrow('模型数量超过限制')
    })

    it('should reject model key too long', async () => {
      const longKey = 'a'.repeat(201)
      const secrets: any = {
        models: { [longKey]: 'value' },
        embedding: 'key',
      }

      await expect(
        sealVault(secrets, testPassword, testContext)
      ).rejects.toThrow('模型标识符长度错误')
    })

    it('should reject model value too large', async () => {
      const largeValue = 'x'.repeat(8193)
      const secrets: any = {
        models: { 'model-1': largeValue },
        embedding: 'key',
      }

      await expect(
        sealVault(secrets, testPassword, testContext)
      ).rejects.toThrow('单个配置值超过大小限制')
    })

    it('should reject embedding value too large', async () => {
      const largeValue = 'x'.repeat(8193)
      const secrets: any = {
        models: { 'model-1': 'key' },
        embedding: largeValue,
      }

      await expect(
        sealVault(secrets, testPassword, testContext)
      ).rejects.toThrow('配置值超过大小限制')
    })

    it('should reject extra fields in secrets', async () => {
      const secrets: any = {
        models: { 'model-1': 'key' },
        embedding: 'key',
        extraField: 'malicious',
      }

      await expect(
        sealVault(secrets, testPassword, testContext)
      ).rejects.toThrow('配置数据格式错误')
    })

    it('should reject corrupted decrypted payload', async () => {
      const envelope = await sealVault(testSecrets, testPassword, testContext)

      // Manually decrypt and corrupt
      const { webcrypto } = await import('node:crypto')
      const salt = Uint8Array.from(atob(envelope.salt), c => c.charCodeAt(0))
      const iv = Uint8Array.from(atob(envelope.iv), c => c.charCodeAt(0))
      
      const passwordBytes = new TextEncoder().encode(testPassword)
      const passwordKey = await webcrypto.subtle.importKey('raw', passwordBytes, 'PBKDF2', false, ['deriveKey'])
      const key = await webcrypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' },
        passwordKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt']
      )

      const aad = new TextEncoder().encode(JSON.stringify([
        'mojian-config-keys', 1, testContext.endpoint, testContext.userId, testContext.settingsHash
      ]))

      // Encrypt corrupted JSON
      const corruptedPayload = '{"models":{"model-1":"key"},"embedding":"key","__proto__":{"polluted":true}}'
      const corruptedCiphertext = await webcrypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: aad },
        key,
        new TextEncoder().encode(corruptedPayload)
      )

      const corruptedEnvelope = {
        ...envelope,
        ciphertext: btoa(String.fromCharCode(...new Uint8Array(corruptedCiphertext))),
      }

      await expect(
        openVault(corruptedEnvelope, testPassword, testContext)
      ).rejects.toThrow('配置数据格式错误')
    })
  })

  describe('envelope does not contain plaintext', () => {
    it('should not contain plaintext secrets in envelope', async () => {
      const secrets: VaultSecrets = {
        models: {
          'secret-model': 'sk-secret-api-key-12345',
        },
        embedding: 'sk-secret-embed-key-67890',
      }

      const envelope = await sealVault(secrets, testPassword, testContext)
      const envelopeJson = JSON.stringify(envelope)

      expect(envelopeJson).not.toContain('sk-secret-api-key-12345')
      expect(envelopeJson).not.toContain('sk-secret-embed-key-67890')
      expect(envelopeJson).not.toContain('secret-model')
      expect(envelopeJson).not.toContain('models')
      expect(envelopeJson).not.toContain('embedding')
    })
  })

  describe('context validation', () => {
    it('should reject invalid endpoint URL', async () => {
      const badContext: VaultContext = {
        endpoint: 'not-a-url',
        userId: 'user-1',
  settingsHash: 'a'.repeat(64),
      }

      await expect(
        sealVault(testSecrets, testPassword, badContext)
      ).rejects.toThrow('请输入有效的 HTTPS 同步服务器地址')
    })

    it('should reject non-HTTPS endpoint', async () => {
      const badContext: VaultContext = {
        endpoint: 'http://example.com',
        userId: 'user-1',
  settingsHash: 'a'.repeat(64),
      }

      await expect(
        sealVault(testSecrets, testPassword, badContext)
      ).rejects.toThrow('同步服务器必须是 HTTPS 地址')
    })
  })
})
