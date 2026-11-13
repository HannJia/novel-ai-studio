const MISSING = Symbol('missing')
const POLLUTION_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

type Missing = typeof MISSING
type MergeValue = unknown | Missing

/**
 * Merge a snapshot that was committed from `before` into the latest in-memory
 * value. The inputs are JSON-shaped values; undefined object properties are
 * treated as omitted, while undefined array entries have JSON's null value.
 */
export function mergeCommittedSnapshot<T>(before: T, committed: T, current: T): T {
  validateJsonShape(before)
  validateJsonShape(committed)
  validateJsonShape(current)

  const merged = mergeValue(normalizeJson(before), normalizeJson(committed), normalizeJson(current))
  return (merged === MISSING ? undefined : merged) as T
}

function validateJsonShape(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== 'object') return
  if (seen.has(value)) throw new Error('无法合并循环引用数据')
  seen.add(value)

  for (const key of Object.keys(value)) {
    if (POLLUTION_KEYS.has(key)) throw new Error(`拒绝不安全键：${key}`)
    validateJsonShape((value as Record<string, unknown>)[key], seen)
  }
  seen.delete(value)
}

function normalizeJson(value: unknown): unknown {
  if (value === undefined) return undefined
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(item => item === undefined ? null : normalizeJson(item))

  const result: Record<string, unknown> = {}
  for (const key of Object.keys(value)) {
    const child = (value as Record<string, unknown>)[key]
    if (child !== undefined) result[key] = normalizeJson(child)
  }
  return result
}

function mergeValue(before: MergeValue, committed: MergeValue, current: MergeValue): MergeValue {
  if (jsonEqual(before, committed)) return cloneJson(current)
  if (jsonEqual(before, current)) return cloneJson(committed)
  if (jsonEqual(committed, current)) return cloneJson(current)

  if (isRecord(before) && isRecord(committed) && isRecord(current)) {
    return mergeObject(before, committed, current)
  }
  if (Array.isArray(before) && Array.isArray(committed) && Array.isArray(current)) {
    return mergeArray(before, committed, current)
  }

  // A scalar conflict, or a type change conflict, keeps the author's value.
  return cloneJson(current)
}

function mergeObject(before: Record<string, unknown>, committed: Record<string, unknown>, current: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const keys = [...new Set([...Object.keys(current), ...Object.keys(committed), ...Object.keys(before)])]
  for (const key of keys) {
    const merged = mergeValue(
      ownValue(before, key),
      ownValue(committed, key),
      ownValue(current, key),
    )
    if (merged !== MISSING) result[key] = merged
  }
  return result
}

function mergeArray(before: unknown[], committed: unknown[], current: unknown[]): unknown[] {
  if (!isIdArray(before, committed, current)) return cloneJson(current) as unknown[]

  const beforeById = indexById(before)
  const committedById = indexById(committed)
  const currentById = indexById(current)
  const result: unknown[] = []

  // Current order is authoritative for rows visible in memory. This includes
  // rows authored concurrently and excludes rows the author deleted.
  for (const row of current) {
    const id = (row as { id: string }).id
    const merged = mergeValue(
      beforeById.get(id) ?? MISSING,
      committedById.get(id) ?? MISSING,
      row,
    )
    if (merged !== MISSING) result.push(merged)
  }

  // A transaction can add rows while the author is editing. Append only rows
  // that are absent from current, preserving committed's order for them.
  for (const row of committed) {
    const id = (row as { id: string }).id
    if (currentById.has(id)) continue
    const merged = mergeValue(
      beforeById.get(id) ?? MISSING,
      row,
      MISSING,
    )
    if (merged !== MISSING) result.push(merged)
  }

  return result
}

function isIdArray(...arrays: unknown[][]): boolean {
  const rows = arrays.flat()
  if (rows.length === 0) return false
  return arrays.every(array => {
    const ids = new Set<string>()
    return array.every(row => {
      if (!isRecord(row) || typeof row.id !== 'string' || ids.has(row.id)) return false
      ids.add(row.id)
      return true
    })
  })
}

function indexById(rows: unknown[]): Map<string, unknown> {
  return new Map(rows.map(row => [((row as { id: string }).id), row]))
}

function ownValue(record: Record<string, unknown>, key: string): MergeValue {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : MISSING
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function jsonEqual(left: MergeValue, right: MergeValue): boolean {
  if (left === MISSING || right === MISSING) return left === right
  if (left === right) return true
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => jsonEqual(item, right[index]))
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    return leftKeys.length === rightKeys.length
      && leftKeys.every(key => Object.prototype.hasOwnProperty.call(right, key) && jsonEqual(left[key], right[key]))
  }
  return false
}

function cloneJson(value: MergeValue): MergeValue {
  if (value === MISSING) return MISSING
  if (value === undefined || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    return value.map(item => {
      const cloned = cloneJson(item)
      return cloned === undefined ? null : cloned
    })
  }

  const result: Record<string, unknown> = {}
  for (const key of Object.keys(value)) result[key] = cloneJson((value as Record<string, unknown>)[key])
  return result
}
