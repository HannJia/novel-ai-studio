import type JSZip from 'jszip'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'

export const KNOWLEDGE_IMPORT_LIMITS = {
  fileBytes: 25 * 1024 * 1024, archiveEntries: 2000, entryBytes: 16 * 1024 * 1024,
  expandedBytes: 64 * 1024 * 1024, textCharacters: 5_000_000, pdfPages: 1000,
}

// Inspect the central directory before asking a ZIP library to allocate entry
// objects. ZIP64/multi-disk archives are unnecessary for these bounded imports.
export function validateKnowledgeZip(buffer: ArrayBuffer): void {
  const view = new DataView(buffer)
  let end = -1
  for (let offset = view.byteLength - 22; offset >= Math.max(0, view.byteLength - 65557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === view.byteLength) { end = offset; break }
  }
  if (end < 0) throw new Error('ZIP 文件目录损坏')
  const count = view.getUint16(end + 10, true)
  const directorySize = view.getUint32(end + 12, true)
  let offset = view.getUint32(end + 16, true)
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== count
    || count === 65535 || directorySize === 0xffffffff || offset === 0xffffffff) throw new Error('不支持分卷或 ZIP64 压缩包')
  if (count > KNOWLEDGE_IMPORT_LIMITS.archiveEntries) throw new Error('压缩包条目超过 2000 个')
  const directoryEnd = offset + directorySize
  if (directoryEnd > end) throw new Error('ZIP 目录越界')
  let total = 0
  for (let index = 0; index < count; index++) {
    if (offset + 46 > directoryEnd || view.getUint32(offset, true) !== 0x02014b50) throw new Error('ZIP 条目损坏')
    const compressed = view.getUint32(offset + 20, true)
    const expanded = view.getUint32(offset + 24, true)
    const localOffset = view.getUint32(offset + 42, true)
    const flags = view.getUint16(offset + 8, true)
    if (compressed === 0xffffffff || expanded === 0xffffffff || localOffset === 0xffffffff) throw new Error('不支持 ZIP64 条目')
    if (flags & 1) throw new Error('不支持加密压缩包')
    if (localOffset >= view.byteLength || compressed > view.byteLength) throw new Error('ZIP 数据越界')
    total += expanded
    if (expanded > KNOWLEDGE_IMPORT_LIMITS.entryBytes || total > KNOWLEDGE_IMPORT_LIMITS.expandedBytes) throw new Error('解压内容超过安全上限（单文件 16 MB / 总计 64 MB）')
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true)
    if (offset > directoryEnd) throw new Error('ZIP 条目越界')
  }
  if (offset !== directoryEnd) throw new Error('ZIP 目录长度不匹配')
}

function readEntryBounded(entry: JSZip.JSZipObject, budget: { used: number }): Promise<Uint8Array> {
  // JSZip exposes this streaming method at runtime; its bundled d.ts omits it.
  const stream = (entry as JSZip.JSZipObject & {
    internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array>
  }).internalStream('uint8array')
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    let length = 0
    let done = false
    const fail = (error: Error) => { if (!done) { done = true; stream.pause(); reject(error) } }
    stream.on('data', chunk => {
      if (done) return
      length += chunk.length
      budget.used += chunk.length
      if (length > KNOWLEDGE_IMPORT_LIMITS.entryBytes || budget.used > KNOWLEDGE_IMPORT_LIMITS.expandedBytes) {
        fail(new Error('实际解压内容超过安全上限')); return
      }
      chunks.push(chunk)
    }).on('error', fail).on('end', () => {
      if (done) return
      done = true
      const result = new Uint8Array(length)
      let offset = 0
      for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length }
      resolve(result)
    }).resume()
  })
}

function xml(text: string): Document {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('不支持带外部实体声明的书籍目录')
  const result = new DOMParser().parseFromString(text, 'application/xml')
  if (result.getElementsByTagName('parsererror').length) throw new Error('书籍 XML 目录无效')
  return result
}
function elements(document: Document, name: string): Element[] {
  return Array.from(document.getElementsByTagName('*')).filter(element => element.localName?.toLowerCase() === name)
}
function archivePath(base: string, rawHref: string): string {
  const href = decodeURIComponent(rawHref.split('#')[0])
  if (!href || /^[a-z][a-z0-9+.-]*:|^[\\/]|[\\\0]/i.test(href)) throw new Error('书籍目录包含无效路径')
  const parts = base.split('/').slice(0, -1)
  for (const part of href.split('/')) {
    if (part === '..') {
      if (!parts.length) throw new Error('书籍目录路径越界')
      parts.pop()
    } else if (part && part !== '.') parts.push(part)
  }
  return parts.join('/')
}
function htmlText(html: string): string {
  return html.replace(/<(script|style|title)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(?:p|div|h[1-6])>/gi, '\n\n')
    .replace(/<h[1-6]\b[^>]*>/gi, '## ').replace(/<[^>]+>/g, '')
    .replace(/&(nbsp|lt|gt|quot|apos|amp|#\d+|#x[\da-f]+);/gi, (entity, name: string) => {
      const entities: Record<string, string> = { nbsp: ' ', lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }
      if (entities[name.toLowerCase()]) return entities[name.toLowerCase()]
      const point = name[1].toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1))
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity
    }).trim()
}

