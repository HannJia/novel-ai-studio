// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { NInput } from 'naive-ui'
import VolumeOutline from '@/v3/planning/VolumePlanner.vue'
import { useNovelStore } from '@/stores/novel'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { useConfigStore } from '@/stores/config'
import { callAI } from '@/services/ai'
import type { ReconstructionWorkspaceSnapshot } from '@/types/reconstruction'
import { createEmptyCreationDraft } from '@/types/reconstruction'

const { route, error } = vi.hoisted(() => ({ route: { params: { novelId: '' } }, error: vi.fn() }))
vi.mock('vue-router', () => ({ useRoute: () => route }))
vi.mock('@/services/ai', () => ({ callAI: vi.fn() }))
vi.mock('naive-ui', async original => ({ ...await original<object>(), useMessage: () => ({ error, success: vi.fn(), warning: vi.fn(), info: vi.fn() }) }))
let wrapper: ReturnType<typeof shallowMount>
type VolumeOutlineProps = { compact?: boolean; chapterPlanConfirmed?: boolean }
function setup(props: VolumeOutlineProps = {}) {
  const store = useNovelStore()
  const created = store.addNovel({ genre: 'urban', subGenre: 'mystery', tags: [], targetWordCountMin: 50, targetWordCountMax: 100,
    settings: store.defaultSettings(), writingStyle: store.defaultWritingStyle() })
  const novel = store.getNovel(created.id)!
  store.updateOutline(novel.id, '原始总纲')
  store.setVolumes(novel.id, [0, 1].map(index => ({ id: 'volume-' + index, volumeIndex: index, title: '卷' + index,
    theme: '', summary: '卷纲' + index, keyTurningPoints: '', characterChanges: '', estimatedChapters: 10, estimatedWordCount: 2, versions: [] })))
  store.setChapterPlanConfirmed(novel.id, true)
  route.params.novelId = novel.id
  const snapshot: ReconstructionWorkspaceSnapshot = { candidates: [], reviewFindings: [], chapterReviews: [], canonMutations: [], aiRuns: [] }
  vi.spyOn(useReconstructionWorkspaceStore(), 'transactStory').mockImplementation(async (id, operation) => operation({ novel: store.getNovel(id)!, workspace: snapshot }))
  vi.spyOn(useConfigStore(), 'getModelForTask').mockReturnValue({ id: 'test', modelName: 'test' } as never)
  wrapper = shallowMount(VolumeOutline, { props, global: { renderStubDefaultSlot: true, stubs: {
    Button: { props: ['disabled'], emits: ['click'], template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>' },
  } } })
  return { store, novel }
}
const button = (label: string) => wrapper.findAll('button').find(item => item.text() === label)!
const generated = '## 第1卷《新方向》\n**主题**：调查\n**剧情概要**：找到新线索\n**预估章节数和字数**：约12章，约3万字'
beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks(); vi.mocked(callAI).mockReset() })
afterEach(() => wrapper?.unmount())

