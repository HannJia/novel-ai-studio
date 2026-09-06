function cleanAiJsonText(text: string): string {
  return text
    .replace(/<(thinking|think|analysis|reasoning)>[\s\S]*?<\/\1>/gi, '')
    .replace(/```json\s*/gi, '')
    .replace(/```/g, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, '$1')
    .trim()
}

function extractBalancedJson(text: string, startChar: '{' | '[', endChar: '}' | ']'): string[] {
  const candidates: string[] = []
  for (let start = text.indexOf(startChar); start >= 0; start = text.indexOf(startChar, start + 1)) {
    let depth = 0
    let inString = false
    let escaped = false
    for (let index = start; index < text.length; index++) {
      const char = text[index]
      if (inString) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') inString = false
        continue
      }
      if (char === '"') { inString = true; continue }
      if (char === startChar) depth += 1
      else if (char === endChar) depth -= 1
      if (depth === 0) {
        candidates.push(text.slice(start, index + 1))
        break
      }
    }
  }
  return candidates.sort((a, b) => b.length - a.length)
}

export function parseAiJsonObject<T = unknown>(text: string): T | null {
  const cleaned = cleanAiJsonText(text)
  for (const json of extractBalancedJson(cleaned, '{', '}')) {
    try {
      return JSON.parse(json) as T
    } catch {
      // Try the next balanced object.
    }
  }
  return null
}

export function parseAiJsonArray<T = unknown>(text: string): T[] {
  const cleaned = cleanAiJsonText(text)
  for (const json of extractBalancedJson(cleaned, '[', ']')) {
    try {
      const parsed = JSON.parse(json)
      if (Array.isArray(parsed)) return parsed as T[]
    } catch {
      // Try the next balanced array.
    }
  }
  return []
}
