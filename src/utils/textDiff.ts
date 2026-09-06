export interface TextDiffResult {
  diff: string
  addedLines: number
  removedLines: number
}

function commonPrefixLength(before: string[], after: string[]): number {
  let index = 0
  while (index < before.length && index < after.length && before[index] === after[index]) index++
  return index
}

function commonSuffixLength(before: string[], after: string[], prefix: number): number {
  let count = 0
  while (
    count < before.length - prefix &&
    count < after.length - prefix &&
    before[before.length - 1 - count] === after[after.length - 1 - count]
  ) count++
  return count
}

/**
 * Produces a compact, review-friendly line diff without pulling a large diff
 * runtime into the desktop bundle. The unchanged prefix and suffix are kept
 * as context; the changed middle is represented by removed/added lines.
 */
export function createTextDiff(beforeText: string, afterText: string): TextDiffResult {
  const beforeNormalized = beforeText.replace(/\r\n/g, '\n')
  const afterNormalized = afterText.replace(/\r\n/g, '\n')
  const before = beforeNormalized ? beforeNormalized.split('\n') : []
  const after = afterNormalized ? afterNormalized.split('\n') : []
  const prefix = commonPrefixLength(before, after)
  const suffix = commonSuffixLength(before, after, prefix)
  const beforeEnd = before.length - suffix
  const afterEnd = after.length - suffix
  const contextStart = Math.max(0, prefix - 2)
  const contextBefore = before.slice(contextStart, prefix).map(line => ` ${line}`)
  const removed = before.slice(prefix, beforeEnd).map(line => `-${line}`)
  const added = after.slice(prefix, afterEnd).map(line => `+${line}`)
  const contextAfter = before.slice(beforeEnd, beforeEnd + 2).map(line => ` ${line}`)

  const header = `@@ -${prefix + 1},${Math.max(0, beforeEnd - prefix)} +${prefix + 1},${Math.max(0, afterEnd - prefix)} @@`
  return {
    diff: [header, ...contextBefore, ...removed, ...added, ...contextAfter].join('\n'),
    addedLines: added.length,
    removedLines: removed.length,
  }
}
