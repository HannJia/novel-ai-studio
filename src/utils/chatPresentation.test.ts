import { describe, expect, it } from 'vitest'
import type { ChatSearchRecord } from '@/types/chat'
import { chatSourceExcerpt, chatSourceTitle, formatChatReply } from './chatPresentation'
import { renderMd } from './markdown'

const url = 'https://news.example.test/2026/article.shtml?utm_source=provider'
const record: ChatSearchRecord = {
  protocol: 'responses', status: 'searched', sources: [{ title: '城市历史资料 · 新闻网', url }],
}

describe('chat citation presentation', () => {
  it('displays page titles instead of Markdown URLs while retaining source data', () => {
    const content = `资料如下。([news.example.test](${url}))`
    const before = JSON.stringify(record)
    expect(formatChatReply(content, record)).toBe('资料如下。(城市历史资料 · 新闻网)')
    expect(content).toContain(url)
    expect(JSON.stringify(record)).toBe(before)
  })

  it('retains readable link names and replaces raw-URL labels, bare URLs and autolinks', () => {
    const text = `[新闻网页](${url})\n[${url}](${url})\n${url}。\n<${url}>`
    const formatted = formatChatReply(text, record)
    expect(formatted).toBe('新闻网页\n城市历史资料 · 新闻网\n城市历史资料 · 新闻网。\n城市历史资料 · 新闻网')
    expect(formatted).not.toMatch(/https?:\/\//)
  })

  it('matches escaped tracking parameters and preserves sentence punctuation', () => {
    expect(formatChatReply(`([新闻](${url.replace('utm_source', 'utm\\_source')}))`, record)).toBe('(新闻)')
    expect(formatChatReply(`详见（https://news.example.test/2026/article.shtml#section）。`, record))
      .toBe('详见（城市历史资料 · 新闻网）。')
  })

  it('handles nested/escaped parentheses in Markdown link destinations', () => {
    const nested = 'https://example.test/wiki/event_(part_(one))'
    const sources: ChatSearchRecord = { ...record, sources: [{ title: '事件背景', url: nested }] }
    expect(formatChatReply(`([${nested}](${nested}))`, sources)).toBe('(事件背景)')
    expect(formatChatReply(`[事件](${nested.replace(/\(/g, '\\(').replace(/\)/g, '\\)')})`, sources)).toBe('事件')
    expect(formatChatReply(`[事件](<${nested}> "资料标题")`, sources)).toBe('事件')
  })

  it('does not lose unrelated links, meaningful query parameters or ordinary chat text', () => {
    const unrelated = '[另一篇文章](https://news.example.test/2026/article.shtml?id=2)'
    expect(formatChatReply(unrelated, record)).toBe(unrelated)
    expect(formatChatReply(`作者资料 ${url}`)).toBe(`作者资料 ${url}`)
    expect(formatChatReply('写人物在雨中等待的场景', record)).toBe('写人物在雨中等待的场景')
    expect(formatChatReply('未闭合的 [资料](https://example.test/event', record))
      .toBe('未闭合的 [资料](https://example.test/event')
  })

  it('never exposes raw URLs in source labels or excerpts, including provider fallback titles', () => {
    expect(chatSourceTitle({ title: url, url }, 2)).toBe('网页来源 3')
    expect(chatSourceTitle({ title: `[${url}](${url})`, url })).toBe('网页来源 1')
    expect(chatSourceTitle({ title: `背景资料 ${url}`, url })).toBe('背景资料')
    expect(chatSourceTitle({ title: 'news.example.test', url })).toBe('网页来源 1')
    expect(chatSourceExcerpt(`资料在 ${url} 和 https://other.example.test/article。`, record))
      .toBe('资料在 城市历史资料 · 新闻网 和 相关网页。')
  })

  it('keeps untrusted titles and Markdown labels HTML-escaped', () => {
    const unsafe: ChatSearchRecord = { ...record, sources: [{ url, title: '<img src=x onerror=alert(1)>' }] }
    expect(renderMd(formatChatReply(url, unsafe))).not.toContain('<img')
    expect(renderMd(formatChatReply(`[<script>alert(1)</script>](${url})`, record))).not.toContain('<script')
  })
})
