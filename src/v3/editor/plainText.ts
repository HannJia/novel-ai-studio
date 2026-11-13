// 纯文本 ⇄ ProseMirror 文档。正文仍以纯文本存储：审校发现、候选和证据都用 UTF-16 偏移，
// 并以 buildAnalysisSourceVersionId(content) 判定版本，所以任何字符（含空白与换行）都不能被编辑器改动。
// 不变式：serialize(parse(s)) === s 对任意字符串成立。
//
// 文档结构只有 doc → paragraph → text。正文按 '\n' 切成段落（每行一段，空行即空段落）；
// '\r'、制表符、全角空格和代理对都作为普通文字保存在段落内。
import type { Node as PMNode, Schema } from '@tiptap/pm/model'

export function splitLines(text: string): string[] {
  return text.split('\n')
}

export function plainTextToDoc(schema: Schema, text: string): PMNode {
  const paragraph = schema.nodes.paragraph
  return schema.nodes.doc.create(null, splitLines(text).map(line => paragraph.create(null, line ? schema.text(line) : null)))
}

export function docToPlainText(doc: PMNode): string {
  const lines: string[] = []
  doc.forEach(block => { lines.push(block.textContent) })
  return lines.join('\n')
}

/**
 * 纯文本偏移 → 文档位置。段落 i 的内容起点为 1 + Σ(len_j + 2)（j < i），
 * 每个段落前后各占一个位置；换行符本身对应段落边界。
 * 偏移恰好落在换行符上时映射到上一段末尾。
 */
export function offsetToPos(doc: PMNode, offset: number): number {
  let remaining = Math.max(0, offset), pos = 1
  for (let i = 0; i < doc.childCount; i++) {
    const len = doc.child(i).content.size
    if (remaining <= len) return pos + remaining
    remaining -= len + 1
    pos += len + 2
  }
  // 超出末尾时停在最后一段末尾
  const last = doc.lastChild
  return last ? pos - 2 : 1
}

/** 文档位置 → 纯文本偏移。段落外的位置（段落之间）归到下一段起点。 */
export function posToOffset(doc: PMNode, pos: number): number {
  let offset = 0, start = 1
  for (let i = 0; i < doc.childCount; i++) {
    const len = doc.child(i).content.size
    if (pos <= start + len) return offset + Math.max(0, pos - start)
    offset += len + 1
    start += len + 2
  }
  return Math.max(0, offset - 1)
}
