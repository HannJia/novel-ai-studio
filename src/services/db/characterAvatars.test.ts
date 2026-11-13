import { beforeAll, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useNovelStore } from '@/stores/novel'
import { loadAllNovelsFromDb } from './novels'

beforeAll(() => {
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'window', { configurable: true, value: Object.assign(new EventTarget(), { electronAPI: undefined }) })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } })
  setActivePinia(createPinia())
})

describe('角色头像持久化', () => {
  it('retains a manual ID through SQLite reload, identity updates and explicit edits, then restores automatic matching', async () => {
    const store = useNovelStore()
    await store.initStore()
    const book = store.addNovel({ genre: 'fantasy', subGenre: 'oriental', tags: [], targetWordCountMin: 10, targetWordCountMax: 20, writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() })
    const character = await store.addCharacter(book.id, { name: '合成角色', identity: '书生', avatarId: 'ink-warrior-f' })!
    await store.flushPendingSaves()
    expect((await loadAllNovelsFromDb()).find(n => n.id === book.id)?.characters[0].avatarId).toBe('ink-warrior-f')
    await store.updateCharacter(book.id, character.id, { identity: '江湖医师' })
    await expect(store.addCharacter(book.id, { name: character.name, description: '重复新增' })).rejects.toThrow()
    await store.updateCharacter(book.id, character.id, { description: '作者明确补充的合成资料' })
    await store.flushPendingSaves()
    const reloaded = (await loadAllNovelsFromDb()).find(n => n.id === book.id)!.characters[0]
    expect(reloaded.avatarId).toBe('ink-warrior-f')
    expect(reloaded.identity).toBe('江湖医师')
    await store.updateCharacter(book.id, character.id, { avatarId: undefined })
    await store.flushPendingSaves()
    expect((await loadAllNovelsFromDb()).find(n => n.id === book.id)?.characters[0].avatarId).toBeUndefined()
  })
})
