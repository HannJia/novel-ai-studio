// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, shallowMount } from '@vue/test-utils'
import GenerateOutline from '@/v3/create/DirectionEditor.vue'
import { useNovelStore } from '@/stores/novel'
import { callAI } from '@/services/ai'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { useConfigStore } from '@/stores/config'
import StorySkeletonPicker from '@/components/StorySkeletonPicker.vue'
import StoryContractEditor from '@/components/StoryContractEditor.vue'
import { saveStoryAggregate } from '@/services/storyAggregate'
import type { PlotSkeleton } from '@/types/reconstruction'
import { contractCards, contractCardSignature } from '@/services/storyContract'

const { route, push } = vi.hoisted(() => ({ route: { params: { novelId: '' }, query: {} }, push: vi.fn() }))
const nButtonStub = { props: ['disabled'], emits: ['click'],
  template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>' }
const testModel = { id: 'test', modelName: 'test', maxTokens: 4096, temperature: 0.7, topP: 1 }
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ push }) }))
vi.mock('@/services/ai', async importOriginal => ({
  ...await importOriginal<object>(),
  callAI: vi.fn(),
}))
vi.mock('@/services/storyAggregate', async importOriginal => ({
  ...await importOriginal<object>(),
  readStoryAggregate: vi.fn(async () => ({ novel: null, workspace: { candidates: [], reviewFindings: [], canonMutations: [] } })),
  saveStoryAggregate: vi.fn(async () => {}),
}))
vi.mock('naive-ui', async importOriginal => ({
  ...await importOriginal<object>(), useMessage: () => ({ success: vi.fn(), warning: vi.fn(), info: vi.fn(), error: vi.fn() }),
}))
beforeEach(() => {
  setActivePinia(createPinia()); vi.clearAllMocks()
  route.params.novelId = ''
  route.query = {}
  vi.mocked(saveStoryAggregate).mockResolvedValue()
  vi.spyOn(useNovelStore(), 'saveNovelNow').mockResolvedValue()
  vi.spyOn(useReconstructionWorkspaceStore(), 'hydrateFromPersistence').mockResolvedValue({ candidates: [], reviewFindings: [], canonMutations: [] })
  vi.spyOn(useReconstructionWorkspaceStore(), 'persistToDatabase').mockResolvedValue()
})
async function confirmContract(wrapper: ReturnType<typeof shallowMount>, novelId: string, expectConfirmed = true) {
  const contract = { ...useReconstructionWorkspaceStore().getCreationDraft(novelId)!.contract, centralConflict: '追查事故', endingDirection: '暂不确定' }
  wrapper.getComponent(StoryContractEditor).vm.$emit('confirm', { ...contract, cardConfirmations: contractCards.map(card => ({
    cardId: card.id, signature: contractCardSignature(contract, card.id), confirmedAt: contract.updatedAt,
  })) })
  await flushPromises()
  if (expectConfirmed) await vi.waitFor(() => expect(useReconstructionWorkspaceStore().getCreationDraft(novelId)?.approval.contract).toBe('approved'))
}
async function waitForSkeletonPickerReady(wrapper: ReturnType<typeof shallowMount>) {
  await vi.waitFor(() => expect(wrapper.getComponent(StorySkeletonPicker).props('busy')).toBe(false))
}
function regenerateSkeleton(wrapper: ReturnType<typeof shallowMount>) {
  const picker = wrapper.getComponent(StorySkeletonPicker)
  expect(picker.vm.$.vnode.props?.onRegenerate).toBeTypeOf('function')
  const state = (wrapper.vm.$ as unknown as { setupState: Record<string, unknown> }).setupState
  const request = state.requestSkeletonGeneration
  if (typeof request !== 'function') throw new Error('大纲页未连接骨架生成流程')
  return (request as () => Promise<void>)()
}
function generateOutline(wrapper: ReturnType<typeof shallowMount>) {
  const start = (wrapper.vm.$ as unknown as { setupState: Record<string, unknown> }).setupState.startGenerate
  if (typeof start !== 'function') throw new Error('大纲页未连接大纲生成流程')
  return (start as () => Promise<void>)()
}
function completeSkeleton(skeleton: PlotSkeleton): PlotSkeleton {
  return {
    ...skeleton,
    title: skeleton.title || '作者确认的方案',
    premise: skeleton.premise || '主角循线查明一桩旧案。',
    logline: skeleton.logline || '主角查证线索并揭开旧案真相。',
    promise: skeleton.promise || '逐步解开旧案留下的谜团。',
    ending: skeleton.ending || '主角查明真相并作出选择。',
    beats: skeleton.beats.length ? skeleton.beats.map((beat, index) => ({
      ...beat,
      title: beat.title || `关键节点${index + 1}`,
      description: beat.description || '主角取得一条新线索。',
      relatedCharacterIds: beat.relatedCharacterIds || [],
      relatedPlotlineIds: beat.relatedPlotlineIds || [],
    })) : [{ id: 'test-opening', title: '获得线索', description: '主角找到第一条调查线索。', kind: 'opening',
      relatedCharacterIds: [], relatedPlotlineIds: [] }],
  }
}
async function confirmSkeletonInPicker(wrapper: ReturnType<typeof shallowMount>, novelId: string, skeletonId: string) {
  const picker = wrapper.getComponent(StorySkeletonPicker)
  await waitForSkeletonPickerReady(wrapper)
  const skeleton = useReconstructionWorkspaceStore().getCreationDraft(novelId)!.skeletons.find(item => item.id === skeletonId)!
  picker.vm.$emit('select', skeleton.id)
  await flushPromises()
  picker.vm.$emit('edit', completeSkeleton(skeleton))
  await flushPromises()
  picker.vm.$emit('save')
  await flushPromises()
  picker.vm.$emit('confirm')
  await flushPromises()
}
async function confirmImportedSkeleton(wrapper: ReturnType<typeof shallowMount>, novelId: string) {
  await confirmContract(wrapper, novelId)
  const picker = wrapper.getComponent(StorySkeletonPicker)
  await waitForSkeletonPickerReady(wrapper)
  const skeleton = useReconstructionWorkspaceStore().getCreationDraft(novelId)!.skeletons[0]
  picker.vm.$emit('select', skeleton.id)
  await flushPromises()
  picker.vm.$emit('edit', completeSkeleton(skeleton))
  await flushPromises()
  picker.vm.$emit('save')
  await flushPromises()
  picker.vm.$emit('confirm')
  await flushPromises()
}

