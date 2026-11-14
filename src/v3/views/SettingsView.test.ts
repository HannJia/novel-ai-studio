// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { URL as NodeURL } from 'node:url'
import { createPinia, setActivePinia } from 'pinia'
import { computed } from 'vue'
import { createMemoryHistory, createRouter, matchedRouteKey, type Router } from 'vue-router'
import { flushPromises, shallowMount, type VueWrapper } from '@vue/test-utils'
import SettingsView from '@/v3/views/SettingsView.vue'
import { useConfigStore } from '@/stores/config'
import { listAvailableModels, testConnection } from '@/services/ai'
import ModelSearchTest from '@/components/ModelSearchTest.vue'
import { testChatSearch } from '@/services/chatSearch'
import { modelConnectionFingerprint } from '@/services/modelConnectionTest'
import { version as appVersion } from '../../../package.json'

vi.mock('@/services/ai', async importOriginal => ({
  ...await importOriginal<object>(), listAvailableModels: vi.fn(), testConnection: vi.fn(),
}))
vi.mock('@/services/embeddings', async importOriginal => ({
  ...await importOriginal<object>(), testEmbeddingConnection: vi.fn(),
}))
const dialog = vi.hoisted(() => ({ warning: vi.fn() }))
vi.mock('@/services/chatSearch', async original => ({ ...await original<object>(), testChatSearch: vi.fn() }))
vi.mock('naive-ui', async importOriginal => ({
  ...await importOriginal<object>(),
  useMessage: () => ({ success: vi.fn(), warning: vi.fn(), info: vi.fn(), error: vi.fn() }),
  useDialog: () => dialog,
}))

const ids = ['claude-opus-4-6-thinking', 'claude-opus-5', 'claude-sonnet-5']
const aliasPlaceholder = '如：主用接口 / 备用接口；留空使用模型 ID'
const modelPlaceholder = '如：deepseek-chat / gpt-4o / qwen-max'
const mounted: ReturnType<typeof shallowMount>[] = []
let router: Router

function mountSettings(realSearchTest = false) {
  const wrapper = shallowMount(SettingsView, { global: {
    plugins: [router],
    provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) },
    renderStubDefaultSlot: true, stubs: {
    Button: { props: ['disabled'], emits: ['click'], template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>' },
    Modal: { props: ['show'], template: '<section v-if="show"><slot /><slot name="action" /></section>' },
    Input: { props: ['value', 'placeholder'], emits: ['update:value'],
      template: '<input :value="value" :placeholder="placeholder" @input="$emit(\'update:value\', $event.target.value)" />' },
    ...(realSearchTest ? { ModelSearchTest: false } : {}),
  } } })
  mounted.push(wrapper)
  return wrapper
}

async function selectSection(wrapper: ReturnType<typeof mountSettings>, label: string) {
  await wrapper.findAll('.settings-nav-item').find(tab => tab.text() === label)!.trigger('click')
  await flushPromises()
}

function addLegacyModel(modelName = ids[0], name = 'Claude Sonnet 5') {
  return useConfigStore().addModel({ name, modelName, baseUrl: 'https://example.test', apiKey: 'synthetic-test-key',
    maxTokens: 4096, temperature: 0.7, topP: 0.9 })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise })
  return { promise, resolve, reject }
}

function refreshIsBlocked() {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

beforeEach(async () => {
  router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/settings', component: SettingsView },
    { path: '/outside', component: { template: '<div />' } },
    { path: '/', component: { template: '<div />' } },
  ] })
  await router.push('/settings')
  setActivePinia(createPinia())
  vi.stubGlobal('crypto', webcrypto)
  localStorage.clear()
  sessionStorage.clear()
  vi.clearAllMocks()
  vi.mocked(testConnection).mockReset()
  vi.mocked(listAvailableModels).mockResolvedValue(ids.map(id => ({ id, ownedBy: 'custom' })))
})
afterEach(async () => {
  await useConfigStore().saveConfig()
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  vi.restoreAllMocks()
})

