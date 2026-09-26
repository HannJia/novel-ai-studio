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
