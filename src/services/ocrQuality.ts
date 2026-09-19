import type { Page } from 'tesseract.js'

export interface OcrBox { x0: number; y0: number; x1: number; y1: number }
export interface OcrLine {
  id: string; original: string; text: string; confidence: number; box: OcrBox; reasons: string[]
  status: 'local' | 'pending' | 'reviewed' | 'corrected' | 'uncertain' | 'manual'
  note?: string; suggestion?: string; reviewedBy?: string
}
export interface LocalOcrResult {
  engine: string; width: number; height: number; lines: OcrLine[]; warnings: string[]
  nativeText?: string
}
export const LOCAL_OCR_VERSION = 'tesseract6.0.1-best-zh-en-v1'
const normalize = (text: string) => text.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase()
export const unresolvedOcr = (line: OcrLine) => line.reasons.length > 0 && ['pending', 'uncertain'].includes(line.status)

export function analyzeOcr(data: Page, width: number, height: number, nativeText: string): LocalOcrResult {
  const lines: OcrLine[] = []
  const native = normalize(nativeText)
  for (const block of data.blocks || []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        const text = line.text.trim()
        if (!text) continue
        const confidence = Math.max(0, Math.min(100, Number(line.confidence) || 0))
        const reasons: string[] = []
        if (confidence < 85 || line.words.some(word => word.text.trim() && word.confidence < 65)) reasons.push('低置信度')
        if (/\d|[〇零一二三四五六七八九十百千万亿]+[年月日]/.test(text)) reasons.push('数字或日期')
        if (/[�□■]|[a-zA-Z]{1,3}[一-龥]|[一-龥][a-zA-Z]{1,3}/.test(text)) reasons.push('疑似误字')
        const normalized = normalize(text)
        if (native && normalized.length >= 8 && !native.includes(normalized)) reasons.push('与原文字层不一致')
        const wideGaps = line.words.filter((word, index, words) => index > 0
          && word.bbox.x0 - words[index - 1].bbox.x1 > (line.bbox.y1 - line.bbox.y0) * 2).length
        if (/table/i.test(block.blocktype) || wideGaps >= 2) reasons.push('表格或分栏关系')
        lines.push({ id: `line-${lines.length}`, original: text, text, confidence,
          box: { x0: Math.max(0, line.bbox.x0 / width), y0: Math.max(0, line.bbox.y0 / height),
            x1: Math.min(1, line.bbox.x1 / width), y1: Math.min(1, line.bbox.y1 / height) },
          reasons, status: reasons.length ? 'pending' : 'local' })
      }
    }
  }
  const warnings: string[] = []
  const observed = normalize(lines.map(line => line.original).join(''))
  if (native.length > 100 && observed.length < native.length * 0.6) {
    warnings.push('本地识别文字明显少于原文字层，可能存在漏行。请核对整页，不能按置信度判定完整。')
    for (const line of lines) {
      line.reasons.push('疑似漏行')
      line.status = 'pending'
    }
  }
  if (!lines.length) {
    warnings.push('本地 OCR 未检出可用文字，不能据此认定页面为空白。')
    lines.push({ id: 'page-empty', text: data.text.trim(), original: data.text.trim(), confidence: 0,
      box: { x0: 0, y0: 0, x1: 1, y1: 1 }, reasons: ['整页未检出文字'], status: 'pending' })
  }
  return { engine: LOCAL_OCR_VERSION, width, height, lines, warnings, nativeText }
}

export function ocrText(result: LocalOcrResult): string {
  return result.lines.map(line => unresolvedOcr(line)
    ? `【待核实：${line.reasons.join('、')}】${line.text || '[未识别出文字]'}`
    : line.text).join('\n')
}

export function applyOcrReview(line: OcrLine, value: unknown, modelName: string): OcrLine {
  const reply = value as { verdict?: unknown; text?: unknown; note?: unknown }
  if (!reply || !['confirmed', 'corrected', 'uncertain'].includes(String(reply.verdict))
    || typeof reply.text !== 'string' || reply.text.length > 12000
    || typeof reply.note !== 'string' || reply.note.length > 1500) throw new Error('复核结果格式无效，原文已保留。')
  const candidate = reply.text.trim()
  if (reply.verdict !== 'uncertain' && !candidate) throw new Error('复核未返回有效文字，原文已保留。')
  const numbers = (text: string) => (text.normalize('NFKC').match(/\d+(?:[.,]\d+)*(?:%)?|[〇零一二三四五六七八九十百千万亿两]+/g) || []).join('|')
  const numericChange = numbers(candidate) !== numbers(line.original)
  // Never silently settle conflicting quantities or uncertain table relationships.
  const uncertain = reply.verdict === 'uncertain' || numericChange || line.reasons.includes('表格或分栏关系')
    || line.reasons.includes('疑似漏行')
    || /无法辨认|待核实|看不清|不确定/.test(candidate)
    || (reply.verdict === 'confirmed' && normalize(candidate) !== normalize(line.original))
  return { ...line, text: uncertain ? line.original : candidate,
    status: uncertain ? 'uncertain' : candidate === line.original ? 'reviewed' : 'corrected',
    suggestion: candidate, note: `${numericChange ? '数字发生变化，保留原值待确认。' : ''}${reply.note}`,
    reviewedBy: modelName.slice(0, 200) }
}