describe('模型原始名称与配置备注', () => {
  it.each([
    { section: 'cloud', label: '云同步与历史', selector: '.cloud-settings-section' },
    { section: 'about', label: '关于', selector: '.about-section' },
  ])('opens the requested $section settings section from the shell deep link', async ({ section, label, selector }) => {
    await router.replace({ query: { section } })
    const wrapper = mountSettings()
    await flushPromises()
    expect(wrapper.findAll('.settings-nav-item').find(tab => tab.text() === label)!.attributes('aria-selected')).toBe('true')
    expect(wrapper.get(selector).isVisible()).toBe(true)
  })

  it('combines about and updates, and highlights the real workflow limits', async () => {
    const wrapper = mountSettings()
    const tabs = wrapper.findAll('.settings-nav-item')
    expect(tabs.map(tab => tab.text())).toEqual(['模型配置', '任务分配', 'AI 工作流', '外观', '语义检索', '写作技能', '云同步与历史', '关于'])
    expect(tabs[0].attributes('aria-selected')).toBe('true')
    await tabs.find(tab => tab.text() === '关于')!.trigger('click')
    await flushPromises()
    expect(wrapper.get('.about-section').isVisible()).toBe(true)
    expect(wrapper.get('.about-update').text()).toContain('软件更新')
    useConfigStore().aiWorkflowMode = 'balanced'
    await flushPromises()
    expect(wrapper.findAll('.workflow-rounds-value').map(node => node.text())).toEqual(['2 轮', '2 轮'])
    useConfigStore().aiWorkflowMode = 'strict'
    await flushPromises()
    expect(wrapper.findAll('.workflow-rounds-value').map(node => node.text())).toEqual(['3 轮', '3 轮'])
  })

  it('selects skills from the card, description and tags while preserving the current draft on reselection', async () => {
    const store = useConfigStore()
    const wrapper = mountSettings()
    await selectSection(wrapper, '写作技能')
    const cards = wrapper.findAll('.skill-row')
    await cards[1].get('.skill-info p').trigger('click')
    expect(cards[1].classes()).toContain('selected')
    expect(cards[0].get('.skill-select').attributes('aria-pressed')).toBe('false')
    expect(wrapper.get('input[aria-label="技能名称"]').element).toHaveProperty('value', store.skills[1].name)

    await cards[2].get('.skill-name').findComponent({ name: 'Tag' }).trigger('click')
    expect(wrapper.get('input[aria-label="技能名称"]').element).toHaveProperty('value', store.skills[2].name)
    await cards[0].trigger('click')
    expect(cards[0].get('.skill-select').attributes('aria-pressed')).toBe('true')
    const name = wrapper.get('input[aria-label="技能名称"]')
    await name.setValue('尚未保存的技能名称')
    await cards[0].trigger('click')
    await cards[0].get('.skill-select').trigger('click')
    expect(name.element).toHaveProperty('value', '尚未保存的技能名称')
    expect(store.skills[0].name).not.toBe('尚未保存的技能名称')
  })

  it('keeps switches and delete actions independent from skill selection', async () => {
    const store = useConfigStore()
    const custom = store.addSkill({ name: '自定义测试技能', description: '合成测试', task: 'writing', instructions: '合成规则' })
    const wrapper = mountSettings()
    await selectSection(wrapper, '写作技能')
    const cards = wrapper.findAll('.skill-row')
    const name = wrapper.get('input[aria-label="技能名称"]')
    await name.setValue('尚未保存的技能名称')
    const toggle = cards[1].findComponent({ name: 'Switch' })
    await toggle.trigger('click')
    toggle.vm.$emit('update:value', false)
    await flushPromises()
    expect(store.skills[1].enabled).toBe(false)
    expect(cards[0].classes()).toContain('selected')
    expect(name.element).toHaveProperty('value', '尚未保存的技能名称')

    const customCard = cards.find(card => card.text().includes(custom.name))!
    await customCard.findAll('button').find(button => button.text() === '删除')!.trigger('click')
    expect(dialog.warning).toHaveBeenCalledOnce()
    expect(cards[0].classes()).toContain('selected')
    expect(name.element).toHaveProperty('value', '尚未保存的技能名称')
    await cards[1].get('.model-actions button').trigger('click')
    expect(cards[1].classes()).toContain('selected')
    expect(name.element).toHaveProperty('value', store.skills[1].name)
  })

  it('adds a local embedding model through the inline editor without requiring a key', async () => {
    const store = useConfigStore()
    const wrapper = mountSettings()
    await wrapper.get('#add-model-btn').trigger('click')
    const kind = wrapper.findAllComponents({ name: 'Select' }).find(item => item.attributes('aria-label') === '模型类型')!
    kind.vm.$emit('update:value', 'embedding')
    await flushPromises()
    await wrapper.get('input[placeholder="如：https://api.deepseek.com"]').setValue('http://127.0.0.1:11434')
    await wrapper.get(`input[placeholder="${modelPlaceholder}"]`).setValue('synthetic-vector')
    expect(wrapper.findComponent(ModelSearchTest).exists()).toBe(false)
    expect(wrapper.find('.model-advanced').exists()).toBe(false)
    const add = wrapper.findAll('button').find(button => button.text() === '添加')!
    expect(add.attributes('disabled')).toBeUndefined()
    await add.trigger('click')
    await flushPromises()
    expect(store.models).toHaveLength(1)
    expect(store.models[0]).toMatchObject({ kind: 'embedding', apiKey: '', modelName: 'synthetic-vector' })
    expect(store.getModelForTask('writing')).toBeNull()
    expect(store.embedding.enabled).toBe(false)
  })

  it('offers embedding models only to semantic retrieval and keeps unfinished edits across sections', async () => {
    const chat = addLegacyModel()
    const store = useConfigStore()
    const vector = store.addModel({ name: '资料检索', kind: 'embedding', modelName: 'synthetic-vector', baseUrl: 'http://127.0.0.1:11434', apiKey: '', maxTokens: 4096, temperature: 0, topP: 1 })
    const wrapper = mountSettings()
    const semantic = wrapper.find('.embedding-assignment').findComponent({ name: 'Select' })
    expect(semantic.props('options').map((option: { value: string }) => option.value)).toEqual(['', vector.id])
    const chatOptions = wrapper.find('.chat-assignment').findComponent({ name: 'Select' }).props('options')
    expect(chatOptions.some((option: { value: string }) => option.value === vector.id)).toBe(false)
    await wrapper.findAll('.model-select')[0].trigger('click')
    await wrapper.get(`input[placeholder="${aliasPlaceholder}"]`).setValue('未保存的配置备注')
    const tabs = wrapper.findAll('.settings-nav-item')
    await tabs[2].trigger('click')
    await flushPromises()
    await tabs[0].trigger('click')
    await flushPromises()
    expect(wrapper.get(`input[placeholder="${aliasPlaceholder}"]`).element).toHaveProperty('value', '未保存的配置备注')
    expect(store.models.find(model => model.id === chat.id)?.name).not.toBe('未保存的配置备注')
    expect(tabs).toHaveLength(8)
    await tabs[0].trigger('keydown', { key: 'ArrowRight' })
    await flushPromises()
    expect(tabs[1].attributes('aria-selected')).toBe('true')
    expect(wrapper.find('.retrieval-model-status').findAll('input')).toHaveLength(0)
  })

  it('keeps the saved key for the editor search test when the edit field is blank', async () => {
    const model = addLegacyModel()
    const wrapper = mountSettings()
    expect(wrapper.findAll('button').some(button => button.text() === '测试对话')).toBe(true)
    await wrapper.findAll('button').find(button => button.text() === '编辑')!.trigger('click')
    const input = wrapper.get('input[placeholder="留空则保留当前接口密钥"]')
    await input.setValue('')
    expect(wrapper.get('.model-editor').findComponent(ModelSearchTest).props('model')).toMatchObject({
      id: model.id, apiKey: 'synthetic-test-key', modelName: model.modelName,
    })
    expect(useConfigStore().models[0].apiKey).toBe('synthetic-test-key')
  })

  it('tests search on the model card without opening or changing the configuration', async () => {
    const model = addLegacyModel()
    const before = JSON.stringify(useConfigStore().models)
    vi.mocked(testChatSearch).mockResolvedValue({ status: 'failed', message: '[HTTP_404] 接口不支持此搜索协议。', sourceCount: 0 })
    const wrapper = mountSettings(true)
    await wrapper.findAll('.settings-nav-item')[0].trigger('click')
    const card = wrapper.get('.model-card')
    await card.findAll('button').find(button => button.text() === '测试联网')!.trigger('click')
    expect(wrapper.find('.model-editor').exists()).toBe(false)
    expect(testChatSearch).not.toHaveBeenCalled()
    dialog.warning.mock.calls[0][0].onPositiveClick()
    await flushPromises()
    expect(testChatSearch).toHaveBeenCalledTimes(1)
    expect(testChatSearch).toHaveBeenCalledWith(expect.objectContaining({ id: model.id, apiKey: model.apiKey }), expect.any(AbortSignal))
    expect(card.text()).toContain('搜索测试失败')
    expect(card.text()).toContain('HTTP_404')
    expect(card.findAll('button').some(button => button.text() === '复制诊断')).toBe(true)
    expect(wrapper.find('.model-editor').exists()).toBe(false)
    expect(JSON.stringify(useConfigStore().models)).toBe(before)
    expect(card.text()).not.toContain(model.apiKey)
  })

  it('tests the saved card configuration while preserving an unfinished model edit', async () => {
    const model = addLegacyModel()
    vi.mocked(testChatSearch).mockResolvedValue({ status: 'unverified', message: '没有可验证的搜索证据。', sourceCount: 0 })
    const wrapper = mountSettings(true)
    await wrapper.findAll('.settings-nav-item')[0].trigger('click')
    await wrapper.get('.model-select').trigger('click')
    await wrapper.get(`input[placeholder="${modelPlaceholder}"]`).setValue('unsaved-model')
    await wrapper.get('.model-card').findAll('button').find(button => button.text() === '测试联网')!.trigger('click')
    dialog.warning.mock.calls[0][0].onPositiveClick()
    await flushPromises()
    expect(testChatSearch).toHaveBeenCalledWith(expect.objectContaining({ modelName: model.modelName }), expect.any(AbortSignal))
    expect(wrapper.get(`input[placeholder="${modelPlaceholder}"]`).element).toHaveProperty('value', 'unsaved-model')
    expect(wrapper.get('.model-card').text()).toContain('搜索尚未验证')
    expect(useConfigStore().models[0].modelName).toBe(model.modelName)
  })

  it('shows the package version in the about section', () => {
    expect(mountSettings().find('.about-section').text()).toContain(`v${appVersion}`)
  })

  it('shows complete bundled-font license originals offline in a collapsed panel', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Offline license check'))
    try {
      const wrapper = mountSettings()
      await selectSection(wrapper, '关于')
      const panel = wrapper.get('.about-section details.font-licenses')
      expect(panel.get('summary').text()).toBe('内置字体与许可')
      expect(panel.element).toHaveProperty('open', false)
      expect(panel.text()).toContain('HarmonyOS Sans SC 未随应用分发，界面使用 Noto Sans SC 替代')
      expect(panel.text()).toContain('不分发微软系统字体')
      expect(panel.findAll('.font-license-item > summary').map(node => node.text())).toEqual([
        'Noto Serif SC（思源宋体，可变字体） OFL 1.1',
        'Noto Sans SC（思源黑体，可变字体） OFL 1.1',
        'JetBrains Mono（可变字体） OFL 1.1',
        'LXGW WenKai（霞鹜文楷，Regular） 字体 OFL 1.1 · 包 MIT',
      ])
      const sources = [
        '@fontsource-variable/noto-serif-sc/LICENSE',
        '@fontsource-variable/noto-sans-sc/LICENSE',
        '@fontsource-variable/jetbrains-mono/LICENSE',
        'lxgw-wenkai-webfont/OFL.txt',
        'lxgw-wenkai-webfont/LICENSE',
      ]
      const documents = panel.findAll('.font-license-text')
      expect(documents).toHaveLength(sources.length)
      sources.forEach((source, index) => {
        const original = readFileSync(new NodeURL(`../../../node_modules/${source}`, import.meta.url), 'utf8')
        expect(documents[index].element.textContent).toBe(original)
        expect(documents[index].attributes('tabindex')).toBe('0')
        expect(documents[index].attributes('aria-label')).toBeTruthy()
      })
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      fetch.mockRestore()
    }
  })

  it('has no duplicate global writing-mode setting or setter', async () => {
    const store = useConfigStore()
    const wrapper = mountSettings()
    expect(wrapper.text()).not.toContain('默认正文创作方式')
    expect(wrapper.find('[name="writing-mode"]').exists()).toBe(false)
    expect('writingMode' in store).toBe(false)
    expect('setWritingMode' in store).toBe(false)
    await store.saveConfig()
    expect(JSON.parse(localStorage.getItem('mojian-v3-config')!)).not.toHaveProperty('writingMode')
  })

  it('provides a chat-model assignment with outline-following default and raw model choices', async () => {
    const outline = addLegacyModel(ids[0])
    const chat = addLegacyModel(ids[1])
    const store = useConfigStore()
    const wrapper = mountSettings()
    const select = wrapper.find('.chat-assignment').findComponent({ name: 'Select' })
    expect(select.props('value')).toBe('')
    expect(select.props('options')).toEqual([
      { value: '', label: '默认跟随大纲模型' },
      { value: outline.id, label: ids[0] },
      { value: chat.id, label: ids[1] },
    ])
    select.vm.$emit('update:value', chat.id)
    await flushPromises()
    expect(store.assignments.chat).toBe(chat.id)
    expect(store.assignments.outline).toBe(outline.id)
    expect(wrapper.find('.chat-assignment').text()).toContain('大纲生成、设定整理仍使用大纲模型')
    select.vm.$emit('update:value', '')
    await flushPromises()
    expect(store.getModelForTask('chat')?.id).toBe(outline.id)
  })

  it('shows actual model IDs in titles and task choices without rewriting legacy configs', async () => {
    ids.forEach((id, index) => addLegacyModel(id, index ? `Claude Sonnet 5 · ${id}` : 'Claude Sonnet 5'))
    const store = useConfigStore()
    const before = JSON.stringify(store.models)
    const assignments = { ...store.assignments }
    const wrapper = mountSettings()
    expect(wrapper.findAll('.model-name').map(node => node.text())).toEqual(ids)
    const selects = wrapper.findAllComponents({ name: 'Select' })
    expect(selects[0].props('options').map((option: { label: string }) => option.label)).toEqual(ids)
    expect(wrapper.find('.model-detail').text()).toBe('备注：Claude Sonnet 5')
    expect(JSON.stringify(store.models)).toBe(before)
    expect(store.assignments).toEqual(assignments)
  })

  it('batch-creates each model under its raw ID, skips duplicates, and preserves the edited config', async () => {
    const original = addLegacyModel()
    const store = useConfigStore()
    const before = { ...store.models[0] }
    const wrapper = mountSettings()
    await wrapper.findAll('button').find(button => button.text() === '编辑')!.trigger('click')
    await wrapper.findAll('button').find(button => button.text() === '获取模型')!.trigger('click')
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '全选')!.trigger('click')
    const batch = wrapper.findAll('button').find(button => button.text().includes('批量添加'))!
    expect(batch.attributes('disabled')).toBeUndefined()
    await batch.trigger('click')
    await flushPromises()
    expect(store.models).toHaveLength(3)
    expect(store.models[0]).toEqual(before)
    expect(store.assignments.writing).toBe(original.id)
    expect(store.models.slice(1).map(model => ({ name: model.name, modelName: model.modelName })))
      .toEqual(ids.slice(1).map(id => ({ name: id, modelName: id })))
    expect(wrapper.findAll('.model-name').map(node => node.text())).toEqual(ids)
  })

  it('allows a blank remark and keeps displayed identity in sync when editing the model ID', async () => {
    const original = addLegacyModel()
    const store = useConfigStore()
    const wrapper = mountSettings()
    await wrapper.findAll('button').find(button => button.text() === '编辑')!.trigger('click')
    await wrapper.get(`input[placeholder="${aliasPlaceholder}"]`).setValue('')
    await wrapper.get(`input[placeholder="${modelPlaceholder}"]`).setValue(ids[1])
    const save = wrapper.findAll('button').find(button => button.text() === '保存')!
    expect(save.attributes('disabled')).toBeUndefined()
    await save.trigger('click')
    expect(store.models[0]).toMatchObject({ id: original.id, name: ids[1], modelName: ids[1], apiKey: 'synthetic-test-key' })
    expect(store.assignments.writing).toBe(original.id)
    expect(wrapper.find('.model-name').text()).toBe(ids[1])
  })

  it('adds discovered models without requiring a shared display name', async () => {
    const wrapper = mountSettings()
    await wrapper.get('#add-model-btn').trigger('click')
    await wrapper.get('input[placeholder="如：https://api.deepseek.com"]').setValue('https://example.test')
    await wrapper.get('input[placeholder="填写服务商提供的接口密钥"]').setValue('synthetic-test-key')
    await wrapper.findAll('button').find(button => button.text() === '获取模型')!.trigger('click')
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '全选')!.trigger('click')
    const batch = wrapper.findAll('button').find(button => button.text().includes('批量添加'))!
    expect(batch.attributes('disabled')).toBeUndefined()
    await batch.trigger('click')
    expect(useConfigStore().models.map(model => model.name)).toEqual(ids)
  })

  it('uses remarks to distinguish two connections to the same model', () => {
    addLegacyModel(ids[0], '主用接口')
    addLegacyModel(ids[0], '备用接口')
    const wrapper = mountSettings()
    const select = wrapper.findAllComponents({ name: 'Select' })[0]
    expect(select.props('options').map((option: { label: string }) => option.label))
      .toEqual([`${ids[0]}（备注：主用接口）`, `${ids[0]}（备注：备用接口）`])
  })
})

