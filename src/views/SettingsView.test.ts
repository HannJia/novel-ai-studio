// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, shallowMount } from '@vue/test-utils'
import SettingsView from './SettingsView.vue'
import { useConfigStore } from '@/stores/config'
import { listAvailableModels } from '@/services/ai'
import ModelSearchTest from '@/components/ModelSearchTest.vue'
import { version as appVersion } from '../../package.json'

vi.mock('@/services/ai', async importOriginal => ({
  ...await importOriginal<object>(), listAvailableModels: vi.fn(), testConnection: vi.fn(),
}))
vi.mock('naive-ui', async importOriginal => ({
  ...await importOriginal<object>(),
  useMessage: () => ({ success: vi.fn(), warning: vi.fn(), info: vi.fn(), error: vi.fn() }),
  useDialog: () => ({ warning: vi.fn() }),
}))

const ids = ['claude-opus-4-6-thinking', 'claude-opus-5', 'claude-sonnet-5']
const aliasPlaceholder = '如：主用接口 / 备用接口；留空使用模型 ID'
const modelPlaceholder = '如：deepseek-chat / gpt-4o / qwen-max'
const mounted: ReturnType<typeof shallowMount>[] = []

function mountSettings() {
  const wrapper = shallowMount(SettingsView, { global: { renderStubDefaultSlot: true, stubs: {
    Button: { props: ['disabled'], emits: ['click'], template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>' },
    Modal: { props: ['show'], template: '<section v-if="show"><slot /><slot name="action" /></section>' },
    Input: { props: ['value', 'placeholder'], emits: ['update:value'],
      template: '<input :value="value" :placeholder="placeholder" @input="$emit(\'update:value\', $event.target.value)" />' },
  } } })
  mounted.push(wrapper)
  return wrapper
}

function addLegacyModel(modelName = ids[0], name = 'Claude Sonnet 5') {
  return useConfigStore().addModel({ name, modelName, baseUrl: 'https://example.test', apiKey: 'synthetic-test-key',
    maxTokens: 4096, temperature: 0.7, topP: 0.9 })
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  sessionStorage.clear()
  vi.clearAllMocks()
  vi.mocked(listAvailableModels).mockResolvedValue(ids.map(id => ({ id, ownedBy: 'custom' })))
})
afterEach(async () => {
  await useConfigStore().saveConfig()
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
})

describe('模型原始名称与配置备注', () => {
  it('combines about and updates, and highlights the real workflow limits', async () => {
    const wrapper = mountSettings()
    const tabs = wrapper.findAll('.settings-nav-item')
    expect(tabs.map(tab => tab.text())).toEqual(['云同步', '模型配置', 'AI 工作流', '语义检索', '写作技能', '关于与更新'])
    await tabs[5].trigger('click')
    expect(wrapper.get('.about-section').isVisible()).toBe(true)
    expect(wrapper.get('.about-update').text()).toContain('软件更新')
    useConfigStore().aiWorkflowMode = 'balanced'
    await flushPromises()
    expect(wrapper.findAll('.workflow-rounds-value').map(node => node.text())).toEqual(['2 轮', '2 轮'])
    useConfigStore().aiWorkflowMode = 'strict'
    await flushPromises()
    expect(wrapper.findAll('.workflow-rounds-value').map(node => node.text())).toEqual(['3 轮', '3 轮'])
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
    await tabs[1].trigger('click')
    expect(wrapper.get(`input[placeholder="${aliasPlaceholder}"]`).element).toHaveProperty('value', '未保存的配置备注')
    expect(store.models.find(model => model.id === chat.id)?.name).not.toBe('未保存的配置备注')
    expect(tabs).toHaveLength(6)
    await tabs[1].trigger('keydown', { key: 'ArrowRight' })
    expect(tabs[2].attributes('aria-selected')).toBe('true')
    expect(wrapper.find('.retrieval-model-status').findAll('input')).toHaveLength(0)
  })

  it('separates conversation and search tests and keeps the saved key when the edit field is blank', async () => {
    const model = addLegacyModel()
    const wrapper = mountSettings()
    expect(wrapper.findAll('button').some(button => button.text() === '测试对话')).toBe(true)
    await wrapper.findAll('button').find(button => button.text() === '测试联网')!.trigger('click')
    const input = wrapper.get('input[placeholder="留空则保留当前接口密钥"]')
    await input.setValue('')
    expect(wrapper.findComponent(ModelSearchTest).props('model')).toMatchObject({
      id: model.id, apiKey: 'synthetic-test-key', modelName: model.modelName,
    })
    expect(useConfigStore().models[0].apiKey).toBe('synthetic-test-key')
  })

  it('shows the package version in the about section', () => {
    expect(mountSettings().find('.about-section').text()).toContain(`v${appVersion}`)
  })

  it('has no duplicate global writing-mode setting or setter', async () => {
    const store = useConfigStore()
    const wrapper = mountSettings()
    expect(wrapper.text()).not.toContain('默认正文创作方式')
    expect(wrapper.find('[name="writing-mode"]').exists()).toBe(false)
    expect('writingMode' in store).toBe(false)
    expect('setWritingMode' in store).toBe(false)
    await store.saveConfig()
    expect(JSON.parse(localStorage.getItem('novel-writer-config')!)).not.toHaveProperty('writingMode')
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
