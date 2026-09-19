import type { LocalOcrResult } from './ocrQuality'

export interface PdfPageText {
  page: number
  text: string
  method: 'text' | 'vision' | 'local-ocr'
  decoderVersion?: number
  ocr?: LocalOcrResult
}

const DATABASE = 'novel-writer-pdf-recognition'
const STORE = 'pages'
let opening: Promise<IDBDatabase> | undefined

function open(): Promise<IDBDatabase> {
  if (!opening) {
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1)
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('document', 'document')
      }
      request.onsuccess = () => {
        const db = request.result
        db.onversionchange = () => { db.close(); opening = undefined }
        resolve(db)
      }
      request.onerror = () => reject(new Error('无法打开 PDF 识别缓存，请检查本机存储权限'))
      request.onblocked = () => reject(new Error('PDF 缓存正在升级，请关闭其他软件窗口后重试'))
    }).catch(error => { opening = undefined; throw error })
  }
  return opening
}

export async function loadPdfPages(document: string): Promise<Map<number, PdfPageText>> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readonly')
    const request = transaction.objectStore(STORE).index('document').getAll(document)
    transaction.oncomplete = () => resolve(new Map(request.result.map(row => [row.page, {
      page: row.page, text: row.text, method: row.method, decoderVersion: row.decoderVersion, ocr: row.ocr,
    }])))
    transaction.onerror = transaction.onabort = () => reject(new Error('读取 PDF 识别进度失败，请重试'))
  })
}

export async function savePdfPage(document: string, page: PdfPageText): Promise<void> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).put({ ...page, document, id: `${document}:${page.page}`, updatedAt: Date.now() })
    transaction.oncomplete = () => resolve()
    transaction.onerror = transaction.onabort = () => reject(new Error('识别结果未能写入本机缓存，请检查可用空间后重试'))
  })
}
