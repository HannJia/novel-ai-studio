export type WritingSkillTask = 'planning' | 'writing' | 'review' | 'analysis' | 'all'

export interface WritingSkill {
  id: string
  name: string
  description: string
  task: WritingSkillTask
  instructions: string
  enabled: boolean
  builtIn: boolean
  createdAt: string
  updatedAt: string
}
