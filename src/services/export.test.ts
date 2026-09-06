// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useNovelStore } from '@/stores/novel'
import { exportToTXT, exportToWordHtml, exportToEpub, exportInspirationArchive } from './export'
import JSZip from 'jszip'

afterEach(() => vi.restoreAllMocks())
describe('reader-facing exports', () => {
  it('exports the complete inspiration archive and source URLs without assistant chat or manuscript', async () => {
    setActivePinia(createPinia())
    const store = useNovelStore()
    const book = store.addNovel({ genre: '', subGenre: '', tags: [], targetWordCountMin: 1, targetWordCountMax: 2,
      writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() })
    book.title = '测试/灵感书'
    book.outline = '禁止混入的正文规划'
    store.addChatMessage(book.id, { id: 'chat', role: 'user', content: '禁止混入的助手问题', timestamp: book.createdAt })
    store.setInspirationHistory(book.id, Array.from({ length: 65 }, (_, index) => ({
      id: `idea-${index}`, role: 'assistant', content: `存档第${index}条`, timestamp: book.createdAt,
      search: { protocol: 'responses', status: 'searched', sources: [{ title: '示例来源', url: 'https://example.org/source' }] },
    })))
    const blobs: Blob[] = []
    const filenames: string[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { blobs.push(blob as Blob); return 'blob:synthetic' })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function(this: HTMLAnchorElement) { filenames.push(this.download) })
    exportInspirationArchive(book, 'markdown')
    exportInspirationArchive(book, 'json')
    const markdown = await blobs[0].text()
    const json = JSON.parse((await blobs[1].text()).replace(/^\uFEFF/, ''))
    expect(markdown).toContain('存档第0条')
    expect(markdown).toContain('存档第64条')
    expect(markdown).toContain('[示例来源](<https://example.org/source>)')
    expect(markdown).not.toContain('禁止混入')
    expect(json.messages).toHaveLength(65)
    expect(json.messages[0].search.sources[0].url).toBe('https://example.org/source')
    expect(JSON.stringify(json)).not.toContain('禁止混入')
    expect(filenames).toEqual(['测试_灵感书-灵感记录.md', '测试_灵感书-灵感记录.json'])
  })

  it('omits the outline in body-only TXT/Word while retaining the original full export', async () => {
    setActivePinia(createPinia())
    const store = useNovelStore()
    const book = store.addNovel({ genre: '', subGenre: '', tags: [], targetWordCountMin: 1, targetWordCountMax: 2,
      writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() })
    store.updateOutline(book.id, '不应给读者看的结局剧透')
    store.addChapter(book.id, { title: '开门', content: '窗外下起雨。' })
    const live = store.getNovel(book.id)!
    live.synopsis = '作者尚未公开的简介'
    const blobs: Blob[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { blobs.push(blob as Blob); return 'blob:synthetic' })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    exportToTXT(live, { bodyOnly: true })
    exportToWordHtml(live, { bodyOnly: true })
    exportToTXT(live)
    expect(await blobs[0].text()).not.toContain('结局剧透')
    expect(await blobs[1].text()).not.toContain('结局剧透')
    expect(await blobs[0].text()).not.toContain('尚未公开的简介')
    expect(await blobs[1].text()).not.toContain('尚未公开的简介')
    expect(await blobs[1].text()).toContain('窗外下起雨')
    expect(await blobs[2].text()).toContain('结局剧透')
    expect(await blobs[2].text()).toContain('尚未公开的简介')
    live.chapters[0].chapterIndex = 3
    await exportToEpub(live)
    const zip = await JSZip.loadAsync(await blobs[3].arrayBuffer())
    expect(await zip.file('OEBPS/toc.xhtml')!.async('text')).toContain('chapter_4.xhtml')
    expect(zip.file('OEBPS/chapter_4.xhtml')).not.toBeNull()
  })
})
