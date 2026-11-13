// @vitest-environment happy-dom
vi.mock('@/v3/components/BookPage.vue', () => ({ default: { template: '<div><slot /></div>' } }))
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import * as storyAggregate from '@/services/storyAggregate'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, shallowMount } from '@vue/test-utils'
import CharacterLibrary from '@/v3/characters/CharacterManager.vue'
import { useNovelStore } from '@/stores/novel'
import { useConfigStore } from '@/stores/config'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { loadReconstructionWorkspace } from '@/services/db/reconstruction'
import { saveNovelToDb } from '@/services/db/novels'
import { buildAnalysisSourceVersionId, buildChapterAnalysisCandidates } from '@/services/reconstructionCandidates'
import { applyCandidateChangeToCanon } from '@/services/reconstructionCanon'
import { callAI } from '@/services/ai'

const { route, notify, push } = vi.hoisted(() => ({
  route: { params: { novelId: '' } }, push: vi.fn(), notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))
vi.mock('vue-router', () => ({ useRoute: () => reactive(route), useRouter: () => ({ push }) }))
vi.mock('@/services/ai', () => ({ callAI: vi.fn() }))
vi.mock('naive-ui', async original => ({ ...await original<object>(), useMessage: () => notify }))
const paint = { clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
  fillText: vi.fn(), arc: vi.fn(), fill: vi.fn(), fillRect: vi.fn(), measureText: () => ({ width: 50 }) }

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  vi.spyOn(storyAggregate, 'readStoryAggregate').mockImplementation(async novelId => ({
    novel: useNovelStore().getNovel(novelId) || null,
    workspace: await loadReconstructionWorkspace(novelId),
  }))
  vi.spyOn(storyAggregate, 'saveStoryAggregate').mockResolvedValue()

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(paint as unknown as CanvasRenderingContext2D)
})
afterEach(() => vi.restoreAllMocks())

async function setup() {
  const store = useNovelStore()
  const book = store.addNovel({ genre: 'urban', subGenre: 'business', tags: [], targetWordCountMin: 80, targetWordCountMax: 100,
    writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() })
  const a = await store.addCharacter(book.id, { name: '甲', identity: '工人' })!
  const b = await store.addCharacter(book.id, { name: '乙', identity: '甲的同事' })!
  store.updateOutline(book.id, '甲与乙是同事，合作创业。')
  await saveNovelToDb(book)
  vi.spyOn(useReconstructionWorkspaceStore(), 'hydrateFromPersistence').mockResolvedValue({ candidates: [], reviewFindings: [], chapterReviews: [], aiRuns: [], canonMutations: [] })
  route.params.novelId = book.id
  useConfigStore().models = [{ id: 'fixture', name: 'fixture', baseUrl: 'https://example.test', modelName: 'fixture',
    apiKey: 'synthetic', temperature: 0.7, topP: 0.9, maxTokens: 4000 }]
  const wrapper = shallowMount(CharacterLibrary, { global: { renderStubDefaultSlot: true, stubs: {
    Button: { props: ['disabled'], template: '<button :disabled="disabled"><slot /></button>' },
    Modal: { props: ['show'], template: '<section v-if="show" role="dialog"><slot /><slot name="footer"/><slot name="action"/></section>' },
    Drawer: { props: ['show'], template: '<aside v-if="show"><slot /></aside>' },
    DrawerContent: { props: ['title'], template: '<div><h3>{{ title }}</h3><slot /></div>' },
  } } })
  const button = (text: string) => wrapper.findAll('button').find(item => item.text().includes(text))!
  return { store, book, a, b, wrapper, button }
}

