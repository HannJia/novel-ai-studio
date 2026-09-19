import type { Worker, Page } from 'tesseract.js'
import { LOCAL_OCR_VERSION } from './ocrQuality'

export async function createLocalOcr(signal: AbortSignal, onProgress?: (percent: number) => void) {
  signal.throwIfAborted()
  const { createWorker, OEM, PSM } = await import('tesseract.js')
  signal.throwIfAborted()
  const base = new URL('ocr-assets/', new URL(import.meta.env.BASE_URL, document.baseURI))
  let worker: Worker | undefined
  let finished = false
  let rejectError!: (error: Error) => void
  const failure = new Promise<never>((_, reject) => { rejectError = reject })
  // Termination doesn't reject Tesseract's current recognition promise; race it explicitly.
  const abort = () => {
    finished = true
    void worker?.terminate()
    rejectError(signal.reason || new DOMException('已暂停', 'AbortError'))
  }
  signal.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(() => rejectError(new Error('本地识别引擎加载超时，请检查安装文件。')), 90000)
  try {
    const initializing = createWorker(['chi_sim', 'eng'], OEM.LSTM_ONLY, {
      workerPath: new URL('worker.min.js', base).href,
      corePath: new URL('core/', base).href,
      langPath: new URL('models', base).href,
      gzip: false, cacheMethod: 'none', cachePath: LOCAL_OCR_VERSION,
      workerBlobURL: false,
      logger: message => { if (message.status === 'recognizing text' && !finished) onProgress?.(Math.round(message.progress * 100)) },
      errorHandler: () => rejectError(new Error('本地 OCR 执行失败，请检查识别资源或重新打开软件。')),
    }).then(value => { worker = value; if (finished) void value.terminate(); return value })
    await Promise.race([initializing, failure])
    clearTimeout(timeout)
    signal.throwIfAborted()
    await worker!.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: '1', user_defined_dpi: '300' })
    return {
      async recognize(image: string): Promise<Page> {
        signal.throwIfAborted()
        const timer = setTimeout(() => {
          void worker?.terminate()
          rejectError(new Error('单页本地识别超过 3 分钟，已停止；已完成页保留。'))
        }, 180000)
        try {
          const result = await Promise.race([worker!.recognize(image, {}, { text: true, blocks: true }), failure])
          signal.throwIfAborted()
          return result.data
        } finally { clearTimeout(timer) }
      },
      async dispose() { finished = true; signal.removeEventListener('abort', abort); await worker?.terminate() },
    }
  } catch (error) {
    finished = true
    signal.removeEventListener('abort', abort)
    await worker?.terminate()
    throw error
  } finally { clearTimeout(timeout) }
}
