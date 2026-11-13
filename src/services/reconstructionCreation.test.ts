import { describe, expect, it } from 'vitest'
import type { Novel } from '@/types/novel'
import { buildConfirmedSkeletonConstraint, buildPlotSkeletonFromOutline, buildPlotSkeletonPrompt, confirmCreationSkeleton, confirmStoryContract, reviseStoryContract, createCreationDraftFromNovel, syncCreationDraftFromOutline, syncCreationDraftPlanning } from './reconstructionCreation'

const now = '2026-10-26T00:00:00.000Z'

function makeNovel(): Novel {
  return {
    id: 'novel-1', title: '雾城回响', genre: 'fantasy', subGenre: 'urban-fantasy', genreLabel: '玄幻', subGenreLabel: '东方玄幻',
    tags: ['复仇', '学院'], targetWordCountMin: 80, targetWordCountMax: 120, currentWordCount: 0,
    writingStyle: { narrativePov: 'third-limited', toneStyle: 'dark', descriptionDensity: 'balanced', dialogueStyle: 'crisp', combatStyle: 'strategic', pacingControl: 'normal', emotionExpression: 'nuanced' },
    writingMode: 'manual', settings: {
      protagonist: { name: '林澈', gender: '男', age: '17', background: '边城学徒', personality: ['谨慎'], initialPower: '初阶', cheatDescription: '能听见旧物回声', romanceTendency: '单线' },
      supportingCharacters: [], worldBuilding: { worldType: '灵能都市', worldScale: '一城', socialStructure: '学院与家族', techLevel: '现代', specialRules: '夜间禁行；能力必须付出代价。' },
      powerSystem: { systemName: '回响术', levelHierarchy: '一至九阶', combatStyleDesc: '策略', auxiliarySystems: '' },
      coreConflict: { mainConflict: '追查父亲失踪', mainVillain: '监察院', factionConflicts: '', coreSuspense: '真相会改变他的身份' },
      romance: { romanceType: '单女主', developmentPace: '慢热', toneChanges: '', emotionalConflict: '' },
      payoff: { faceSlapFrequency: '适中', levelUpPace: '稳步', patterns: ['复仇'] },
      structure: { foreshadowingDensity: '中等' }, otherSettings: '',
    },
    outline: '', synopsis: '', volumes: [], chapters: [], characters: [], chatHistory: [], knowledgeBaseIds: [], eventLog: [], dataPanels: [], dataPanelChanges: [], status: 'creating', createdAt: now, updatedAt: now,
  } as unknown as Novel
}

