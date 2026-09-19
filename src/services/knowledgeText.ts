export function splitKnowledgeText(text: string): Array<{ title: string; content: string }> {
  const sections = text.replace(/\r\n?/g, '\n').split(/^(?=##\s)|^---[ \t]*$/gm).filter(section => section.trim())
  return sections.flatMap(section => {
    const lines = section.trim().split('\n')
    const title = lines[0].replace(/^#+\s*/, '').trim().slice(0, 180)
    const content = (/^#+\s/.test(lines[0]) ? lines.slice(1).join('\n') : section).trim()
    return content ? [{ title: title || '导入资料', content }] : []
  })
}
