import type { EditorDraft, EditorDraftCommand, EditorDraftVersion } from '../types/editorRecovery'
import { assertEditorDraft, assertEditorDraftId, assertEditorDrafts, assertEditorPayload } from './editorRecoveryValidation'

export function editorDraftVersion(draft?: EditorDraft): EditorDraftVersion {
  return { revision: draft?.revision || 0, operationId: draft?.lastOperationId || null }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}'
  return JSON.stringify(value) ?? 'undefined'
}
/** Pure SQL/kernel CAS. Tombstones are retained so delayed writers cannot resurrect discarded input. */
export function applyEditorDraftCommand(rows: EditorDraft[], command: EditorDraftCommand, now: string): { drafts: EditorDraft[]; draft: EditorDraft } {
  assertEditorDraftId(command.id); assertEditorDraftId(command.novelId); assertEditorDraftId(command.operationId)
  assertEditorDrafts(rows, command.novelId)
  if (!command.expected || !Number.isSafeInteger(command.expected.revision) || command.expected.revision < 0
    || (command.expected.revision === 0 ? command.expected.operationId !== null : typeof command.expected.operationId !== 'string')) throw new Error('草稿保存缺少打开时版本。')
  if (command.action !== 'save' && command.action !== 'discard') throw new Error('未知草稿操作。')
  const current = rows.find(row => row.id === command.id)
  if (command.action === 'save') {
    assertEditorPayload(command.draft.payload)
    if (command.draft.id !== command.id || command.draft.novelId !== command.novelId) throw new Error('草稿保存归属不一致。')
  }
  const sameInput = current && (command.action === 'discard' ? current.status === 'discarded' : current.status === 'active'
    && ['id', 'novelId', 'kind', 'scope', 'targetId', 'openedBaseline', 'payload'].every(key =>
      canonical(current[key as keyof EditorDraft]) === canonical(command.draft[key as keyof typeof command.draft])))
  if (current?.lastOperationId === command.operationId) {
    if (current.revision !== command.expected.revision + 1 || !sameInput) throw new Error('同一草稿操作编号内容不一致。')
    return { drafts: rows, draft: current }
  }
  if ((current?.revision || 0) !== command.expected.revision || (current?.lastOperationId || null) !== command.expected.operationId) {
    throw new Error('草稿已被其他编辑或历史恢复更改。当前输入仍保留，请重新选择恢复版本或另存草稿。')
  }
  if (current?.status === 'discarded') throw new Error('该草稿已丢弃，请用新草稿保留当前输入。')
  if (command.action === 'discard' && !current) throw new Error('要丢弃的草稿已不存在。')
  if (current && command.action === 'save' && ['kind', 'scope', 'targetId', 'openedBaseline'].some(key =>
    canonical(current[key as keyof EditorDraft]) !== canonical(command.draft[key as keyof typeof command.draft]))) throw new Error('不能改变草稿原始基线或归属，请另存新草稿。')
  const draft: EditorDraft = command.action === 'save'
    ? { ...command.draft, status: 'active', revision: (current?.revision || 0) + 1, lastOperationId: command.operationId,
      createdAt: current?.createdAt || now, updatedAt: current && current.updatedAt > now ? current.updatedAt : now }
    : { ...current!, payload: null, status: 'discarded', revision: current!.revision + 1, lastOperationId: command.operationId,
      updatedAt: current!.updatedAt > now ? current!.updatedAt : now }
  assertEditorDraft(draft, command.novelId)
  const drafts = [...rows.filter(row => row.id !== draft.id), draft]
  assertEditorDrafts(drafts, command.novelId)
  return { drafts, draft }
}
