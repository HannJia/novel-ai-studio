// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ChapterAiStatus from './ChapterAiStatus.vue'

const baseProps = {
  writing: true,
  writingText: 'AI 正在检查章节结尾是否完整...',
  completing: false,
  completingText: '',
  backgroundText: '',
  backgroundPending: 0,
}

describe('ChapterAiStatus', () => {
  it('展示当前阶段并允许用户中止完整生成链路', async () => {
    const wrapper = mount(ChapterAiStatus, { props: baseProps })
    expect(wrapper.text()).toContain('检查章节结尾是否完整')
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('stop')).toHaveLength(1)
  })

  it('后台任务没有待处理项时不显示旋转状态', () => {
    const wrapper = mount(ChapterAiStatus, {
      props: { ...baseProps, writing: false, backgroundText: '后台任务已完成' },
    })
    expect(wrapper.text()).toContain('后台任务已完成')
    expect(wrapper.find('.background .spinner').exists()).toBe(false)
  })
})
