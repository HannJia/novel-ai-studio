import { describe, expect, it } from 'vitest'
import { characterAvatars, inferAvatarEra, resolveCharacterAvatar } from './characterAvatars'

describe('内置水墨头像', () => {
  it('offers eighty distinct portraits on five valid 4×4 atlases', () => {
    expect(characterAvatars).toHaveLength(80)
    expect(new Set(characterAvatars.map(avatar => avatar.id)).size).toBe(80)
    expect(new Set(characterAvatars.map(avatar => `${avatar.src}:${avatar.col}:${avatar.row}`)).size).toBe(80)
    expect(new Set(characterAvatars.map(avatar => avatar.src)).size).toBe(5)
    for (const avatar of characterAvatars) {
      expect(Number.isInteger(avatar.col) && avatar.col >= 0 && avatar.col < 4).toBe(true)
      expect(Number.isInteger(avatar.row) && avatar.row >= 0 && avatar.row < 4).toBe(true)
    }
    for (const era of ['ancient', 'modern']) {
      expect(characterAvatars.filter(avatar => avatar.era === era && avatar.category === 'heroine').length).toBeGreaterThanOrEqual(16)
      expect(characterAvatars.filter(avatar => avatar.era === era && avatar.category === 'villain')).toHaveLength(8)
    }
  })

  it('matches identity without randomness and assigns every character a stable default', () => {
    const character = { id: 'stable-character', name: '沈砚', identity: '江湖医师' }
    const first = resolveCharacterAvatar(character)
    expect(first?.role).toBe('healer')
    expect(resolveCharacterAvatar({ ...character })).toEqual(first)
    expect(resolveCharacterAvatar({ ...character, identity: '女将军' })?.id).toBe('ink-warrior-f')
    expect(resolveCharacterAvatar({ ...character, identity: '年长的女导师' })?.id).toBe('ink-mentor-f')
    for (const identity of ['', '大学室友', '董事长', '普通居民', '未知职业']) {
      const first = resolveCharacterAvatar({ ...character, identity })
      expect(characterAvatars).toContain(first)
      expect(resolveCharacterAvatar({ ...character, identity })).toEqual(first)
      expect(first.category).not.toBe('villain')
    }
  })

  it('uses novel era, explicit roles and description pronouns', () => {
    const character = { id: 'char', name: '任意名字', identity: '主角' }
    expect(inferAvatarEra('都市 商战职场')).toBe('modern')
    expect(inferAvatarEra('古代修仙')).toBe('ancient')
    expect(resolveCharacterAvatar(character, { era: 'modern' }).era).toBe('modern')
    expect(resolveCharacterAvatar({ ...character, identity: '女主' }, { era: 'modern' }).category).toBe('heroine')
    expect(resolveCharacterAvatar({ ...character, identity: '反派女士' }, { era: 'modern' })).toMatchObject({ era: 'modern', category: 'villain', gender: 'female' })
    expect(resolveCharacterAvatar({ ...character, identity: '财务总监', description: '她曾在公司负责财务。' }, { era: 'modern' }).gender).toBe('female')
    expect(resolveCharacterAvatar({ ...character, identity: '女儿' }, { era: 'modern' }).category).toBe('heroine')
  })

  it('preserves the manual choice through identity/name changes and falls back on unknown IDs', () => {
    const character = { id: 'manual', name: '角色', identity: '书生', avatarId: 'ink-warrior-f' }
    expect(resolveCharacterAvatar(character)?.id).toBe(character.avatarId)
    expect(resolveCharacterAvatar({ ...character, name: '新名字', identity: '医师' })?.id).toBe(character.avatarId)
    expect(resolveCharacterAvatar(character, { era: 'modern' }).id).toBe(character.avatarId)
    expect(resolveCharacterAvatar({ ...character, avatarId: '' })?.role).toBe('scholar')
    expect(characterAvatars).toContain(resolveCharacterAvatar({ ...character, avatarId: 'invalid-id' }))
    expect(characterAvatars).toContain(resolveCharacterAvatar({ ...character, avatarId: '', identity: '' }))
  })
})
