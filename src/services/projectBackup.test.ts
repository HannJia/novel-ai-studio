import { describe, expect, it } from 'vitest'
import { createProjectBackup, parseProjectBackup } from './projectBackup'
import { createPinia, setActivePinia } from 'pinia'
import { useNovelStore } from '@/stores/novel'

function validBook() {
  setActivePinia(createPinia())
  const store = useNovelStore()
  return store.addNovel({ genre: '', subGenre: '', tags: [], targetWordCountMin: 1, targetWordCountMax: 2,
    settings: store.defaultSettings(), writingStyle: store.defaultWritingStyle() })
}

describe('项目备份格式', () => {
  it('preserves separate inspiration archives and validates their nested fields', () => {
    const book = validBook()
    book.inspirationHistory = [{ id: 'idea', role: 'assistant', content: '存档内容', timestamp: book.createdAt,
      search: { protocol: 'responses', status: 'searched', sources: [{ title: '来源', url: 'https://example.org' }] } }]
    const backup = createProjectBackup([book], [])
    const parsed = parseProjectBackup(JSON.stringify(backup))
    expect(parsed.novels[0].inspirationHistory).toEqual(book.inspirationHistory)
    expect(parsed.novels[0].chatHistory).toHaveLength(0)
    parsed.novels[0].inspirationHistory![0].search!.sources = '错误类型' as any
    expect(() => parseProjectBackup(JSON.stringify(parsed))).toThrow('inspirationHistory')
    backup.novels[0].inspirationHistory!.push({ ...book.inspirationHistory[0] })
    expect(() => parseProjectBackup(JSON.stringify(backup))).toThrow('重复 ID')
  })

  it('可以深拷贝项目数据并成功解析', () => {
    const novels = [{ ...validBook(), id: 'novel-1', title: '测试书' }]
    const knowledgeBases = [{ id: 'kb-1', entries: [], name: '设定库', description: '', createdAt: new Date().toISOString() }]
    const backup = createProjectBackup(novels, knowledgeBases)
    const parsed = parseProjectBackup(JSON.stringify(backup))
    expect(parsed.format).toBe('ai-novel-writer-backup')
    expect(parsed.novels[0].id).toBe('novel-1')
    expect(parsed.knowledgeBases[0].id).toBe('kb-1')
    novels[0].title = '修改后'
    expect(parsed.novels[0].title).toBe('测试书')
  })

  it('拒绝格式或必需数组不正确的文件', () => {
    expect(() => parseProjectBackup('{}')).toThrow('不是有效的 AI Novel Writer 备份文件')
    expect(() => parseProjectBackup(JSON.stringify({ format: 'ai-novel-writer-backup', version: 1, novels: [{ id: 'x' }], knowledgeBases: [] }))).toThrow('备份数据不完整')
  })

  it('rejects nested corruption, duplicate IDs, dangling knowledge references and prototype keys', () => {
    const original = createProjectBackup([validBook()], [])
    const malformed = JSON.parse(JSON.stringify(original))
    malformed.novels[0].settings.protagonist.personality = '不是数组'
    expect(() => parseProjectBackup(JSON.stringify(malformed))).toThrow('personality')
    expect(() => parseProjectBackup(JSON.stringify({ ...original, novels: [original.novels[0], original.novels[0]] }))).toThrow('重复 ID')
    original.novels[0].knowledgeBaseIds = ['missing-kb']
    expect(() => parseProjectBackup(JSON.stringify(original))).toThrow('引用不存在')
    expect(() => parseProjectBackup('{"format":"ai-novel-writer-backup","version":1,"novels":[],"knowledgeBases":[],"__proto__":{}}')).toThrow('__proto__')
  })
})
