// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { NButton } from 'naive-ui'
import ChapterReviewSidebar from './ChapterReviewSidebar.vue'
import StoryCandidateEditor from './StoryCandidateEditor.vue'

const passingReview = `## 结论
总体判断：✅可通过
必改数量：0
建议修改数量：3`
const requiredReview = `## 结论
总体判断：❌必须修改
必改数量：1`

beforeEach(() => setActivePinia(createPinia()))

function renderReview(contentReview: string, editableReview = contentReview) {
  return shallowMount(ChapterReviewSidebar, {
    global: { renderStubDefaultSlot: true },
    props: {
      open: true, hasContent: true, summary: '', loading: false, endingCheck: null,
      pendingRevision: null, revisionLoading: false, contentReview,
      renderedContentReview: contentReview, editableReview,
      aiWriting: false, completing: false, allowRewrite: true,
      localScanResults: [], continuityAlerts: [], bannedResult: '', renderedBannedResult: '',
      candidateChanges: [],
      reviewFindings: [],
      expanded: { summary: false, contentReview: true, localScan: false, aiReview: false, continuity: false, findings: true },
      reviewStatus: '当前正文需要修改',
    },
  })
}

describe('chapter review repair controls', () => {
  it('keeps a failed request visible without a report and preserves the existing report beside it', async () => {
    const wrapper = renderReview('')
    const diagnostic = '结尾检查输出未正常完成（结束原因：length；正文长度：292 字符；输出用量：900 token）'
    await wrapper.setProps({ hasContent: false, requestError: diagnostic })
    expect(wrapper.get('[role="alert"]').text()).toContain(diagnostic)
    expect(wrapper.find('.review-sidebar').exists()).toBe(true)
    await wrapper.setProps({ contentReview: requiredReview, renderedContentReview: requiredReview })
    expect(wrapper.get('.review-full-report').text()).toContain('必改数量：1')
    expect(wrapper.get('[role="alert"]').text()).toContain('未产生新的有效审核结论')
    await wrapper.setProps({ requestError: undefined })
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })
  it.each([passingReview, requiredReview])('marks a stale or incomplete report as awaiting revalidation', async report => {
    const wrapper = renderReview(report)
    await wrapper.setProps({ reviewNeedsRevalidation: true })
    expect(wrapper.get('.review-verdict').text()).toBe('原报告待重新审核，不能代表当前正文结论')
    expect(wrapper.get('.review-verdict').classes()).toContain('review-verdict--unknown')
    expect(wrapper.get('.review-full-report').text()).toContain(report.split('\n')[1])
    await wrapper.setProps({ loading: true })
    expect(wrapper.get('.review-verdict').text()).toContain('结论尚未完成')
    await wrapper.setProps({ loading: false, reviewNeedsRevalidation: false })
    expect(wrapper.get('.review-verdict').text()).toContain('报告结论：')
    wrapper.unmount()
  })
  it('emits a deferred decision with the note opening baseline, and clears it only on a success receipt', async () => {
    const wrapper = renderReview('')
    const candidate = { id: 'candidate', chapterId: 'chapter', type: 'fact' as const, status: 'proposed' as const,
      createdAt: '', updatedAt: '', proposedValue: '{"title":"得到钥匙"}', evidence: [] }
    await wrapper.setProps({ candidateChanges: [candidate], decisionVersion: 'review-v1' })
    await wrapper.get('[aria-label="候选处理说明"]').setValue('核对后文再决定')
    await wrapper.setProps({ candidateChanges: [{ ...candidate, proposedValue: '{"title":"另一次分析"}' }], decisionVersion: 'review-v2' })
    const defer = wrapper.findAllComponents(NButton).find(button => button.text() === '稍后处理')!
    defer.vm.$emit('click')
    expect(wrapper.emitted('defer-candidate')?.[0]).toEqual([candidate, 'review-v1', '核对后文再决定'])
    await wrapper.setProps({ candidateSaving: true })
    expect(defer.props('disabled')).toBe(true)
    await wrapper.setProps({ candidateSaving: false })
    expect(wrapper.get<HTMLTextAreaElement>('[aria-label="候选处理说明"]').element.value).toBe('核对后文再决定')
    await wrapper.setProps({ candidateReceipt: { id: candidate.id, sequence: 1 } })
    expect(wrapper.get<HTMLTextAreaElement>('[aria-label="候选处理说明"]').element.value).toBe('')
    wrapper.unmount()
  })

  it('retains an opened candidate editor when source changes hide the pending candidate', async () => {
    const wrapper = renderReview('')
    const candidate = { id: 'candidate', chapterId: 'chapter', type: 'fact' as const, status: 'proposed' as const,
      createdAt: '', updatedAt: '', proposedValue: '{"title":"得到钥匙"}', evidence: [] }
    await wrapper.setProps({ candidateChanges: [candidate], decisionVersion: 'review-v1' })
    wrapper.findAllComponents(NButton).find(button => button.text() === '修改后确认')!.vm.$emit('click')
    await wrapper.vm.$nextTick()
    const editor = wrapper.getComponent(StoryCandidateEditor)
    expect(editor.props('candidate')).toEqual(candidate)
    await wrapper.setProps({ candidateChanges: [], hasContent: false, decisionVersion: 'review-v2' })
    expect(wrapper.findComponent(StoryCandidateEditor).exists()).toBe(true)
    expect(editor.props('disabled')).toBe(true)
    expect(wrapper.text()).toContain('修改草稿已保留')
    editor.vm.$emit('confirm', candidate, '{"title":"作者修改"}', '')
    expect(wrapper.emitted('accept-candidate')).toBeUndefined()
    await wrapper.setProps({ candidateReceipt: { id: candidate.id, sequence: 1 } })
    expect(wrapper.findComponent(StoryCandidateEditor).exists()).toBe(false)
    wrapper.unmount()
  })

  it('offers evidence navigation and deferred findings while preserving the finalization blocker', async () => {
    const wrapper = renderReview(passingReview)
    const evidence = { id: 'evidence', sourceType: 'chapter' as const, sourceId: 'chapter', sourceVersionId: 'body', quote: '钥匙仍在门上' }
    const finding = { id: 'finding', type: 'continuity' as const, chapterId: 'chapter', sourceVersionId: 'body', severity: 'blocker' as const,
      title: '核对钥匙', explanation: '去向不明', status: 'deferred' as const, evidence: [evidence], blocksFinalization: true, authorNote: '等后文' }
    await wrapper.setProps({ reviewFindings: [finding], decisionVersion: 'review' })
    expect(wrapper.text()).toContain('已延后')
    expect(wrapper.text()).toContain('延后不代表已解决')
    await wrapper.get('.evidence-locate').trigger('click')
    expect(wrapper.emitted('locate-evidence')?.[0]).toEqual([evidence])
    await wrapper.get('[aria-label="审核问题处理说明"]').setValue('这里是故意留下的线索')
    wrapper.findAllComponents(NButton).find(button => button.text() === '标记有意')!.vm.$emit('click')
    expect(wrapper.emitted('resolve-finding')?.[0]).toEqual([finding, 'intentional', 'review', '这里是故意留下的线索'])
    await wrapper.setProps({ allowRewrite: false })
    expect(wrapper.findAllComponents(NButton).filter(button => button.element.closest('.finding-item')).every(button => button.props('disabled'))).toBe(true)
    await wrapper.setProps({ reviewFindings: [{ ...finding, status: 'accepted' }] })
    expect(wrapper.text()).not.toContain('当前问题会阻塞章节定稿')
    expect(wrapper.find('[aria-label="审核问题处理说明"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('keeps stale summary visible and requires author confirmation before it is used again', async () => {
    const wrapper = renderReview('')
    await wrapper.setProps({ summary: '保留的旧总结。', summaryState: 'stale',
      expanded: { summary: true, contentReview: false, localScan: false, aiReview: false, continuity: false, findings: false } })
    expect(wrapper.text()).toContain('保留的旧总结。')
    expect(wrapper.get('.summary-source-warning').text()).toContain('暂不用于 AI 写作和审核')
    const button = wrapper.findAllComponents(NButton).find(button => button.element.closest('.summary-source-warning'))!
    expect(button.props('disabled')).toBe(false)
    button.vm.$emit('click')
    expect(wrapper.emitted('confirm-summary')).toHaveLength(1)
    await wrapper.setProps({ summarySaving: true })
    expect(button.props('disabled')).toBe(true)
    await wrapper.setProps({ summarySaving: false, allowRewrite: false })
    expect(button.props('disabled')).toBe(true)
    await wrapper.setProps({ summaryState: 'current' })
    expect(wrapper.find('.summary-source-warning').exists()).toBe(false)
    expect(wrapper.text()).toContain('保留的旧总结。')
    wrapper.unmount()
  })
  it('requires edited selection text to be saved before accepting the persisted candidate', async () => {
    const wrapper = renderReview('')
    const revision = { id: 'revision', novelId: 'book', chapterId: 'chapter', baseContent: '原文。', proposedContent: '新文。',
      source: 'ai' as const, status: 'pending' as const, diff: '- 原文 + 新文', reason: '选区改写', createdAt: '2026-10-27', updatedAt: '2026-10-27',
      selection: { mode: 'rewrite' as const, startOffset: 0, endOffset: 2, contextVersion: 'context' } }
    await wrapper.setProps({ pendingRevision: revision })
    const text = wrapper.get<HTMLTextAreaElement>('.selection-replacement')
    expect(text.element.value).toBe('新文')
    const buttons = () => wrapper.findAllComponents(NButton).filter(button => button.element.closest('.revision-section'))
    expect(buttons().find(button => button.props('type') === 'primary')!.props('disabled')).toBe(false)
    await text.setValue('作者修改的新文')
    const accept = buttons().find(button => button.props('type') === 'primary')!
    expect(accept.props('disabled')).toBe(true)
    const save = buttons()[0]
    save.vm.$emit('click')
    expect(wrapper.emitted('edit-revision')?.[0]).toEqual(['作者修改的新文'])
    await wrapper.setProps({ pendingRevision: { ...revision, proposedContent: '作者修改的新文。' } })
    expect(accept.props('disabled')).toBe(false)
    await wrapper.setProps({ allowRewrite: false })
    expect(accept.props('disabled')).toBe(true)
    wrapper.unmount()
  })

  it('explains beliefs and relationship direction and disables decisions during persistence', async () => {
    const wrapper = renderReview(passingReview)
    const candidate = { id: 'knowledge', type: 'knowledge' as const, status: 'proposed' as const,
      createdAt: '', updatedAt: '', proposedValue: JSON.stringify({ characterName: '林澈', fact: '城主在世', state: 'false_belief', belief: '城主已经死了' }),
      evidence: [{ id: 'evidence', sourceType: 'chapter' as const, sourceId: 'chapter', quote: '林澈以为城主已经死了' }] }
    await wrapper.setProps({ candidateChanges: [candidate], candidateSaving: true })
    expect(wrapper.get('.candidate-card pre').text()).toContain('角色误信：城主已经死了（不代表客观事实）')
    expect(wrapper.findAllComponents(NButton).filter(button => button.element.closest('.candidate-card')).every(button => button.props('disabled'))).toBe(true)
    await wrapper.setProps({ candidateChanges: [{ ...candidate, type: 'relationship', proposedValue: JSON.stringify({ characterName: '林澈', targetCharacterName: '苏禾', relation: '怀疑' }) }] })
    expect(wrapper.get('.candidate-card pre').text()).toContain('林澈 → 苏禾：怀疑')
    wrapper.unmount()
  })

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

  it('renders structured findings with severity and evidence', async () => {
    const wrapper = renderReview(passingReview)
    await wrapper.setProps({
      reviewFindings: [{
        id: 'finding-1', type: 'timeline', severity: 'blocker', title: '时间线冲突', explanation: '前后日期不一致。',
        chapterId: 'chapter-1', sourceVersionId: 'content:v1', quotedText: '第三天抵达学院', evidence: [],
        blocksFinalization: true, status: 'open',
      }],
    })
    expect(wrapper.text()).toContain('结构化审核问题')
    expect(wrapper.text()).toContain('时间线冲突')
    expect(wrapper.text()).toContain('当前问题会阻塞章节定稿')
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
