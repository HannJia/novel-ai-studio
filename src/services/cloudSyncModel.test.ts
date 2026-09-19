import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useNovelStore } from '@/stores/novel'
import { createProjectBackup } from './projectBackup'
import { canonicalJson, decideSync, hashPayload, mergeCloudDocuments, normalizeSyncEndpoint, parseCloudDocument, projectDocuments } from './cloudSyncModel'
import { parseInspirationSession } from './inspirationSessions'

function book() {
  const store = useNovelStore()
  return store.addNovel({ genre: '', subGenre: '', tags: [], targetWordCountMin: 1, targetWordCountMax: 2,
    settings: store.defaultSettings(), writingStyle: store.defaultWritingStyle() })
}
beforeEach(() => setActivePinia(createPinia()))

describe('云同步文档与冲突判断', () => {
  it('merges conversations by session ID and caps the visible history at the latest five', () => {
    const sessions = Array.from({ length: 5 }, (_, index) => parseInspirationSession({ id: `idea-${index}`, title: `${index}`,
      updatedAt: `2026-09-1${index + 1}T00:00:00Z`, messages: [], draft: 'draft' }))
    const project = createProjectBackup([], [], [], sessions)
    const incoming = parseInspirationSession({ id: 'newest', title: '新会话', updatedAt: '2026-09-18T00:00:00Z', messages: [], draft: '继续聊' })
    const merged = mergeCloudDocuments(project, new Map([['inspiration:newest', canonicalJson({ kind: 'inspiration', inspiration: incoming })]]))
    expect(merged.inspirationSessions).toHaveLength(5)
    expect(merged.inspirationSessions![0].id).toBe('newest')
    expect(merged.inspirationSessions!.some(item => item.id === 'idea-0')).toBe(false)
    expect(project.inspirationSessions).toHaveLength(5)
    expect(() => parseCloudDocument('inspiration:newest', canonicalJson({ kind: 'inspiration', inspiration: { ...incoming, messages: 'invalid' } }))).toThrow()
  })
  it('requires HTTPS and an origin without embedded credentials', () => {
    expect(normalizeSyncEndpoint('https://154.94.227.164/')).toBe('https://154.94.227.164')
    for (const value of ['', '不是地址', 'http://example.org', 'https://user:pass@example.org', 'https://example.org/path', 'https://example.org/?key=secret']) {
      expect(() => normalizeSyncEndpoint(value)).toThrow()
    }
  })
  it('has stable serialization and hashes', async () => {
    expect(canonicalJson({ z: [2, 1], a: { y: 2, x: 1 } })).toBe(canonicalJson({ a: { x: 1, y: 2 }, z: [2, 1] }))
    expect(await hashPayload('hello')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
    expect(await hashPayload(null)).toBeNull()
  })
  it.each([
    ['a', undefined, undefined, 'push'],
    [null, { version: 1, hash: 'a' }, undefined, 'pull'],
    ['a', { version: 1, hash: 'a' }, undefined, 'same'],
    ['a', { version: 1, hash: 'b' }, undefined, 'conflict'],
    ['b', { version: 1, hash: 'a' }, { version: 1, hash: 'a' }, 'push'],
    ['a', { version: 2, hash: 'b' }, { version: 1, hash: 'a' }, 'pull'],
    ['b', { version: 2, hash: 'c' }, { version: 1, hash: 'a' }, 'conflict'],
    [null, { version: 2, hash: 'b' }, { version: 1, hash: 'a' }, 'conflict'],
    ['b', { version: 2, hash: null }, { version: 1, hash: 'a' }, 'conflict'],
    [null, { version: 1, hash: 'a' }, { version: 1, hash: 'a' }, 'push'],
    ['a', { version: 2, hash: null }, { version: 1, hash: 'a' }, 'pull'],
  ] as const)('decides %s %j %j as %s', (local, remote, base, expected) => {
    expect(decideSync(local, remote, base)).toBe(expected)
  })
  it('refuses server rollback or a vanished previously acknowledged document', () => {
    expect(() => decideSync('a', { version: 1, hash: 'a' }, { version: 2, hash: 'a' })).toThrow('云端版本低于')
    expect(() => decideSync('a', undefined, { version: 1, hash: 'a' })).toThrow()
  })
  it('exports only project data and preserves planning and knowledge summaries', () => {
    const novel = book()
    const library = { id: 'kb', name: '历史', description: '', createdAt: novel.createdAt, entries: [], summary: '时间线', summaryLevel: 'detailed' as const }
    novel.knowledgeBaseIds = ['kb']
    const docs = projectDocuments(createProjectBackup([novel], [library]))
    expect(docs.size).toBe(2)
    expect(parseCloudDocument(`novel:${novel.id}`, docs.get(`novel:${novel.id}`)!)).toMatchObject({ kind: 'novel', novel: { settings: novel.settings } })
    expect(parseCloudDocument('knowledge:kb', docs.get('knowledge:kb')!)).toMatchObject({ knowledge: { summary: '时间线' } })
    expect([...docs.keys()].some(key => /config|apiKey|embedding/.test(key))).toBe(false)
  })
  it('rejects corrupt or mismatched remote documents', () => {
    const novel = book()
    const docs = projectDocuments(createProjectBackup([novel], []))
    expect(() => parseCloudDocument('novel:wrong', docs.get(`novel:${novel.id}`)!)).toThrow()
    expect(() => parseCloudDocument(`novel:${novel.id}`, JSON.stringify({ kind: 'novel', novel: { id: novel.id }, chapterRevisions: [] }))).toThrow()
  })
  it('merges a remote book without changing unrelated books and preserves deletion semantics', () => {
    const a = book()
    const b = book()
    const project = createProjectBackup([a, b], [])
    const doc = JSON.parse(projectDocuments(project).get(`novel:${a.id}`)!)
    doc.novel.title = '云端标题'
    const merged = mergeCloudDocuments(project, new Map([[`novel:${a.id}`, canonicalJson(doc)]]))
    expect(merged.novels.find(item => item.id === a.id)?.title).toBe('云端标题')
    expect(merged.novels.find(item => item.id === b.id)).toEqual(project.novels[1])
    expect(project.novels[0].title).not.toBe('云端标题')
    expect(mergeCloudDocuments(project, new Map([[`novel:${a.id}`, null]])).novels).toEqual([project.novels[1]])
  })
})
