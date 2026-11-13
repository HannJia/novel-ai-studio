function cleanAiJsonText(text: string): string {
  return text
    .replace(/<(thinking|think|analysis|reasoning)>[\s\S]*?<\/\1>/gi, '')
    .replace(/```json\s*/gi, '')
    .replace(/```/g, '')
    .trim()
}

/** Tolerate structural punctuation without rewriting dialogue inside JSON strings. */
function repairJsonPunctuation(text: string): string {
  let result = ''
  let delimiter: '"' | '”' | undefined
  let escaped = false
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (delimiter) {
      if (escaped) { result += char; escaped = false }
      else if (char === '\\') { result += char; escaped = true }
      else if (char === delimiter) { result += '"'; delimiter = undefined }
      else result += char
      continue
    }
    if (char === '"' || char === '“') {
      delimiter = char === '“' ? '”' : '"'
      result += '"'
    } else if (char === ',' && /^\s*[}\]]/.test(text.slice(index + 1))) {
      // Only remove a trailing comma outside a string.
    } else result += char
  }
  return result
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
  const cleaned = repairJsonPunctuation(cleanAiJsonText(text))
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
  const cleaned = repairJsonPunctuation(cleanAiJsonText(text))
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
