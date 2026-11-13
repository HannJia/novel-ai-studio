import { parseReviewFindings } from '@/services/reconstructionFindings'
import { buildAnalysisSourceVersionId } from '@/services/reconstructionCandidates'
import type { ReviewFinding } from '@/types/reconstruction'

/** Synthetic 20-fragment report: four issues with fields, four editorial notes. */
export function legacyReviewFindingsFixture(chapterId: string, content: string) {
  const input = { chapterId, content, sourceVersionId: buildAnalysisSourceVersionId(content) }
  const sections = [
    { heading: '必改问题', items: ['[知情] 未拆信却知道第三行', '[物品] 钥匙没有交接'] },
    { heading: '建议修改', items: ['[节奏] 补充渡口过渡', '[文风] 减少重复描述'] },
    { heading: '编辑建议', items: ['保留克制语气。', '统一标点。', '保留雨声。', '适当分段。'] },
  ]
  const old: ReviewFinding[] = []
  const report = sections.map((section, index) => '## ' + section.heading + '\n' + section.items.map((title, item) => {
    const lines = [title, ...(index < 2 ? [
      '原文证据：“' + content.slice(index * 2 + item, index * 2 + item + 10) + '”', '问题原因：' + title + '，需要核对。', '修改建议：处理第' + (index * 2 + item + 1) + '项。',
    ] : [])]
    // Produce the legacy separate rows with real parser IDs, without seeding
    // assumptions about the new migration's identity or grouping functions.
    for (const line of lines) old.push(...parseReviewFindings({ ...input, report: '## ' + section.heading + '\n1. ' + line }))
    return (item + 1) + '. ' + lines[0] + lines.slice(1).map(line => '\n   - ' + line).join('')
  }).join('\n')).join('\n')
  old[0].status = 'deferred'; old[0].authorNote = '父项待核对'
  old[1].status = 'accepted'; old[1].authorNote = '只确认引文位置'
  old[4].status = 'intentional'; old[4].authorNote = '有意保留归属悬念'
  return { ...input, report, old: JSON.parse(JSON.stringify(old)) as ReviewFinding[] }
}
