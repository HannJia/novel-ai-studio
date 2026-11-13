import { describe, expect, it } from 'vitest'
import {
  buildSelectionRevision,
  captureSelectionSnapshot,
  type SelectionSnapshot,
} from './selectionRevision'

const MAX_SELECTION_LENGTH = 12_000
const MAX_REPLACEMENT_LENGTH = 24_000

function capture(
  baseContent: string,
  startOffset: number,
  endOffset: number,
  mode: SelectionSnapshot['mode'] = 'rewrite',
) {
  return captureSelectionSnapshot({
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    baseContent,
    contextVersion: 'version-1',
    startOffset,
    endOffset,
    mode,
  })
}

function currentFor(snapshot: SelectionSnapshot) {
  return {
    novelId: snapshot.novelId,
    chapterId: snapshot.chapterId,
    content: snapshot.baseContent,
    contextVersion: snapshot.contextVersion,
  }
}

describe('纯选区修订', () => {
  it('捕获选区正文，并允许 continue 使用零长度光标', () => {
    const snapshot = capture('前文🙂后文', 2, 4)
    expect(snapshot.selectedText).toBe('🙂')

    const cursor = capture('前文🙂后文', 2, 2, 'continue')
    expect(cursor.selectedText).toBe('')
  })

  it('拒绝无效身份、偏移、非整数和代理对中间边界', () => {
    expect(() => captureSelectionSnapshot({
      novelId: ' ',
      chapterId: 'chapter-1',
      baseContent: '正文',
      contextVersion: 'version-1',
      startOffset: 0,
      endOffset: 1,
      mode: 'rewrite',
    })).toThrow()

    expect(() => captureSelectionSnapshot({
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      baseContent: '正文',
      contextVersion: '',
      startOffset: 0,
      endOffset: 1,
      mode: 'rewrite',
    })).toThrow()

    expect(() => capture('正文', 1.5, 2)).toThrow()
    expect(() => capture('正文', 0, 3)).toThrow()
    expect(() => capture('正文', 2, 1)).toThrow()

    const emoji = 'A🙂B'
    expect(() => capture(emoji, 2, 3)).toThrow()
    expect(() => capture(emoji, 1, 2)).toThrow()
  })

  it('拒绝非 continue 的空选区、纯空白选区和超长选区', () => {
    expect(() => capture('正文', 1, 1)).toThrow()
    expect(() => capture('   \r\n', 0, 5)).toThrow()
    expect(() => capture('a'.repeat(MAX_SELECTION_LENGTH + 1), 0, MAX_SELECTION_LENGTH + 1)).toThrow()
    expect(capture('a'.repeat(MAX_SELECTION_LENGTH), 0, MAX_SELECTION_LENGTH).selectedText)
      .toHaveLength(MAX_SELECTION_LENGTH)
  })

  it('只替换重复正文中指定的区间，并保留选区外每个字符', () => {
    const content = '同一句\r\n中间内容\r\n同一句'
    const startOffset = content.lastIndexOf('同一句')
    const snapshot = capture(content, startOffset, content.length)

    expect(buildSelectionRevision(snapshot, '改写后的句子', currentFor(snapshot)))
      .toBe('同一句\r\n中间内容\r\n改写后的句子')
  })

  it('continue 在 endOffset 插入并保留原选中文本', () => {
    const content = '开头\r\n已写段落\r\n结尾'
    const startOffset = content.indexOf('已写段落')
    const endOffset = startOffset + '已写段落'.length
    const snapshot = capture(content, startOffset, endOffset, 'continue')

    expect(buildSelectionRevision(snapshot, '续写内容', currentFor(snapshot)))
      .toBe('开头\r\n已写段落续写内容\r\n结尾')
  })

  it('严格拒绝过期版本、正文变化和串章', () => {
    const snapshot = capture('甲乙丙', 1, 2)

    expect(() => buildSelectionRevision(snapshot, '新', {
      ...currentFor(snapshot),
      contextVersion: 'version-2',
    })).toThrow()

    expect(() => buildSelectionRevision(snapshot, '新', {
      ...currentFor(snapshot),
      content: '甲X丙',
    })).toThrow()

    expect(() => buildSelectionRevision(snapshot, '新', {
      ...currentFor(snapshot),
      chapterId: 'chapter-2',
    })).toThrow()

    expect(() => buildSelectionRevision(snapshot, '新', {
      ...currentFor(snapshot),
      novelId: 'novel-2',
    })).toThrow()
  })

  it('拒绝空白或超长 replacement，同时保留 replacement 首尾空白', () => {
    const snapshot = capture('甲乙丙', 1, 2)

    expect(() => buildSelectionRevision(snapshot, '', currentFor(snapshot))).toThrow()
    expect(() => buildSelectionRevision(snapshot, ' \r\n\t ', currentFor(snapshot))).toThrow()
    expect(() => buildSelectionRevision(
      snapshot,
      'x'.repeat(MAX_REPLACEMENT_LENGTH + 1),
      currentFor(snapshot),
    )).toThrow()

    expect(buildSelectionRevision(snapshot, '  新文本  ', currentFor(snapshot)))
      .toBe('甲  新文本  丙')
    expect(buildSelectionRevision(snapshot, snapshot.selectedText, currentFor(snapshot)))
      .toBe(snapshot.baseContent)
  })

  it('保留 CRLF、emoji 和输入对象不变', () => {
    const content = '上文\r\n🙂选中\r\n下文'
    const startOffset = content.indexOf('🙂')
    const endOffset = startOffset + '🙂选中'.length
    const snapshot = capture(content, startOffset, endOffset, 'polish')
    const current = currentFor(snapshot)

    expect(buildSelectionRevision(snapshot, '✨润色✨', current))
      .toBe('上文\r\n✨润色✨\r\n下文')
    expect(snapshot.baseContent).toBe(content)
    expect(snapshot.selectedText).toBe('🙂选中')
    expect(current.content).toBe(content)
  })
})
