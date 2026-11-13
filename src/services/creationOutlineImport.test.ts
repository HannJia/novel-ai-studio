import { describe, expect, it } from 'vitest'
import type { Novel } from '@/types/novel'
import { buildCreationOutlineImport } from './creationOutlineImport'

const now = '2026-10-31T00:00:00.000Z'

function makeNovel(overrides: Partial<Novel> = {}): Novel {
  return {
    id: 'novel-1', title: '测试作品', genre: 'fantasy', subGenre: 'urban-fantasy', genreLabel: '玄幻', subGenreLabel: '都市幻想',
    tags: [], targetWordCountMin: 80, targetWordCountMax: 120, currentWordCount: 0,
    writingStyle: { narrativePov: '', toneStyle: '', descriptionDensity: '', dialogueStyle: '', combatStyle: '', pacingControl: '', emotionExpression: '' },
    settings: {
      protagonist: { name: '', gender: '', age: '', background: '', personality: [], initialPower: '', cheatDescription: '', romanceTendency: '' },
      supportingCharacters: [], worldBuilding: { worldType: '', worldScale: '', socialStructure: '', techLevel: '', specialRules: '' },
      powerSystem: { systemName: '', levelHierarchy: '', combatStyleDesc: '', auxiliarySystems: '' },
      coreConflict: { mainConflict: '', mainVillain: '', factionConflicts: '', coreSuspense: '' },
      romance: { romanceType: '', developmentPace: '', toneChanges: '', emotionalConflict: '' },
      payoff: { faceSlapFrequency: '', levelUpPace: '', patterns: [] }, structure: { foreshadowingDensity: '' }, otherSettings: '',
    },
    outline: '', synopsis: '', volumes: [], chapters: [], characters: [], chatHistory: [], knowledgeBaseIds: [], eventLog: [],
    dataPanels: [], dataPanelChanges: [], status: 'creating', createdAt: now, updatedAt: now, ...overrides,
  }
}

describe('buildCreationOutlineImport', () => {
  it('deduplicates character names and foreshadowing titles across whitespace and case', () => {
    const novel = makeNovel({
      characters: [{ id: 'character-1', name: '林 澈', aliases: [], identity: '作者设定', personality: '', powerLevel: '', faction: '', status: '活跃', firstAppearChapter: 0, description: '保留', relationships: [], events: [], avatarColor: '' }],
      eventLog: [{ id: 'event-1', chapterIndex: -1, title: '暗 门', description: '作者事件', characters: [], type: '伏笔', timestamp: now }],
    })
    const result = buildCreationOutlineImport(novel, `## 第一卷：启程\n\n## 主要角色表\n| 姓名 | 身份 | 性格 | 背景 |\n| --- | --- | --- | --- |\n| 林澈 | 新身份 | 冷静 | 新背景 |\n| Rin | 侦察者 | 谨慎 | 城外人 |\n| rin | 重复行 | 重复 | 重复 |\n\n## 全书伏笔线\n- 伏笔1：暗门 — 新描述\n- 伏笔2：新线索 — 埋设在开篇`)

    expect(result.definitions.filter(item => item.kind === 'character')).toHaveLength(1)
    expect(result.definitions.filter(item => item.kind === 'event')).toHaveLength(1)
    expect(result.definitions).toContainEqual(expect.objectContaining({ kind: 'character', data: expect.objectContaining({ name: 'Rin' }) }))
    expect(result.definitions).toContainEqual(expect.objectContaining({ kind: 'event', data: expect.objectContaining({ title: '新线索' }) }))
  })

  it('reuses a matching volume id on repeated acceptance and preserves author fields', () => {
    const existing = {
      id: 'volume-author', volumeIndex: 0, title: '第一卷：启程', theme: '旧主题', summary: '作者摘要',
      keyTurningPoints: '作者转折', characterChanges: '作者变化', estimatedChapters: 12, estimatedWordCount: 3,
      versions: [{ id: 'version-1', label: '作者版本', savedAt: now, snapshot: '{}' }],
    }
    const novel = makeNovel({ volumes: [existing] })
    const outline = '## 第一卷：启程\n主题：新主题\n预估章节数：20\n预估字数：5万字'
    const first = buildCreationOutlineImport(novel, outline)
    const second = buildCreationOutlineImport({ ...novel, volumes: first.volumes }, outline)

    expect(first.volumes[0]).toMatchObject({ id: 'volume-author', theme: '新主题', summary: '主题：新主题', keyTurningPoints: '作者转折', characterChanges: '作者变化', estimatedChapters: 20, estimatedWordCount: 5, versions: existing.versions })
    expect(second.volumes[0].id).toBe(first.volumes[0].id)
  })

  it('does not mutate the input novel', () => {
    const novel = makeNovel({ volumes: [{ id: 'volume-1', volumeIndex: 0, title: '第一卷：旧名', theme: '作者主题', summary: '作者摘要', keyTurningPoints: '', characterChanges: '', estimatedChapters: 1, estimatedWordCount: 1 }] })
    const before = JSON.stringify(novel)
    buildCreationOutlineImport(novel, '## 第一卷：旧名\n主题：新主题\n## 主要角色表\n| 姓名 | 身份 |\n| --- | --- |\n| 新人 | 侦察者 |')
    expect(JSON.stringify(novel)).toBe(before)
  })

  it('parses Markdown characters and global foreshadowing while returning planning volumes', () => {
    const result = buildCreationOutlineImport(makeNovel(), `# 故事\n## 主要角色表\n| 姓名 | 身份 | 性格 | 背景 |\n| --- | --- | --- | --- |\n| 苏禾 | 研究员 | 细致 | 来自北港 |\n## 全书伏笔线\n- 伏笔1：失踪的钟 — 结局揭示真相\n## 第一卷：雾港\n主题：调查`)

    expect(result.volumes).toHaveLength(1)
    expect(result.definitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'character', data: expect.objectContaining({ name: '苏禾', identity: '研究员', personality: '细致', description: '来自北港' }) }),
      expect.objectContaining({ kind: 'event', data: expect.objectContaining({ title: '失踪的钟', description: '结局揭示真相', type: '伏笔' }) }),
    ]))
  })

  it('returns no volumes for empty or unparseable outline text', () => {
    expect(buildCreationOutlineImport(makeNovel(), '').volumes).toEqual([])
    const result = buildCreationOutlineImport(makeNovel(), '## 主要角色表\n| 姓名 | 身份 |\n| --- | --- |\n| 无卷角色 | 观察者 |\n\n## 全书伏笔线\n- 无卷伏笔 — 在开篇埋下')
    expect(result.volumes).toEqual([])
    expect(result.definitions).toContainEqual(expect.objectContaining({ kind: 'character', data: expect.objectContaining({ name: '无卷角色' }) }))
    expect(result.definitions).toContainEqual(expect.objectContaining({ kind: 'event', data: expect.objectContaining({ title: '无卷伏笔' }) }))
  })
})