describe('reconstruction creation protocol', () => {
  it('requires explicit selection among candidates and binds the chosen edits to downstream generation', () => {
    const novel = makeNovel()
    const initial = createCreationDraftFromNovel(novel, now)
    const draft = confirmStoryContract(initial, { ...initial.contract, endingDirection: '暂不确定' }, now)
    const skeleton = buildPlotSkeletonFromOutline(novel, '## 结局方向\n救回父亲', now)
    draft.skeletons = [skeleton, { ...skeleton, id: 'alternative', ending: '放弃复仇',
      beats: skeleton.beats.map(beat => ({ ...beat, description: '放弃复仇' })) }]
    expect(() => confirmCreationSkeleton(draft, now)).toThrow('选择')
    expect(() => buildConfirmedSkeletonConstraint(draft)).toThrow('尚未由作者确认')
    expect(() => confirmCreationSkeleton({ ...draft, selectedSkeletonId: 'missing' }, now)).toThrow('选择')
    const confirmed = confirmCreationSkeleton({ ...draft, selectedSkeletonId: 'alternative' }, now)
    expect(buildConfirmedSkeletonConstraint(confirmed)).toContain('放弃复仇')
    expect(buildConfirmedSkeletonConstraint(confirmed)).not.toContain('救回父亲')
    expect(syncCreationDraftFromOutline(confirmed, novel, '展开后的大纲', now).stage).toBe('volume-outline')
  })
  it('maps the existing book settings into an author-first story contract', () => {
    const draft = createCreationDraftFromNovel(makeNovel(), now)
    expect(draft.mode).toBe('author')
    expect(draft.stage).toBe('contract')
    expect(draft.contract).toMatchObject({ title: '雾城回响', genre: '玄幻', centralConflict: '追查父亲失踪' })
    expect(draft.contract.targetWordCountMin).toBe(800000)
    expect(draft.contract.worldRules).toEqual(['夜间禁行', '能力必须付出代价'])
    expect(draft.contract.protagonistFear).toBe('')
    expect(draft.contract.endingDirection).toBe('')
    expect(draft.contract.approval).toBe('draft')
    expect(draft.contract.pointOfView).toBe('第三人称限知')
    expect(draft.contract.styleDirection).toContain('暗黑压抑')
    expect(() => buildPlotSkeletonPrompt(draft.contract)).toThrow('请先确认作品契约')
  })

  it('turns a readable outline into a reviewable skeleton and requires explicit confirmation', () => {
    const novel = makeNovel()
    const draft = createCreationDraftFromNovel(novel, now)
    const outline = '## 推荐书名\n《雾城回响》\n## 小说简介\n林澈追查父亲失踪。\n## 第一卷：入城\n他进入学院。\n## 第二卷：回声\n真相浮出水面。\n## 结局方向\n他选择承担真相。'
    const skeleton = buildPlotSkeletonFromOutline(novel, outline, now)
    expect(skeleton.beats.length).toBeGreaterThanOrEqual(2)
    const synced = syncCreationDraftFromOutline(draft, novel, outline, now)
    expect(synced.stage).toBe('contract')
    expect(synced.selectedSkeletonId).toBeUndefined()
    expect(() => confirmCreationSkeleton(synced, now)).toThrow('请先确认作品契约')
    const contract = confirmStoryContract(synced, { ...synced.contract, endingDirection: '承担真相' }, now)
    const confirmed = confirmCreationSkeleton({ ...contract, selectedSkeletonId: skeleton.id }, now)
    expect(confirmed.stage).toBe('volume-outline')
    expect(confirmed.skeletons[0].approval).toBe('approved')
  })

  it('validates the contract and puts author boundaries into skeleton generation', () => {
    const draft = createCreationDraftFromNovel(makeNovel(), now)
    expect(() => confirmStoryContract(draft, draft.contract, now)).toThrow('结局方向')
    const contract = { ...draft.contract, endingDirection: '主角离开城市', forbiddenTopics: [' 禁止复活 ', ''], protagonistFear: '被遗忘' }
    expect(() => confirmStoryContract(draft, { ...contract, targetWordCountMax: 10 }, now)).toThrow('不能少于')
    expect(() => confirmStoryContract(draft, { ...contract, targetWordCountMin: NaN }, now)).toThrow('必须大于')
    const confirmed = confirmStoryContract(draft, contract, now)
    expect(confirmed.approval.contract).toBe('approved')
    expect(confirmed.contract.forbiddenTopics).toEqual(['禁止复活'])
    expect(buildPlotSkeletonPrompt(confirmed.contract)).toContain('禁止复活')
    expect(buildPlotSkeletonPrompt(confirmed.contract)).toContain('主角离开城市')
  })

  it('retains planning but revokes approvals on contract edits; re-confirmation is idempotent', () => {
    const novel = makeNovel()
    let draft = createCreationDraftFromNovel(novel, now)
    draft = confirmStoryContract(draft, { ...draft.contract, endingDirection: '暂不确定' }, now)
    draft = syncCreationDraftFromOutline(draft, novel, '## 小说简介\n林澈追查父亲失踪并揭开真相。', now)
    draft.skeletons[0] = { ...draft.skeletons[0], logline: '林澈追查父亲失踪并揭开真相。', promise: '线索逐步推进父亲失踪案。',
      ending: '林澈查明真相并承担代价。', beats: [{ id: 'beat-opening', title: '发现线索', description: '林澈发现父亲留下的线索。',
        kind: 'opening', relatedPlotlineIds: [], relatedCharacterIds: [] }] }
    draft = confirmCreationSkeleton(draft, now)
    const unchanged = confirmStoryContract(draft, { ...draft.contract }, now)
    expect(unchanged.stage).toBe('volume-outline')
    expect(unchanged.selectedSkeletonId).toBe(draft.selectedSkeletonId)
    expect(unchanged.approval.skeleton).toBe('approved')
    const edited = reviseStoryContract(draft, { ...draft.contract, endingDirection: '放弃复仇' }, now)
    expect(edited.skeletons).toHaveLength(1)
    expect(edited.skeletons[0].premise).toBe(draft.skeletons[0].premise)
    expect(edited.skeletons[0].approval).toBe('draft')
    expect(edited.approval).toEqual({})
    expect(edited.selectedSkeletonId).toBeUndefined()
    expect(() => buildConfirmedSkeletonConstraint(edited)).toThrow('作品契约')
    expect(syncCreationDraftFromOutline(edited, { ...novel, title: '旧标题' }, '新大纲', now).contract.title).toBe(edited.contract.title)
  })

  it('maps confirmed volume and chapter planning into the V2 outline layers', () => {
    const novel = makeNovel()
    novel.volumes = [{ id: 'volume-1', volumeIndex: 0, title: '入城篇', theme: '进入学院', summary: '建立主线', keyTurningPoints: '第一次转折', characterChanges: '主角开始反抗', estimatedChapters: 20, estimatedWordCount: 20 }]
    novel.chapterPlans = [{ id: 'plan-1', horizon: 'next', title: '第一章', objective: '进入学院', summary: '遇到守门人', beats: ['得到线索'], targetChapterStart: 0, targetChapterEnd: 0, relatedArcIds: [], relatedEventIds: [], status: 'planned', source: 'ai', createdAt: now, updatedAt: now }]
    const draft = createCreationDraftFromNovel(novel, now)
    const synced = syncCreationDraftPlanning(draft, novel, now)
    expect(synced.stage).toBe('contract')
    expect(synced.chapterPlans[0].approval).toBe('draft')
    expect(synced.volumes[0]).toMatchObject({ title: '入城篇', objective: '建立主线' })
    expect(synced.chapterPlans[0]).toMatchObject({ number: 1, title: '第一章', requiredEvents: ['得到线索'] })
  })

  it('preserves multiline outline sections and handles punctuation in headings', () => {
    const skeleton = buildPlotSkeletonFromOutline(makeNovel(), '## 小说简介\n第一段。\n第二段。\n## 开局[调查]\n先询问守卫。\n再发现证据。\n## 结局方向\n公开真相。\n承担代价。', now)
    expect(skeleton.premise).toBe('第一段。\n第二段。')
    expect(skeleton.ending).toBe('公开真相。\n承担代价。')
    expect(skeleton.beats.find(beat => beat.title === '开局[调查]')?.description).toContain('再发现证据')
  })
})
