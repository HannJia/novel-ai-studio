import { describe, expect, it } from 'vitest'
import type { Page } from 'tesseract.js'
import { analyzeOcr, applyOcrReview, ocrText, unresolvedOcr, type OcrLine } from './ocrQuality'
const line: OcrLine = { id: 'line-0', original: '郏县修渠', text: '郏县修渠', confidence: 60,
  box: { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.2 }, reasons: ['低置信度'], status: 'pending' }
describe('OCR quality screening and evidence', () => {
  it('flags low-confidence words, dates and native-text disagreement without pretending it measures accuracy', () => {
    const result = analyzeOcr({ text: '1994年修渠', blocks: [{ blocktype: 'FLOWING_TEXT', paragraphs: [{ lines: [{
      text: '1994年当地村民重建水渠', confidence: 98, bbox: { x0: 10, y0: 20, x1: 180, y1: 40 },
      words: [{ text: '1994', confidence: 40, bbox: { x0: 10, y0: 20, x1: 50, y1: 40 } }],
    }] }] }] } as Page, 200, 400, '1993年当地村民重建水渠')
    expect(result.lines[0].reasons).toEqual(['低置信度', '数字或日期', '与原文字层不一致'])
    expect(result.lines[0].box).toEqual({ x0: 0.05, y0: 0.05, x1: 0.9, y1: 0.1 })
    expect(ocrText(result)).toContain('【待核实')
  })
  it('retains a whole-page issue for empty recognition instead of asserting a blank page', () => {
    const result = analyzeOcr({ text: '', blocks: [] } as unknown as Page, 100, 100, '')
    expect(result.lines[0].reasons).toContain('整页未检出文字')
    expect(ocrText(result)).toContain('[未识别出文字]')
  })
  it('keeps original evidence when a textual correction is accepted', () => {
    const changed = applyOcrReview(line, { verdict: 'corrected', text: '郏县修堰', note: '原图末字为堰' }, '模型')
    expect(changed).toMatchObject({ original: '郏县修渠', text: '郏县修堰', status: 'corrected', reviewedBy: '模型' })
    expect(unresolvedOcr(changed)).toBe(false)
    expect(line.status).toBe('pending')
  })
  it.each([
    ['1994年', '1993年'], ['二十亩', '三十亩'], ['25.5%', '255%'],
  ])('never auto-applies numeric changes %s -> %s', (before, after) => {
    const changed = applyOcrReview({ ...line, original: before, text: before },
      { verdict: 'corrected', text: after, note: '清晰可读' }, '模型')
    expect(changed.text).toBe(before)
    expect(changed.suggestion).toBe(after)
    expect(unresolvedOcr(changed)).toBe(true)
  })
  it('retains uncertainty and table relationships even if a model claims confidence', () => {
    for (const source of [line, { ...line, reasons: ['表格或分栏关系'] }]) {
      const changed = applyOcrReview(source, { verdict: 'uncertain', text: '候选', note: '列归属不明确' }, '模型')
      expect(changed.text).toBe(source.original)
      expect(changed.status).toBe('uncertain')
    }
    expect(applyOcrReview(line, { verdict: 'corrected', text: '[无法辨认]', note: '' }, '模型').status).toBe('uncertain')
  })
  it('rejects malformed and empty confirmed replies', () => {
    for (const reply of [null, {}, { verdict: 'confirmed', text: '', note: '' }, { verdict: 'safe', text: 'text', note: '' }]) {
      expect(() => applyOcrReview(line, reply, '模型')).toThrow()
    }
  })
})
