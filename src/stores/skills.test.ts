// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useConfigStore } from './config'
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); setActivePinia(createPinia()) })
describe('editable built-in writing skills', () => {
  it('persists built-in edits and injects the updated rules after reload without changing identity', async () => {
    const store = useConfigStore()
    const skill = store.skills[0]
    store.updateSkill(skill.id, { name: '修改后的规则', instructions: '每段包含明确行动与结果', task: 'review' })
    await store.saveConfig()
    expect(store.getSkillPrompt('review')).toContain('每段包含明确行动与结果')
    setActivePinia(createPinia())
    const reopened = useConfigStore()
    await reopened.loadConfig()
    expect(reopened.skills.find(item => item.id === skill.id)).toMatchObject({ name: '修改后的规则', builtIn: true, task: 'review' })
    expect(reopened.skills.filter(item => item.id === skill.id)).toHaveLength(1)
  })
})
