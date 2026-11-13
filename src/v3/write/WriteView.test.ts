// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { computed, defineComponent, ref, type Ref } from 'vue'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { useNovelStore } from '@/stores/novel'
import { buildAnalysisSourceVersionId } from '@/services/reconstructionCandidates'
import type { useChapterSession } from './useChapterSession'
import type { useChapterAi } from './useChapterAi'
import type { ChapterWorkflow } from '../selectors/chapterWorkflow'
import type { CandidateChange, ReviewFinding } from '@/types/reconstruction'
import WriteView from './WriteView.vue'

const state = vi.hoisted(() => ({ session: {} as ReturnType<typeof useChapterSession>, ai: {} as ReturnType<typeof useChapterAi> }))
vi.mock('./useChapterSession', () => ({ useChapterSession: () => state.session }))
vi.mock('./useChapterAi', () => ({ useChapterAi: () => state.ai }))
vi.mock('@/composables/useWritingAdvisor', () => ({ useWritingAdvisor: () => ({ error: ref('') }) }))

const revealRange = vi.fn()
const EditorDouble = defineComponent({
  props: ['modelValue', 'marks', 'readonly'], emits: ['selection', 'layout', 'ready', 'mark-click', 'update:modelValue'],
  setup(_props, { expose }) {
    expose({ getSelectionOffsets: () => ({ start: 0, end: 3 }), revealRange, coordsAtOffset: () => ({ top: 250, bottom: 286, left: 200 }) })
    return {}
  },
  template: '<div class="editor-double">{{ modelValue }}</div>',
})

let pinia: ReturnType<typeof createPinia>, wrapper: ReturnType<typeof mount>
let currentChapter: ReturnType<typeof useNovelStore>['novels'][number]['chapters'][number]

function button(text: string) {
  const found = wrapper.findAll('button').find(item => item.text() === text)
  if (!found) throw new Error('按钮不存在：' + text)
  return found
}
async function mountDesk(query: Record<string, string> = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/write/:novelId/:chapterId', component: WriteView },
    { path: '/:pathMatch(.*)*', component: { template: '<div />' } },
  ] })
  await router.push({ path: `/write/${state.session.novel.value!.id}/${currentChapter.id}`, query })
  wrapper = mount(WriteView, { attachTo: document.body, global: { plugins: [pinia, router], stubs: {
    PlainTextEditor: EditorDouble, EditorRecoveryPicker: true, ChapterTimePanel: true, CharacterAvatar: true,
    AiChatAssistant: true, WritingAdvisorSidebar: true, StoryCandidateEditor: true, EventCausalityPanel: true,
  } } })
  await flushPromises()
  return router
}

beforeEach(() => {
  document.body.innerHTML = ['v3-crumb', 'v3-lifecycle', 'v3-tools', 'v3-view-tools', 'v3-status'].map(id => `<div id="${id}"></div>`).join('')
  revealRange.mockReset().mockReturnValue(true)
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1440)
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  pinia = createPinia(); setActivePinia(pinia)
  const novels = useNovelStore()
  const novel = novels.addNovel({ workingTitle: '合成渡口', genre: '', subGenre: '', tags: [], targetWordCountMin: 1, targetWordCountMax: 2,
    settings: novels.defaultSettings(), writingStyle: novels.defaultWritingStyle() })
  novel.volumes.push({ id: 'v1', volumeIndex: 0, title: '灯起', theme: '', summary: '', keyTurningPoints: '', characterChanges: '', estimatedChapters: 2, estimatedWordCount: 1 })
  currentChapter = novels.addChapter(novel.id, { title: '雨夜', content: '林澈推门进来。灯还亮着。\n他没有拆信。'.repeat(12) })!
  currentChapter.status = 'completed'
  const content = ref(currentChapter.content)
  const workflow = ref<ChapterWorkflow>({ status: 'ready_to_finalize', locked: false, saved: true,
    length: { words: currentChapter.wordCount, status: 'within', deficit: 0, excess: 0 }, reviewCurrent: true,
    coverage: { completed: 2, total: 2, covered: content.value.length, chars: content.value.length }, blockers: [], openFindings: [], pendingCandidates: [],
    gate: [{ key: 'review', label: '全章审校', state: 'ok', detail: '当前正文已审校通过' }], primary: 'finalize' })
  state.session = { novel: ref(novel), chapter: ref(currentChapter), title: ref(currentChapter.title), content,
    loading: ref(false), loadError: ref(''), saveError: ref(''), saving: ref(false),
    saved: computed(() => content.value === currentChapter.content),
    contentVersion: computed(() => buildAnalysisSourceVersionId(content.value)), contextVersion: ref('ctx'), reviewSourceVersion: ref('review-source'),
    reviewSignature: ref('signature'), findings: ref([]), candidates: ref([]), latestReview: ref(undefined),
    storyTime: ref({ known: true, startDay: 0, endDay: 1, elapsedDays: 1 }), workflow, drafts: ref([]), pendingRevision: ref(undefined), hasPlan: ref(false),
    saveNow: vi.fn().mockResolvedValue(true), saveTitle: vi.fn(), restoreDraft: vi.fn(), discardDraft: vi.fn(), restoreVersion: vi.fn(),
    refreshRevision: vi.fn(), acceptRevision: vi.fn().mockResolvedValue(true), rejectRevision: vi.fn().mockResolvedValue(true), markChanged: vi.fn(),
  } as unknown as ReturnType<typeof useChapterSession>
  state.ai = { reviewBusy: ref(false), selectionBusy: ref(false), completeBusy: ref(false), statusText: ref(''), error: ref(''),
    reviewReport: ref(''), reviewCoverage: ref(undefined), lastSelection: ref(null), backgroundTasks: ref([]), currentMarks: ref([]),
    generateSelection: vi.fn(), reviewChapter: vi.fn(), completeChapter: vi.fn(), finalizeChapter: vi.fn(),
    acceptCandidate: vi.fn(), rejectCandidate: vi.fn(), deferCandidate: vi.fn(), resolveFinding: vi.fn(),
  } as unknown as ReturnType<typeof useChapterAi>
})
afterEach(() => { wrapper?.unmount(); disposePinia(pinia); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = '' })

