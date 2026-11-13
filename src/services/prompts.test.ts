import { describe, expect, it } from 'vitest'
import { buildChapterAnalysisPrompt, buildChapterEndingCheckPrompt, buildChapterEndingContinuationPrompt, buildChapterPrompt, buildOutlinePrompt, buildVolumePlanningPrompt, buildChapterWritingPlanPrompt, buildContentReviewPrompt } from './prompts'
import { buildReviewContext } from './context'
import type { ChapterEndingCheck } from './chapterEnding'
import { createPinia, setActivePinia } from 'pinia'
import { useNovelStore } from '@/stores/novel'
import { createEmptyCreationDraft } from '@/types/reconstruction'

it('uses an approved short-work contract in outline and volume planning without contradictory long-form defaults', () => {
  setActivePinia(createPinia())
  const store = useNovelStore()
  const book = store.addNovel({ genre: '', subGenre: '', tags: [], targetWordCountMin: 80, targetWordCountMax: 120,
    settings: store.defaultSettings(), writingStyle: store.defaultWritingStyle() })
  const draft = createEmptyCreationDraft({ id: 'short', now: '2026-11-13T00:00:00Z' })
  Object.assign(draft.contract, { approval: 'approved', targetWordCountMin: 900, targetWordCountMax: 1100,
    genre: '古代日常', pointOfView: '第三人称限知', styleDirection: '朴素克制' })
  draft.approval.contract = 'approved'
  for (const build of [buildOutlinePrompt, buildVolumePlanningPrompt]) {
    const prompt = build(book, draft).map(item => item.content).join('\n')
    expect(prompt).toContain('900~1100 字')
    expect(prompt).toContain('单章篇幅尚未由作者设置')
    expect(prompt).not.toMatch(/百万字|800000|1200000|2200|禁止使用整数|数字避免整数/)
  }
  const unapproved = { ...draft, approval: { ...draft.approval, contract: 'draft' as const } }
  expect(buildOutlinePrompt(book, unapproved)[1].content).toContain('800000~1200000 字')
  book.chapterLengthPolicy = { minWords: 100, targetWords: 500, maxWords: 1000 }
  expect(buildOutlinePrompt(book, draft)[1].content).toContain('100~1000')
  expect(book.targetWordCountMin).toBe(80)
})

it('uses the same custom length policy in outline, volume, writing and beat planning', () => {
  setActivePinia(createPinia())
  const store = useNovelStore()
  const book = store.addNovel({ genre: '', subGenre: '', tags: [], targetWordCountMin: 10, targetWordCountMax: 20, settings: store.defaultSettings(), writingStyle: store.defaultWritingStyle() })
  book.chapterLengthPolicy = { minWords: 3000, targetWords: 3500, maxWords: 4000 }
  for (const prompt of [buildOutlinePrompt(book), buildVolumePlanningPrompt(book), buildChapterPrompt(book, '', '', '', ''), buildChapterWritingPlanPrompt(book, '', '')]) {
    const text = prompt.map(message => message.content).join('\n')
    expect(text).toContain('3500')
    expect(text).toContain('3000~4000')
    expect(text).not.toContain('2000~2500')
    expect(text).not.toContain('2000~2200')
  }
})

it('reviews with the effective short-chapter policy and deterministic count', () => {
  setActivePinia(createPinia())
  const store = useNovelStore()
  const book = store.addNovel({ genre: '', subGenre: '', tags: [], targetWordCountMin: 1, targetWordCountMax: 1, settings: store.defaultSettings(), writingStyle: store.defaultWritingStyle() })
  book.chapterLengthPolicy = { minWords: 100, targetWords: 500, maxWords: 1000 }
  const chapter = { id: 'test-chapter', chapterIndex: 0, volumeIndex: 0, title: '验收', content: '雨。\n'.repeat(243), summary: '', wordCount: 486, status: 'draft' as const, createdAt: '', updatedAt: '' }
  const context = buildReviewContext(book, chapter, chapter.content)
  expect(context.lengthPolicy).toEqual(book.chapterLengthPolicy)
  expect(context.chapterWordCount).toBe(486)
  const prompt = buildContentReviewPrompt(context, 0)[1].content
  expect(prompt).toContain('目标长度：500 字')
  expect(prompt).toContain('100~1000 字')
  expect(prompt).toContain('确定性统计：486 字')
  expect(prompt).toContain('不得用总字数除以章节数')
  expect(prompt).toContain('接受范围内不得仅因低于目标而要求扩写')
  expect(prompt).toContain('整份报告尽量控制在 1600 个中文字符以内')
  expect(prompt).toContain('不要输出思考过程、推理草稿、分析草稿')
  expect(prompt).toContain('正文却出现相反的持有/位置状态')
  expect(prompt).toContain('必须列为严重问题')
})

it('requests the explicit fields displayed on volume cards', () => {
  setActivePinia(createPinia())
  const store = useNovelStore()
  const book = store.addNovel({ genre: '', subGenre: '', tags: [], targetWordCountMin: 1, targetWordCountMax: 1,
    settings: store.defaultSettings(), writingStyle: store.defaultWritingStyle() })
  const prompt = buildVolumePlanningPrompt(book).map(message => message.content).join('\n')
  for (const label of ['目标：', '冲突：', '收束：']) expect(prompt).toContain(label)
})

describe('章节结构化分析 Prompt', () => {
  it('要求一次返回事件、角色、全书规划和数据变化', () => {
    const messages = buildChapterAnalysisPrompt('正文', '数据面板', '全书规划')
    const content = messages[1].content
    expect(content).toContain('"events"')
    expect(content).toContain('"characters"')
    expect(content).toContain('"globalPlans"')
    expect(content).toContain('"dataChanges"')
  })
})

describe('章节结尾 Prompt', () => {
  it('不把字数或完整句误判为完整章节', () => {
    const content = buildChapterEndingCheckPrompt('林澈准备启动手动导航。', '启动导航并确认结果')[1].content
    expect(content).toContain('达到目标字数或末尾有句号，都不能单独证明章节完整')
    expect(content).toContain('有效悬念')
    expect(content).toContain('强行截断')
    expect(content).toContain('"isComplete"')
  })

  it('收尾续写只完成当前剧情节拍', () => {
    const check: ChapterEndingCheck = {
      isComplete: false,
      isValidCliffhanger: false,
      openAction: '导航尚未启动',
      reason: '动作停在执行之前',
      continuationInstruction: '启动导航并形成结果',
    }
    const content = buildChapterEndingContinuationPrompt('他抬起手。', check)[1].content
    expect(content).toContain('导航尚未启动')
    expect(content).toContain('约 150~400 字')
    expect(content).toContain('不开启新场景')
  })
})
