function parseChineseNumber(value: string): number | null {
  if (/^\d+$/.test(value)) return Number(value)
  const digits: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  }
  if (value === '十') return 10
  const tenIndex = value.indexOf('十')
  if (tenIndex >= 0) {
    const left = value.slice(0, tenIndex)
    const right = value.slice(tenIndex + 1)
    return (left ? digits[left] : 1) * 10 + (right ? digits[right] : 0)
  }
  return digits[value] ?? null
}

function relativeDayOffset(label: string | undefined): number {
  if (!label || label === '今日' || label === '今天' || label === '当天' || label === '当日') return 0
  if (label === '明日' || label === '明天' || label === '次日' || label === '翌日' || label === '第二天') return 1
  if (label === '后日' || label === '后天') return 2
  return 0
}

function parseForecastWindow(text: string): { min: number; max: number } | null {
  const dayRange = text.match(/([一二两三四五六七八九十\d]+)[日天]到([一二两三四五六七八九十\d]+)[日天]/)
  if (dayRange) {
    const min = parseChineseNumber(dayRange[1])
    const max = parseChineseNumber(dayRange[2])
    if (min !== null && max !== null) return { min, max }
  }

  const halfDay = text.match(/([一二两三四五六七八九十\d]+)日半/)
  if (halfDay) {
    const value = parseChineseNumber(halfDay[1])
    if (value !== null) return { min: value + 0.5, max: value + 0.5 }
  }

  const relative = text.match(/(最早|最迟|顶多|至多)?(今日|今天|当天|当日|明日|明天|次日|翌日|第二天|后日|后天)/)
  if (relative) {
    const offset = relativeDayOffset(relative[2])
    return { min: offset, max: offset }
  }

  const single = text.match(/([一二两三四五六七八九十\d]+)[日天](?:内|左右|之内|就会|会|到)?/)
  if (single) {
    const value = parseChineseNumber(single[1])
    if (value !== null) return { min: value, max: value }
  }

  return null
}

function buildTrendForecastFindings(text: string): string[] {
  const findings: string[] = []
  const sentencePattern = /[^。！？\n]*(?:峰值|可采标准|成熟|采收)[^。！？\n]*(?:。|！|？|$)/g
  const forecasts: Array<{ evidence: string; index: number; day: number; maxAbsDay: number; hasAcceleration: boolean }> = []
  let match: RegExpExecArray | null

  while ((match = sentencePattern.exec(text))) {
    const evidence = match[0].trim()
    const window = parseForecastWindow(evidence)
    if (!window) continue
    const prefix = text.slice(Math.max(0, match.index - 180), match.index)
    const nearby = `${prefix}${evidence}`
    const dayLabel = nearby.match(/(第二日清晨|第二天清晨|次日清晨|翌日清晨|明日清晨|当天|当日|今日|今天|后日|后天)/)?.[1]
    const currentDay = dayLabel?.startsWith('第二') ? 2 : relativeDayOffset(dayLabel)
    forecasts.push({
      evidence,
      index: match.index,
      day: currentDay,
      maxAbsDay: currentDay + window.max,
      hasAcceleration: /更快|加快|变快|超出预期|比[^。！？\n]{0,20}还要快|速度[^。！？\n]{0,12}快/.test(nearby),
    })
  }

  for (let i = 1; i < forecasts.length; i++) {
    const prev = forecasts[i - 1]
    const current = forecasts[i]
    const accelerationContext = prev.hasAcceleration || current.hasAcceleration
    if (accelerationContext && current.maxAbsDay > prev.maxAbsDay) {
      findings.push(`1. [设定冲突检测] 生长趋势加快但峰值预估上限反而外扩
   - 原文证据一：「${prev.evidence}」
   - 原文证据二：「${current.evidence}」
   - 问题原因：前序预估折算最迟为第 ${prev.maxAbsDay} 日，后续预估折算最迟为第 ${current.maxAbsDay} 日；正文同时出现“更快/加快/超出预期”等趋势信号时，最迟达成日应收紧或持平，不能向后外扩。
   - 修改建议：将后续预估改为不晚于第 ${prev.maxAbsDay} 日的窗口，例如“一日内、顶多一日半”，或删除“更快/超出预期”的趋势判断。`)
    }
  }

  return findings
}

export function buildLocalConsistencyReviewBlock(text: string): string {
  const findings: string[] = []
  const basePattern = /距月底(?:采收)?还有([一二两三四五六七八九十\d]+)[日天]/g
  let baseMatch: RegExpExecArray | null

  while ((baseMatch = basePattern.exec(text))) {
    const baseRemaining = parseChineseNumber(baseMatch[1])
    if (baseRemaining === null) continue

    const afterBase = text.slice(baseMatch.index + baseMatch[0].length, baseMatch.index + baseMatch[0].length + 900)
    const currentDayMatch = afterBase.match(/(次日|翌日|第二天|明日|明天|今日|今天|当天|当日|后日|后天)[\s\S]{0,260}?((?:今日|今天|当天|当日|明日|明天|次日|翌日|第二天|后日|后天)?)[^。！？\n]{0,80}?离月底还有(?:整整)?([一二两三四五六七八九十\d]+)[日天]/)
    if (!currentDayMatch) continue

    const currentOffset = relativeDayOffset(currentDayMatch[1])
    const targetOffset = relativeDayOffset(currentDayMatch[2])
    const claimedRemaining = parseChineseNumber(currentDayMatch[3])
    if (claimedRemaining === null) continue

    const expectedRemaining = baseRemaining - currentOffset - targetOffset
    if (expectedRemaining >= 0 && expectedRemaining !== claimedRemaining) {
      findings.push(`1. [剧情连贯性] 相对时间剩余天数自相矛盾
   - 原文证据：「${baseMatch[0]}」；后文「${currentDayMatch[0]}」
   - 问题原因：以“${baseMatch[0]}”为基准，${currentDayMatch[1]}再计算“${currentDayMatch[2] || '当前'}”后，离月底应剩 ${expectedRemaining} 天，而正文写成 ${claimedRemaining} 天。
   - 修改建议：统一时间轴，改为“离月底还有${expectedRemaining}天”，或调整前文基准天数。`)
    }
  }

  findings.push(...buildTrendForecastFindings(text))

  if (findings.length === 0) return ''
  return `## 本地硬伤预检（必须修改）
${findings.join('\n\n')}`
}

