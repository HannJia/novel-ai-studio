// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { NButton } from 'naive-ui'
import ChapterReviewSidebar from './ChapterReviewSidebar.vue'

const passingReview = `## 结论
总体判断：✅可通过
必改数量：0
建议修改数量：3`
const requiredReview = `## 结论
总体判断：❌必须修改
必改数量：1`

function renderReview(contentReview: string, editableReview = contentReview) {
  return shallowMount(ChapterReviewSidebar, {
    props: {
      open: true, hasContent: true, summary: '', loading: false, endingCheck: null,
      pendingRevision: null, revisionLoading: false, contentReview,
      renderedContentReview: contentReview, editableReview,
      aiWriting: false, completing: false, allowRewrite: true,
      localScanResults: [], continuityAlerts: [], bannedResult: '', renderedBannedResult: '',
      expanded: { summary: false, contentReview: true, localScan: false, aiReview: false, continuity: false },
      reviewStatus: '当前正文需要修改',
    },
  })
}

describe('chapter review repair controls', () => {
  it('shows real dimensions as cards, retains the complete source and escapes markup', async () => {
    const report = passingReview + '\n## 六维度简评\n1. 角色一致性：✅通过，动机明确\n2. 剧情连贯性：<img src=x onerror=alert(1)>\n## 编辑建议\n保留悬念。'
    const wrapper = renderReview(report)
    expect(wrapper.findAll('.review-card h4').map(node => node.text())).toEqual(['1角色一致性', '2剧情连贯性', '3编辑建议'])
    expect(wrapper.get('.review-card p').text()).toContain('动机明确')
    expect(wrapper.find('.review-cards img').exists()).toBe(false)
    expect(wrapper.get('.review-full-report').text()).toContain('总体判断')
    expect(wrapper.get('.review-verdict').text()).toContain('可通过')
    await wrapper.setProps({ loading: true })
    expect(wrapper.get('.review-verdict').text()).toContain('结论尚未完成')
    wrapper.unmount()
  })
  it('shows repair controls before the report when changes are required', () => {
    const wrapper = renderReview(requiredReview)
    const section = wrapper.get('.review-section-content')
    expect(section.element.firstElementChild?.classList.contains('rewrite-actions')).toBe(true)
    expect(section.find('.rewrite-actions textarea').exists()).toBe(true)
    expect(section.get('.rewrite-actions .action-row').element.children).toHaveLength(2)
    wrapper.unmount()
  })

  it('hides repair controls for a passing review even with suggestions', () => {
    const wrapper = renderReview(passingReview)
    expect(wrapper.find('.rewrite-actions').exists()).toBe(false)
    expect(wrapper.text()).toContain('建议修改数量：3')
    wrapper.unmount()
  })

  it('hides repair controls when the verdict is not yet known', () => {
    const wrapper = renderReview('审查进行中')
    expect(wrapper.find('.rewrite-actions').exists()).toBe(false)
    wrapper.unmount()
  })

  it('does not submit the full report when no actionable issues were extracted', () => {
    const wrapper = renderReview(requiredReview, '')
    expect((wrapper.get('.rewrite-actions textarea').element as HTMLTextAreaElement).value).toBe('')
    expect(wrapper.get('.rewrite-actions .action-row').element.children).toHaveLength(2)
    const repairButtons = wrapper.findAllComponents(NButton).filter(button => button.element.closest('.rewrite-actions'))
    expect(repairButtons).toHaveLength(2)
    expect(repairButtons.every(button => button.props('disabled'))).toBe(true)
    wrapper.unmount()
  })
})
