import type { CreationEntryInput, CreationOutlineInput } from '@/types/creationEntry'

export const CREATION_OUTLINE_LIMITS = { fileBytes: 10 * 1024 * 1024, textCharacters: 500_000 }
const fail = (path: string): never => { throw new Error('创建输入无效：' + path) }
const record = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path)
  return value as Record<string, unknown>
}
const date = (value: unknown, path: string) => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(Date.parse(value))) fail(path)
}
export function validateCreationOutlineText(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('请提供含文字的大纲；空文件和仅含图片的文档不能导入')
  if (value.length > CREATION_OUTLINE_LIMITS.textCharacters) throw new Error('大纲文字超过 50 万字符，请拆分后导入')
  if (value.includes('\0')) throw new Error('文件含有二进制或不支持的文本编码，请另存为 UTF-8 TXT / Markdown')
}
export function assertCreationOutlineInput(value: unknown, path = 'outline', requireSaved = false): asserts value is CreationOutlineInput {
  const input = record(value, path)
  if (input.source !== 'file' && input.source !== 'paste') fail(path + '.source')
  validateCreationOutlineText(input.text)
  validateCreationOutlineText(input.originalText)
  date(input.capturedAt, path + '.capturedAt')
  if (requireSaved || input.savedAt !== undefined) date(input.savedAt, path + '.savedAt')
  if (input.source === 'file') {
    if (typeof input.fileName !== 'string' || !input.fileName.trim() || input.fileName.length > 512 || /[\\/\0]/.test(input.fileName)) fail(path + '.fileName')
    if (!['txt', 'md', 'markdown', 'docx'].includes(input.format as string)) fail(path + '.format')
    if (!Number.isSafeInteger(input.fileBytes) || (input.fileBytes as number) <= 0 || (input.fileBytes as number) > CREATION_OUTLINE_LIMITS.fileBytes) fail(path + '.fileBytes')
  } else if (input.fileName !== undefined || input.fileBytes !== undefined || input.format !== undefined) fail(path + '.source')
}
export function assertCreationEntryInput(value: unknown, path = 'initialInput'): asserts value is CreationEntryInput {
  const input = record(value, path)
  if (!['inspiration', 'outline', 'blank', 'custom'].includes(input.method as string)) fail(path + '.method')
  date(input.savedAt, path + '.savedAt')
  if (input.idea !== undefined && (typeof input.idea !== 'string' || input.idea.length > 4000)) fail(path + '.idea')
  if (input.includeDiscussion !== undefined && typeof input.includeDiscussion !== 'boolean') fail(path + '.includeDiscussion')
  if (input.method === 'outline') assertCreationOutlineInput(input.outline, path + '.outline', true)
  else if (input.outline !== undefined) fail(path + '.outline')
  if (input.method !== 'inspiration' && (input.idea !== undefined || input.includeDiscussion === true)) fail(path + '.idea')
}
/** Ignore the saved marker when deciding whether author edits require another explicit save. */
export function creationOutlineInputSignature(value?: CreationOutlineInput): string {
  if (!value) return ''
  const { savedAt: _saved, ...input } = value
  return JSON.stringify(input)
}
