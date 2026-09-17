const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const asar = require('@electron/asar')
const yaml = require('js-yaml')

const root = path.resolve(__dirname, '..')
const version = require('../package.json').version
const archive = path.join(root, 'release/win-unpacked/resources/app.asar')
const name = `AI-Novel-Writer-${version}-x64.exe`
const installer = path.join(root, 'release', name)
const bytes = fs.readFileSync(installer)
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
const sha512 = crypto.createHash('sha512').update(bytes).digest('base64')
const manifest = yaml.load(fs.readFileSync(path.join(root, 'release/latest.yml'), 'utf8'))
assert.equal(manifest.version, version)
assert.equal(manifest.path, name)
assert.equal(manifest.sha512, sha512)
assert.equal(manifest.files[0].url, name)
assert.equal(manifest.files[0].size, bytes.length)
assert.equal(manifest.files[0].sha512, sha512)
assert.ok(fs.statSync(`${installer}.blockmap`).size > 0)

const files = asar.listPackage(archive).map(file => file.replace(/^[/\\]/, '').replaceAll('\\', '/'))
const privateFiles = /(?:^|\/)(?:\.env(?:\..*)?|\.ssh|\.local-recovery|server|novel-writer-config\.json|novel-writer-cloud-session)(?:\/|$)|\.(?:db|sqlite|sqlite3|pfx|p12|pem|key)(?:-(?:wal|shm))?$/
assert.deepEqual(files.filter(file => privateFiles.test(file)), [], 'Private or server-side files included')
const packaged = JSON.parse(asar.extractFile(archive, 'package.json').toString())
assert.equal(packaged.version, version)
let audited = 0
for (const file of files.filter(file => /^(dist|app-main)\//.test(file))) {
  if (asar.statFile(archive, path.normalize(file)).files) continue
  const content = asar.extractFile(archive, path.normalize(file))
  assert.ok(content.equals(fs.readFileSync(path.join(root, file))), `Packaged source mismatch: ${file}`)
  if (/\.(?:js|cjs|mjs|html|json)$/.test(file)) {
    assert.ok(!/sk-(?:proj-)?[a-zA-Z0-9_-]{24,}|gh[pousr]_[a-zA-Z0-9]{30,}|-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----/.test(content.toString()),
      `Potential credential in ${file}`)
  }
  audited++
}
fs.writeFileSync(`${installer}.sha256`, `${sha256}  ${name}\n`)
console.log(JSON.stringify({ version, bytes: bytes.length, sha256, sha512, auditedApplicationFiles: audited,
  manifestMatches: true, privateFilesFound: false, credentialPatternsFound: false }, null, 2))