describe('volume planning persistence and request baselines', () => {
  it('renders explicit card fields and separates real chapters from estimates', async () => {
    const { store, novel } = setup()
    novel.volumes[0].summary = '卷纲概要\n**目标**：寻找失踪账册。\n- **冲突**: 守灯人拒绝交出钥匙。\n### 收束：揭开旧案。'
    novel.volumes[0].keyTurningPoints = '查到旧档'
    novel.volumes[0].characterChanges = '沈砚开始怀疑'
    store.addChapter(novel.id, { title: '第一章', volumeIndex: 0 })
    store.addChapter(novel.id, { title: '第二章', volumeIndex: 0 })
    await flushPromises()

    const cards = wrapper.findAll('.volc')
    expect(cards).toHaveLength(2)
    expect(cards[0].classes()).toContain('cur')
    expect(cards[0].text()).toContain('目标寻找失踪账册。')
    expect(cards[0].text()).toContain('冲突守灯人拒绝交出钥匙。')
    expect(cards[0].text()).toContain('转折查到旧档')
    expect(cards[0].text()).toContain('收束揭开旧案。')
    expect(cards[0].text()).toContain('已建立 2 章')
    expect(cards[0].text()).toContain('预计 10 章')
    expect(cards[0].text()).not.toContain('共 10 章')
    expect(wrapper.find('.volume-summary').text()).toContain('寻找失踪账册')

    await cards[1].trigger('click')
    expect(cards[0].classes()).not.toContain('cur')
    expect(cards[1].classes()).toContain('cur')
    expect(cards[1].attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('.volume-detail-panel').text()).toContain('卷1')
  })

  it('expands compact cards on selection and keeps the editor visible with an unsaved draft', async () => {
    setup({ compact: true })
    expect(wrapper.find('.volume-detail-panel').exists()).toBe(false)
    await wrapper.find('.volc').trigger('click')
    expect(wrapper.find('.volume-detail-panel').exists()).toBe(true)
    await button('编辑').trigger('click')
    expect(button('收起分卷详情').attributes('disabled')).toBeDefined()
    await button('取消').trigger('click')
    await button('收起分卷详情').trigger('click')
    expect(wrapper.find('.volume-detail-panel').exists()).toBe(false)
  })

  it('marks missing card fields as unfilled without treating character changes as closure', async () => {
    const { novel } = setup()
    novel.volumes[0].characterChanges = '人物变化记录'
    await flushPromises()

    const card = wrapper.find('.volc')
    expect(card.text()).toContain('目标未填写')
    expect(card.text()).toContain('冲突未填写')
    expect(card.text()).toContain('收束未填写')
    expect(card.text()).not.toContain('人物变化记录')
  })

  it('leaves creation-flow confirmation to its parent while keeping volume cards and details', () => {
    setup({ compact: true })
    const labels = wrapper.findAll('button').map(item => item.text())
    expect(wrapper.findAll('.volc')).toHaveLength(2)
    expect(wrapper.find('.volume-nav').exists()).toBe(false)
    expect(labels).not.toContain('确认分卷并生成章节计划')
  })

  it('retains form input after failed save, blocks duplicate actions, and permits retry', async () => {
    const { store, novel } = setup()
    await button('编辑').trigger('click')
    wrapper.findAllComponents(NInput)[2].vm.$emit('update:value', '作者手写的新卷纲')
    await flushPromises()
    let reject!: (error: Error) => void
    vi.spyOn(store, 'updateVolumeWithImpact').mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
    await button('保存').trigger('click')
    expect(button('保存').attributes('disabled')).toBeDefined()
    expect(button('取消').attributes('disabled')).toBeDefined()
    expect(button('确认分卷并生成章节计划').attributes('disabled')).toBeDefined()
    reject(new Error('磁盘失败')); await flushPromises()
    expect(novel.chapterPlanConfirmed).toBe(true)
    expect(wrapper.findAllComponents(NInput)[2].props('value')).toBe('作者手写的新卷纲')
    await button('保存').trigger('click'); await flushPromises()
    expect(novel.volumes[0].summary).toBe('作者手写的新卷纲')
    expect(novel.chapterPlanConfirmed).toBe(false)
    expect(wrapper.find('.edit-form').exists()).toBe(false)
  })

  it('retains the original form baseline when switching between volume drafts', async () => {
    const { store, novel } = setup()
    await button('编辑').trigger('click')
    wrapper.findAllComponents(NInput)[2].vm.$emit('update:value', '未保存的作者输入')
    await wrapper.findAll('.volc')[1].trigger('click')
    await store.updateVolumeWithImpact(novel.id, novel.volumes[0].id, { summary: '另一个窗口已保存' })
    await wrapper.findAll('.volc')[0].trigger('click')
    await button('保存').trigger('click'); await flushPromises()
    expect(novel.volumes[0].summary).toBe('另一个窗口已保存')
    expect(wrapper.findAllComponents(NInput)[2].props('value')).toBe('未保存的作者输入')
    expect(error).toHaveBeenCalledWith(expect.stringContaining('已经变化'))
  })

  it('does not clear approval when generation fails before any volume is saved', async () => {
    const { novel } = setup(), before = JSON.stringify(novel.volumes)
    vi.mocked(callAI).mockRejectedValueOnce(new Error('模型失败'))
    await button('AI 生成分卷规划').trigger('click'); await flushPromises()
    expect(novel.chapterPlanConfirmed).toBe(true)
    expect(JSON.stringify(novel.volumes)).toBe(before)
  })

  it.each(['outline', 'length', 'references', 'contract'] as const)('rejects late generation when %s changed during the request', async field => {
    const { store, novel } = setup(), before = JSON.stringify(novel.volumes)
    let release!: (value: never) => void
    vi.mocked(callAI).mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    await button('AI 生成分卷规划').trigger('click')
    if (field === 'outline') store.updateOutline(novel.id, '请求期间的新总纲')
    else if (field === 'length') novel.targetWordCountMax += 5
    else if (field === 'references') novel.knowledgeBaseIds = ['new-reference']
    else useReconstructionWorkspaceStore().setCreationDraft(novel.id, createEmptyCreationDraft({ id: 'new-direction', now: '2026-11-13T00:00:00Z' }))
    release({ content: generated, finishReason: 'stop' } as never); await flushPromises()
    expect(JSON.stringify(novel.volumes)).toBe(before)
    expect(novel.chapterPlanConfirmed).toBe(true)
    expect(error).toHaveBeenCalledWith(expect.stringContaining('已经变化'))
  })

  it('rejects a late local regeneration after another edit', async () => {
    const { store, novel } = setup()
    let release!: (value: never) => void
    vi.mocked(callAI).mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    await button('局部重生成').trigger('click')
    await store.updateVolumeWithImpact(novel.id, novel.volumes[0].id, { summary: '新保存的卷纲' })
    release({ content: JSON.stringify({ title: '迟到', summary: '旧请求内容' }) } as never); await flushPromises()
    expect(novel.volumes[0].summary).toBe('新保存的卷纲')
    expect(error).toHaveBeenCalledWith(expect.stringContaining('已经变化'))
  })

  it('invalidates confirmation only after successful generation and prevents a truncated result from replacing it', async () => {
    const { novel } = setup(), before = JSON.stringify(novel.volumes)
    vi.mocked(callAI).mockResolvedValueOnce({ content: generated, finishReason: 'length' } as never)
    await button('AI 生成分卷规划').trigger('click'); await flushPromises()
    expect(JSON.stringify(novel.volumes)).toBe(before)
    expect(novel.chapterPlanConfirmed).toBe(true)
    vi.mocked(callAI).mockResolvedValueOnce({ content: generated, finishReason: 'stop' } as never)
    await button('AI 生成分卷规划').trigger('click'); await flushPromises()
    expect(novel.volumes).toHaveLength(1)
    expect(novel.volumes[0].title).toContain('新方向')
    expect(novel.chapterPlanConfirmed).toBe(false)
  })
})
