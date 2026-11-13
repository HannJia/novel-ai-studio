// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { useNovelStore } from '@/stores/novel'
import * as lifecycle from '@/services/appLifecycle'
import * as exporters from '@/services/export'
import * as shell from '@/v3/shell'
import BookExport from './BookExport.vue'

describe('V3 book export', () => {
  let pinia: ReturnType<typeof createPinia>
  let router: ReturnType<typeof createRouter>
  let wrapper: ReturnType<typeof shallowMount>
  let novels: ReturnType<typeof useNovelStore>
  let book: ReturnType<ReturnType<typeof useNovelStore>['addNovel']>

  beforeEach(async () => {
    pinia = createPinia(); setActivePinia(pinia); novels = useNovelStore()
    book = novels.addNovel({ workingTitle: 'V3 导出合成作品', genre: '', subGenre: '', tags: [], targetWordCountMin: 1, targetWordCountMax: 2,
      writingStyle: novels.defaultWritingStyle(), settings: novels.defaultSettings() })
    novels.addChapter(book.id, { title: '修灯', content: '已经采纳的正式正文。' })
    vi.spyOn(lifecycle, 'flushEditorDrafts').mockResolvedValue()
    vi.spyOn(novels, 'flushPendingSaves').mockResolvedValue()
    vi.spyOn(exporters, 'exportToTXT').mockImplementation(() => {})
    vi.spyOn(exporters, 'exportToWordHtml').mockImplementation(() => {})
    vi.spyOn(exporters, 'exportToEpub').mockResolvedValue()
    vi.spyOn(shell, 'toast').mockImplementation(() => {})
    router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/chapters/:novelId', component: {}, meta: { bookTool: 'chapters', title: '章节管理' } }] })
    await router.push('/chapters/' + book.id)
    wrapper = shallowMount(BookExport, { global: { plugins: [pinia, router], stubs: { Teleport: true } } })
  })
  afterEach(() => { wrapper?.unmount(); disposePinia(pinia); vi.restoreAllMocks() })

  it.each(['txt', 'txt-body', 'word', 'word-body', 'epub'])('retains %s export after retiring the workspace shell', async format => {
    await wrapper.get('select[aria-label="导出作品格式"]').setValue(format)
    await wrapper.get('.book-export button').trigger('click'); await flushPromises()
    expect(lifecycle.flushEditorDrafts).toHaveBeenCalledOnce()
    expect(novels.flushPendingSaves).toHaveBeenCalledOnce()
    const target = format === 'epub' ? exporters.exportToEpub : format.startsWith('word') ? exporters.exportToWordHtml : exporters.exportToTXT
    expect(target).toHaveBeenCalledOnce()
    const snapshot = vi.mocked(target).mock.calls[0][0]
    expect(snapshot).not.toBe(book)
    expect(snapshot.chapters[0].content).toBe('已经采纳的正式正文。')
    if (format !== 'epub') expect(vi.mocked(target).mock.calls[0][1]).toEqual({ bodyOnly: format.endsWith('-body') })
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('does not download an outdated snapshot if saving fails', async () => {
    vi.mocked(novels.flushPendingSaves).mockRejectedValueOnce(new Error('磁盘写入失败'))
    await wrapper.get('.book-export button').trigger('click'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('磁盘写入失败')
    expect(exporters.exportToTXT).not.toHaveBeenCalled()
    expect(exporters.exportToWordHtml).not.toHaveBeenCalled()
    expect(exporters.exportToEpub).not.toHaveBeenCalled()
    expect(wrapper.get('.book-export button').attributes('disabled')).toBeUndefined()
  })

  it('stops an export if the author changes books while saving', async () => {
    let finish!: () => void
    vi.mocked(novels.flushPendingSaves).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    await wrapper.get('.book-export button').trigger('click'); await flushPromises()
    await router.push('/chapters/another-book')
    finish(); await flushPromises()
    expect(exporters.exportToTXT).not.toHaveBeenCalled()
    expect(exporters.exportToWordHtml).not.toHaveBeenCalled()
    expect(exporters.exportToEpub).not.toHaveBeenCalled()
  })
})
