// 导出服务 — TXT、Word 兼容 HTML (.doc)、EPUB
import type { Novel } from '@/types/novel'
import { escapeHtml, renderMd } from '@/utils/markdown'
import { formatChatReply, chatSourceTitle } from '@/utils/chatPresentation'
import { safeSourceUrl } from '@/services/chatSearch'

// Export only the creative discussion archive, never assistant chat, credentials,
// manuscript or current settings that could be mistaken for the original proposal.
export function exportInspirationArchive(novel: Novel, format: 'markdown' | 'json'): void {
  const messages = novel.inspirationHistory || []
  const filename = (novel.title || '未命名小说').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 100)
  if (format === 'json') {
    downloadFile(`${filename}-灵感记录.json`, JSON.stringify({
      format: 'ai-novel-writer-inspiration', version: 1, exportedAt: new Date().toISOString(),
      novelId: novel.id, title: novel.title, messages,
    }, null, 2), 'application/json;charset=utf-8')
    return
  }
  const lines = [`# 《${novel.title}》灵感记录`, '',
    '> 创建前的讨论存档，可能含备选或已否定方案。正式创作以已确认设定和大纲为准。', '']
  for (const [index, message] of messages.entries()) {
    lines.push(`## ${index + 1}. ${message.role === 'user' ? '我' : 'AI'}`, '',
      message.role === 'assistant' ? formatChatReply(message.content, message.search) : message.content, '')
    if (message.search) {
      lines.push(`搜索记录：${message.search.status === 'searched' ? '接口返回已搜索' : message.search.status === 'not-used' ? '本轮未搜索' : '未收到可验证的搜索证据'}`, '')
      for (const [sourceIndex, source] of message.search.sources.entries()) {
        const url = safeSourceUrl(source.url)
        const title = chatSourceTitle(source, sourceIndex).replace(/[\r\n]/g, ' ').replace(/([\\[\]])/g, '\\$1')
        if (url) lines.push(`- [${title}](<${url.replace(/</g, '%3C').replace(/>/g, '%3E')}>)`)
      }
      lines.push('')
    }
  }
  downloadFile(`${filename}-灵感记录.md`, lines.join('\n'), 'text/markdown;charset=utf-8')
}

// 导出为 TXT 文本
export function exportToTXT(novel: Novel, options: { bodyOnly?: boolean } = {}): void {
  const lines: string[] = []
  
  // 标题和基本信息
  lines.push(`《${novel.title}》`)
  if (!options.bodyOnly) {
    lines.push(`类型：${novel.genreLabel} · ${novel.subGenreLabel}`)
    lines.push(`标签：${novel.tags.join('、') || '无'}`)
  }
  lines.push('')
  lines.push('═'.repeat(40))
  lines.push('')

  // 简介
  if (novel.synopsis && !options.bodyOnly) {
    lines.push('【内容简介】')
    lines.push(novel.synopsis)
    lines.push('')
  }

  // 大纲
  if (novel.outline && !options.bodyOnly) {
    lines.push('【总大纲】')
    lines.push(novel.outline)
    lines.push('')
    lines.push('═'.repeat(40))
    lines.push('')
  }

  // 章节正文
  for (const chapter of novel.chapters) {
    lines.push(`第${chapter.chapterIndex + 1}章 ${chapter.title}`)
    lines.push('')
    lines.push(chapter.content || '（暂无内容）')
    lines.push('')
    lines.push('-'.repeat(30))
    lines.push('')
  }

  // 统计信息
  if (!options.bodyOnly) {
    lines.push('')
    lines.push(`——全书${novel.chapters.length}章，共${novel.currentWordCount.toLocaleString()}字——`)
  }

  const text = lines.join('\n')
  downloadFile(`${novel.title}.txt`, text, 'text/plain;charset=utf-8')
}

