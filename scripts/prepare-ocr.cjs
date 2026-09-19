const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '../resources/ocr')
const manifest = require('../resources/ocr/manifest.json')
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')

async function main() {
  fs.mkdirSync(root, { recursive: true })
  for (const [name, expected] of Object.entries(manifest.files)) {
    const destination = path.join(root, name)
    if (fs.existsSync(destination) && hash(fs.readFileSync(destination)) === expected) continue
    let bytes
    for (const host of [
      `https://raw.githubusercontent.com/${manifest.repository}/${manifest.revision}`,
      `https://cdn.jsdelivr.net/gh/${manifest.repository}@${manifest.revision}`,
    ]) {
      try {
        const response = await fetch(`${host}/${name}`, { signal: AbortSignal.timeout(180000) })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        if (Number(response.headers.get('content-length')) > 30000000) throw new Error('模型文件过大')
        const chunks = []
        let length = 0
        for await (const chunk of response.body) {
          length += chunk.length
          if (length > 30000000) throw new Error('模型文件过大')
          chunks.push(chunk)
        }
        bytes = Buffer.concat(chunks)
        if (hash(bytes) !== expected) throw new Error('模型校验失败')
        break
      } catch { bytes = undefined }
    }
    if (!bytes) throw new Error(`无法获取并校验 ${name}，未构建不完整的 OCR 资源。`)
    fs.writeFileSync(`${destination}.tmp`, bytes)
    fs.renameSync(`${destination}.tmp`, destination)
  }
  console.log('本地 OCR 模型已校验；识别时不会从外部下载模型。')
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
