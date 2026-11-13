import type { EntityDefinitionEdit } from './entityDefinitionEditing'
import type { Novel, Volume } from '@/types/novel'
import { parseVolumesFromText } from './volumeParsing'

export interface CreationOutlineImport {
  volumes: Volume[]
  definitions: EntityDefinitionEdit[]
}

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** Names and titles are compared as display text, with formatting whitespace ignored. */
function identityKey(value: string): string {
  return value
    .replace(/[\u200B\uFEFF]/g, '')
    .replace(/[\s\u00A0]+/g, '')
    .toLocaleLowerCase()
}

function cleanCell(value: string): string {
  return value.replace(/\*\*/g, '').replace(/\*/g, '').trim()
}

function sectionAfterHeading(text: string, heading: RegExp): string | undefined {
  const match = heading.exec(text)
  if (!match || match.index === undefined) return undefined
  const start = match.index + match[0].length
  const rest = text.slice(start)
  const next = rest.search(/^#{2,4}\s+/m)
  return rest.slice(0, next < 0 ? rest.length : next)
}

function parseForeshadowing(text: string, existing: Novel['eventLog'], definitions: EntityDefinitionEdit[]) {
  const section = sectionAfterHeading(text, /^#{2,4}\s*(?:全书)?伏笔(?:线|线索|设计|追踪|规划)?\s*[:：]?\s*$/m)
  if (!section) return

  const titles = new Set(existing
    .filter(event => event.chapterIndex === -1 && event.type === '伏笔')
    .map(event => identityKey(event.title)))

  for (const line of section.split(/\r?\n/)) {
    if (!line.trim().startsWith('-')) continue
    const cleaned = line.trim()
      .replace(/^-\s*/, '')
      .replace(/\*\*/g, '')
      .replace(/^伏笔\s*\d*[：:]?\s*/, '')
      .trim()
    if (!cleaned) continue

    const [rawName = '', ...rest] = cleaned.split(/\s*[—–-]\s*/)
    const title = rawName.replace(/[《》「」『』“”‘’"']/g, '').replace(/^\[|\]$/g, '').trim() || '未命名全书规划'
    const titleKey = identityKey(title)
    if (titles.has(titleKey)) continue
    titles.add(titleKey)
    definitions.push({ action: 'create', kind: 'event', data: {
      chapterIndex: -1,
      title,
      description: rest.join(' - ').trim() || cleaned,
      characters: [],
      type: '伏笔',
      scope: 'global',
      status: 'planted',
      hintCount: 0,
      importance: 4,
      source: 'user',
    } })
  }
}

function parseCharacters(text: string, existing: Novel['characters'], definitions: EntityDefinitionEdit[]) {
  const section = sectionAfterHeading(text, /^#{2,4}\s*主要角色表\s*[:：]?\s*$/m)
  if (!section) return

  const names = new Set(existing.map(character => identityKey(character.name)))
  for (const line of section.split(/\r?\n/).filter(item => item.trim().startsWith('|'))) {
    const trimmed = line.trim()
    if (/^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/.test(trimmed)) continue
    const columns = trimmed.replace(/^\||\|$/g, '').split('|').map(cleanCell)
    if (columns.length < 2 || /姓名|名字/.test(columns[0])) continue

    const [name, role = '', personality = '', background = ''] = columns
    if (!name || names.has(identityKey(name))) continue
    names.add(identityKey(name))
    definitions.push({ action: 'create', kind: 'character', data: {
      name,
      identity: role || '主要角色',
      personality,
      description: background,
      relationships: [],
      aliases: [],
      powerLevel: '',
      faction: '',
      status: '活跃',
      firstAppearChapter: 0,
      events: [],
      avatarColor: '',
    } })
  }
}

function mergeVolumePlanning(existing: Volume, parsed: Volume): Volume {
  const next = copy(existing)
  next.volumeIndex = parsed.volumeIndex
  next.title = parsed.title
  if (parsed.theme) next.theme = parsed.theme
  if (parsed.summary) next.summary = parsed.summary
  if (parsed.keyTurningPoints) next.keyTurningPoints = parsed.keyTurningPoints
  if (parsed.characterChanges) next.characterChanges = parsed.characterChanges
  if (parsed.estimatedChapters > 0) next.estimatedChapters = parsed.estimatedChapters
  if (parsed.estimatedWordCount > 0) next.estimatedWordCount = parsed.estimatedWordCount
  return next
}

function mergeParsedVolumes(novel: Novel, parsed: Volume[]): Volume[] {
  return parsed.map(volume => {
    const existing = novel.volumes.find(item => item.volumeIndex === volume.volumeIndex
      && identityKey(item.title) === identityKey(volume.title))
    return existing ? mergeVolumePlanning(existing, volume) : copy(volume)
  })
}

/**
 * Extracts the author-confirmed planning payload from an onboarding outline.
 * The novel is read only; persistence and all transaction effects belong to the caller.
 */
export function buildCreationOutlineImport(novel: Novel, outlineText: string): CreationOutlineImport {
  const parsedVolumes = parseVolumesFromText(outlineText)
  const definitions: EntityDefinitionEdit[] = []
  parseForeshadowing(outlineText, novel.eventLog, definitions)
  parseCharacters(outlineText, novel.characters, definitions)
  return { volumes: mergeParsedVolumes(novel, parsedVolumes), definitions }
}
