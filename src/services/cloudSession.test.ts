// @vitest-environment node
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
const require = createRequire(import.meta.url)
const { createCloudSessionStorage } = require('../../app-main/cloudSession.cjs')
let directory: string
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'novel-cloud-session-')) })
afterEach(() => rmSync(directory, { recursive: true, force: true }))
const valid = { endpoint: 'https://example.org', token: 'a'.repeat(40), expiresAt: Date.now() + 10000, user: { id: 'user', username: 'author' } }
const encryption = { isEncryptionAvailable: () => true, encryptString: (text: string) => Buffer.from([...text].reverse().join('')),
  decryptString: (bytes: Buffer) => [...bytes.toString()].reverse().join('') }
describe('桌面云登录安全存储', () => {
  it('encrypts persistent sessions and clears them without retaining the old token', () => {
    const file = join(directory, 'session')
    const storage = createCloudSessionStorage(file, encryption)
    expect(storage.read()).toBeNull()
    storage.write(valid)
    expect(readFileSync(file, 'utf8')).not.toContain(valid.token)
    expect(storage.read()).toEqual(valid)
    storage.write(null)
    expect(storage.read()).toBeNull()
  })
  it('refuses plaintext fallback and insecure endpoints', () => {
    const store = createCloudSessionStorage(join(directory, 'session'), { ...encryption, isEncryptionAvailable: () => false })
    expect(() => store.write(valid)).toThrow('安全存储不可用')
    const secure = createCloudSessionStorage(join(directory, 'session'), encryption)
    expect(() => secure.write({ ...valid, endpoint: 'http://example.org' })).toThrow()
    expect(() => secure.write({ ...valid, token: '\r\ninjection' })).toThrow()
  })
})