describe('设置分区与路由同步', () => {
  it('keeps other query parameters and the hash when navigating, and skips duplicate history entries', async () => {
    await router.replace({ query: { section: 'cloud', returnTo: '/outside', filter: ['a', 'b'] }, hash: '#keep' })
    const push = vi.spyOn(router, 'push')
    const wrapper = mountSettings()
    await selectSection(wrapper, '写作技能')
    expect(router.currentRoute.value.query).toEqual({ section: 'skills', returnTo: '/outside', filter: ['a', 'b'] })
    expect(router.currentRoute.value.hash).toBe('#keep')
    expect(wrapper.get('.skill-editor').isVisible()).toBe(true)
    await selectSection(wrapper, '写作技能')
    expect(push).toHaveBeenCalledOnce()
  })

  it('restores sections and unsaved skill input through back and forward navigation', async () => {
    const wrapper = mountSettings()
    await selectSection(wrapper, '写作技能')
    await wrapper.get('input[aria-label="技能名称"]').setValue('历史导航中的技能草稿')
    await selectSection(wrapper, '外观')
    router.back()
    await vi.waitFor(() => expect(router.currentRoute.value.query.section).toBe('skills'))
    await flushPromises()
    expect(wrapper.get('.skill-editor').isVisible()).toBe(true)
    expect(wrapper.get('input[aria-label="技能名称"]').element).toHaveProperty('value', '历史导航中的技能草稿')
    router.back()
    await vi.waitFor(() => expect(router.currentRoute.value.query.section).toBeUndefined())
    await flushPromises()
    expect(wrapper.findAll('.settings-nav-item')[0].attributes('aria-selected')).toBe('true')
    router.forward()
    await vi.waitFor(() => expect(router.currentRoute.value.query.section).toBe('skills'))
    await flushPromises()
    expect(wrapper.get('input[aria-label="技能名称"]').element).toHaveProperty('value', '历史导航中的技能草稿')
    expect(dialog.warning).not.toHaveBeenCalled()
  })

  it.each([{ section: undefined }, { section: 'unknown' }, { section: ['skills', 'about'] }])('falls back to models when section becomes $section', async ({ section }) => {
    await router.replace({ query: { section: 'about' } })
    const wrapper = mountSettings()
    await router.replace({ query: { section, returnTo: '/outside' } })
    await flushPromises()
    expect(wrapper.findAll('.settings-nav-item')[0].attributes('aria-selected')).toBe('true')
    expect(wrapper.get('.about-section').attributes('style')).toContain('display: none')
    expect(router.currentRoute.value.query.returnTo).toBe('/outside')
  })

  it('uses the assignments URL and anchor for the retrieval shortcut and after remounting', async () => {
    addLegacyModel()
    await router.replace({ query: { section: 'retrieval', returnTo: '/outside' } })
    const wrapper = mountSettings()
    const assignments = wrapper.get('#model-task-assignments').element as HTMLElement
    const scroll = vi.fn()
    assignments.scrollIntoView = scroll
    const focus = vi.spyOn(assignments, 'focus')
    await wrapper.findAll('button').find(button => button.text() === '前往任务分配')!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ section: 'assign', returnTo: '/outside' })
    expect(wrapper.findAll('.settings-nav-item')[1].attributes('aria-selected')).toBe('true')
    expect(scroll).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' })
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    wrapper.unmount()
    await router.push({ path: '/settings', query: { section: 'assign', returnTo: '/outside' } })
    const reopened = mountSettings()
    await flushPromises()
    expect(reopened.findAll('.settings-nav-item')[1].attributes('aria-selected')).toBe('true')
    expect(reopened.get('#model-task-assignments').isVisible()).toBe(true)
  })

  it('initializes the skill editor when opening its deep link', async () => {
    await router.replace({ query: { section: 'skills' } })
    const wrapper = mountSettings()
    expect(wrapper.get('input[aria-label="技能名称"]').element).toHaveProperty('value', useConfigStore().skills[0].name)
    expect(refreshIsBlocked()).toBe(false)
  })
})