describe('V3 写作台原型交互', () => {
  it('hides the internal review schema version in the writing desk', async () => {
    await mountDesk()
    expect(wrapper.get('.desk-side').text()).toContain('全章审校')
    expect(wrapper.get('.desk-side').text()).not.toContain('review-v')
  })

  it('窄屏从定稿核对打开候选案头时收起目录，两个抽屉不会相互遮挡', async () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(540)
    ;(state.session.candidates as Ref<CandidateChange[]>).value = [{ id: 'c-narrow', novelId: state.session.novel.value!.id,
      chapterId: currentChapter.id, type: 'fact', status: 'proposed', proposedValue: '{"title":"灯仍亮着"}',
      evidence: [], createdAt: '', updatedAt: '' } as CandidateChange]
    await mountDesk()
    ;(document.querySelector('[aria-label="切换目录"]') as HTMLButtonElement).click()
    await flushPromises()
    expect(wrapper.find('.tree-side').exists()).toBe(true)
    await button('定稿 · 核对').trigger('click')
    await button('去案头逐条核对').trigger('click')
    expect(wrapper.find('.tree-side').exists()).toBe(false)
    expect(wrapper.get('.desk-side').text()).toContain('灯仍亮着')
    ;(document.querySelector('[aria-label="切换目录"]') as HTMLButtonElement).click()
    await flushPromises()
    expect(wrapper.find('.tree-side').exists()).toBe(true)
    expect(wrapper.find('.desk-side').exists()).toBe(false)
    ;(document.querySelector('[aria-label="切换案头"]') as HTMLButtonElement).click()
    await flushPromises()
    expect(wrapper.find('.tree-side').exists()).toBe(false)
    expect(wrapper.find('.desk-side').exists()).toBe(true)
    expect(state.ai.acceptCandidate).not.toHaveBeenCalled()
  })
  it('从桌面缩到窄屏时保留案头并收起会覆盖它的目录', async () => {
    await mountDesk()
    expect(wrapper.find('.tree-side').exists()).toBe(true)
    expect(wrapper.find('.desk-side').exists()).toBe(true)
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(540)
    window.dispatchEvent(new Event('resize'))
    await flushPromises()
    expect(wrapper.find('.tree-side').exists()).toBe(false)
    expect(wrapper.find('.desk-side').exists()).toBe(true)
  })
  it('展示真实卷章、生命周期与文末检查，专注退出后恢复案头', async () => {
    await mountDesk()
    expect(wrapper.get('.volume-head').text()).toContain('卷1 · 灯起')
    // 稿纸章头按原型把中文章号逐字展开；读屏文本仍是阿拉伯数字章号。
    expect(wrapper.get('.paper-kicker').text()).toMatch(/^第 [一二三四五六七八九十百零 ]+ 章$/)
    expect(wrapper.get('.paper-kicker').attributes('aria-label')).toMatch(/^第\d+章$/)
    expect(document.querySelector('#v3-lifecycle .cur')?.textContent).toBe('可定稿')
    expect(wrapper.get('.chapter-gate').text()).toContain('定稿检查')
    expect(wrapper.get('.gate-stats').text()).toContain('2/2')
    ;(document.querySelector('[aria-label="切换专注模式"]') as HTMLButtonElement).click()
    await flushPromises()
    expect(wrapper.find('.desk-side').exists()).toBe(false)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(wrapper.find('.desk-side').exists()).toBe(true)
  })
  it('写作模式切换只保存偏好，不自动请求模型', async () => {
    await mountDesk()
    const mode = [...document.querySelectorAll<HTMLButtonElement>('#v3-tools button')].find(item => item.textContent === '协作')!
    mode.click(); await flushPromises()
    expect(state.session.novel.value!.writingMode).toBe('ai')
    expect(state.ai.generateSelection).not.toHaveBeenCalled()
    expect(state.ai.completeChapter).not.toHaveBeenCalled()
  })
  it('切换章节前先保存未保存正文', async () => {
    const novels = useNovelStore()
    const second = novels.addChapter(novels.novels[0].id, { title: '旧河', content: '第二章正文。' })!
    state.session.content.value += '\n未保存的正文。'
    const router = await mountDesk()
    const chapterButtons = wrapper.findAll('.tree-item')
    expect(chapterButtons).toHaveLength(2)
    await chapterButtons[1].trigger('click')
    await flushPromises()
    expect(state.session.saveNow).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.params.chapterId).toBe(second.id)
  })
  it('只将有当前审校依据的批注放到页边，旧批注不再错位定位', async () => {
    const finding: ReviewFinding = { id: 'f1', chapterId: currentChapter.id, type: 'knowledge', severity: 'blocker', title: '核对知情', explanation: '尚未拆信。',
      quotedText: '灯还亮着。', startOffset: 1, endOffset: 7, evidence: [], status: 'open', blocksFinalization: true, sourceVersionId: state.session.contentVersion.value }
    ;(state.session.findings as Ref<ReviewFinding[]>).value = [finding]
    await mountDesk()
    expect(wrapper.findAll('.margin-note')).toHaveLength(1)
    await wrapper.get('.margin-note').trigger('click')
    expect(revealRange).toHaveBeenCalledWith(7, 12, { focus: false })
    state.session.workflow.value!.reviewCurrent = false
    await flushPromises()
    revealRange.mockClear()
    expect(wrapper.findAll('.margin-note')).toHaveLength(0)
    await wrapper.get('.finding').trigger('click')
    expect(revealRange).not.toHaveBeenCalled()
    expect(wrapper.get('.finding').text()).toContain('旧版参考')
  })
  it('外部证据定位等待正文和编辑器就绪，失败的早期尝试不消费定位请求', async () => {
    state.session.loading.value = true
    const query = { evidenceVersion: state.session.contentVersion.value, evidenceStart: '7', evidenceEnd: '12' }
    await mountDesk(query)
    expect(revealRange).not.toHaveBeenCalled()
    revealRange.mockReturnValueOnce(false)
    state.session.loading.value = false; await flushPromises()
    expect(revealRange).toHaveBeenCalledWith(7, 12)
    wrapper.getComponent(EditorDouble).vm.$emit('ready'); await flushPromises()
    expect(revealRange).toHaveBeenCalledTimes(2)
    wrapper.getComponent(EditorDouble).vm.$emit('ready'); await flushPromises()
    expect(revealRange).toHaveBeenCalledTimes(2)
    expect(state.session.content.value).toBe(currentChapter.content)
    expect(state.session.saveNow).not.toHaveBeenCalled()
  })
  it('外部证据签名过期或范围越界时不定位，重新进入有效链接仍可定位', async () => {
    const router = await mountDesk({ evidenceVersion: '旧正文版本', evidenceStart: '7', evidenceEnd: '12' })
    expect(revealRange).not.toHaveBeenCalled()
    await router.replace({ query: { evidenceVersion: state.session.contentVersion.value, evidenceStart: '7', evidenceEnd: String(state.session.content.value.length + 1) } })
    await flushPromises(); expect(revealRange).not.toHaveBeenCalled()
    const query = { evidenceVersion: state.session.contentVersion.value, evidenceStart: '7', evidenceEnd: '12' }
    await router.replace({ query }); await flushPromises()
    expect(revealRange).toHaveBeenCalledTimes(1)
    await router.replace({ query: {} }); await flushPromises()
    await router.replace({ query }); await flushPromises()
    expect(revealRange).toHaveBeenCalledTimes(2)
  })
  it('选区工具条不改正文，滚动或 Escape 后收起', async () => {
    await mountDesk()
    const original = state.session.content.value
    wrapper.getComponent(EditorDouble).vm.$emit('selection', { start: 0, end: 3, text: original.slice(0, 3), rect: { left: 100, right: 200, top: 220, bottom: 250 } })
    await flushPromises()
    expect(wrapper.get('[aria-label="选区 AI 操作"]').text()).toContain('润色')
    expect(state.session.content.value).toBe(original)
    await wrapper.get('.write-main').trigger('scroll')
    expect(wrapper.find('.selection-tools').exists()).toBe(false)
    expect(state.ai.generateSelection).not.toHaveBeenCalled()
  })
  it('正文浮签先展示差异，拒绝只调用拒绝事务；上下文过期后禁止采纳', async () => {
    const original = state.session.content.value
    state.session.pendingRevision.value = { id: 'r1', novelId: state.session.novel.value!.id, chapterId: currentChapter.id, baseContent: original,
      proposedContent: '新' + original.slice(1), source: 'ai', status: 'pending', diff: '', reason: '选区候选', createdAt: '', updatedAt: '',
      selection: { mode: 'rewrite', startOffset: 0, endOffset: 1, contextVersion: 'ctx' } }
    await mountDesk()
    expect(wrapper.get('.margin-slip').text()).toContain('未入正文')
    expect(state.session.content.value).toBe(original)
    await button('候选1').trigger('click')
    expect(wrapper.get('.revision-diff').text()).toContain('新')
    ;(state.session.contextVersion as Ref<string>).value = 'changed'
    await flushPromises()
    expect(button('采纳入正文').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.margin-slip').exists()).toBe(false)
    await button('拒绝候选').trigger('click'); await flushPromises()
    expect(state.session.rejectRevision).toHaveBeenCalledOnce()
    expect(state.session.acceptRevision).not.toHaveBeenCalled()
    expect(state.session.content.value).toBe(original)
  })
  it('定稿核对不接受或驳回任何候选，待处理项阻止直接定稿', async () => {
    ;(state.session.candidates as Ref<CandidateChange[]>).value = [{ id: 'c1', novelId: state.session.novel.value!.id, chapterId: currentChapter.id, type: 'fact', status: 'proposed',
      proposedValue: '{"title":"灯仍亮着"}', evidence: [], createdAt: '', updatedAt: '' } as CandidateChange]
    state.session.workflow.value!.gate.push({ key: 'candidates', label: '故事变化候选', state: 'block', detail: '1 条待决定' })
    await mountDesk()
    await button('定稿 · 核对').trigger('click')
    expect(wrapper.get('[role="dialog"]').text()).toContain('灯仍亮着')
    expect(button('确认定稿').attributes('disabled')).toBeDefined()
    await button('返回写作').trigger('click')
    expect(state.ai.acceptCandidate).not.toHaveBeenCalled()
    expect(state.ai.rejectCandidate).not.toHaveBeenCalled()
    expect(state.ai.finalizeChapter).not.toHaveBeenCalled()
  })
  it('只有确认事务真正成功后才显示定稿印章，失败保留检查面板', async () => {
    vi.mocked(state.ai.finalizeChapter).mockRejectedValueOnce(new Error('来源已变化'))
    await mountDesk()
    await button('定稿 · 核对').trigger('click')
    expect(state.ai.finalizeChapter).not.toHaveBeenCalled()
    await button('确认定稿').trigger('click'); await flushPromises()
    expect(wrapper.find('.chapter-seal').exists()).toBe(false)
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
    expect(wrapper.get('.write-toast').text()).toContain('来源已变化')
    vi.mocked(state.ai.finalizeChapter).mockImplementationOnce(async () => { state.session.chapter.value!.status = 'finalized' })
    await button('确认定稿').trigger('click'); await flushPromises()
    expect(wrapper.get('.chapter-seal').text()).toBe('定稿')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })
  it('核对过程中依据变化时禁用提交，不消耗模型请求', async () => {
    await mountDesk()
    await button('定稿 · 核对').trigger('click')
    ;(state.session.reviewSourceVersion as Ref<string>).value = 'new-source'
    await flushPromises()
    expect(button('确认定稿').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[role="dialog"]').text()).toContain('关闭后重新核对')
    expect(state.ai.finalizeChapter).not.toHaveBeenCalled()
  })
})
