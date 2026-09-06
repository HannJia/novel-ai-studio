import { execute, initDb, runTransaction } from '@/services/database'

type PersistedTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export async function createAiTaskRecord(name: string, groupName = ''): Promise<string> {
  await initDb()
  const id = Date.now().toString(36) + Math.random().toString(36).substring(2, 8)
  const now = new Date().toISOString()
  await runTransaction(() => {
    execute(`
      INSERT INTO ai_tasks (id, name, group_name, status, error, created_at, updated_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, name, groupName, 'pending', '', now, now, ''])
  })
  return id
}

export async function updateAiTaskRecord(
  id: string,
  status: PersistedTaskStatus,
  error = '',
): Promise<void> {
  await initDb()
  const now = new Date().toISOString()
  await runTransaction(() => {
    execute(`
      UPDATE ai_tasks
      SET status = ?, error = ?, updated_at = ?, completed_at = ?
      WHERE id = ?
    `, [status, error, now, ['completed', 'failed', 'cancelled'].includes(status) ? now : '', id])
  })
}

export async function markInterruptedTasksFailed(): Promise<void> {
  await initDb()
  await runTransaction(() => {
    const now = new Date().toISOString()
    execute(`
      UPDATE ai_tasks
      SET status = 'failed', error = '应用关闭或刷新后任务中断', updated_at = ?, completed_at = ?
      WHERE status IN ('pending', 'running')
    `, [now, now])
  })
}
