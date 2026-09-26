export type ContentReviewVerdict = 'passed' | 'changes-required' | 'unknown'

export function extractActionableReview(report: string): string {
  const headings = [...report.matchAll(/^#{1,2}\s+(.+)\s*$/gm)]
  const sections: string[] = []
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i][1].trim()
    if (!headings[i][0].startsWith('##') || !/^(?:本地硬伤预检|必改问题|建议修改)(?:\s|（|[(]|$)/.test(heading)) continue
    const body = report.slice(headings[i].index! + headings[i][0].length, headings[i + 1]?.index ?? report.length)
      .replace(/^\s*---\s*$/gm, '').trim()
    if (!body || /^(?:无|暂无|没有)(?:[。.!！\s]|问题|发现|必改项|建议修改项)/.test(body)) continue
    sections.push(`## ${heading}\n${body}`)
  }
  return sections.join('\n\n')
}

export function contentReviewVerdict(report: string): ContentReviewVerdict {
  const text = report.replace(/\r/g, '').replace(/\*\*/g, '')
  const localFindings = text.match(/##\s*本地硬伤预检[^\n]*\n([\s\S]*?)(?=\n#{1,2}\s|$)/)?.[1]?.trim()
  if (localFindings && !/^(?:无|暂无)[。.!！\s]*$/.test(localFindings)) return 'changes-required'

  const conclusion = text.match(/总体判断[：:]\s*([^\n]+)/)?.[1]?.trim() || ''
  if (/[\/／]/.test(conclusion) && /可通过/.test(conclusion) && /建议修改|必须修改/.test(conclusion)) return 'unknown'
  const requiredCount = text.match(/必改数量[：:]\s*(\d+)/)?.[1]
  if (requiredCount && Number(requiredCount) > 0) return 'changes-required'
  if (/必须修改|建议修改|不通过|未通过|不能通过|不可通过|❌/.test(conclusion)) return 'changes-required'
  if (!/可通过|^✅\s*通过|^通过/.test(conclusion)) return 'unknown'

  // A zero-issue report may include successful checks after "无"; these are not revision requests.
  const requiredSection = text.match(/##\s*必改问题[^\n]*\n([\s\S]*?)(?=\n##\s|$)/)?.[1] || ''
  if (/^\s*\d+[.、)]\s*\[[^\]]+\]/m.test(requiredSection)
    && /原文证据[：:]|问题原因[：:]/.test(requiredSection)) return 'changes-required'
  return 'passed'
}

export function reviewNeedsRewrite(report: string): boolean {
  return contentReviewVerdict(report) !== 'passed'
}
