// 数据完整性：编辑器载入再导出的正文必须与原文逐字符相同，偏移映射必须可逆。
import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { docToPlainText, offsetToPos, plainTextToDoc, posToOffset } from './plainText'
import { buildAnalysisSourceVersionId } from '@/services/reconstructionCandidates'

const schema = getSchema([Document, Paragraph, Text])
const SAMPLES: Record<string, string> = {
  empty: '',
  single: '雨是从黄昏开始下的。',
  paragraphs: '第一段。\n第二段。\n第三段。',
  leadingTrailing: '\n首行前有换行\n末尾也有\n',
  blankRuns: '甲\n\n\n乙\n\n',
  onlyNewlines: '\n\n\n',
  crlf: '旧稿使用 CRLF\r\n第二行\r\n',
  loneCr: '只有回车\r字符',
  spaces: '  行首两个空格\n\t制表符\n行尾空格   \n　　全角缩进',
  surrogate: '𠀀生僻字𪚥与表情😀在一起\n🎋',
  punctuation: '“引号”‘单引’——破折号……省略号《书名》',
  zeroWidth: '零宽\u200b空格\ufeff与BOM',
}

describe('纯文本编辑器往返', () => {
  it.each(Object.entries(SAMPLES))('serialize(parse(s)) === s：%s', (_, text) => {
    const doc = plainTextToDoc(schema, text)
    const back = docToPlainText(doc)
    expect(back).toBe(text)
    expect(buildAnalysisSourceVersionId(back)).toBe(buildAnalysisSourceVersionId(text))
  })

  it('round trips a long synthetic manuscript without changing its version signature', () => {
    const text = Array.from({ length: 4000 }, (_, i) => (i % 7 === 0 ? '' : `第${i}段，灯焰被风压低了一瞬。𠀀`)).join('\n')
    expect(docToPlainText(plainTextToDoc(schema, text))).toBe(text)
  })

  it.each(Object.entries(SAMPLES))('每个偏移都能映射到位置并换算回来：%s', (_, text) => {
    const doc = plainTextToDoc(schema, text)
    for (let offset = 0; offset <= text.length; offset++) {
      const pos = offsetToPos(doc, offset)
      expect(pos).toBeGreaterThanOrEqual(1)
      expect(pos).toBeLessThanOrEqual(doc.content.size)
      expect(posToOffset(doc, pos)).toBe(offset)
    }
  })

  it('maps a review quote range to exactly the quoted document text', () => {
    const text = '沈砚给老人倒了一碗热茶。\n他终于问出了口：“您从前在禁军里，也是这样守夜的吗？”\n老人的手停在半空。'
    const quote = '“您从前在禁军里，也是这样守夜的吗？”'
    const start = text.indexOf(quote), end = start + quote.length
    const doc = plainTextToDoc(schema, text)
    expect(doc.textBetween(offsetToPos(doc, start), offsetToPos(doc, end))).toBe(quote)
  })

  it('maps a range across a paragraph boundary to text joined by the newline', () => {
    const text = '第一段末尾\n第二段开头'
    const doc = plainTextToDoc(schema, text)
    expect(doc.textBetween(offsetToPos(doc, 3), offsetToPos(doc, 8), '\n')).toBe(text.slice(3, 8))
  })
})
