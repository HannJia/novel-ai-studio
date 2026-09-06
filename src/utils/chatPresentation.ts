import type { ChatSearchRecord, ChatSource } from '@/types/chat'

type LinkLabel = (url: string, label?: string) => string | undefined

function unescapeUrl(value: string): string {
  return value.replace(/\\([\\()[\]<>_*])/g, '$1').replace(/&amp;/g, '&')
}

function sourceKey(value: string): string | undefined {
  try {
    const url = new URL(unescapeUrl(value))
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return
    url.hash = ''
    // Tracking parameters are not part of an article's identity. Keep meaningful
    // query parameters so different articles on the same site never get merged.
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_|^(gclid|fbclid)$/i.test(key)) url.searchParams.delete(key)
    }
    return url.href
  } catch { return }
}

/** Rewrite link labels as plain text. Rendering/escaping remains renderMd's job. */
function rewriteWebLinks(text: string, labelFor: LinkLabel): string {
  // Walk balanced Markdown destinations, including escaped/nested parentheses.
  const start = /!?\[([^\]\n]*)\]\(\s*(?=https?:\/\/|<https?:\/\/)/gi
  let result = ''
  let copiedUntil = 0
  let match: RegExpExecArray | null
  while ((match = start.exec(text))) {
    let depth = 1
    let end = start.lastIndex
    for (; end < Math.min(text.length, start.lastIndex + 4096); end++) {
      if (text[end] === '\\') { end++; continue }
      if (text[end] === '(') depth++
      if (text[end] === ')' && --depth === 0) break
    }
    if (depth !== 0) continue
    const destination = text.slice(start.lastIndex, end).trim()
    const url = destination.startsWith('<')
      ? destination.slice(1, destination.indexOf('>'))
      : destination.replace(/\s+["'][\s\S]*["']$/, '')
    const label = labelFor(url, match[1])
    result += text.slice(copiedUntil, match.index) + (label ?? text.slice(match.index, end + 1))
    copiedUntil = end + 1
    start.lastIndex = copiedUntil
  }
  result += text.slice(copiedUntil)
  result = result.replace(/<(https?:\/\/[^<>\s]+)>/gi, (original, url: string) => labelFor(url) ?? original)
  return result.replace(/https?:\/\/[^\s<>"'`[\]，。；！？、【】（）]+/gi, original => {
    let url = original.replace(/[.,;:!?]+$/, '')
    // Exclude sentence-closing parentheses, retaining balanced URL parentheses.
    while (url.endsWith(')') && (url.match(/\)/g)?.length || 0) > (url.match(/\(/g)?.length || 0)) url = url.slice(0, -1)
    return (labelFor(url) ?? url) + original.slice(url.length)
  })
}

function readableLabel(value: string): string {
  const text = rewriteWebLinks(value, (_url, label) => label && !/https?:\/\//i.test(label) ? label : '')
    .replace(/\s+/g, ' ').trim()
  // A hostname supplied in place of an article title isn't a page name.
  return /^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?$/i.test(text) ? '' : text
}

/** No raw URL in source headings, even when the provider uses one as its title. */
export function chatSourceTitle(source: ChatSource, index = 0): string {
  return readableLabel(source.title) || `网页来源 ${index + 1}`
}

function sourceLookup(record: ChatSearchRecord): Map<string, string> {
  const titles = new Map<string, string>()
  record.sources.forEach((source, index) => {
    const key = sourceKey(source.url)
    if (key && !titles.has(key)) titles.set(key, chatSourceTitle(source, index))
  })
  return titles
}

/**
 * Display-only cleanup of references already available in the source drawer.
 * Never mutate stored messages or hide unrelated/user-provided URLs.
 */
export function formatChatReply(content: string, record?: ChatSearchRecord): string {
  if (!record?.sources.length) return content
  const titles = sourceLookup(record)
  return rewriteWebLinks(content, (url, label) => {
    const key = sourceKey(url)
    const title = key ? titles.get(key) : undefined
    return title ? (label && readableLabel(label)) || title : undefined
  })
}

export function chatSourceExcerpt(excerpt: string, record: ChatSearchRecord): string {
  const titles = sourceLookup(record)
  return rewriteWebLinks(excerpt, (url, label) =>
    (label && readableLabel(label)) || titles.get(sourceKey(url) || '') || '相关网页')
}
