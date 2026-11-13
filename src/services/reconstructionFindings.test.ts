import { describe, expect, it } from 'vitest'
import { buildContinuityFindings, mergeReviewFindings, parseReviewFindings } from './reconstructionFindings'

describe('structured reconstruction findings', () => {
  const input = {
    chapterId: 'chapter-1',
    sourceVersionId: 'content:v1',
    content: '林澈在第三天抵达学院，随后在第二天见到了守门人。',
  }

  it('converts continuity alerts into evidence-backed blocking findings', () => {
    const findings = buildContinuityFindings({
      ...input,
      alerts: [{ id: 'alert-1', level: 'warning', title: '时间线冲突', detail: '章节中的日期前后矛盾。', evidence: '第三天抵达学院' }],
    })
    expect(findings[0]).toMatchObject({ severity: 'blocker', blocksFinalization: true, type: 'continuity' })
    expect(findings[0].evidence[0]).toMatchObject({ quote: '第三天抵达学院', startOffset: 3 })
  })

  it('parses required and suggested report sections into separate findings', () => {
    const report = '## 必改问题\n1. [时间线冲突] 正文写成「第三天抵达学院」，但后文又说第二天。\n## 建议修改\n1. [节奏] 可以补充环境细节。'
    const findings = parseReviewFindings({ ...input, report })
    expect(findings).toHaveLength(2)
    expect(findings[0]).toMatchObject({ severity: 'blocker', type: 'timeline', blocksFinalization: true, quotedText: '第三天抵达学院' })
    expect(findings[1]).toMatchObject({ severity: 'suggestion', type: 'pacing', blocksFinalization: false })
    expect(findings[0].evidence).toHaveLength(1)
  })

  it('classifies explicit foreshadowing findings separately from plot findings', () => {
    const report = '## 建议修改\n1. [伏笔] 青灯线索尚未回收。\n2. [情节] 事件推进略显突兀。'
    const findings = parseReviewFindings({ ...input, report })
    expect(findings.map(item => item.type)).toEqual(['foreshadowing', 'plot'])
  })

  it('deduplicates findings from multiple review layers', () => {
    const finding = parseReviewFindings({ ...input, report: '## 建议修改\n1. [节奏] 可以补充环境细节。' })
    expect(mergeReviewFindings(finding, finding)).toHaveLength(1)
  })

  it('keeps evidence, explanation and suggested fixes inside their parent finding', () => {
    const report = `## 必改问题（只列严重问题）
1. [时间线] 前后顺序矛盾
   - 原文证据：“第三天抵达学院”
   - 问题原因：后文又说第二天。
   - 修改建议：统一为第三天。
2. [知情] 人物提前知道内容
   - 原文证据：“第二天见到了守门人”
   - 问题原因：尚未发生见面。
   - 修改建议：删除提前获知的内容。
## 建议修改（轻微问题）
- [节奏] 增加过渡
  - 修改建议：补一句环境描写。
    1. 保留当前视角。
    2. 不新增事件。
## 编辑建议（不影响通过）
1. 保留克制风格。`
    const findings = parseReviewFindings({ ...input, report })
    expect(findings).toHaveLength(4)
    expect(findings.filter(item => item.blocksFinalization)).toHaveLength(2)
    expect(findings[0]).toMatchObject({
      quotedText: '第三天抵达学院', suggestedFix: '统一为第三天。',
    })
    expect(findings[0].evidence[0]?.startOffset).toBe(3)
    expect(findings[1].suggestedFix).toBe('删除提前获知的内容。')
    expect(findings[2].explanation).toContain('不新增事件。')
    expect(findings[2].suggestedFix).toContain('不新增事件。')
  })

  it('recognizes unindented detail labels and markdown emphasis without inventing findings', () => {
    const report = '## 必改问题\n1. [时间线] 顺序矛盾\n- **原文证据**：“第三天抵达学院”\n- **问题原因**：先后矛盾。\n- **修改建议**：统一日期。\n2. [知情] 未知信息\n- 修改建议：保留未知。'
    const findings = parseReviewFindings({ ...input, report })
    expect(findings).toHaveLength(2)
    expect(findings[0].suggestedFix).toBe('统一日期。')
    expect(findings[1].suggestedFix).toBe('保留未知。')
  })

  it('ignores empty issue lists and resets list indentation between sections', () => {
    const report = '## 必改问题\n无\n## 建议修改\n  - [节奏] 调整段落\n    - 修改建议：留一行空白。\n  - [文风] 保持视角\n## 编辑建议\n1. 调整标点。'
    const findings = parseReviewFindings({ ...input, report })
    expect(findings).toHaveLength(3)
    expect(findings.every(item => !item.blocksFinalization)).toBe(true)
  })
  it('does not turn a no-issue explanation into a phantom blocker', () => {
    const findings = parseReviewFindings({ ...input, report: '## 必改问题\n无。本章时间线单向推进，人物知情与前文一致。\n- 年份与设定一致。\n## 建议修改\n1. [节奏] 可补充过渡。' })
    expect(findings).toHaveLength(1)
    expect(findings[0].blocksFinalization).toBe(false)
  })
  it('retains explicit real issues after a contradictory no-issue declaration', () => {
    const findings = parseReviewFindings({ ...input, report: '## 必改问题\n无。\n1. [时间线] 第三天和第二天倒置。\n- 问题原因：时序相反。' })
    expect(findings).toHaveLength(1)
    expect(findings[0].blocksFinalization).toBe(true)
  })
  it('does not treat a sentence starting with 无视 as an empty declaration', () => {
    const findings = parseReviewFindings({ ...input, report: '## 必改问题\n无视了前文确认的日期，存在倒序。' })
    expect(findings).toHaveLength(1)
    expect(findings[0].blocksFinalization).toBe(true)
  })
})
