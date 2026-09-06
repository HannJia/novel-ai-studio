// HTML 转义（防 XSS）
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// 简易 Markdown → HTML 渲染（覆盖项目中所有使用场景）
export function renderMd(text: string): string {
  let t = escapeHtml(text)
  t = t.replace(/^#### (.+)$/gm, '<h5>$1</h5>')
  t = t.replace(/^### (.+)$/gm, '<h4>$1</h4>')
  t = t.replace(/^## (.+)$/gm, '<h3>$1</h3>')
  t = t.replace(/^# (.+)$/gm, '<h2>$1</h2>')
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  t = t.replace(/\*(.+?)\*/g, '<em>$1</em>')
  t = t.replace(/^- (.+)$/gm, '<li>$1</li>')
  t = t.replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
  t = t.replace(/\|/g, ' │ ')
  t = t.replace(/\n\n/g, '</p><p>')
  t = t.replace(/\n/g, '<br>')
  return `<p>${t}</p>`
}