// Word-compatible HTML, deliberately labelled .doc (not a DOCX archive).
export function exportToWordHtml(novel: Novel, options: { bodyOnly?: boolean } = {}): void {
  const html: string[] = []
  
  html.push(`<!DOCTYPE html><html><head><meta charset="utf-8">`)
  html.push(`<style>
    body { font-family: '宋体', SimSun, serif; font-size: 14pt; line-height: 2; max-width: 800px; margin: 0 auto; padding: 40px; }
    h1 { text-align: center; font-size: 22pt; margin-bottom: 20px; }
    h2 { font-size: 16pt; margin-top: 30px; border-bottom: 1px solid #ccc; padding-bottom: 6px; }
    h3 { font-size: 14pt; margin-top: 20px; }
    .meta { text-align: center; color: #666; font-size: 11pt; margin-bottom: 30px; }
    .chapter-title { font-size: 16pt; font-weight: bold; margin-top: 40px; margin-bottom: 10px; page-break-before: always; }
    .chapter-title:first-of-type { page-break-before: auto; }
    .content { text-indent: 2em; }
    .separator { text-align: center; color: #ccc; margin: 20px 0; }
    .stats { text-align: center; color: #999; margin-top: 40px; font-size: 11pt; }
  </style></head><body>`)

  // 标题
  html.push(`<h1>《${escapeHtml(novel.title)}》</h1>`)
  if (!options.bodyOnly) html.push(`<div class="meta">${escapeHtml(novel.genreLabel)} · ${escapeHtml(novel.subGenreLabel)}</div>`)

  // 简介
  if (novel.synopsis && !options.bodyOnly) {
    html.push(`<h2>内容简介</h2>`)
    html.push(`<p>${escapeHtml(novel.synopsis)}</p>`)
  }

  // 大纲
  if (novel.outline && !options.bodyOnly) {
    html.push(`<h2>总大纲</h2>`)
    html.push(renderMd(novel.outline))
  }

  // 正文
  for (const chapter of novel.chapters) {
    html.push(`<div class="chapter-title">第${chapter.chapterIndex + 1}章 ${escapeHtml(chapter.title)}</div>`)
    const paragraphs = (chapter.content || '暂无内容').split('\n').filter(l => l.trim())
    for (const p of paragraphs) {
      html.push(`<p class="content">${escapeHtml(p)}</p>`)
    }
  }

  // 统计
  if (!options.bodyOnly) html.push(`<div class="stats">——全书${novel.chapters.length}章，共${novel.currentWordCount.toLocaleString()}字——</div>`)
  html.push(`</body></html>`)

  const content = html.join('\n')
  // 使用 Word 兼容的 MIME 类型
  downloadFile(`${novel.title}.doc`, content, 'application/msword')
}

// 通用下载函数
function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function downloadFile(filename: string, content: string, mimeType: string): void {
  downloadBlob(filename, new Blob(['﻿' + content], { type: mimeType }))
}

// 导出为 EPUB（纯前端，使用 JSZip）
export async function exportToEpub(novel: Novel): Promise<void> {
  // 动态加载 JSZip
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()

  // 1. mimetype（不压缩）
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })

  // 2. META-INF/container.xml
  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`)

  // 3. 生成章节 XHTML
  const chapterFiles: string[] = []
  for (const ch of novel.chapters) {
    const filename = `chapter_${ch.chapterIndex + 1}.xhtml`
    chapterFiles.push(filename)
    const paragraphs = (ch.content || '暂无内容')
      .split('\n')
      .filter(l => l.trim())
      .map(p => `    <p>${escapeXml(p)}</p>`)
      .join('\n')

    zip.file(`OEBPS/${filename}`, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN">
<head>
  <meta charset="UTF-8"/>
  <title>第${ch.chapterIndex + 1}章 ${escapeXml(ch.title)}</title>
  <style>
    body { font-family: serif; font-size: 1em; line-height: 2; padding: 1em; }
    h1 { font-size: 1.4em; text-align: center; margin: 1em 0; }
    p { text-indent: 2em; margin: 0.5em 0; }
  </style>
</head>
<body>
  <h1>第${ch.chapterIndex + 1}章 ${escapeXml(ch.title)}</h1>
${paragraphs}
</body>
</html>`)
  }

  // 4. content.opf
  const manifestItems = chapterFiles.map((f, i) =>
    `    <item id="ch${i + 1}" href="${f}" media-type="application/xhtml+xml"/>`
  ).join('\n')
  const spineItems = chapterFiles.map((_, i) =>
    `    <itemref idref="ch${i + 1}"/>`
  ).join('\n')

  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="BookId">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="BookId">urn:uuid:${crypto.randomUUID()}</dc:identifier>
    <dc:title>${escapeXml(novel.title)}</dc:title>
    <dc:language>zh-CN</dc:language>
    <dc:creator>AI 小说写作</dc:creator>
    <meta property="dcterms:modified">${new Date().toISOString().split('.')[0]}Z</meta>
  </metadata>
  <manifest>
    <item id="toc" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${manifestItems}
  </manifest>
  <spine>
${spineItems}
  </spine>
</package>`)

  // 5. 目录页（EPUB 3 nav）
  const tocItems = novel.chapters.map((ch) =>
    `      <li><a href="chapter_${ch.chapterIndex + 1}.xhtml">第${ch.chapterIndex + 1}章 ${escapeXml(ch.title)}</a></li>`
  ).join('\n')

  zip.file('OEBPS/toc.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-CN">
<head>
  <meta charset="UTF-8"/>
  <title>目录</title>
</head>
<body>
  <nav epub:type="toc">
    <h1>目录</h1>
    <ol>
${tocItems}
    </ol>
  </nav>
</body>
</html>`)

  // 生成并下载
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' })
  downloadBlob(`${novel.title}.epub`, blob)
}

// XML 转义
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
