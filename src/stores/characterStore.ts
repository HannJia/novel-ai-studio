/**
 * 角色状态管理
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Character, CharacterProfile, CharacterState } from '@/types'
import * as characterApi from '@/services/api/characterApi'
import type { CreateCharacterInput, UpdateCharacterInput, CharacterStats } from '@/services/api/characterApi'

export const useCharacterStore = defineStore('character', () => {
  // 状态
  const characters = ref<Character[]>([])
  const currentCharacter = ref<Character | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const stats = ref<CharacterStats | null>(null)

  // 计算属性
  const protagonists = computed(() =>
    characters.value.filter(c => c.type === 'protagonist')
  )

  const supportingCharacters = computed(() =>
    characters.value.filter(c => c.type === 'supporting')
  )

  const antagonists = computed(() =>
    characters.value.filter(c => c.type === 'antagonist')
  )

  const otherCharacters = computed(() =>
    characters.value.filter(c => c.type === 'other')
  )

  const characterCount = computed(() => characters.value.length)

  // 获取书籍的所有角色
  async function fetchCharacters(bookId: string) {
    loading.value = true
    error.value = null
    try {
      characters.value = await characterApi.getCharactersByBook(bookId)
    } catch (e) {
      error.value = e instanceof Error ? e.message : '获取角色列表失败'
      throw e
    } finally {
      loading.value = false
    }
  }

  // 按类型获取角色
  async function fetchCharactersByType(bookId: string, type: string) {
    loading.value = true
    error.value = null
    try {
      return await characterApi.getCharactersByType(bookId, type)
    } catch (e) {
      error.value = e instanceof Error ? e.message : '获取角色列表失败'
      throw e
    } finally {
      loading.value = false
    }
  }

  // 获取角色详情
  async function fetchCharacter(id: string) {
    loading.value = true
    error.value = null
    try {
      currentCharacter.value = await characterApi.getCharacter(id)
      return currentCharacter.value
    } catch (e) {
      error.value = e instanceof Error ? e.message : '获取角色详情失败'
      throw e
    } finally {
      loading.value = false
    }
  }

  // 创建角色
  async function createCharacter(input: CreateCharacterInput) {
    loading.value = true
    error.value = null
    try {
      const character = await characterApi.createCharacter(input)
      characters.value.push(character)
      return character
    } catch (e) {
      error.value = e instanceof Error ? e.message : '创建角色失败'
      throw e
    } finally {
      loading.value = false
    }
  }

  // 更新角色
  async function updateCharacter(id: string, input: UpdateCharacterInput) {
    loading.value = true
    error.value = null
    try {
      const character = await characterApi.updateCharacter(id, input)
      const index = characters.value.findIndex(c => c.id === id)
      if (index !== -1) {
        characters.value[index] = character
      }
      if (currentCharacter.value?.id === id) {
        currentCharacter.value = character
      }
      return character
    } catch (e) {
      error.value = e instanceof Error ? e.message : '更新角色失败'
      throw e
    } finally {
      loading.value = false
    }
  }

  // 更新角色档案
  async function updateProfile(id: string, profile: Partial<CharacterProfile>) {
    loading.value = true
    error.value = null
    try {
      const character = await characterApi.updateCharacterProfile(id, profile)
      const index = characters.value.findIndex(c => c.id === id)
      if (index !== -1) {
        characters.value[index] = character
      }
      if (currentCharacter.value?.id === id) {
        currentCharacter.value = character
      }
      return character
    } catch (e) {
      error.value = e instanceof Error ? e.message : '更新角色档案失败'
      throw e
    } finally {
      loading.value = false
    }
  }

  // 更新角色状态
  async function updateState(id: string, state: Partial<CharacterState>) {
    loading.value = true
    error.value = null
    try {
      const character = await characterApi.updateCharacterState(id, state)
      const index = characters.value.findIndex(c => c.id === id)
      if (index !== -1) {
        characters.value[index] = character
      }
      if (currentCharacter.value?.id === id) {
        currentCharacter.value = character
      }
      return character
    } catch (e) {
      error.value = e instanceof Error ? e.message : '更新角色状态失败'
      throw e
    } finally {
      loading.value = false
    }
  }

  // 添加别名
  async function addAlias(id: string, alias: string) {
    loading.value = true
    error.value = null
    try {
      const character = await characterApi.addCharacterAlias(id, alias)
      const index = characters.value.findIndex(c => c.id === id)
      if (index !== -1) {
        characters.value[index] = character
      }
      if (currentCharacter.value?.id === id) {
        currentCharacter.value = character
      }
      return character
    } catch (e) {
      error.value = e instanceof Error ? e.message : '添加别名失败'
      throw e
    } finally {
      loading.value = false
    }
  }

  // 移除别名
  async function removeAlias(id: string, alias: string) {
    loading.value = true
    error.value = null
    try {
      const character = await characterApi.removeCharacterAlias(id, alias)
      const index = characters.value.findIndex(c => c.id === id)
      if (index !== -1) {
        characters.value[index] = character
      }
      if (currentCharacter.value?.id === id) {
        currentCharacter.value = character
      }
      return character
    } catch (e) {
      error.value = e instanceof Error ? e.message : '移除别名失败'
      throw e
    } finally {
      loading.value = false
    }
  }

  // 删除角色
  async function deleteCharacter(id: string) {
    loading.value = true
    error.value = null
    try {
      await characterApi.deleteCharacter(id)
      characters.value = characters.value.filter(c => c.id !== id)
      if (currentCharacter.value?.id === id) {
        currentCharacter.value = null
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : '删除角色失败'
      throw e
    } finally {
      loading.value = false
    }
  }

  // 搜索角色
  async function searchCharacters(bookId: string, keyword: string) {
    loading.value = true
    error.value = null
    try {
      return await characterApi.searchCharacters(bookId, keyword)
    } catch (e) {
      error.value = e instanceof Error ? e.message : '搜索角色失败'
      throw e
    } finally {
      loading.value = false
    }
  }

  // 获取角色统计
  async function fetchStats(bookId: string) {
    loading.value = true
    error.value = null
    try {
      stats.value = await characterApi.getCharacterStats(bookId)
      return stats.value
    } catch (e) {
      error.value = e instanceof Error ? e.message : '获取统计失败'
      throw e
    } finally {
      loading.value = false
    }
  }

  // 设置当前角色
  function setCurrentCharacter(character: Character | null) {
    currentCharacter.value = character
  }

  // 根据ID获取角色（从本地缓存）
  function getCharacterById(id: string): Character | undefined {
    return characters.value.find(c => c.id === id)
  }

  // 根据名字或别名获取角色
  function getCharacterByName(bookId: string, name: string): Character | undefined {
    return characters.value.find(c =>
      c.bookId === bookId &&
      (c.name === name || c.aliases?.includes(name))
    )
  }

  // 清空状态
  function clearState() {
    characters.value = []
    currentCharacter.value = null
    stats.value = null
    error.value = null
  }

  return {
    // 状态
    characters,
    currentCharacter,
    loading,
    error,
    stats,
    // 计算属性
    protagonists,
    supportingCharacters,
    antagonists,
    otherCharacters,
    characterCount,
    // 方法
    fetchCharacters,
    fetchCharactersByType,
    fetchCharacter,
    createCharacter,
    updateCharacter,
    updateProfile,
    updateState,
    addAlias,
    removeAlias,
    deleteCharacter,
    searchCharacters,
    fetchStats,
    setCurrentCharacter,
    getCharacterById,
    getCharacterByName,
    clearState
  }
})
