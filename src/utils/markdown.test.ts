import { describe, expect, it } from 'vitest'
import { escapeHtml, renderMd } from './markdown'

describe('markdown 工具', () => {
  it('转义 HTML 标签和属性字符', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;')
  })

  it('渲染 Markdown 前先转义 HTML', () => {
    const html = renderMd('## 标题\n<script>alert("x")</script>')
    expect(html).toContain('<h3>标题</h3>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })
})
