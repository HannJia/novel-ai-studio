import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { buildLongformQuestionContext, formatLongformReport, LONGFORM_QUESTIONS, LONGFORM_QUESTION_FOLLOWUPS, LONGFORM_REVIEW_CASES, buildLongformReviewCase, runLongformEvaluation, scoreLongformAnswer } from '@/test/longformEval'
import { buildLongformFixture } from '@/test/longformEvalFixture'
import { REVIEW_CHUNK_SIZE } from './chapterReviewCoverage'
import { inspectChapterLength } from './chapterLength'
import type { LongformScale } from '@/test/longformEvalFixture'

// Pre-registered plan: docs/reconstruction-v2-longform-eval-plan.md. Thresholds live there, not here.
const scale = (process.env.MOJIAN_LONGFORM_SCALE === 'large' ? 'large' : 'default') as LongformScale

describe('long-form memory evaluation (deterministic, synthetic corpus)', () => {
  it('keeps Q2 factual correctness separate from the strict future-information answer gate', () => {
    const fixture = buildLongformFixture('default')
    const question = LONGFORM_QUESTIONS.find(item => item.id === 'Q2')!
    const context = buildLongformQuestionContext(fixture, question)
    const answer = '沈砚此时怀疑父亲仍然在世，但不能把后来白鹭转交的亲笔信提前到章初。'
    const futureFactLines = context.split('\n').filter(line => line.includes('白鹭转交的父亲亲笔信'))

    expect(context).toContain('怀疑')
    expect(futureFactLines.length).toBeGreaterThan(0)
    expect(futureFactLines.every(line => line.includes('本章已确认变化（仅从引文处生效，不可提前）'))).toBe(true)
    expect(scoreLongformAnswer(question, answer)).toEqual({ pass: false, missing: [], forbidden: ['亲笔信'] })
  })

  it('requires abstention when Q9 context does not confirm the magistrate dismissal', () => {
    const fixture = buildLongformFixture('default')
    const question = LONGFORM_QUESTION_FOLLOWUPS[0]
    const context = buildLongformQuestionContext(fixture, question)
    const unmarkedLines = context.split('\n').filter(line => !line.includes('本章已确认变化（仅从引文处生效，不可提前）'))
    const forbidden = question.contextForbids.filter(term => unmarkedLines.some(line => line.includes(term)))

    expect(context).toContain('渔户围堵府衙')
    expect(forbidden).toEqual([])
    expect(scoreLongformAnswer(question, '无法确认。现有已确认资料只说明渔户围府，未记载知府是否已被罢官。').pass).toBe(true)
    expect(scoreLongformAnswer(question, '知府已经被罢官。').pass).toBe(false)
  })

  it('keeps model review cases concise and free of repeated filler', () => {
    const fixture = buildLongformFixture('default')
    for (const reviewCase of LONGFORM_REVIEW_CASES) {
      const { chapter } = buildLongformReviewCase(fixture, reviewCase)
      expect(chapter.content.length).toBeLessThan(REVIEW_CHUNK_SIZE)
      expect(chapter.content).toContain(reviewCase.insert)
      expect(chapter.content).not.toContain('日常')
      expect(new Set(chapter.content.split('\n\n')).size).toBe(chapter.content.split('\n\n').length)
      if (reviewCase.expected === 'none') expect(inspectChapterLength(chapter.content).status).toBe('within')
    }
  })

  it('meets every pre-registered hard and quality threshold', () => {
    const report = runLongformEvaluation(scale)
    if (process.env.MOJIAN_LONGFORM_REPORT) writeFileSync(process.env.MOJIAN_LONGFORM_REPORT, formatLongformReport(report) + '\n')
    const failed = report.checks.filter(check => check.gate !== 'report' && !check.pass).map(check => check.id + '：' + check.actual)
    expect(failed).toEqual([])
  }, scale === 'large' ? 1_800_000 : 300_000)
})
