import type { SqlValue } from 'sql.js'
import { execute, getRowCacheEpoch } from '../database'

const statements = new Map<string, string>()
const rows = new Map<string, string>()
let cacheEpoch = -1
let cachedCharacters = 0
// Table/column names are internal literals, never backup or user input.
export function upsertRow(table: string, columnList: string, values: SqlValue[]): void {
  const epoch = getRowCacheEpoch()
  if (cacheEpoch !== epoch) { rows.clear(); cachedCharacters = 0; cacheEpoch = epoch }
  const rowKey = `${table}:${values[0]}`
  const signature = JSON.stringify(values)
  if (rows.get(rowKey) === signature) return
  const key = `${table}:${columnList}`
  let sql = statements.get(key)
  if (!sql) {
    const columns = columnList.split(',').map(column => column.trim())
    if (![table, ...columns].every(name => /^[a-z_]+$/.test(name)) || columns[0] !== 'id') throw new Error('无效的数据库列定义')
    const changed = columns.slice(1)
    sql = `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})
      ON CONFLICT(id) DO UPDATE SET ${changed.map(column => `${column}=excluded.${column}`).join(',')}
      WHERE ${changed.map(column => `${table}.${column} IS NOT excluded.${column}`).join(' OR ')}`
    statements.set(key, sql)
  }
  execute(sql, values)
  cachedCharacters -= rows.get(rowKey)?.length || 0
  rows.delete(rowKey)
  // Bound the optional cache; correctness still comes from SQL comparison.
  if (signature.length <= 2_000_000) {
    rows.set(rowKey, signature)
    cachedCharacters += signature.length
  }
  while (cachedCharacters > 16_000_000 || rows.size > 20_000) {
    const oldest = rows.keys().next().value as string
    cachedCharacters -= rows.get(oldest)!.length
    rows.delete(oldest)
  }
}
