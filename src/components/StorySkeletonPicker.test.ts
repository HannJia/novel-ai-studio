// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import StorySkeletonPicker from './StorySkeletonPicker.vue'
import type { PlotSkeleton, SkeletonSourceSelection } from '@/types/reconstruction'

const skeleton = (key: string, over: Partial<PlotSkeleton> = {}): PlotSkeleton => ({
  id: 'sk-' + key, revisionId: 'rev-' + key, title: '方案' + key, premise: key + '的前提', logline: key + '的主线', promise: key + '的承诺', ending: key + '的结局',
  beats: [{ id: 'b-' + key + '-1', title: key + '开端', description: key + '的开端内容', kind: 'opening', relatedPlotlineIds: [], relatedCharacterIds: [] },
    { id: 'b-' + key + '-2', title: key + '转折', description: key + '的转折内容', kind: 'turning_point', relatedPlotlineIds: [], relatedCharacterIds: [] }],
  approval: 'draft', updatedAt: '2026-11-09T00:00:00Z', ...over,
})
const stubs = { NButton: { props: ['disabled'], emits: ['click'], template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>' } }
function mountPicker(props: Record<string, unknown> = {}) {
  return mount(StorySkeletonPicker, { props: { skeletons: [skeleton('甲'), skeleton('乙'), skeleton('丙')], selectedId: 'sk-甲', ...props }, global: { stubs } })
}
const cell = (wrapper: ReturnType<typeof mountPicker>, label: string, title: string) => wrapper.get(`button.cell[aria-label="${label} · ${title}"]`)

describe('故事骨架并排比较', () => {
  it('每个方案一列，字段与关键节点按行对照，并保留整列选用', () => {
    const wrapper = mountPicker()
    expect(wrapper.findAll('thead .col-title').map(node => node.text())).toEqual(['方案甲', '方案乙', '方案丙'])
    expect(wrapper.findAll('tbody th.rh').map(node => node.text().replace(/\s+/g, ''))).toEqual(['方案名称', '故事前提', '一句话主线', '读者承诺', '结局方向', '关键节点按勾选顺序混合'])
    expect(wrapper.findAll('.col-all')).toHaveLength(3)
    expect(wrapper.get('.mix-hint').text()).toContain('为 5 个字段选择来源')
  })

  it('点击单元格逐行挑选，同一行只能取自一个方案，再点同一格取消', async () => {
    const wrapper = mountPicker()
    await cell(wrapper, '故事前提', '方案乙').trigger('click')
    expect(cell(wrapper, '故事前提', '方案乙').attributes('aria-pressed')).toBe('true')
    await cell(wrapper, '故事前提', '方案丙').trigger('click')
    expect(cell(wrapper, '故事前提', '方案乙').attributes('aria-pressed')).toBe('false')
    expect(cell(wrapper, '故事前提', '方案丙').attributes('aria-pressed')).toBe('true')
    expect(wrapper.findAll('td.pick')).toHaveLength(1)
    await cell(wrapper, '故事前提', '方案丙').trigger('click')
    expect(wrapper.findAll('td.pick')).toHaveLength(0)
  })

  it('整列选用一次取满五个字段和该方案全部节点，混合栏如实列出来源与计数', async () => {
    const wrapper = mountPicker()
    await wrapper.get('button[aria-label="整列选用：方案乙"]').trigger('click')
    expect(wrapper.findAll('.mix-seq li').map(node => node.text())).toEqual(['方案名称 · 方案乙', '故事前提 · 方案乙', '一句话主线 · 方案乙', '读者承诺 · 方案乙', '结局方向 · 方案乙'])
    expect(wrapper.findAll('.mixed-beats li')).toHaveLength(2)
    expect(wrapper.get('.mix-counts').text()).toBe('方案乙×7')
    expect(wrapper.find('.mix-hint').exists()).toBe(false)
    // 再逐行改选一个字段，来源计数随之变化。
    await cell(wrapper, '结局方向', '方案丙').trigger('click')
    expect(wrapper.get('.mix-counts').text()).toBe('方案乙×6 · 方案丙×1')
  })

  it('混合事务只发出所选来源：每个字段一个来源，节点按勾选顺序，且不自动确认', async () => {
    const wrapper = mountPicker()
    for (const label of ['方案名称', '故事前提', '一句话主线', '读者承诺', '结局方向']) await cell(wrapper, label, label === '结局方向' ? '方案丙' : '方案甲').trigger('click')
    const beats = wrapper.findAll('.beats-cell')
    await beats[2].findAll('input')[1].setValue(true)
    await beats[0].findAll('input')[0].setValue(true)
    const mix = wrapper.findAll('button').find(button => button.text() === '组合为新的可编辑候选')!
    expect(mix.attributes('disabled')).toBeUndefined()
    await mix.trigger('click')
    const sources = wrapper.emitted('mix')![0][0] as SkeletonSourceSelection[]
    expect(sources.slice(0, 5)).toEqual([
      { field: 'title', revisionId: 'rev-甲' }, { field: 'premise', revisionId: 'rev-甲' }, { field: 'logline', revisionId: 'rev-甲' },
      { field: 'promise', revisionId: 'rev-甲' }, { field: 'ending', revisionId: 'rev-丙' },
    ])
    expect(sources.slice(5).map(source => [source.revisionId, source.beatId])).toEqual([['rev-丙', 'b-丙-2'], ['rev-甲', 'b-甲-1']])
    expect(wrapper.emitted('confirm')).toBeUndefined()
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('有未保存的作者输入时不允许混合，并说明原因', async () => {
    const wrapper = mountPicker({ dirty: true })
    await wrapper.get('button[aria-label="整列选用：方案甲"]').trigger('click')
    expect(wrapper.get('.mix-hint').text()).toContain('请先保存当前作者版本')
    expect(wrapper.findAll('button').find(button => button.text() === '组合为新的可编辑候选')!.attributes('disabled')).toBeDefined()
  })

  it('没有 revisionId 的历史方案不能被选作混合来源', () => {
    const wrapper = mountPicker({ skeletons: [skeleton('甲', { revisionId: undefined }), skeleton('乙')] })
    expect(wrapper.get('button[aria-label="整列选用：方案甲"]').attributes('disabled')).toBeDefined()
    expect(cell(wrapper, '故事前提', '方案甲').attributes('disabled')).toBeDefined()
    expect(cell(wrapper, '故事前提', '方案乙').attributes('disabled')).toBeUndefined()
  })

  it('点方案标题只切换编辑对象，并标出当前编辑、正式方向与未完整方案', async () => {
    const wrapper = mountPicker({ confirmedId: 'sk-乙', skeletons: [skeleton('甲'), skeleton('乙'), skeleton('丙', { complete: false })] })
    const tags = wrapper.findAll('.colh').map(node => node.find('.col-tags').text())
    expect(tags).toEqual(['编辑中', '正式方向', '未完整，需作者补齐保存'])
    await wrapper.findAll('.col-title')[2].trigger('click')
    expect(wrapper.emitted('select')![0]).toEqual(['sk-丙'])
    expect(wrapper.emitted('confirm')).toBeUndefined()
  })

  it('没有候选方案时只提供手写和重新生成，不渲染空表格', async () => {
    const wrapper = mountPicker({ skeletons: [], selectedId: undefined })
    expect(wrapper.find('table').exists()).toBe(false)
    expect(wrapper.find('.mix').exists()).toBe(false)
    expect(wrapper.get('footer').text()).toContain('选择一个方案，或手写新方案')
    await wrapper.findAll('button').find(button => button.text() === '手写新方案')!.trigger('click')
    await wrapper.findAll('button').find(button => button.text() === '重新生成候选')!.trigger('click')
    expect(wrapper.emitted('create')).toHaveLength(1)
    expect(wrapper.emitted('regenerate')).toHaveLength(1)
  })
})
