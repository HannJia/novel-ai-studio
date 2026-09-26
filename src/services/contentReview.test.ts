import { describe, expect, it } from 'vitest'
import { contentReviewVerdict, extractActionableReview, reviewNeedsRewrite } from './contentReview'

describe('actionable review excerpt', () => {
  it('keeps only concrete local, required and suggested issues with their evidence', () => {
    const report = `## 本地硬伤预检（必须修改）
1. 倒计时不符
   - 修改建议：调整天数。

---

# 第 2 章全维度审查报告
## 结论
- 总体判断：⚠️建议修改
- 必改数量：1
## 必改问题（只列严重问题）
1. [时间线] 日期矛盾
   - 原文证据：次日
   - 修改建议：改成第三天
## 建议修改（轻微问题）
1. [叙事] 转场太快
   - 修改建议：补充一句过渡
## 编辑建议（不影响通过）
1. 可添加氛围描写
## 六维度简评
1. 时间线：✅通过
2. 叙事：⚠️轻微`
    expect(extractActionableReview(report)).toBe(`## 本地硬伤预检（必须修改）
1. 倒计时不符
   - 修改建议：调整天数。

## 必改问题（只列严重问题）
1. [时间线] 日期矛盾
   - 原文证据：次日
   - 修改建议：改成第三天

## 建议修改（轻微问题）
1. [叙事] 转场太快
   - 修改建议：补充一句过渡`)
  })

  it('ignores no-issue sections, passing checks and editorial notes', () => {
    const report = `## 结论
总体判断：✅可通过
## 必改问题
无。
关键项均已核对通过。
## 建议修改
暂无。
## 编辑建议
可以增加气氛
## 六维度简评
1. ✅通过`
    expect(extractActionableReview(report)).toBe('')
  })
})

describe('content review verdict', () => {
  it('accepts a passed report with zero required issues and explanatory checks', () => {
    const report = `## 结论
- 总体判断：✅可通过
- 必改数量：0
- 建议修改数量：4
## 必改问题（只列严重问题）
无。
关键项已逐条演算核对：
- 年份与设定一致。
- 能力边界没有冲突。
## 建议修改
1. 过渡可以更自然。`
    expect(contentReviewVerdict(report)).toBe('passed')
    expect(reviewNeedsRewrite(report)).toBe(false)
  })

  it('accepts markdown emphasis and optional editorial suggestions', () => {
    expect(contentReviewVerdict('**总体判断：** ✅ 可通过\n必改数量：0\n## 编辑建议\n补充氛围')).toBe('passed')
  })

  it.each(['建议修改', '必须修改', '未通过', '不通过', '不能通过', '不可通过'])('blocks the explicit verdict %s', verdict => {
    expect(contentReviewVerdict(`总体判断：${verdict}\n必改数量：0`)).toBe('changes-required')
  })

  it('does not let a passed label override a positive required count or concrete critical issue', () => {
    expect(contentReviewVerdict('总体判断：可通过\n必改数量：1')).toBe('changes-required')
    expect(contentReviewVerdict('总体判断：可通过\n## 必改问题\n1. [时间线] 日期矛盾\n- 原文证据：次日')).toBe('changes-required')
  })

  it('keeps local hard-error findings blocking even if the AI passes', () => {
    expect(contentReviewVerdict('## 本地硬伤预检（必须修改）\n1. 剩余天数不符\n\n## 结论\n总体判断：可通过')).toBe('changes-required')
  })

  it.each(['', '# 全维度审查报告', '总体判断：正在分析', '## 必改问题\n无',
    '总体判断：✅可通过 / ⚠️建议修改 / ❌必须修改'])('does not treat an incomplete report as passed', report => {
    expect(contentReviewVerdict(report)).toBe('unknown')
    expect(reviewNeedsRewrite(report)).toBe(true)
  })
})
