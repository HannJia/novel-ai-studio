import type { Chapter, Novel } from '@/types/novel'

type ContinuityAlertLevel = 'warning' | 'info'

export interface ContinuityAlert {
  id: string
  level: ContinuityAlertLevel
  title: string
  detail: string
  evidence: string
}

function numberPattern(value: string): RegExp {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`${escaped}[^\\n]{0,18}?(\\d+(?:\\.\\d+)?)`)
}

/** Fast local checks only; this never mutates story data or calls an API. */
export function scanContinuity(novel: Novel, chapter: Chapter, content: string): ContinuityAlert[] {
  const text = content.trim()
  if (!text) return []
  const alerts: ContinuityAlert[] = []
  const add = (level: ContinuityAlertLevel, title: string, detail: string, evidence: string) => {
    if (alerts.some(item => item.title === title && item.detail === detail)) return
    alerts.push({ id: `${chapter.id}-${alerts.length}`, level, title, detail, evidence })
  }

  for (const item of novel.dataPanels || []) {
    for (const field of item.fields || []) {
      if (!field.value || !/^[-+]?\d+(?:\.\d+)?$/.test(field.value.trim())) continue
      const match = text.match(numberPattern(field.name))
      if (!match || match[1] === field.value.trim()) continue
      add('warning', `${item.name} · ${field.name}`, `正文提到 ${match[1]}，数据面板当前为 ${field.value}。如确实发生变化，可在章节完成后确认变更。`, match[0].slice(0, 90))
    }
  }

  for (const character of novel.characters || []) {
    if (!character.name || !text.includes(character.name)) continue
    if (character.status === '死亡' && !/(已死|死亡|尸体|遗体|亡故|死去)/.test(text)) {
      add('warning', `${character.name} 状态冲突`, '角色库标记为“死亡”，但本章仍直接出现该角色；请确认这是回忆、幻象还是状态需要调整。', character.name)
    } else if (character.status === '退场' && /(现身|出现|走进|说道|回答)/.test(text)) {
      add('info', `${character.name} 可能重新出场`, '角色库标记为“退场”，本章出现了行动描写；如为正式回归，章节完成后可更新角色状态。', character.name)
    }
  }

  const previous = novel.chapters.filter(item => item.id !== chapter.id && item.content.trim())
  const firstSentence = text.split(/[。！？!?\n]/).map(item => item.trim()).find(item => item.length >= 18)
  if (firstSentence && previous.some(item => item.content.includes(firstSentence))) {
    add('info', '段落疑似重复', '本章开头有一段与其他章节完全相同的文字，可能是复制残留。', firstSentence.slice(0, 90))
  }
  return alerts.slice(0, 20)
}
