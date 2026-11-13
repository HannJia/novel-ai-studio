import { beforeEach, describe, expect, it } from 'vitest'
import liveV5 from '@/test/fixtures/longform-v5-no-issues.json'
import { buildLongformFixture } from '@/test/longformEvalFixture'
import { buildLongformReviewCase, LONGFORM_REVIEW_CASES } from '@/test/longformEval'
import { createPinia, setActivePinia } from 'pinia'
import { characterStateFixture } from '@/test/characterStateFixture'
import { useKnowledgeStore } from '@/stores/knowledge'
import { buildChapterReviewInput, buildChapterReviewResult } from './chapterReviewInput'
import { selectKnowledgeEntries } from './knowledgeSelection'
import { createEntrySummarySource } from './knowledgeSources'
import { buildReviewContextVersion } from './reconstructionReviewVersion'
import { splitReviewChunks } from './chapterReviewCheckpoint'

beforeEach(() => setActivePinia(createPinia()))
function fixture() {
  const { novel } = characterStateFixture()
  novel.outline = '石桥通行规则核对'
  const store = useKnowledgeStore(), base = store.createKB('石桥规则')
  const entry = store.addEntry(base.id, { title: '石桥通行', category: '规则',
    content: '石桥只准持蓝色通行证者通过。', summary: '', tags: ['石桥'] })!
  novel.knowledgeBaseIds = [base.id]
  const chapter = novel.chapters[2]
  chapter.title = '石桥通行'
  return { novel, chapter, base, entry, store }
}