describe('设置草稿保护', () => {
  it('retains separate model drafts and does not reset the selected model on repeated clicks', async () => {
    const first = addLegacyModel(ids[0], '第一配置')
    addLegacyModel(ids[1], '第二配置')
    const wrapper = mountSettings()
    const models = wrapper.findAll('.model-select')
    await models[0].trigger('click')
    await wrapper.get(`input[placeholder="${aliasPlaceholder}"]`).setValue('第一份模型草稿')
    await wrapper.get('input[placeholder="留空则保留当前接口密钥"]').setValue('synthetic-unsaved-key')
    await models[0].trigger('click')
    expect(wrapper.get(`input[placeholder="${aliasPlaceholder}"]`).element).toHaveProperty('value', '第一份模型草稿')
    await models[1].trigger('click')
    await wrapper.get(`input[placeholder="${aliasPlaceholder}"]`).setValue('第二份模型草稿')
    await models[0].trigger('click')
    expect(wrapper.get(`input[placeholder="${aliasPlaceholder}"]`).element).toHaveProperty('value', '第一份模型草稿')
    expect(wrapper.get('input[placeholder="留空则保留当前接口密钥"]').element).toHaveProperty('value', 'synthetic-unsaved-key')
    expect(wrapper.findAll('.model-card .draft-badge')).toHaveLength(2)
    expect(useConfigStore().models.find(model => model.id === first.id)?.name).toBe('第一配置')
    await useConfigStore().saveConfig()
    expect(localStorage.getItem('mojian-v3-config')).not.toContain('synthetic-unsaved-key')
    expect(JSON.stringify(sessionStorage)).not.toContain('synthetic-unsaved-key')
    expect(dialog.warning).not.toHaveBeenCalled()
  })

  it('retains a new model, discovered choices and batch selection across models and sections', async () => {
    addLegacyModel()
    const wrapper = mountSettings()
    await wrapper.get('#add-model-btn').trigger('click')
    await wrapper.get('input[placeholder="如：https://api.deepseek.com"]').setValue('https://new.example.test')
    await wrapper.get('input[placeholder="填写服务商提供的接口密钥"]').setValue('synthetic-new-draft-key')
    await wrapper.findAll('button').find(button => button.text() === '获取模型')!.trigger('click')
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '全选')!.trigger('click')
    await wrapper.get('#add-model-btn').trigger('click')
    await wrapper.get('.model-select').trigger('click')
    expect(wrapper.get('#add-model-btn .draft-badge').text()).toBe('未保存')
    await wrapper.get('#add-model-btn').trigger('click')
    await selectSection(wrapper, 'AI 工作流')
    await selectSection(wrapper, '模型配置')
    const choices = wrapper.get('.model-editor').findAllComponents({ name: 'Select' })
      .find((select: VueWrapper<{ $props: { multiple?: boolean } }>) => select.props('multiple'))!
    expect(choices.props('value')).toEqual(ids)
    expect(choices.props('options').map((option: { value: string }) => option.value)).toEqual(ids)
    expect(wrapper.get('input[placeholder="填写服务商提供的接口密钥"]').element).toHaveProperty('value', 'synthetic-new-draft-key')
    expect(wrapper.get('.settings-draft-note').text()).toContain('未保存')
    await useConfigStore().saveConfig()
    expect(localStorage.getItem('mojian-v3-config')).not.toContain('synthetic-new-draft-key')
    expect(useConfigStore().models).toHaveLength(1)
  })

  it('retains existing and new skill drafts across selection and section changes', async () => {
    const store = useConfigStore()
    const wrapper = mountSettings()
    await selectSection(wrapper, '写作技能')
    const skills = wrapper.findAll('.skill-select')
    await wrapper.get('input[aria-label="技能名称"]').setValue('第一份技能草稿')
    await skills[1].trigger('click')
    await wrapper.get('input[aria-label="技能名称"]').setValue('第二份技能草稿')
    await skills[0].trigger('click')
    expect(wrapper.get('input[aria-label="技能名称"]').element).toHaveProperty('value', '第一份技能草稿')
    await wrapper.findAll('button').find(button => button.text() === '添加技能')!.trigger('click')
    await wrapper.get('input[aria-label="技能名称"]').setValue('新技能草稿')
    await wrapper.get('input[aria-label="技能执行规则"]').setValue('新技能的合成规则')
    await skills[1].trigger('click')
    expect(wrapper.get('input[aria-label="技能名称"]').element).toHaveProperty('value', '第二份技能草稿')
    await wrapper.findAll('button').find(button => button.text().startsWith('添加技能'))!.trigger('click')
    await selectSection(wrapper, '关于')
    expect(refreshIsBlocked()).toBe(true)
    await selectSection(wrapper, '写作技能')
    expect(wrapper.get('input[aria-label="技能名称"]').element).toHaveProperty('value', '新技能草稿')
    expect(wrapper.get('input[aria-label="技能执行规则"]').element).toHaveProperty('value', '新技能的合成规则')
    expect(store.skills[0].name).not.toBe('第一份技能草稿')
    expect(store.skills.some(skill => skill.name === '新技能草稿')).toBe(false)
    expect(dialog.warning).not.toHaveBeenCalled()
  })

  it.each(['取消', '收起'])('confirms before discarding a model through %s', async action => {
    addLegacyModel()
    const wrapper = mountSettings()
    await wrapper.get('.model-select').trigger('click')
    await wrapper.get(`input[placeholder="${aliasPlaceholder}"]`).setValue('待确认的草稿')
    const close = () => wrapper.get('.model-editor').findAll('button').find(button => button.text() === action)!
    await close().trigger('click')
    dialog.warning.mock.calls[0][0].onNegativeClick()
    await flushPromises()
    expect(wrapper.get(`input[placeholder="${aliasPlaceholder}"]`).element).toHaveProperty('value', '待确认的草稿')
    await close().trigger('click')
    dialog.warning.mock.calls[1][0].onPositiveClick()
    await flushPromises()
    expect(wrapper.find('.model-editor').exists()).toBe(false)
    expect(refreshIsBlocked()).toBe(false)
    await wrapper.get('.model-select').trigger('click')
    expect(wrapper.get(`input[placeholder="${aliasPlaceholder}"]`).element).toHaveProperty('value', 'Claude Sonnet 5')
  })

  it('discards only the cancelled skill and retains other unsaved drafts', async () => {
    const wrapper = mountSettings()
    await selectSection(wrapper, '写作技能')
    await wrapper.get('input[aria-label="技能名称"]').setValue('保留的技能草稿')
    await wrapper.findAll('.skill-select')[1].trigger('click')
    await wrapper.get('input[aria-label="技能名称"]').setValue('取消的技能草稿')
    const cancel = () => wrapper.get('.skill-editor').findAll('button').find(button => button.text() === '取消')!
    await cancel().trigger('click')
    dialog.warning.mock.calls[0][0].onClose()
    await flushPromises()
    expect(wrapper.get('input[aria-label="技能名称"]').element).toHaveProperty('value', '取消的技能草稿')
    await cancel().trigger('click')
    dialog.warning.mock.calls[1][0].onPositiveClick()
    await flushPromises()
    expect(wrapper.find('.skill-editor').exists()).toBe(false)
    expect(refreshIsBlocked()).toBe(true)
    await wrapper.findAll('.skill-select')[0].trigger('click')
    expect(wrapper.get('input[aria-label="技能名称"]').element).toHaveProperty('value', '保留的技能草稿')
  })

  it.each(['onNegativeClick', 'onClose', 'onMaskClick'])('cancels leaving with %s and leaves only after confirmation', async dismiss => {
    addLegacyModel()
    addLegacyModel(ids[1])
    await router.replace({ query: { returnTo: '/outside' } })
    const wrapper = mountSettings()
    await wrapper.findAll('.model-select')[0].trigger('click')
    await wrapper.get(`input[placeholder="${aliasPlaceholder}"]`).setValue('非当前条目的草稿')
    await wrapper.findAll('.model-select')[1].trigger('click')
    await selectSection(wrapper, '关于')
    await wrapper.get('.back-btn').trigger('click')
    await flushPromises()
    expect(dialog.warning).toHaveBeenCalledOnce()
    dialog.warning.mock.calls[0][0][dismiss]()
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/settings')
    expect(refreshIsBlocked()).toBe(true)
    const leaving = router.push('/')
    await flushPromises()
    dialog.warning.mock.calls[1][0].onPositiveClick()
    await leaving
    expect(router.currentRoute.value.path).toBe('/')
    wrapper.unmount()
    expect(refreshIsBlocked()).toBe(false)
  })

  it.each(['model', 'skill', 'batch'])('clears dirty and leave protection after saving a %s draft', async kind => {
    const wrapper = mountSettings()
    if (kind === 'skill') {
      await selectSection(wrapper, '写作技能')
      await wrapper.get('input[aria-label="技能名称"]').setValue('保存后的技能')
    } else {
      await wrapper.get('#add-model-btn').trigger('click')
      await wrapper.get('input[placeholder="如：https://api.deepseek.com"]').setValue('https://example.test')
      await wrapper.get('input[placeholder="填写服务商提供的接口密钥"]').setValue('synthetic-test-key')
      await wrapper.get(`input[placeholder="${modelPlaceholder}"]`).setValue('synthetic-new-model')
      if (kind === 'batch') {
        await wrapper.findAll('button').find(button => button.text() === '获取模型')!.trigger('click')
        await flushPromises()
        await wrapper.findAll('button').find(button => button.text() === '全选')!.trigger('click')
      }
    }
    expect(refreshIsBlocked()).toBe(true)
    const editor = wrapper.get(kind === 'skill' ? '.skill-editor' : '.model-editor')
    const save = editor.findAll('button').find(button => kind === 'batch' ? button.text().startsWith('批量添加') : button.text() === (kind === 'skill' ? '保存' : '添加'))!
    await save.trigger('click')
    await flushPromises()
    expect(wrapper.find('.settings-draft-note').exists()).toBe(false)
    expect(refreshIsBlocked()).toBe(false)
    await router.push('/outside')
    expect(dialog.warning).not.toHaveBeenCalled()
  })

  it('keeps edits to the original model after batch-adding its discovered choices', async () => {
    const model = addLegacyModel()
    const wrapper = mountSettings()
    await wrapper.get('.model-select').trigger('click')
    await wrapper.get(`input[placeholder="${aliasPlaceholder}"]`).setValue('批量添加前的草稿')
    await wrapper.findAll('button').find(button => button.text() === '获取模型')!.trigger('click')
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '全选')!.trigger('click')
    await wrapper.findAll('button').find(button => button.text().startsWith('批量添加'))!.trigger('click')
    expect(refreshIsBlocked()).toBe(true)
    await wrapper.findAll('.model-select')[0].trigger('click')
    expect(wrapper.get(`input[placeholder="${aliasPlaceholder}"]`).element).toHaveProperty('value', '批量添加前的草稿')
    expect(useConfigStore().models.find(item => item.id === model.id)?.name).toBe('Claude Sonnet 5')
  })

  it('keeps a different skill open when the previous skill finishes saving', async () => {
    const wrapper = mountSettings()
    await selectSection(wrapper, '写作技能')
    await wrapper.get('input[aria-label="技能名称"]').setValue('已提交的技能')
    const pending = deferred<void>()
    vi.spyOn(useConfigStore(), 'saveConfig').mockReturnValueOnce(pending.promise)
    await wrapper.get('.skill-editor').findAll('button').find(button => button.text() === '保存')!.trigger('click')
    await wrapper.findAll('.skill-select')[1].trigger('click')
    await wrapper.get('input[aria-label="技能名称"]').setValue('另一项未保存技能')
    pending.resolve()
    await flushPromises()
    expect(wrapper.get('input[aria-label="技能名称"]').element).toHaveProperty('value', '另一项未保存技能')
    expect(wrapper.findAll('.skill-row .draft-badge')).toHaveLength(1)
    expect(refreshIsBlocked()).toBe(true)
  })

  it('retains a failed new skill save for retry without creating duplicates', async () => {
    const store = useConfigStore()
    const wrapper = mountSettings()
    await selectSection(wrapper, '写作技能')
    await wrapper.findAll('button').find(button => button.text() === '添加技能')!.trigger('click')
    await wrapper.get('input[aria-label="技能名称"]').setValue('可重试的技能')
    await wrapper.get('input[aria-label="技能执行规则"]').setValue('合成技能规则')
    vi.spyOn(store, 'saveConfig').mockRejectedValueOnce(new Error('synthetic save failure'))
    const save = () => wrapper.get('.skill-editor').findAll('button').find(button => button.text() === '保存')!
    await save().trigger('click')
    await flushPromises()
    expect(refreshIsBlocked()).toBe(true)
    await save().trigger('click')
    await flushPromises()
    expect(store.skills.filter(skill => skill.name === '可重试的技能')).toHaveLength(1)
    expect(refreshIsBlocked()).toBe(false)
  })

  it.each(['success', 'failure'])('ignores a stale discovery %s after switching models while a newer request is pending', async outcome => {
    addLegacyModel(ids[0])
    addLegacyModel(ids[1])
    const first = deferred<{ id: string }[]>()
    const second = deferred<{ id: string }[]>()
    vi.mocked(listAvailableModels).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const wrapper = mountSettings()
    await wrapper.findAll('.model-select')[0].trigger('click')
    await wrapper.findAll('button').find(button => button.text() === '获取模型')!.trigger('click')
    const signal = vi.mocked(listAvailableModels).mock.calls[0][1]!
    await wrapper.findAll('.model-select')[1].trigger('click')
    expect(signal.aborted).toBe(true)
    await wrapper.findAll('button').find(button => button.text() === '获取模型')!.trigger('click')
    if (outcome === 'success') first.resolve([{ id: 'stale-model' }])
    else first.reject(new Error('stale discovery failure'))
    await flushPromises()
    expect(wrapper.get(`input[placeholder="${modelPlaceholder}"]`).element).toHaveProperty('value', ids[1])
    expect(wrapper.get('.model-editor').text()).toContain('获取中...')
    expect(wrapper.find('.model-discovery-error').exists()).toBe(false)
    second.resolve([{ id: 'current-model' }])
    await flushPromises()
    expect(wrapper.get(`input[placeholder="${modelPlaceholder}"]`).element).toHaveProperty('value', 'current-model')
    expect(wrapper.get('.model-editor').text()).not.toContain('stale-model')
  })

  it('aborts discovery when changing the source before the first result arrives', async () => {
    addLegacyModel()
    const pending = deferred<{ id: string }[]>()
    vi.mocked(listAvailableModels).mockReturnValueOnce(pending.promise)
    const wrapper = mountSettings()
    await wrapper.get('.model-select').trigger('click')
    await wrapper.findAll('button').find(button => button.text() === '获取模型')!.trigger('click')
    await wrapper.get('input[placeholder="如：https://api.deepseek.com"]').setValue('https://changed.example.test')
    expect(vi.mocked(listAvailableModels).mock.calls[0][1]!.aborted).toBe(true)
    pending.resolve([{ id: 'stale-source-model' }])
    await flushPromises()
    expect(wrapper.get(`input[placeholder="${modelPlaceholder}"]`).element).toHaveProperty('value', ids[0])
    expect(wrapper.find('.model-discovery-success').exists()).toBe(false)
    expect(wrapper.get('.model-editor').text()).not.toContain('获取中...')
  })
})

