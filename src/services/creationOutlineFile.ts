import type { CreationOutlineFormat, CreationOutlineInput } from '@/types/creationEntry'
import { assertCreationOutlineInput, CREATION_OUTLINE_LIMITS, validateCreationOutlineText } from './creationEntryInput'

/** Reads only a user-selected local file. No model, upload, PDF/OCR or URL path. */
export async function readCreationOutlineFile(file: File): Promise<CreationOutlineInput> {
  const format = file.name.split('.').pop()?.toLowerCase()
  if (!format || !['txt', 'md', 'markdown', 'docx'].includes(format)) throw new Error('只支持 UTF-8 TXT、Markdown（.md / .markdown）和 DOCX；不支持 DOC、PDF 或 JSON 设定')
  if (!file.size) throw new Error('文件为空，请重新选择')
  if (file.size > CREATION_OUTLINE_LIMITS.fileBytes) throw new Error('大纲文件不能超过 10 MB')
  let text: string
  if (format === 'docx') {
    // Reuse the bounded ZIP reader and Mammoth extractor. The extension is already fixed to DOCX.
    const { readKnowledgeFile } = await import('./knowledgeImport')
    text = await readKnowledgeFile(file)
  } else {
    const buffer = await file.arrayBuffer()
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer) }
    catch { throw new Error('文本不是有效 UTF-8，请在编辑器中另存为 UTF-8 后重试') }
  }
  validateCreationOutlineText(text)
  const input: CreationOutlineInput = { source: 'file', fileName: file.name, format: format as CreationOutlineFormat, fileBytes: file.size,
    originalText: text, text, capturedAt: new Date().toISOString() }
  assertCreationOutlineInput(input)
  return input
}