describe('character relationship workflow', () => {
  it('keeps a new character form open through pending and failed writes, then retries once', async () => {
    const { book, wrapper, button } = await setup(), vm = wrapper.vm as any
    await button('手动添加').trigger('click')
    vm.form.name = '新人物'; vm.form.identity = '作者输入的身份'
    let reject!: (error: Error) => void
    vi.mocked(storyAggregate.saveStoryAggregate).mockImplementationOnce(() => new Promise((_, no) => { reject = no }))
    const saving = vm.saveChar()
    await flushPromises()
    expect(vm.savingEdit).toBe(true); expect(vm.showAddModal).toBe(true)
    expect(book.characters).toHaveLength(2)
    reject(new Error('新增写盘失败')); await saving
    expect(vm.form.name).toBe('新人物'); expect(vm.saveError).toBe('新增写盘失败')
    expect(book.characters).toHaveLength(2)
    await vm.saveChar()
    expect(book.characters).toHaveLength(3)
    expect(book.characters[2].identity).toBe('作者输入的身份')
    expect(vm.showAddModal).toBe(false)
    wrapper.unmount()
  })

  it('retains a character detail when deletion fails and closes it only after a successful retry', async () => {
    const { book, a, wrapper } = await setup(), vm = wrapper.vm as any
    vm.selectChar(a)
    vi.mocked(storyAggregate.saveStoryAggregate).mockRejectedValueOnce(new Error('删除写盘失败'))
    expect(await vm.removeChar(a.id)).toBe(false)
    expect(vm.showDetail).toBe(true); expect(book.characters).toHaveLength(2)
    expect(notify.error).toHaveBeenCalledWith('删除写盘失败')
    expect(await vm.removeChar(a.id)).toBe(true)
    expect(vm.showDetail).toBe(false); expect(book.characters).toHaveLength(1)
    wrapper.unmount()
  })

  it('switches chapter relationships and clears stale evidence without restoring the global default', async () => {
    const { book, store, a, b, wrapper, button } = await setup()
    await store.updateCharacter(book.id, a.id, { relationships: [{ targetId: b.id, targetName: b.name, relation: '宿敌', dimension: 'allegiance' }] })
    const first = store.addChapter(book.id, { title: '结盟', content: '甲明确表示信任乙。' })!
    const second = store.addChapter(book.id, { title: '疑云', content: '甲开始怀疑乙。' })!
    const workspace = useReconstructionWorkspaceStore()
    for (const [chapter, relation] of [[first, '信任'], [second, '怀疑']] as const) {
      const candidate = buildChapterAnalysisCandidates(book, chapter, buildAnalysisSourceVersionId(chapter.content), { relationshipChanges: [{ characterId: a.id, targetCharacterId: b.id, dimension: 'trust', relation, evidence: chapter.content }] })[0]
      candidate.status = 'accepted'
      workspace.recordCanonMutation(book.id, applyCandidateChangeToCanon(book, candidate, '2026-10-30T00:00:00.000Z').record)
    }
    await button('关系图').trigger('click'); await flushPromises()
    await wrapper.get('select[aria-label="关系回看章节"]').setValue(first.id)
    expect(wrapper.get('[aria-label="有效人物关系"]').text()).toContain('甲 → 乙｜信任：信任')
    await wrapper.get('select[aria-label="关系回看章节"]').setValue(second.id)
    expect(wrapper.get('[aria-label="有效人物关系"]').text()).toContain('甲 → 乙｜信任：怀疑')
    store.updateChapter(book.id, second.id, { content: '甲开始依赖乙。' }); await flushPromises()
    const projected = wrapper.get('[aria-label="有效人物关系"]').text()
    expect(projected).toContain('阵营：宿敌')
    expect(projected).not.toMatch(/｜信任：(?:信任|怀疑)/)
    expect(wrapper.text()).toContain('关系待核对')
    wrapper.unmount()
  })
  it('queues evidence-bound scan candidates without turning AI output into author definitions', async () => {
    const { store, book, wrapper, button } = await setup()
    const chapter = store.addChapter(book.id, { content: '丙在门外自称白塔调查员。' + '走廊很安静。'.repeat(25) })!
    const workspace = useReconstructionWorkspaceStore()
    vi.spyOn(workspace, 'hydrateFromPersistence').mockResolvedValue({
      candidates: [], reviewFindings: [], chapterReviews: [], aiRuns: [], canonMutations: [],
    })
    const persist = vi.mocked(storyAggregate.saveStoryAggregate)
    persist.mockClear()
    const response = JSON.stringify([
      { name: '丙', identity: '白塔调查员', chapterId: chapter.id, evidence: '丙在门外自称白塔调查员。' },
      { name: '丁', identity: '无依据人物', chapterId: chapter.id, evidence: '正文没有这句话' },
    ])
    vi.mocked(callAI).mockImplementation(async options => { options.onChunk?.(response); return { content: response } })
    await button('AI 扫描角色').trigger('click'); await flushPromises()
    expect(book.characters.map(character => character.name)).toEqual(['甲', '乙'])
    const candidates = workspace.getCandidates(book.id)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ status: 'proposed', chapterId: chapter.id, sourceVersionId: buildAnalysisSourceVersionId(chapter.content) })
    expect(candidates[0].evidence[0].quote).toBe('丙在门外自称白塔调查员。')
    expect(persist).toHaveBeenCalledTimes(1)
    expect(persist.mock.calls[0][0].workspace.candidates).toEqual(candidates)
    expect(push).toHaveBeenCalledWith('/write/' + book.id + '/' + chapter.id)
    wrapper.unmount()
  })
  it('keeps a failed character scan for saving again without another model request or early publication', async () => {
    const { store, book, wrapper, button } = await setup()
    const chapter = store.addChapter(book.id, { content: '丙是一名调查员。' + '安静的走廊。'.repeat(25) })!
    const response = JSON.stringify([{ name: '丙', chapterId: chapter.id, evidence: '丙是一名调查员。' }])
    vi.mocked(callAI).mockResolvedValue({ content: response })
    let reject!: (error: Error) => void
    vi.mocked(storyAggregate.saveStoryAggregate).mockImplementationOnce(() => new Promise((_, no) => { reject = no }))
    await button('AI 扫描角色').trigger('click'); await flushPromises()
    const workspace = useReconstructionWorkspaceStore()
    expect(workspace.getCandidates(book.id)).toHaveLength(0)
    expect(book.characters).toHaveLength(2)
    expect(push).not.toHaveBeenCalled()
    reject(new Error('角色候选写盘失败')); await flushPromises()
    expect(wrapper.get('[aria-label="角色扫描待保存结果"]').text()).toContain('角色候选写盘失败')
    await button('重试保存角色候选').trigger('click'); await flushPromises()
    expect(callAI).toHaveBeenCalledTimes(1)
    expect(workspace.getCandidates(book.id)).toHaveLength(1)
    expect(book.characters).toHaveLength(2)
    expect(push).toHaveBeenCalledWith('/write/' + book.id + '/' + chapter.id)
    wrapper.unmount()
  })

  it('refuses saving a retained character scan after its source changes', async () => {
    const { store, book, wrapper, button } = await setup()
    const chapter = store.addChapter(book.id, { content: '丙是一名调查员。' + '安静的走廊。'.repeat(25) })!
    vi.mocked(callAI).mockResolvedValue({ content: JSON.stringify([{ name: '丙', chapterId: chapter.id, evidence: '丙是一名调查员。' }]) })
    vi.mocked(storyAggregate.saveStoryAggregate).mockRejectedValueOnce(new Error('首次保存失败'))
    await button('AI 扫描角色').trigger('click'); await flushPromises()
    store.updateChapter(book.id, chapter.id, { content: chapter.content.replace('调查员', '冒充者') })
    const writes = vi.mocked(storyAggregate.saveStoryAggregate).mock.calls.length
    await button('重试保存角色候选').trigger('click'); await flushPromises()
    expect(callAI).toHaveBeenCalledTimes(1)
    expect(storyAggregate.saveStoryAggregate).toHaveBeenCalledTimes(writes)
    expect(useReconstructionWorkspaceStore().getCandidates(book.id)).toHaveLength(0)
    expect(wrapper.get('[aria-label="角色扫描待保存结果"]').text()).toContain('正文或角色资料已变化')
    wrapper.unmount()
  })

  it('rejects truncated character scans even when a complete-looking array was received', async () => {
    const { store, book, wrapper, button } = await setup()
    const chapter = store.addChapter(book.id, { content: '丙是一名调查员。' + '安静的走廊。'.repeat(25) })!
    vi.mocked(callAI).mockResolvedValue({ content: JSON.stringify([{ name: '丙', chapterId: chapter.id, evidence: '丙是一名调查员。' }]), finishReason: 'length' })
    await button('AI 扫描角色').trigger('click'); await flushPromises()
    expect(useReconstructionWorkspaceStore().getCandidates(book.id)).toHaveLength(0)
    expect(notify.error).toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it.each(['stop', 'unmount'] as const)('does not save a late character response after %s', async action => {
    const { store, book, wrapper, button } = await setup()
    const chapter = store.addChapter(book.id, { content: '丙是一名调查员。' + '安静的走廊。'.repeat(25) })!
    let finish!: (value: { content: string }) => void
    vi.mocked(callAI).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await button('AI 扫描角色').trigger('click'); await flushPromises()
    if (action === 'stop') await button('停止').trigger('click')
    else wrapper.unmount()
    finish({ content: JSON.stringify([{ name: '丙', chapterId: chapter.id, evidence: '丙是一名调查员。' }]) })
    await flushPromises()
    expect(useReconstructionWorkspaceStore().getCandidates(book.id)).toHaveLength(0)
    expect(push).not.toHaveBeenCalled()
    if (action === 'stop') wrapper.unmount()
  })

  it('keeps a stale edit open and reports the atomic baseline rejection', async () => {
    const { store, book, a, wrapper } = await setup()
    const vm = wrapper.vm as any
    vm.editChar(a)
    await store.updateCharacter(book.id, a.id, { identity: '已被其他操作修改' })

    await vm.saveChar()

    expect(vm.showAddModal).toBe(true)
    expect(vm.saveError).toContain('设定在编辑期间发生变化')
    expect(vm.savingEdit).toBe(false)
    wrapper.unmount()
  })

  it('keeps the editor open when an async entity save fails so it can be retried', async () => {
    const { a, wrapper } = await setup()
    const vm = wrapper.vm as any
    vi.mocked(storyAggregate.saveStoryAggregate).mockRejectedValueOnce(new Error('模拟保存失败'))
    vm.editChar(a)

    await vm.saveChar()

    expect(vm.showAddModal).toBe(true)
    expect(vm.saveError).toBe('模拟保存失败')
    expect(vm.savingEdit).toBe(false)
    wrapper.unmount()
  })

  it('replaces the list with the graph, draws reverse-only edges and refreshes in-place edits', async () => {
    const { store, book, a, b, wrapper, button } = await setup()
    await store.updateCharacter(book.id, b.id, { relationships: [{ targetId: a.id, targetName: a.name, relation: '同事', dimension: 'allegiance' }] })
    await button('关系图').trigger('click')
    await flushPromises()
    expect(wrapper.find('.char-grid').exists()).toBe(false)
    expect(paint.fillText).toHaveBeenCalledWith('阵营：同事', expect.any(Number), expect.any(Number))
    expect(wrapper.get('.graph-legend').text()).toContain('1 条关系')
    paint.fillText.mockClear()
    await store.updateCharacter(book.id, b.id, { relationships: [{ targetId: a.id, targetName: '旧名', relation: '合伙人', dimension: 'allegiance' }] })
    await flushPromises()
    expect(paint.fillText).toHaveBeenCalledWith('阵营：合伙人', expect.any(Number), expect.any(Number))
    await button('列表').trigger('click')
    expect(wrapper.find('canvas').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows empty relationships and applies filters in graph mode', async () => {
    const { wrapper, button } = await setup()
    await button('关系图').trigger('click')
    expect(wrapper.text()).toContain('尚无已确认关系')
    wrapper.findAllComponents({ name: 'Input' })[0].vm.$emit('update:value', '不存在')
    await flushPromises()
    expect(wrapper.find('canvas').exists()).toBe(false)
    expect(wrapper.text()).toContain('没有匹配的角色')
    wrapper.unmount()
  })

  it('requires chapter evidence instead of promoting outline guesses to global relations', async () => {
    const { book, wrapper, button } = await setup()
    await button('补全关系').trigger('click'); await flushPromises()
    expect(book.chapters).toHaveLength(0)
    expect(wrapper.text()).toContain('先创建并撰写章节')
    expect(button('分析所选章节').attributes('disabled')).toBeDefined()
    expect(callAI).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('retains received candidates on storage failure and retries storage without another model call', async () => {
    const { book, store, a, b, wrapper, button } = await setup()
    const chapter = store.addChapter(book.id, { content: '甲明确表示信任乙。' })!
    const workspace = useReconstructionWorkspaceStore()
    const save = vi.spyOn(workspace, 'saveRelationshipCandidates').mockRejectedValueOnce(new Error('模拟保存失败')).mockResolvedValueOnce(1)
    vi.mocked(callAI).mockResolvedValue({ content: JSON.stringify([{ characterId: a.id, targetCharacterId: b.id, relation: '信任', evidence: chapter.content }]) })
    await button('补全关系').trigger('click'); await flushPromises()
    await button('分析所选章节').trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('模拟保存失败')
    expect(wrapper.text()).toContain('已收到 1 条候选')
    expect(a.relationships).toEqual([])
    expect(workspace.getCanonMutations(book.id)).toEqual([])
    await button('重试保存候选').trigger('click'); await flushPromises()
    expect(callAI).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledTimes(2)
    expect(push).toHaveBeenCalledWith('/write/' + book.id + '/' + chapter.id)
    wrapper.unmount()
  })

  it.each(['stop', 'mutate', 'unmount'])('rejects a late scan result after %s', async action => {
    const { store, book, a, b, wrapper, button } = await setup()
    const chapter = store.addChapter(book.id, { content: '甲明确表示信任乙。' })!
    const save = vi.spyOn(useReconstructionWorkspaceStore(), 'saveRelationshipCandidates')
    let finish!: (value: { content: string }) => void
    vi.mocked(callAI).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    await button('补全关系').trigger('click'); await flushPromises()
    await button('分析所选章节').trigger('click'); await flushPromises()
    if (action === 'stop') await button('停止').trigger('click')
    if (action === 'mutate') store.updateChapter(book.id, chapter.id, { content: '甲明确表示怀疑乙。' })
    if (action === 'unmount') wrapper.unmount()
    finish({ content: JSON.stringify([{ characterId: a.id, targetCharacterId: b.id, relation: '信任', evidence: '甲明确表示信任乙。' }]) })
    await flushPromises()
    expect(save).not.toHaveBeenCalled()
    expect(a.relationships).toEqual([])
    if (action !== 'unmount') wrapper.unmount()
  })

  it('opens details by clicking a scaled graph node and includes incoming relationships', async () => {
    const { store, book, a, b, wrapper, button } = await setup()
    await store.updateCharacter(book.id, b.id, { relationships: [{ targetId: a.id, targetName: a.name, relation: '同事', dimension: 'allegiance' }] })
    await button('关系图').trigger('click')
    await flushPromises()
    const canvas = wrapper.get('canvas')
    vi.spyOn(canvas.element, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 350, height: 220 } as DOMRect)
    // The focused character is at the center; hit testing must map the scaled canvas back to its natural size.
    await canvas.trigger('click', { clientX: 175, clientY: 110 })
    expect(wrapper.get('aside').text()).toContain('乙 → 甲')
    expect(wrapper.get('aside').text()).toContain('同事')
    wrapper.unmount()
  })

  it('does not write into another book after navigating away during a scan', async () => {
    const { store, book, a, b, wrapper, button } = await setup()
    const other = store.addNovel({ genre: 'urban', subGenre: 'business', tags: [], targetWordCountMin: 80, targetWordCountMax: 100,
      writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() })
    await saveNovelToDb(other)
    store.addChapter(book.id, { content: '甲明确表示信任乙。' })
    let finish!: (result: { content: string }) => void
    vi.mocked(callAI).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    await button('补全关系').trigger('click'); await flushPromises()
    await button('分析所选章节').trigger('click'); await flushPromises()
    reactive(route).params.novelId = other.id
    await flushPromises()
    expect(vi.mocked(callAI).mock.calls[0][0].signal?.aborted).toBe(true)
    finish({ content: JSON.stringify([{ sourceName: a.name, targetName: b.name, relation: '同事' }]) })
    await flushPromises()
    expect(book.characters[0].relationships).toHaveLength(0)
    expect(other.characters).toHaveLength(0)
    wrapper.unmount()
  })
})
