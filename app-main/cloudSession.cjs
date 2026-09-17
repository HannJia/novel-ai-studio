const fs = require('node:fs')
const { writeAtomicFile } = require('./durableFiles.cjs')

function validateSession(value) {
  if (value === null) return
  const url = new URL(value.endpoint)
  if (url.protocol !== 'https:' || url.origin !== value.endpoint || url.username || url.password
    || typeof value.token !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(value.token)
    || !Number.isFinite(value.expiresAt) || typeof value.user?.id !== 'string'
    || typeof value.user?.username !== 'string') throw new Error('同步登录信息无效')
}

function createCloudSessionStorage(filename, safeStorage) {
  return {
    read() {
      if (!fs.existsSync(filename)) return null
      if (!safeStorage.isEncryptionAvailable()) throw new Error('本机安全存储不可用，请重新登录同步账号')
      const encrypted = fs.readFileSync(filename, 'utf8')
      if (encrypted.length > 16384) throw new Error('同步登录文件无效')
      const value = JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, 'base64')))
      validateSession(value)
      return value
    },
    write(value) {
      validateSession(value)
      if (!safeStorage.isEncryptionAvailable()) throw new Error('本机安全存储不可用，不能持久保存同步登录信息')
      const text = JSON.stringify(value)
      if (Buffer.byteLength(text) > 8192) throw new Error('同步登录信息过大')
      writeAtomicFile(filename, safeStorage.encryptString(text).toString('base64'))
    },
  }
}
module.exports = { createCloudSessionStorage, validateSession }