describe('模型连接测试结果持久化', () => {
  it('saves a testing record when the mock request starts and an ok record when it succeeds', async () => {
    const model = addLegacyModel()
    let resolveTest!: (result: { ok: boolean; message: string }) => void
    vi.mocked(testConnection).mockImplementation(() => new Promise(resolve => { resolveTest = resolve }))
    const wrapper = mountSettings()

    await wrapper.get('.model-card').findAll('button').find(button => button.text() === '测试对话')!.trigger('click')
    await vi.waitFor(() => expect(testConnection).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('mojian-v3-config')!)
      expect(saved.models.find((item: { id: string }) => item.id === model.id).connectionTest).toMatchObject({
        status: 'testing', environment: 'browser',
      })
    })
    expect(wrapper.get('.model-card').text()).toContain('测试中...')

    const pending = JSON.parse(localStorage.getItem('mojian-v3-config')!).models.find((item: { id: string }) => item.id === model.id).connectionTest
    expect(pending.fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(pending.fingerprint).not.toContain(model.apiKey)

    resolveTest({ ok: true, message: 'synthetic connection success' })
    await flushPromises()
    await vi.waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('mojian-v3-config')!)
      expect(saved.models.find((item: { id: string }) => item.id === model.id).connectionTest.status).toBe('ok')
    })
    expect(wrapper.get('.model-card').text()).toContain('连接正常')
    expect(wrapper.get('.model-tested-at').attributes('datetime')).toMatch(/T/)
    expect(wrapper.get('.model-tested-at').text()).toBeTruthy()
  })

  it('saves failures, accepts legacy models without records, and invalidates the record on connection changes', async () => {
    const model = addLegacyModel()
    vi.mocked(testConnection).mockResolvedValue({ ok: false, message: 'synthetic connection failure' })
    const wrapper = mountSettings()

    expect(wrapper.get('.model-card').find('.model-status').exists()).toBe(false)
    await wrapper.get('.model-card').findAll('button').find(button => button.text() === '测试对话')!.trigger('click')
    await flushPromises()
    await vi.waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('mojian-v3-config')!)
      expect(saved.models.find((item: { id: string }) => item.id === model.id).connectionTest).toMatchObject({
        status: 'fail', environment: 'browser',
      })
    })
    expect(wrapper.get('.model-card').text()).toContain('测试失败')

    const store = useConfigStore()
    store.updateModel(model.id, { baseUrl: 'https://changed.example.test' })
    await store.saveConfig()
    await flushPromises()
    expect(store.models[0].connectionTest).toBeUndefined()
    expect(wrapper.get('.model-card').find('.model-status').exists()).toBe(false)
  })

  it('does not publish an old request after the connection configuration changes', async () => {
    const model = addLegacyModel()
    const pending = deferred<{ ok: boolean; message: string }>()
    vi.mocked(testConnection).mockReturnValue(pending.promise)
    const wrapper = mountSettings()

    await wrapper.get('.model-card').find('.model-actions').findAll('button')[0].trigger('click')
    await vi.waitFor(() => expect(testConnection).toHaveBeenCalledTimes(1))
    const store = useConfigStore()
    store.updateModel(model.id, { baseUrl: 'https://changed.example.test' })
    await store.saveConfig()

    pending.resolve({ ok: true, message: 'late synthetic success' })
    await flushPromises()
    await store.saveConfig()
    expect(store.models[0].connectionTest).toBeUndefined()
    expect(JSON.parse(localStorage.getItem('mojian-v3-config')!).models[0].connectionTest).toBeUndefined()
    expect(wrapper.get('.model-card').find('.model-status').exists()).toBe(false)
  })

  it('keeps the newer result when two tests on the same configuration finish out of order', async () => {
    addLegacyModel()
    const first = deferred<{ ok: boolean; message: string }>()
    const second = deferred<{ ok: boolean; message: string }>()
    vi.mocked(testConnection).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const wrapper = mountSettings()
    const testButton = () => wrapper.get('.model-card').find('.model-actions').findAll('button')[0]

    await testButton().trigger('click')
    await vi.waitFor(() => expect(testConnection).toHaveBeenCalledTimes(1))
    await testButton().trigger('click')
    await vi.waitFor(() => expect(testConnection).toHaveBeenCalledTimes(2))

    second.resolve({ ok: true, message: 'new synthetic success' })
    await flushPromises()
    await vi.waitFor(() => expect(useConfigStore().models[0].connectionTest?.status).toBe('ok'))
    first.resolve({ ok: false, message: 'old synthetic failure' })
    await flushPromises()
    await useConfigStore().saveConfig()

    expect(useConfigStore().models[0].connectionTest?.status).toBe('ok')
    expect(wrapper.get('.model-card').text()).toContain('连接正常')
    expect(wrapper.get('.model-card').text()).not.toContain('测试失败')
  })

  it('distinguishes an active test from an interrupted testing record after reload', async () => {
    const model = addLegacyModel()
    const fingerprint = await modelConnectionFingerprint(model)
    const store = useConfigStore()
    const attempt = store.beginModelConnectionTest(model.id, 'browser')!
    await store.recordModelConnectionTest(attempt, {
      status: 'testing', testedAt: '2026-11-10T01:02:03.000Z', fingerprint, environment: 'browser',
    })
    store.finishModelConnectionTest(attempt)

    const firstWrapper = mountSettings()
    await vi.waitFor(() => expect(firstWrapper.get('.model-card').text()).toContain('上次测试未完成'))
    expect(firstWrapper.get('.model-tested-at').attributes('datetime')).toBe('2026-11-10T01:02:03.000Z')
    firstWrapper.unmount()
    await router.push('/settings')

    const activeAttempt = store.beginModelConnectionTest(model.id, 'browser')!
    const activeWrapper = mountSettings()
    await vi.waitFor(() => expect(activeWrapper.get('.model-card').text()).toContain('测试中...'))
    await store.recordModelConnectionTest(activeAttempt, {
      status: 'testing', testedAt: '2026-11-10T01:02:04.000Z', fingerprint, environment: 'browser',
    })
    await flushPromises()
    expect(activeWrapper.get('.model-card').text()).toContain('测试中...')
    store.finishModelConnectionTest(activeAttempt)
  })

  it('reopens with the persisted successful result and test time', async () => {
    addLegacyModel()
    vi.mocked(testConnection).mockResolvedValue({ ok: true, message: 'reopen synthetic success' })
    const firstWrapper = mountSettings()
    await firstWrapper.get('.model-card').find('.model-actions').findAll('button')[0].trigger('click')
    await vi.waitFor(() => expect(useConfigStore().models[0].connectionTest?.status).toBe('ok'))
    const testedAt = useConfigStore().models[0].connectionTest!.testedAt
    firstWrapper.unmount()
    await router.push('/settings')

    setActivePinia(createPinia())
    const restored = useConfigStore()
    await restored.loadConfig()
    const reopened = mountSettings()
    await vi.waitFor(() => expect(reopened.get('.model-card').text()).toContain('连接正常'))
    expect(reopened.get('.model-tested-at').attributes('datetime')).toBe(testedAt)
  })
})
