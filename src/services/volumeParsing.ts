import type { Volume } from '@/types/novel'

function plain(text: string): string {
  return text.replace(/\*\*|__|`/g, '').replace(/[【】]/g, '').trim()
}

export function parseVolumeEstimates(text: string): { estimatedChapters?: number; estimatedWordCount?: number } {
  const clean = plain(text)
  const chapter = clean.match(/(?:预估|预计|计划)?章(?:节数|数|节)[^\n：:]{0,8}[：:]\s*(?:约|共|大约)?\s*(\d+)\s*(?:章|个章节)?/)
    || clean.match(/(?:约|共|大约)?\s*(\d+)\s*(?:章|个章节)(?!节)/)
  const words = clean.match(/(?:预估|预计|计划)?字数[：:]\s*(?:约|共|大约)?\s*([\d.]+)\s*(万)?字/)
    || clean.match(/([\d.]+)\s*(万)字/)
  const chapters = chapter ? Number(chapter[1]) : 0
  const wordCount = words ? Number(words[1]) / (words[2] ? 1 : 10000) : 0
  return {
    estimatedChapters: chapters > 0 && Number.isFinite(chapters) ? chapters : undefined,
    estimatedWordCount: wordCount > 0 && Number.isFinite(wordCount) ? Math.round(wordCount * 1000) / 1000 : undefined,
  }
}

/** Both the onboarding outline and the planning workspace use this parser. */
export function parseVolumesFromText(raw: string): Volume[] {
  const lines = raw.replace(/```(?:markdown|md)?/gi, '').split(/\r?\n/)
  const startPattern = /^(#{1,4}\s*)?(?:第\s*[一二三四五六七八九十百零\d]+\s*卷|卷\s*[一二三四五六七八九十百零\d]+|卷名)[：:\s—-]*(.*)$/
  const blocks: Array<{ title: string; lines: string[]; level: number }> = []
  let current: typeof blocks[number] | undefined
  for (const line of lines) {
    const clean = plain(line)
    const start = clean.match(startPattern)
    if (start) {
      current = { title: clean.replace(/^#{1,4}\s*/, ''), lines: [], level: start[1]?.trim().length || 0 }
      blocks.push(current)
    } else if (current) {
      const heading = clean.match(/^(#{1,4})\s+/)
      // A peer outline heading (e.g. role table) is not part of the final volume.
      if (heading && (
        /全书|总字数|主要角色表|核心冲突/.test(clean)
        || (current.level && heading[1].length < current.level)
        || (current.level && heading[1].length === current.level && !/主题|剧情|转折|角色变化|预估|预计/.test(clean))
      )) current = undefined
      else current.lines.push(line)
    }
  }
  return blocks.map((block, index) => {
    const body = block.lines.join('\n').trim()
    const clean = plain(body)
    const estimates = parseVolumeEstimates(`${block.title}\n${body}`)
    const field = (labels: string) => {
      const match = clean.match(new RegExp(`(?:^|\\n)\\s*(?:#{1,4}\\s*)?(?:${labels})[：:]?\\s*([^\\n]+)`))
      return match?.[1]?.trim() || ''
    }
    const theme = field('核心主题|主题')
    const summary = body.replace(/^\s*(?:\*\*|__)?(?:预估|预计)?(?:章节数|章数|字数|章节数和字数).*$/gm, '').trim()
    return {
      id: `vol-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 7)}`,
      volumeIndex: index, title: block.title, theme, summary,
      keyTurningPoints: field('关键转折点?|核心转折|重要转折'),
      characterChanges: field('角色变化|人物变化|角色发展'),
      estimatedChapters: estimates.estimatedChapters || (estimates.estimatedWordCount ? Math.round(estimates.estimatedWordCount / 0.225) : 0),
      estimatedWordCount: estimates.estimatedWordCount || (estimates.estimatedChapters ? Math.round(estimates.estimatedChapters * 0.225 * 10) / 10 : 0),
    }
  })
}