describe('explicit chapter review inputs', () => {
  it('replays the unchanged live V5 report without fabricating a blocker from its passing explanation', () => {
    const { fixture: corpus, chapter } = buildLongformReviewCase(buildLongformFixture('large'), LONGFORM_REVIEW_CASES.find(row => row.id === 'V5')!)
    expect(chapter.content.length).toBe(liveV5.sourceCharacters)
    expect(liveV5.finishReason).toBe('stop')
    const input = buildChapterReviewInput(corpus.novel, chapter, { knowledge: [], canonMutations: corpus.records, storyMemories: [] })
    const { review } = buildChapterReviewResult(input, liveV5.report, [], [], '2026-11-10T00:00:00.000Z')
    expect(review.semanticChecksPassed).toBe(true)
    expect(review.findings.filter(row => row.blocksFinalization)).toEqual([])
    expect(review.status).toBe('ready_to_finalize')
  })

  it('ignores a setting outside every actual prompt budget', () => {
    const { novel, chapter } = fixture()
    novel.settings.protagonist.background = '背景'.repeat(2000)
    const before = buildChapterReviewInput(novel, chapter)
    novel.settings.coreConflict.coreSuspense = '预算外的未使用内容'
    const after = buildChapterReviewInput(novel, chapter)
    expect(after.buildContext(chapter.content)).toEqual(before.buildContext(chapter.content))
    expect(after.signature).toBe(before.signature)
  })
  it('shares the per-chapter input with signatures and includes author scene notes', () => {
    const { novel, chapter } = fixture()
    const before = buildChapterReviewInput(novel, chapter)
    chapter.sceneNotes = [{ id: 'note', title: '作者要求', content: '本章不得提前揭晓守门人的身份。', source: 'user', createdAt: novel.createdAt, updatedAt: novel.createdAt }]
    const after = buildChapterReviewInput(novel, chapter)
    expect(after.buildContext(chapter.content).chapterGuidance).toContain(chapter.sceneNotes[0].content)
    expect(after.signature).not.toBe(before.signature)
    expect(after.contextVersion).toBe(buildReviewContextVersion(novel, chapter))
  })
  it('binds local findings even when a data value is absent from model context', () => {
    const { novel, chapter } = fixture()
    chapter.content = '无关计数器的数字为5。'
    novel.dataPanels = Array.from({ length: 24 }, (_, index) => ({ id: 'panel-' + index, name: '无关计数器' + index, category: '资源' as const,
      fields: [{ id: 'number', name: '数字', value: '5', unit: '', note: '', type: 'number' as const }],
      relatedKeywords: [], createdAt: novel.createdAt, updatedAt: novel.createdAt }))
    const before = buildChapterReviewInput(novel, chapter)
    novel.dataPanels[23].fields[0].value = '8'
    const after = buildChapterReviewInput(novel, chapter)
    expect(after.alerts).not.toEqual(before.alerts)
    expect(after.signature).not.toBe(before.signature)
  })
  it('retains every original review slice and does not allow mutation of captured contexts', () => {
    const { novel, chapter } = fixture()
    chapter.content = '甲'.repeat(3300) + '林澈走进桥头。' + '乙'.repeat(3300)
    const input = buildChapterReviewInput(novel, chapter)
    for (const chunk of splitReviewChunks(chapter.content)) {
      const before = input.buildContext(chunk.text)
      expect(before.chapterContent).toBe(chunk.text)
      const original = JSON.parse(JSON.stringify(before))
      before.settings = '被调用方覆盖'; before.chapterContent = '不是原文'
      expect(input.buildContext(chunk.text)).toEqual(original)
    }
  })
  it('keeps plan progress and later chapters outside the current review while retaining author constraints', () => {
    const { novel, chapter } = fixture()
    novel.chapterPlans = [{ id: 'plan', horizon: 'next', status: 'awaiting_review', title: '当前计划', objective: '先验证通行证',
      summary: '', beats: [], targetChapterStart: chapter.chapterIndex, targetChapterEnd: chapter.chapterIndex,
      relatedArcIds: [], relatedEventIds: [], source: 'user', versions: [], createdAt: novel.createdAt, updatedAt: novel.createdAt }]
    const before = buildChapterReviewInput(novel, chapter)
    novel.chapterPlans[0].status = 'completed'
    novel.chapterPlans.push({ ...novel.chapterPlans[0], id: 'later-plan', title: '下一章计划', objective: '未来才揭露的秘密',
      status: 'planned', targetChapterStart: chapter.chapterIndex + 1, targetChapterEnd: chapter.chapterIndex + 1 })
    const after = buildChapterReviewInput(novel, chapter)
    expect(after.signature).toBe(before.signature)
    expect(JSON.stringify(after.buildContext(chapter.content))).not.toContain('未来才揭露的秘密')
    expect(novel.chapterPlans[0].status).toBe('completed')
    novel.chapterPlans[0].objective = '必须保密并原路返回'
    expect(buildChapterReviewInput(novel, chapter).signature).not.toBe(before.signature)
  })
  it('does not inject live knowledge absent from the supplied review sources', () => {
    const { novel, chapter } = fixture()
    const input = buildChapterReviewInput(novel, chapter, { knowledge: [] })
    expect(JSON.stringify(input.buildContext(chapter.content))).not.toContain('石桥只准持蓝色通行证者通过。')
  })

  it('freezes the prompt together with the request signature when author and knowledge inputs change', () => {
    const { novel, chapter, entry, store } = fixture()
    const input = buildChapterReviewInput(novel, chapter, { knowledge: store.knowledgeBases })
    const before = input.buildContext(chapter.content), signature = input.signature
    expect(JSON.stringify(before)).toContain('石桥只准持蓝色通行证者通过。')
    entry.content = '石桥只准持红色通行证者通过。'
    novel.settings.worldBuilding.specialRules = '新的世界规则'
    expect(input.buildContext(chapter.content)).toEqual(before)
    expect(input.signature).toBe(signature)
    const current = buildChapterReviewInput(novel, chapter, { knowledge: store.knowledgeBases })
    expect(current.signature).not.toBe(signature)
    expect(JSON.stringify(current.buildContext(chapter.content))).toContain('石桥只准持红色通行证者通过。')
  })

  it('constructs explicit knowledge context without an active UI store', () => {
    const { novel, chapter, base } = fixture()
    const snapshot = JSON.parse(JSON.stringify({ novel, chapter, knowledge: [base] }))
    setActivePinia(undefined)
    const input = buildChapterReviewInput(snapshot.novel, snapshot.chapter, { knowledge: snapshot.knowledge })
    expect(JSON.stringify(input.buildContext(snapshot.chapter.content))).toContain('石桥只准持蓝色通行证者通过。')
  })

  it('keeps equal-score knowledge selection stable after a different storage row order', () => {
    const { novel, chapter, base, entry } = fixture()
    base.entries = ['c', 'b', 'a'].map(id => ({ ...entry, id, title: '石桥规则', content: '石桥规则' + id }))
    const first = buildChapterReviewInput(novel, chapter, { knowledge: [base] })
    const selected = selectKnowledgeEntries([base], [base.id], ['石桥'], 2).map(row => row.id)
    expect(selected).toEqual(['a', 'b'])
    base.entries.reverse()
    expect(selectKnowledgeEntries([base], [base.id], ['石桥'], 2).map(row => row.id)).toEqual(selected)
    expect(buildChapterReviewInput(novel, chapter, { knowledge: [base] }).signature).toBe(first.signature)
  })

  it('uses a confirmed summary only while its original source is current', () => {
    const { novel, chapter, base, entry } = fixture()
    entry.summary = '桥头只验蓝证的压缩规则。'
    entry.summarySource = createEntrySummarySource(base.id, entry, entry.summary, 'author', novel.createdAt)
    const before = buildChapterReviewInput(novel, chapter, { knowledge: [base] })
    expect(JSON.stringify(before.buildContext(chapter.content))).toContain(entry.summary)
    entry.content = '石桥只准持红色通行证者通过。'
    const after = buildChapterReviewInput(novel, chapter, { knowledge: [base] })
    const context = JSON.stringify(after.buildContext(chapter.content))
    expect(after.signature).not.toBe(before.signature)
    expect(context).not.toContain(entry.summary)
    expect(context).toContain(entry.content)
    expect(entry.summary).toBe('桥头只验蓝证的压缩规则。')
  })
})
