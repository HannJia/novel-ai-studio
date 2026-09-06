// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import WritingAdvisorSidebar from './WritingAdvisorSidebar.vue'
import type { WritingAdviceResult } from '@/services/writingAdvisor'

const result: WritingAdviceResult = {
  mode: 'scene',
  focusLabel: '当前场景',
  focusExcerpt: '林默走进旧港口。',
  contextSummary: '当前章节计划、前文章节摘要、世界观',
  suggestions: [{
    id: 'direction-1', kind: 'investigation', title: '追查标记来源',
    approach: '让林默先从守门人的反应入手，查明金属片和旧港口的关系。',
    storyEffect: '推进主线线索。', nextBeat: '询问守门人。', risk: '不要提前揭露真相。',
    evidence: [{ sourceType: 'chapter', sourceLabel: '第 3 章', excerpt: '星环组织曾在旧港口活动' }],
  }],
  nextChapterPlan: { title: '城门后的回声', objective: '确认线索来源', beats: ['调查守门人'] },
  generatedAt: '2026-01-01',
}

const baseProps = {
  open: true, persistent: false, analyzing: false, error: '', stale: false, result, lastMode: 'scene' as const,
}

describe('WritingAdvisorSidebar', () => {
  it('展示多个方向需要的核心信息和证据', () => {
    const wrapper = shallowMount(WritingAdvisorSidebar, { props: baseProps })
    expect(wrapper.text()).toContain('追查标记来源')
    expect(wrapper.text()).toContain('第 3 章')
    expect(wrapper.text()).toContain('下一章计划草案')
  })

  it('空状态提供当前场景分析入口', () => {
    const wrapper = shallowMount(WritingAdvisorSidebar, { props: { ...baseProps, result: null } })
    expect(wrapper.text()).toContain('选择分析范围')
    expect(wrapper.find('.advisor-empty').exists()).toBe(true)
  })

  it('人工主笔辅助模式即使 open 关闭也保持侧栏常驻', () => {
    const wrapper = shallowMount(WritingAdvisorSidebar, {
      props: { ...baseProps, open: false, persistent: true, result: null },
    })
    expect(wrapper.find('.advisor-sidebar').exists()).toBe(true)
    expect(wrapper.find('.advisor-toggle-btn').exists()).toBe(false)
    expect(wrapper.find('.close-btn').exists()).toBe(false)
  })

  it('普通模式关闭时显示唯一的侧栏入口', () => {
    const wrapper = shallowMount(WritingAdvisorSidebar, {
      props: { ...baseProps, open: false, persistent: false },
    })
    expect(wrapper.find('.advisor-toggle-btn').exists()).toBe(true)
    expect(wrapper.find('.advisor-sidebar').exists()).toBe(false)
  })

  it('分析范围按钮只切换对应模式，不自动生成', async () => {
    const wrapper = shallowMount(WritingAdvisorSidebar, { props: { ...baseProps, result: null } })
    await wrapper.findAll('.mode-btn')[0].trigger('click')
    expect(wrapper.emitted('select-mode')?.[0]).toEqual(['paragraph'])
    expect(wrapper.emitted('analyze')).toBeUndefined()
  })

  it('提供同时分析全部范围的入口', async () => {
    const wrapper = shallowMount(WritingAdvisorSidebar, { props: baseProps })
    const button = wrapper.findAllComponents({ name: 'Button' }).find(item => item.text() === '同时分析全部范围')!
    expect(button.exists()).toBe(true)
    button.vm.$emit('click')
    expect(wrapper.emitted('analyze-all')).toHaveLength(1)
    wrapper.unmount()
  })

  it('分析范围位于滚动内容外，分析中也可以切换', async () => {
    const wrapper = shallowMount(WritingAdvisorSidebar, { props: { ...baseProps, analyzing: true } })
    expect(wrapper.find('.advisor-body .advisor-mode-row').exists()).toBe(false)
    const button = wrapper.findAll('.mode-btn')[2]
    expect(button.attributes('disabled')).toBeUndefined()
    await button.trigger('click')
    expect(wrapper.emitted('select-mode')?.[0]).toEqual(['chapter'])
    expect(wrapper.emitted('analyze')).toBeUndefined()
  })

  it('分析进行中允许停止且显示过期提示', () => {
    const wrapper = shallowMount(WritingAdvisorSidebar, {
      props: { ...baseProps, analyzing: true, stale: true, error: '正文已变化' },
    })
    expect(wrapper.text()).toContain('正文或参考资料已经变化')
  })

  it('首次分析按钮遵从所选标签，不固定生成场景分析', () => {
    const wrapper = shallowMount(WritingAdvisorSidebar, {
      props: { ...baseProps, result: null, lastMode: 'paragraph' },
      global: { renderStubDefaultSlot: true },
    })
    const analyze = wrapper.findAllComponents({ name: 'Button' }).find(button => button.text() === '分析当前段落')!
    expect(analyze.exists()).toBe(true)
    analyze.vm.$emit('click')
    expect(wrapper.emitted('analyze')?.[0]).toEqual(['paragraph'])
    wrapper.unmount()
  })

  it('不同标签独立保留选中方向，相同建议 ID 不会串选', async () => {
    const wrapper = shallowMount(WritingAdvisorSidebar, { props: baseProps, global: { renderStubDefaultSlot: true } })
    const choose = () => wrapper.findAllComponents({ name: 'Button' }).find(button => button.text() === '选为当前方向')!
    choose().vm.$emit('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.suggestion-card.selected').exists()).toBe(true)
    const paragraph: WritingAdviceResult = { ...result, mode: 'paragraph', focusLabel: '当前段落' }
    await wrapper.setProps({ result: paragraph, lastMode: 'paragraph' })
    expect(wrapper.find('.suggestion-card.selected').exists()).toBe(false)
    choose().vm.$emit('click')
    await wrapper.vm.$nextTick()
    await wrapper.setProps({ result, lastMode: 'scene' })
    expect(wrapper.find('.suggestion-card.selected').exists()).toBe(true)
    await wrapper.setProps({ result: { ...result } })
    expect(wrapper.find('.suggestion-card.selected').exists()).toBe(false)
    wrapper.unmount()
  })
})