async function readArchive(buffer: ArrayBuffer, extension: string): Promise<string> {
  validateKnowledgeZip(buffer)
  const Zip = (await import('jszip')).default
  const zip = await Zip.loadAsync(buffer)
  const budget = { used: 0 }
  const loaded = new Map<string, Uint8Array>()
  async function read(name: string): Promise<Uint8Array> {
    if (loaded.has(name)) return loaded.get(name)!
    const entry = zip.file(name)
    if (!entry || entry.unsafeOriginalName !== undefined && entry.unsafeOriginalName !== name) throw new Error(`书籍缺少有效条目：${name}`)
    const data = await readEntryBounded(entry, budget)
    loaded.set(name, data)
    return data
  }
  const readText = async (name: string) => new TextDecoder().decode(await read(name))
  if (extension === 'docx') {
    // Normalize through bounded streaming first. A forged ZIP size cannot make
    // Mammoth's downstream reader expand arbitrarily large content.
    const normalized = new Zip()
    for (const entry of Object.values(zip.files)) {
      if (!entry.dir) normalized.file(entry.name, await read(entry.name), { compression: 'STORE' })
    }
    const mammoth = (await import('mammoth')).default
    return (await mammoth.extractRawText({ arrayBuffer: await normalized.generateAsync({ type: 'arraybuffer', compression: 'STORE' }) })).value
  }
  const container = xml(await readText('META-INF/container.xml'))
  const rootPath = archivePath('', elements(container, 'rootfile')[0]?.getAttribute('full-path') || '')
  const packageDocument = xml(await readText(rootPath))
  const manifest = new Map(elements(packageDocument, 'item').map(item => [item.getAttribute('id'), item.getAttribute('href')]))
  const spine = elements(packageDocument, 'itemref').filter(item => item.getAttribute('linear') !== 'no')
  if (!spine.length) throw new Error('EPUB 缺少有效的 spine 阅读顺序')
  const chapters: string[] = []
  let length = 0
  for (const item of spine) {
    const href = manifest.get(item.getAttribute('idref'))
    if (!href) throw new Error('EPUB 阅读顺序引用了不存在的章节')
    const text = htmlText(await readText(archivePath(rootPath, href)))
    length += text.length
    if (length > KNOWLEDGE_IMPORT_LIMITS.textCharacters) throw new Error('提取文本超过 500 万字符')
    if (text) chapters.push(text)
  }
  return chapters.join('\n\n---\n\n')
}

export async function readKnowledgeFile(file: File): Promise<string> {
  if (file.size > KNOWLEDGE_IMPORT_LIMITS.fileBytes) throw new Error('导入文件超过 25 MB，请拆分后导入')
  const extension = file.name.split('.').pop()?.toLowerCase()
  let result: string
  if (extension === 'docx' || extension === 'epub') result = await readArchive(await file.arrayBuffer(), extension)
  else if (extension === 'pdf') {
    const pdfjs = await import('pdfjs-dist')
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
    const task = pdfjs.getDocument({ data: await file.arrayBuffer() })
    try {
      const pdf = await task.promise
      if (pdf.numPages > KNOWLEDGE_IMPORT_LIMITS.pdfPages) throw new Error('PDF 超过 1000 页，请拆分后导入')
      const pages: string[] = []
      let length = 0
      for (let index = 1; index <= pdf.numPages; index++) {
        const page = await pdf.getPage(index)
        try {
          const content = await page.getTextContent()
          const text = content.items.map(item => 'str' in item ? item.str : '').join(' ').trim()
          length += text.length
          if (length > KNOWLEDGE_IMPORT_LIMITS.textCharacters) throw new Error('提取文本超过 500 万字符')
          if (text) pages.push(`## 第 ${index} 页\n${text}`)
        } finally { page.cleanup() }
      }
      result = pages.join('\n\n---\n\n')
    } finally { await task.destroy() }
  } else if (extension === 'txt' || extension === 'md' || extension === 'markdown') result = await file.text()
  else throw new Error('只支持 TXT、Markdown、DOCX、EPUB 和 PDF')
  if (result.length > KNOWLEDGE_IMPORT_LIMITS.textCharacters) throw new Error('提取文本超过 500 万字符')
  return result
}
