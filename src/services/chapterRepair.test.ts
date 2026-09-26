import { describe, expect, it } from 'vitest'
import { applyChapterEdits } from './chapterRepair'

const source = '前景不变。'.repeat(80) + '他在五月三日抵达。' + '后景不变。'.repeat(80)
describe('targeted chapter edits', () => {
  it('only changes the exactly located text', () => {
    expect(applyChapterEdits(source, { edits: [{ original: '五月三日', replacement: '五月四日' }] }))
      .toBe(source.replace('五月三日', '五月四日'))
  })
  it('locates a unique sentence despite quote, punctuation and whitespace differences', () => {
    const text = '前景不变。'.repeat(30) + '他说：“走吧”，然后停下。\n他回答：‘好’。' + '后景不变。'.repeat(30)
    const result = applyChapterEdits(text, {
      edits: [{
        original: '他说:\"走吧\", 然后停下。 他回答:\'好\'。',
        replacement: '他说：“先走吧”，然后停下。\n他回答：“好”。',
      }],
    })
    expect(result).toBe(text.replace('他说：“走吧”，然后停下。\n他回答：‘好’。', '他说：“先走吧”，然后停下。\n他回答：“好”。'))
  })
  it('rejects a normalized anchor when it could refer to two places', () => {
    const text = '“不要”他说。中间还有别的事。\"不要\"他说。'
    expect(() => applyChapterEdits(text, { edits: [{ original: '「不要」他说。', replacement: '“可以”他说。' }] }))
      .toThrow('第 1 处引用在正文中出现多次')
  })
  it('identifies which edit does not match and preserves all earlier edits', () => {
    expect(() => applyChapterEdits(source, {
      edits: [
        { original: '五月三日', replacement: '五月四日' },
        { original: '不存在的句子', replacement: '替换文本' },
      ],
    })).toThrow('第 2 处引用与当前正文不一致')
    expect(source).toContain('五月三日')
  })
  it.each([
    { edits: [{ original: '五月十日', replacement: '五月四日' }] },
    { edits: [{ original: '前景不变。', replacement: '全换了' }] },
    { edits: [{ original: '五月三日', replacement: '' }] },
    { edits: [{ original: '五月三日', replacement: '五月三日' }] },
    { edits: [] }, {},
    { needsFullRewrite: true, edits: [] },
    { edits: [{ original: source, replacement: '整章重写' }] },
    { edits: [{ original: '五月三日', replacement: '五月四日' }, { original: '五月三日抵达', replacement: '六月出发' }] },
  ])('rejects unsafe or unlocatable changes atomically', payload => {
    expect(() => applyChapterEdits(source, payload)).toThrow()
    expect(source).toContain('五月三日')
  })
})
