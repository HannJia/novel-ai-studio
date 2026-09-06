import { DatabaseRecoveryError, recoverDatabase } from './database'

export function showRecoveryScreen(error: unknown) {
  const root = document.getElementById('app')
  if (!root) return
  const panel = document.createElement('section')
  panel.style.cssText = 'padding:40px;max-width:760px;margin:auto;line-height:1.8;overflow:auto;max-height:100vh;box-sizing:border-box'
  const title = document.createElement('h2')
  title.textContent = '数据加载失败 · 已停止写入'
  const detail = document.createElement('p')
  detail.textContent = error instanceof Error ? error.message : '未知错误'
  const help = document.createElement('p')
  help.textContent = '请勿删除数据目录。可以先重试；恢复前会保留原库和备份的独立副本。若数据重要且没有有效备份，请保留文件寻求修复，不要直接新建空库。'
  const status = document.createElement('p')
  status.setAttribute('role', 'alert')
  const actions = document.createElement('div')
  actions.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap'
  const button = (label: string, action: () => void) => {
    const node = document.createElement('button')
    node.textContent = label
    node.style.cssText = 'padding:8px 14px;cursor:pointer'
    node.onclick = action
    actions.appendChild(node)
  }
  button('重新加载', () => location.reload())
  async function recover(mode: 'backup' | 'empty') {
    if (!window.confirm(mode === 'backup'
      ? '确认使用通过完整性检查的备份恢复？恢复前将另存原库和备份副本。备份时间之后的修改可能需要另行找回。'
      : '确认新建空数据库？原库和备份会另存为恢复副本，但不会自动迁移其中书稿。')) return
    actions.querySelectorAll('button').forEach(node => { node.disabled = true })
    try {
      await recoverDatabase(mode)
      location.reload()
    } catch (failure) {
      status.textContent = failure instanceof Error ? failure.message : '恢复失败，原文件保留'
      actions.querySelectorAll('button').forEach(node => { node.disabled = false })
    }
  }
  if (error instanceof DatabaseRecoveryError) {
    if (error.backupAvailable) button('从有效备份恢复', () => { void recover('backup') })
    button('保留原文件并新建空库', () => { void recover('empty') })
  }
  panel.append(title, detail, help, actions, status)
  root.replaceChildren(panel)
}