describe('editable generated outline', () => {
  it('keeps contract layout when reopening an unapproved direction with a retained outline', async () => {
    const store = useNovelStore()
    const novel = store.addNovel({ genre: 'urban', subGenre: 'mystery', tags: [], targetWordCountMin: 1, targetWordCountMax: 2,
      writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() })
    const retained = '## 小说简介\n作者保留的旧方向大纲'
    store.updateOutline(novel.id, retained)
    route.params.novelId = novel.id
    const wrapper = shallowMount(GenerateOutline)
    try {
      await flushPromises()
      await vi.waitFor(() => expect(wrapper.getComponent(StoryContractEditor).props('busy')).toBe(false))
      expect(wrapper.classes()).not.toContain('outline-ready')
      expect(wrapper.find('.output-container').exists()).toBe(false)
      expect(novel.outline).toBe(retained)
      expect(callAI).not.toHaveBeenCalled()
    } finally { wrapper.unmount() }
  })

  it('retains contract input and exploration with the original baseline and restores them without requesting AI', async () => {
    const store = useNovelStore(), workspace = useReconstructionWorkspaceStore()
    const novel = store.addNovel({ genre: 'urban', subGenre: 'mystery', tags: [], targetWordCountMin: 1, targetWordCountMax: 2,
      writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() })
    route.params.novelId = novel.id
    const wrapper = shallowMount(GenerateOutline)
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.getComponent(StoryContractEditor).props('busy')).toBe(false))
    const baseline = workspace.captureCreationEditBaseline(novel.id)
    const contract = { ...workspace.getCreationDraft(novel.id)!.contract, protagonistFear: '害怕遗忘' }
    const exploration = { input: '尚未发送的想法', messages: [{ id: 'turn', role: 'assistant' as const, content: '部分输出', status: 'running' as const }] }
    wrapper.getComponent(StoryContractEditor).vm.$emit('change', contract, exploration)
    await flushPromises()
    await vi.waitFor(() => expect(workspace.getCreationDraft(novel.id)?.editorDrafts?.length).toBe(1))
    const recovery = workspace.getCreationDraft(novel.id)!.editorDrafts!.slice(-1)[0]
    expect(recovery).toMatchObject({ baseline, surface: 'contract', contract, exploration })
    expect(workspace.getCreationDraft(novel.id)!.contract.protagonistFear).not.toBe('害怕遗忘')
    wrapper.unmount()
    const reopened = shallowMount(GenerateOutline)
    await flushPromises()
    await vi.waitFor(() => expect(reopened.getComponent(StoryContractEditor).props('busy')).toBe(false))
    const editor = reopened.getComponent(StoryContractEditor)
    expect(editor.props('contract').protagonistFear).toBe('害怕遗忘')
    expect(editor.props('exploration')).toMatchObject({ input: '尚未发送的想法', messages: [{ status: 'interrupted' }] })
    expect(callAI).not.toHaveBeenCalled()
    reopened.unmount()
  })
  it('blocks formal contract changes when pending contract recovery fails to save', async () => {
    const store = useNovelStore(), workspace = useReconstructionWorkspaceStore()
    const novel = store.addNovel({ genre: 'urban', subGenre: 'mystery', tags: [], targetWordCountMin: 1, targetWordCountMax: 2,
      writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() })
    route.params.novelId = novel.id
    const wrapper = shallowMount(GenerateOutline)
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.getComponent(StoryContractEditor).props('busy')).toBe(false))
    const original = JSON.parse(JSON.stringify(workspace.getCreationDraft(novel.id)!.contract))
    const failedSave = vi.spyOn(workspace, 'saveCreationRecovery').mockRejectedValue(new Error('模拟恢复保存失败'))
    wrapper.getComponent(StoryContractEditor).vm.$emit('change', { ...original, protagonistFear: '新输入' })
    await flushPromises()
    await confirmContract(wrapper, novel.id, false)
    expect(workspace.getCreationDraft(novel.id)!.contract).toEqual(original)
    expect(callAI).not.toHaveBeenCalled()
    failedSave.mockRestore()
    const retry = (wrapper.vm.$ as unknown as { setupState: { retryRecoverySaves: () => Promise<void> } }).setupState.retryRecoverySaves
    await retry()
    wrapper.unmount()
  })
  it('keeps a truncated model outline as an unconfirmed candidate and restores it without another request', async () => {
    const store = useNovelStore(), workspace = useReconstructionWorkspaceStore(), config = useConfigStore()
    const novel = store.addNovel({ genre: 'urban', subGenre: 'business', tags: [], targetWordCountMin: 1, targetWordCountMax: 1,
      writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() })
    route.params.novelId = novel.id
    config.isConfigured = true
    vi.spyOn(config, 'getModelForTask').mockReturnValue(testModel as never)
    vi.mocked(callAI).mockResolvedValueOnce({ content: JSON.stringify({ skeletons: [
      { title: '调查', premise: '查证旧信', logline: '主角追查旧信并查明误会。',
        promise: '逐步揭开旧信背后的真相。', ending: '主角澄清误会并作出选择。',
        beats: [{ title: '找到旧信', description: '主角发现一封被隐藏的旧信。', kind: 'opening' }] },
    ] }), finishReason: 'stop' })
    const options = { global: { renderStubDefaultSlot: true, stubs: {
      NButton: nButtonStub,
      StorySkeletonPicker: false,
      StoryContractEditor: false,
    } } }
    const wrapper = shallowMount(GenerateOutline, options)
    await flushPromises()
    await confirmContract(wrapper, novel.id)
    await waitForSkeletonPickerReady(wrapper)
    await regenerateSkeleton(wrapper)
    expect(workspace.getCreationDraft(novel.id)!.skeletons).toHaveLength(1)
    await confirmSkeletonInPicker(wrapper, novel.id, workspace.getCreationDraft(novel.id)!.skeletons[0].id)
    vi.mocked(callAI).mockImplementationOnce(async input => {
      input.onChunk?.('## 小说简介\n被截断但必须保留的候选')
      return { content: '## 小说简介\n被截断但必须保留的候选', finishReason: 'length' }
    })
    expect(callAI).toHaveBeenCalledTimes(1)
    await generateOutline(wrapper)
    await flushPromises()
    expect(callAI).toHaveBeenCalledTimes(2)
    expect(workspace.getCreationDraft(novel.id)!.outlineCandidate).toMatchObject({ source: 'model', complete: false })
    expect(novel.outline).toBe('')
    expect(wrapper.get('.generate-error').text()).toContain('length')
    expect(wrapper.find('.generate-actions').exists()).toBe(true)
    expect(push).not.toHaveBeenCalled()
    wrapper.unmount()
    const reopened = shallowMount(GenerateOutline, options)
    await flushPromises()
    expect(reopened.get('.output-content').text()).toContain('被截断但必须保留')
    expect(reopened.get('.generate-error').text()).toContain('已恢复未完整')
    expect(callAI).toHaveBeenCalledTimes(2)
    reopened.unmount()
  })

  it('rejects a skeleton response when the contract changed while the request was running', async () => {
    const store = useNovelStore(), workspace = useReconstructionWorkspaceStore(), config = useConfigStore()
    const novel = store.addNovel({ genre: 'urban', subGenre: 'business', tags: [], targetWordCountMin: 1, targetWordCountMax: 1,
      writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() })
    route.params.novelId = novel.id
    config.isConfigured = true
    vi.spyOn(config, 'getModelForTask').mockReturnValue(testModel as never)
    let reply!: (value: { content: string; finishReason: string }) => void
    vi.mocked(callAI).mockImplementationOnce(() => new Promise(resolve => { reply = resolve }))
    const wrapper = shallowMount(GenerateOutline, { global: { stubs: { NButton: nButtonStub,
      StorySkeletonPicker: false, StoryContractEditor: false } } })
    await flushPromises()
    await confirmContract(wrapper, novel.id)
    await waitForSkeletonPickerReady(wrapper)
    void regenerateSkeleton(wrapper)
    await flushPromises()
    expect(callAI).toHaveBeenCalledTimes(1)
    const draft = workspace.getCreationDraft(novel.id)!
    workspace.setCreationDraft(novel.id, { ...draft, contract: { ...draft.contract, title: '作者另开窗口更新的标题' } })
    reply({ content: JSON.stringify({ skeletons: [{ title: '旧方向', premise: '旧请求输出' }] }), finishReason: 'stop' })
    await flushPromises()
    expect(workspace.getCreationDraft(novel.id)!.contract.title).toBe('作者另开窗口更新的标题')
    expect(workspace.getCreationDraft(novel.id)!.skeletons).toEqual([])
    expect(wrapper.get('.generate-error').text()).toContain('已经变化')
    wrapper.unmount()
  })

  it('supports a manual outline without an AI model, but still requires contract and skeleton confirmation', async () => {
    const store = useNovelStore()
    const novel = store.addNovel({ genre: 'urban', subGenre: 'business', tags: [], targetWordCountMin: 80, targetWordCountMax: 100,
      writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() })
    route.params.novelId = novel.id
    const wrapper = shallowMount(GenerateOutline, { global: { renderStubDefaultSlot: true, stubs: {
      Button: { props: ['disabled'], emits: ['click'], template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>' },
    } } })
    await flushPromises()
    expect(wrapper.find('[aria-label="手动准备大纲"]').exists()).toBe(false)
    await confirmContract(wrapper, novel.id)
    wrapper.get('[aria-label="手动准备大纲"]').getComponent({ name: 'Input' }).vm.$emit('update:value', '## 小说简介\n作者自己的故事\n## 第一卷：启程\n预估章节数：10章\n预估字数：2万字')
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.findAll('button').find(button => button.text() === '保存大纲并核对骨架')!.attributes('disabled')).toBeUndefined())
    await wrapper.findAll('button').find(button => button.text() === '保存大纲并核对骨架')!.trigger('click')
    await vi.waitFor(() => expect(useReconstructionWorkspaceStore().getCreationDraft(novel.id)?.outlineCandidate?.content).toContain('作者自己的故事'))
    expect(novel.outline).toBe('')
    const draft = useReconstructionWorkspaceStore().getCreationDraft(novel.id)!
    expect(draft.approval.skeleton).not.toBe('approved')
    expect(draft.skeletons[0].approval).toBe('draft')
    expect(draft.outlineCandidate?.skeletonId).toBe(draft.skeletons[0].id)
    expect(callAI).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('does not approve or generate when persisting the contract fails', async () => {
    const store = useNovelStore(), workspace = useReconstructionWorkspaceStore()
    const novel = store.addNovel({ genre: 'urban', subGenre: 'business', tags: [], targetWordCountMin: 80, targetWordCountMax: 100,
      writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() })
    route.params.novelId = novel.id
    useConfigStore().isConfigured = true
    const wrapper = shallowMount(GenerateOutline)
    await flushPromises()
    vi.mocked(saveStoryAggregate).mockRejectedValueOnce(new Error('磁盘写入失败'))
    await confirmContract(wrapper, novel.id, false)
    expect(workspace.getCreationDraft(novel.id)?.contract.approval).toBe('draft')
    expect(callAI).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('waits for the edited skeleton to be selected and confirmed before generating the outline', async () => {
    const store = useNovelStore()
    const novel = store.addNovel({ genre: 'urban', subGenre: 'business', tags: [], targetWordCountMin: 80, targetWordCountMax: 100,
      writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() })
    route.params.novelId = novel.id
    const workspace = useReconstructionWorkspaceStore()
    vi.spyOn(workspace, 'hydrateFromPersistence').mockResolvedValue({ candidates: [], reviewFindings: [], canonMutations: [] })
    vi.spyOn(workspace, 'persistToDatabase').mockResolvedValue()
    const config = useConfigStore()
    config.isConfigured = true
    vi.spyOn(config, 'getModelForTask').mockReturnValue(testModel as never)
    vi.mocked(callAI).mockResolvedValueOnce({ content: JSON.stringify({ skeletons: [
      { title: '创业路线', premise: '离职创业', logline: '经营工厂', promise: '实现自主创业', ending: '成为企业家', beats: [
        { title: '离开原岗位', description: '主角辞职并准备创业。', kind: 'opening' },
      ] },
      { title: '调查路线', premise: '追查事故', logline: '揭开谜团', promise: '查明事故真相', ending: '揭露真相', beats: [
        { title: '找到证人', description: '主角找到事故的第一位知情人。', kind: 'opening' },
      ] },
    ] }) } as never)
    const wrapper = shallowMount(GenerateOutline, { global: { renderStubDefaultSlot: true, stubs: { NButton: nButtonStub,
      StorySkeletonPicker: false, StoryContractEditor: false } } })
    await flushPromises()
    expect(callAI).not.toHaveBeenCalled()
    await confirmContract(wrapper, novel.id)
    await waitForSkeletonPickerReady(wrapper)
    await regenerateSkeleton(wrapper)
    expect(callAI).toHaveBeenCalledTimes(1)
    expect(novel.outline).toBe('')
    const picker = wrapper.getComponent(StorySkeletonPicker)
    const selectedId = workspace.getCreationDraft(novel.id)!.skeletons[1].id
    await picker.findAll('.comparison thead button')[1].trigger('click')
    await vi.waitFor(() => expect(picker.props('selectedId')).toBe(selectedId))
    await waitForSkeletonPickerReady(wrapper)
    await picker.get('textarea[aria-label="结局方向"]').setValue('作者修改的结局：公开证据后离开城市')
    expect(callAI).toHaveBeenCalledTimes(1)
    picker.vm.$emit('save')
    await vi.waitFor(() => expect(workspace.getCreationDraft(novel.id)!.skeletons.find(item => item.id === selectedId)?.ending)
      .toBe('作者修改的结局：公开证据后离开城市'))
    picker.vm.$emit('confirm')
    await vi.waitFor(() => expect(workspace.getCreationDraft(novel.id)?.approval.skeleton).toBe('approved'))
    expect(callAI).toHaveBeenCalledTimes(1)
    const outline = ['推荐书名', '小说简介', '主线剧情走向', '主要角色表', '核心冲突', '分卷建议', '预估总字数分配', '全书伏笔'].map(title => '## ' + title + '\n展开内容').join('\n')
    vi.mocked(callAI).mockImplementationOnce(async input => {
      input.onChunk?.(outline)
      return { content: outline } as never
    })
    await generateOutline(wrapper)
    await flushPromises()
    expect(callAI).toHaveBeenCalledTimes(2)
    const messages = JSON.stringify(vi.mocked(callAI).mock.calls[1][0].messages)
    expect(messages).toContain('公开证据后离开城市')
    expect(messages).not.toContain('成为企业家')
    expect(novel.outline).toBe('')
    expect(workspace.getCreationDraft(novel.id)?.outlineCandidate?.content).toContain('展开内容')
    expect(workspace.getCreationDraft(novel.id)?.approval.skeleton).toBe('approved')
    wrapper.unmount()
  })
  it('loads an existing draft without making an AI request, then plans from saved edits', async () => {
    const store = useNovelStore()
    const novel = store.addNovel({ genre: 'urban', subGenre: 'business', tags: [], targetWordCountMin: 80, targetWordCountMax: 100,
      writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() })
    store.updateOutline(novel.id, '## 第一卷：旧计划\n预估章节数：20章\n预估字数：4.4万字')
    route.params.novelId = novel.id
    const wrapper = shallowMount(GenerateOutline, { global: { renderStubDefaultSlot: true, stubs: {
      Button: { props: ['disabled'], emits: ['click'], template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>' },
    } } })
    await flushPromises()
    expect(callAI).not.toHaveBeenCalled()
    expect(wrapper.findAll('button').find(item => item.text().includes('确认并规划分卷'))).toBeUndefined()
    await confirmImportedSkeleton(wrapper, novel.id)
    const toolbar = wrapper.get('[aria-label="大纲编辑操作"]')
    expect(toolbar.find('.output-content').exists()).toBe(false)
    expect(wrapper.get('.outline-output-scroll').find('.outline-edit-toolbar').exists()).toBe(false)
    expect(wrapper.get('.outline-output-scroll').get('.output-content').text()).toContain('旧计划')
    expect(wrapper.findAll('button').find(item => item.text() === '编辑大纲')!.attributes('disabled')).toBeUndefined()
    await wrapper.findAll('button').find(item => item.text() === '编辑大纲')!.trigger('click')
    const confirm = wrapper.findAll('button').find(item => item.text().includes('确认并规划分卷'))!
    expect(confirm.attributes('disabled')).toBeDefined()
    wrapper.findAllComponents({ name: 'Input' })[0].vm.$emit('update:value', '## 第一卷：下海\n**预估章节数：** 约97章\n**预估字数：** 约21.3万字')
    await flushPromises()
    await wrapper.findAll('button').find(item => item.text() === '保存修改')!.trigger('click')
    await vi.waitFor(() => expect(confirm.attributes('disabled')).toBeUndefined())
    await confirm.trigger('click')
    await vi.waitFor(() => expect(push).toHaveBeenCalled())
    expect(novel.outline).toContain('下海')
    expect(novel.volumes[0]).toMatchObject({ estimatedChapters: 97, estimatedWordCount: 21.3 })
    expect(push).toHaveBeenCalledWith({ path: `/generate/${novel.id}`, query: { step: 'volumes' } })
    wrapper.unmount()
  })

  it('keeps edited text on save failure and blocks confirmation until a successful retry', async () => {
    const store = useNovelStore()
    const novel = store.addNovel({ genre: 'urban', subGenre: 'business', tags: [], targetWordCountMin: 80, targetWordCountMax: 100,
      writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() })
    store.updateOutline(novel.id, '## 第一卷：原来的方向')
    route.params.novelId = novel.id
    const wrapper = shallowMount(GenerateOutline, { global: { renderStubDefaultSlot: true, stubs: {
      Button: { props: ['disabled'], emits: ['click'], template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>' },
    } } })
    await flushPromises()
    await confirmImportedSkeleton(wrapper, novel.id)
    await wrapper.findAll('button').find(button => button.text() === '编辑大纲')!.trigger('click')
    const input = wrapper.get('.outline-output-scroll').getComponent({ name: 'Input' })
    input.vm.$emit('update:value', '## 第一卷：作者保留的修改')
    await flushPromises()
    let rejectSave!: (reason: Error) => void
    vi.spyOn(useReconstructionWorkspaceStore(), 'commitCreationEdit').mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectSave = reject }))
    const save = wrapper.findAll('button').find(button => button.text() === '保存修改')!
    const confirm = wrapper.findAll('button').find(button => button.text().includes('确认并规划分卷'))!
    await save.trigger('click')
    await flushPromises()
    expect(save.attributes('disabled')).toBeDefined()
    expect(confirm.attributes('disabled')).toBeDefined()
    expect(novel.outline).toBe('## 第一卷：原来的方向')
    rejectSave(new Error('磁盘写入失败'))
    await flushPromises()
    expect(save.attributes('disabled')).toBeUndefined()
    expect(input.props('value')).toBe('## 第一卷：作者保留的修改')
    expect(confirm.attributes('disabled')).toBeDefined()
    expect(push).not.toHaveBeenCalled()
    await save.trigger('click')
    await vi.waitFor(() => expect(confirm.attributes('disabled')).toBeUndefined())
    expect(novel.outline).toBe('## 第一卷：原来的方向')
    expect(useReconstructionWorkspaceStore().getCreationDraft(novel.id)?.outlineCandidate?.content).toBe('## 第一卷：作者保留的修改')
    wrapper.unmount()
  })

  it('keeps an old open outline form from overwriting a concurrent author update', async () => {
    const store = useNovelStore(), workspace = useReconstructionWorkspaceStore()
    const novel = store.addNovel({ genre: 'urban', subGenre: 'business', tags: [], targetWordCountMin: 1, targetWordCountMax: 1,
      writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() })
    store.updateOutline(novel.id, '## 第一卷：原方向')
    route.params.novelId = novel.id
    const wrapper = shallowMount(GenerateOutline, { global: { renderStubDefaultSlot: true, stubs: {
      Button: { props: ['disabled'], emits: ['click'], template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>' },
    } } })
    await flushPromises()
    await confirmImportedSkeleton(wrapper, novel.id)
    await wrapper.findAll('button').find(button => button.text() === '编辑大纲')!.trigger('click')
    const input = wrapper.get('.outline-output-scroll').getComponent({ name: 'Input' })
    input.vm.$emit('update:value', '## 第一卷：旧窗口的手工输入')
    store.updateOutline(novel.id, '## 第一卷：另一个窗口刚保存的内容')
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '保存修改')!.trigger('click')
    await flushPromises()
    expect(novel.outline).toBe('## 第一卷：另一个窗口刚保存的内容')
    expect(input.props('value')).toBe('## 第一卷：旧窗口的手工输入')
    expect(workspace.getCreationDraft(novel.id)!.outlineCandidate).toBeUndefined()
    wrapper.unmount()
  })

  it('explains the temporary edit lock while volume planning is running', async () => {
    const store = useNovelStore()
    const novel = store.addNovel({ genre: 'urban', subGenre: 'business', tags: [], targetWordCountMin: 80, targetWordCountMax: 100,
      writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() })
    store.updateOutline(novel.id, '## 总大纲\n可以编辑的正文')
    route.params.novelId = novel.id
    // Hold the transition to exercise the accepting state without an AI call.
    let saved!: () => void
    push.mockImplementationOnce(() => new Promise<void>(resolve => { saved = resolve }))
    const wrapper = shallowMount(GenerateOutline, { global: { renderStubDefaultSlot: true, stubs: {
      Button: { props: ['disabled'], emits: ['click'], template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>' },
    } } })
    await flushPromises()
    await confirmImportedSkeleton(wrapper, novel.id)
    await wrapper.findAll('button').find(item => item.text().includes('确认并规划分卷'))!.trigger('click')
    await flushPromises()
    expect(wrapper.get('.outline-edit-status').text()).toContain('正在规划分卷')
    expect(wrapper.findAll('button').find(item => item.text() === '编辑大纲')!.attributes('disabled')).toBeDefined()
    saved()
    await flushPromises()
    wrapper.unmount()
  })
})
