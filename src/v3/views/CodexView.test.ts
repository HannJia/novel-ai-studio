// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { useRoute } from 'vue-router'
import CodexView from './CodexView.vue'
import { useNovelStore } from '@/stores/novel'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { characterStateFixture, knowledgeCandidate, relationshipCandidate, stateTestTime as now } from '@/test/characterStateFixture'
import { acceptCandidateChange } from '@/services/reconstructionReview'
import { applyCandidateChangeToCanon } from '@/services/reconstructionCanon'
import { getPropositionCatalog } from '@/services/reconstructionCharacterState'
import { appendEntityRevision, captureEntityRevision } from '@/services/entityProvenance'
import { buildAnalysisSourceVersionId } from '@/services/reconstructionCandidates'
import type { CharacterMemoryAuthorDecision, MemoryKnowledgeEdge, StoryProposition } from '@/types/characterMemory'
import type { CanonMutationRecord, EvidenceRef } from '@/types/reconstruction'

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }))
vi.mock('vue-router', async () => {
  const { reactive } = await import('vue')
  const route = reactive({ params: { novelId: '' }, query: {} })
  return { useRoute: () => route, useRouter: () => ({ replace }) }
})
const route = useRoute()
let pinia: ReturnType<typeof createPinia>, wrapper: ReturnType<typeof mount> | undefined

function fixture() {
  const created = characterStateFixture(), novel = created.store.getNovel(created.novel.id)!
  route.params.novelId = novel.id
  return { ...created, novel, workspace: useReconstructionWorkspaceStore() }
}
function addKnowledge(data: ReturnType<typeof fixture>, index: number, values: Record<string, unknown> = {}, decision?: CharacterMemoryAuthorDecision) {
  const candidate = acceptCandidateChange(knowledgeCandidate(data.novel, index, values), now)
  const result = applyCandidateChangeToCanon(data.novel, candidate, now, data.workspace.getCanonMutations(data.novel.id), decision)
  data.workspace.recordCanonMutation(data.novel.id, result.record)
  return result.record
}
function linkedKnowledge() {
  const data = fixture()
  const first = addKnowledge(data, 0)
  const entry = getPropositionCatalog(data.novel, [first], 1)[0]
  const later = addKnowledge(data, 1, {}, { action: 'link', confirmed: true, targetId: entry.proposition.id, targetSignature: entry.signature })
  return { ...data, first, later }
}
async function mountCodex() {
  wrapper = mount(CodexView, { global: { stubs: { Teleport: true, RouterLink: RouterLinkStub } } })
  await flushPromises()
  return wrapper
}
async function tab(label: string) {
  const button = wrapper!.findAll('.codex-tabs button').find(button => button.text() === label)!
  await button.trigger('click'); await flushPromises()
}
function matrixCell(characterId: string, factId?: string) {
  return wrapper!.get(`.matrix-cell[data-character-id="${characterId}"]${factId ? `[data-fact-id="${factId}"]` : ''}`)
}

function largeMatrixFixture(characterCount = 80, propositionCount = 120) {
  const data = fixture()
  const chapter = data.novel.chapters[0]
  data.novel.characters = Array.from({ length: characterCount }, (_, index) => ({
    id: 'matrix-person-' + index,
    name: '人物' + index,
    aliases: [], identity: '合成角色', personality: '', powerLevel: '', faction: '',
    description: '', status: '活跃' as const, firstAppearChapter: 0, relationships: [], events: [], avatarColor: '',
  }))
  const quotes: string[] = [], records: CanonMutationRecord[] = []
  let offset = 0
  const now = '2026-11-10T00:00:00.000Z'
  for (let characterIndex = 0; characterIndex < characterCount; characterIndex++) {
    for (let propositionIndex = 0; propositionIndex < propositionCount; propositionIndex++) {
      const factId = 'matrix-fact-' + propositionIndex
      const quote = '合成证据-' + characterIndex + '-' + propositionIndex
      const proposition: StoryProposition = { version: 1, id: factId, text: '合成命题' + propositionIndex, scope: '', identityStatus: 'explicit' }
      const evidence: EvidenceRef = { id: 'matrix-evidence-' + characterIndex + '-' + propositionIndex, sourceType: 'chapter', sourceId: chapter.id, quote, startOffset: offset, endOffset: offset + quote.length }
      const state: MemoryKnowledgeEdge = { id: 'matrix-state-' + characterIndex + '-' + propositionIndex, characterId: 'matrix-person-' + characterIndex, factId, fact: proposition.text, state: propositionIndex % 3 === 0 ? 'knows' : propositionIndex % 3 === 1 ? 'suspects' : 'does_not_know', knownSinceChapter: 0, evidence: [evidence], proposition, stateIdentityId: factId }
      records.push({ id: 'matrix-record-' + characterIndex + '-' + propositionIndex, candidateId: 'matrix-candidate-' + characterIndex + '-' + propositionIndex, novelId: data.novel.id, chapterId: chapter.id, type: 'knowledge', summary: '合成知情记录', appliedAt: now, characterState: { kind: 'knowledge', after: state } })
      quotes.push(quote)
      offset += quote.length + 1
    }
  }
  chapter.content = quotes.join('\n')
  chapter.wordCount = chapter.content.length
  const sourceVersionId = buildAnalysisSourceVersionId(chapter.content)
  for (const record of records) {
    const state = record.characterState!.after as MemoryKnowledgeEdge
    state.evidence[0].sourceVersionId = sourceVersionId
  }
  data.workspace.canonMutationsByNovel[data.novel.id] = records
  return data
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear()
  pinia = createPinia(); setActivePinia(pinia)
  route.params.novelId = ''; route.query = {}
  replace.mockReset().mockImplementation(async ({ query }) => { route.query = Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined)) as Record<string, string> })
  vi.spyOn(useReconstructionWorkspaceStore(), 'hydrateFromPersistence').mockResolvedValue({ candidates: [], reviewFindings: [], canonMutations: [], chapterReviews: [], aiRuns: [] })
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined; disposePinia(pinia); vi.restoreAllMocks() })

describe('V3 典籍原型布局与真实按章投影', () => {
  it('默认打开知情矩阵，空作品不编造人物、命题或认知历史', async () => {
    const novels = useNovelStore(), created = novels.addNovel({ workingTitle: '空典籍', genre: 'fantasy', subGenre: 'xuanhuan', tags: [], targetWordCountMin: 20, targetWordCountMax: 30, writingStyle: novels.defaultWritingStyle(), settings: novels.defaultSettings() })
    route.params.novelId = created.id
    await mountCodex()
    expect(wrapper!.get('.codex-tabs .on').text()).toBe('知情矩阵')
    expect(wrapper!.get('.codex-main').text()).toContain('尚无可投影的人物')
    expect(wrapper!.findAll('.matrix-cell')).toHaveLength(0)
    expect(wrapper!.findAll('.history-item')).toHaveLength(0)
    expect(wrapper!.find('input[type="range"]').exists()).toBe(false)
    expect(wrapper!.get('.codex-detail').text()).toContain('选择人物或矩阵单元格')
    const characterLink = wrapper!.findAllComponents(RouterLinkStub).find(link => link.text() === '管理人物资料')
    expect(characterLink?.props('to')).toBe('/characters/' + created.id)
  })

  it('滑条投影到实际章节，只显示当时已确认的认知与来源历史', async () => {
    linkedKnowledge(); await mountCodex()
    expect(matrixCell('person-0').get('.cell-state').text()).toContain('知道')
    expect(matrixCell('person-1').get('.cell-state').text()).toBe('—未记录')
    expect(wrapper!.findAll('.history-item')).toHaveLength(2)
    await wrapper!.get('input[aria-label="按章节投影"]').setValue('0'); await flushPromises()
    expect(wrapper!.get('.projection-control strong').text()).toBe('第 1 章')
    expect(matrixCell('person-0').text()).toContain('误解')
    expect(wrapper!.get('.codex-detail').text()).toContain('城主已经死了')
    expect(wrapper!.get('.codex-detail').text()).not.toContain('苏禾出示的书信')
    expect(wrapper!.findAll('.history-item')).toHaveLength(1)
    expect(replace).toHaveBeenLastCalledWith({ query: expect.objectContaining({ tab: 'knowledge', atChapter: '1' }) })
    await wrapper!.get('select[aria-label="投影章节"]').setValue('1'); await flushPromises()
    expect(matrixCell('person-0').text()).toContain('知道')
    expect(wrapper!.get('.codex-detail').text()).toContain('苏禾出示的书信')
  })

  it('明确不知情与未记录分别显示，点击单元格选择右侧人物', async () => {
    const data = fixture(); addKnowledge(data, 0, { state: 'does_not_know' })
    await mountCodex()
    expect(matrixCell('person-0').get('.cell-state').classes()).toContain('does_not_know')
    expect(matrixCell('person-0').text()).toContain('明确不知情')
    expect(matrixCell('person-1').get('.cell-state').classes()).toContain('unrecorded')
    await matrixCell('person-1').trigger('click'); await flushPromises()
    expect(matrixCell('person-1').attributes('aria-pressed')).toBe('true')
    expect(wrapper!.get('.detail-person h2').text()).toBe('苏禾')
    expect(wrapper!.get('.codex-detail').classes()).toContain('is-open')
    expect(wrapper!.get('.codex-detail').text()).toContain('没有明确的认知记录')
    expect(wrapper!.findAll('.history-item')).toHaveLength(0)
    expect(wrapper!.findAllComponents(RouterLinkStub).some(link => {
      const target = link.props('to')
      return typeof target !== 'string' && target?.query?.character === 'person-1'
    })).toBe(true)
  })

  it('最新认知来源失效时不回退旧信念，旧记录仅作为明确标记的历史', async () => {
    const data = linkedKnowledge()
    data.novel.chapters[1].content += '正文已经修订。'
    await mountCodex()
    expect(matrixCell('person-0').text()).toContain('来源待核对')
    expect(matrixCell('person-0').get('.cell-state').classes()).not.toContain('false_belief')
    expect(wrapper!.get('.projection-notice').text()).toContain('不回退为旧状态')
    const latest = wrapper!.get(`[data-record-id="${data.later.id}"]`)
    expect(latest.classes()).toContain('invalid')
    expect(latest.text()).toContain('仅历史')
    expect(latest.findComponent(RouterLinkStub).exists()).toBe(false)
    await wrapper!.get('input[type="range"]').setValue('0'); await flushPromises()
    expect(matrixCell('person-0').get('.cell-state').classes()).toContain('false_belief')
    expect(wrapper!.find('.projection-notice').exists()).toBe(false)
  })

  it('同文独立命题和并列冲突不被合并或任选第一条当作一致状态', async () => {
    const data = fixture(); addKnowledge(data, 0); addKnowledge(data, 1)
    await mountCodex()
    expect(wrapper!.findAll('.matrix thead th')).toHaveLength(3)
    const cells = wrapper!.findAll('.matrix-cell[data-character-id="person-0"]')
    expect(cells).toHaveLength(2)
    expect(cells.every(cell => cell.text().includes('认知待核对'))).toBe(true)
    expect(wrapper!.get('.codex-detail').text()).toContain('不能任选一条当作一致状态')
  })

  it('不再静默截断第十三个及后续命题', async () => {
    const data = fixture()
    for (let index = 1; index <= 13; index++) addKnowledge(data, 0, { fact: '独立命题' + index, state: 'knows' })
    await mountCodex()
    expect(wrapper!.findAll('.matrix thead th')).toHaveLength(14)
    expect(wrapper!.get('.matrix').text()).toContain('独立命题13')
    expect(wrapper!.findAll('.matrix-cell[data-character-id="person-0"]')).toHaveLength(13)
  })

  it('早章不展示未来人物、未来命题或后续认知引文', async () => {
    const data = fixture(); addKnowledge(data, 0)
    data.novel.characters.push({ ...data.novel.characters[1], id: 'future-person', name: '后章人物', firstAppearChapter: 2 })
    addKnowledge(data, 1, { fact: '只在后章确认的命题' })
    await mountCodex()
    expect(wrapper!.get('.matrix').text()).toContain('后章人物')
    await wrapper!.get('input[type="range"]').setValue('0'); await flushPromises()
    expect(wrapper!.get('.codex-page').text()).not.toContain('后章人物')
    expect(wrapper!.get('.codex-page').text()).not.toContain('只在后章确认的命题')
    expect(wrapper!.get('.codex-detail').text()).not.toContain('苏禾向林澈出示书信')
  })

  it('刻度按真实章节集合移动，不按数组长度虚构缺失章节', async () => {
    const data = fixture(); data.novel.chapters[2].chapterIndex = 8
    await mountCodex()
    expect(wrapper!.get('.projection-control strong').text()).toBe('第 9 章 · 当前')
    expect(wrapper!.get('input[type="range"]').attributes('max')).toBe('2')
    expect(wrapper!.findAll('.projection-control option')).toHaveLength(3)
    await wrapper!.get('input[type="range"]').setValue('1'); await flushPromises()
    expect(wrapper!.get('.projection-control strong').text()).toBe('第 2 章')
  })

  it('保留人物、命题和章节的外部导航选择，并提供准确原文定位链接', async () => {
    const data = linkedKnowledge(), fact = data.first.characterState!.kind === 'knowledge' ? data.first.characterState!.after.factId : ''
    route.query = { tab: 'knowledge', atChapter: '1', character: 'person-0', fact }
    await mountCodex()
    expect(wrapper!.get('.projection-control strong').text()).toBe('第 1 章')
    expect(matrixCell('person-0', fact).attributes('aria-pressed')).toBe('true')
    const evidence = data.first.characterState!.after.evidence[0]
    expect(wrapper!.findAllComponents(RouterLinkStub).some(link => {
      const target = link.props('to')
      return typeof target !== 'string' && target?.path === '/write/' + data.novel.id + '/' + data.novel.chapters[0].id
        && target.query.evidenceVersion === evidence.sourceVersionId && target.query.evidenceStart === String(evidence.startOffset)
    })).toBe(true)
    route.query = { tab: 'characters', atChapter: '2', character: 'person-1' }; await flushPromises()
    expect(wrapper!.get('.codex-tabs .on').text()).toBe('人物')
    expect(wrapper!.get('.detail-person h2').text()).toBe('苏禾')
  })

  it('典籍资源与人物编辑链接使用 V3 工具路由', async () => {
    const data = fixture()
    await mountCodex()

    await tab('资料与回顾')
    const resourceTargets = new Map(wrapper!.findAllComponents(RouterLinkStub)
      .filter(link => link.find('strong').exists())
      .map(link => [link.get('strong').text(), link.props('to')]))
    expect(resourceTargets.get('灵感记录')).toBe('/inspiration/' + data.novel.id)
    expect(resourceTargets.get('资料库')).toBe('/knowledge/' + data.novel.id)
    expect(resourceTargets.get('数据面板')).toBe('/data/' + data.novel.id)

    await tab('人物')
    const characterLink = wrapper!.findAllComponents(RouterLinkStub).find(link => link.text() === '编辑人物')
    expect(characterLink?.props('to')).toEqual({ path: '/characters/' + data.novel.id, query: { character: 'person-0' } })
  })

  it('人物卡只显示真实转折，不制造固定五阶段成长进度', async () => {
    const data = fixture(), chapter = data.novel.chapters[0]
    data.novel.eventLog = [{ id: 'actual', chapterIndex: 0, title: '渡口拒开', description: '渡船没有开门。', characters: ['person-0'], type: '转折', status: 'developing', storyTime: '第一夜', source: 'user', timestamp: now },
      { id: 'future', chapterIndex: 1, title: '计划中的转折', description: '尚未发生。', characters: ['person-0'], type: '转折', status: 'planted', source: 'user', timestamp: now }]
    data.novel.storyArcs = [{ id: 'arc-character', title: '守渡人的转变', description: '', type: 'character', importance: 3, status: 'active', reactivateAt: '', characterIds: ['person-0'], turningPointEventIds: ['actual', 'future'], nodes: [], createdAt: now, updatedAt: now }]
    expect(chapter.content).not.toBe('')
    await mountCodex(); await tab('人物')
    expect(wrapper!.findAll('.character-card')).toHaveLength(2)
    expect(wrapper!.get('.turning-points').text()).toContain('渡口拒开')
    expect(wrapper!.get('.turning-points').text()).not.toContain('计划中的转折')
    expect(wrapper!.findAll('.character-card .arc i')).toHaveLength(0)
    await wrapper!.findAll('.character-select')[1].trigger('click'); await flushPromises()
    expect(wrapper!.get('.detail-person h2').text()).toBe('苏禾')
  })

  it('关系网保留单向性和真实维度，不按一条关系补造反向边', async () => {
    const data = fixture()
    data.novel.characters[0].relationships = [{ targetId: 'person-1', targetName: '苏禾', relation: '信任', dimension: 'trust' }]
    await mountCodex(); await tab('关系网')
    expect(wrapper!.findAll('.relationship-line')).toHaveLength(1)
    expect(wrapper!.findAll('.relation-node')).toHaveLength(2)
    expect(wrapper!.get('.relationship-label').text()).toBe('信任')
    expect(wrapper!.get('.relation-source').text()).toBe('林澈→苏禾')
    await wrapper!.findAll('.relation-node')[1].trigger('click'); await flushPromises()
    expect(wrapper!.get('.detail-person h2').text()).toBe('苏禾')
  })

  it('失效的章节关系不回退成人物资料中的旧关系', async () => {
    const data = fixture()
    data.novel.characters[0].relationships = [{ targetId: 'person-1', targetName: '苏禾', relation: '原本信任', dimension: 'trust' }]
    const candidate = acceptCandidateChange(relationshipCandidate(data.novel, 1), now)
    const record = applyCandidateChangeToCanon(data.novel, candidate, now).record
    data.workspace.recordCanonMutation(data.novel.id, record)
    data.novel.chapters[1].content += '来源已修订。'
    await mountCodex(); await tab('关系网')
    expect(wrapper!.findAll('.relationship-line')).toHaveLength(0)
    expect(wrapper!.get('.invalid-panel').text()).toContain('来源正文')
    expect(wrapper!.get('.codex-main').text()).not.toContain('原本信任')
  })

  it('时间线只用有效投影，规划使用虚线，失效 AI 事件不冒充已发生', async () => {
    const data = fixture()
    data.novel.eventLog = [{ id: 'actual', chapterIndex: 0, title: '渡口拒开', description: '渡船没有开门。', characters: [], type: '主线', status: 'developing', storyTime: '第一夜', source: 'user', timestamp: now },
      { id: 'planned', chapterIndex: -1, title: '未来渡河', description: '', characters: [], type: '转折', status: 'planted', source: 'user', timestamp: now },
      { id: 'invalid', chapterIndex: 0, title: '无来源的 AI 发生记录', description: '不作为真实事件', characters: [], type: '其他', status: 'resolved', source: 'ai', timestamp: now }]
    await mountCodex(); await tab('时间线')
    const rows = wrapper!.findAll('.timeline-row')
    expect(rows).toHaveLength(2)
    expect(rows.map(row => row.text().includes('未来渡河'))).toEqual([false, true])
    expect(rows.find(row => row.text().includes('未来渡河'))!.classes()).toContain('planned')
    expect(rows.find(row => row.text().includes('渡口拒开'))!.classes()).not.toContain('planned')
    expect(wrapper!.get('.story-timeline').text()).toContain('第一夜')
    expect(wrapper!.get('.story-timeline').text()).not.toContain('无来源的 AI 发生记录')
  })

  describe('边界缺陷回归', () => {
    function catalogEntry(data: ReturnType<typeof fixture>, text: string, chapterIndex: number) {
      const entry = getPropositionCatalog(data.novel, data.workspace.getCanonMutations(data.novel.id), chapterIndex).find(item => item.proposition.text === text)
      if (!entry) throw new Error('命题不存在：' + text)
      return entry
    }
    const mergeOf = (target: ReturnType<typeof catalogEntry>, from: ReturnType<typeof catalogEntry>): CharacterMemoryAuthorDecision => ({
      action: 'merge', confirmed: true, targetId: target.proposition.id, targetSignature: target.signature,
      mergeFromId: from.proposition.id, mergeFromSignature: from.signature, reason: '两条表述指同一件事',
    })

    it('失效的链接记录与有效记录经同一归并规范化，不把同一命题拆成两列', async () => {
      const data = fixture()
      addKnowledge(data, 0, { fact: '命题T', state: 'knows', evidence: '林澈以为城主已经死了。' })
      addKnowledge(data, 0, { fact: '命题R', state: 'knows', evidence: '林澈仍然信任苏禾。' })
      const t = catalogEntry(data, '命题T', 1)
      addKnowledge(data, 1, { fact: '命题L', state: 'knows' }, { action: 'link', confirmed: true, targetId: t.proposition.id, targetSignature: t.signature })
      addKnowledge(data, 2, { fact: '命题B', state: 'knows', evidence: '林澈在雨中等待。' }, mergeOf(catalogEntry(data, '命题R', 2), catalogEntry(data, '命题T', 2)))
      data.novel.chapters[1].content += '来源章已经修订。'
      await mountCodex()
      expect(wrapper!.findAll('.matrix thead th')).toHaveLength(2)
      const cells = wrapper!.findAll('.matrix-cell[data-character-id="person-0"]')
      expect(cells).toHaveLength(1)
      expect(cells[0].text()).toContain('来源待核对')
    })

    it('来源章被移到后面后，早章投影不展示它的命题、认知和引文', async () => {
      const data = fixture(); addKnowledge(data, 0)
      data.novel.chapters[0].chapterIndex = 5
      route.query = { atChapter: '2' }
      await mountCodex()
      expect(wrapper!.get('.projection-control strong').text()).toBe('第 2 章')
      expect(wrapper!.find('.projection-notice').exists()).toBe(false)
      expect(wrapper!.findAll('.matrix-cell')).toHaveLength(0)
      expect(wrapper!.findAll('.history-item')).toHaveLength(0)
      expect(wrapper!.get('.codex-page').text()).not.toContain('城主仍然在世')
      expect(wrapper!.get('.codex-page').text()).not.toContain('林澈以为城主已经死了')
      // 投影到来源章当前所在位置时，顺序已变的记录仍作为“来源待核对”的历史展示，不被静默丢弃。
      await wrapper!.get('select[aria-label="投影章节"]').setValue('5'); await flushPromises()
      expect(matrixCell('person-0').text()).toContain('来源待核对')
    })

    it('多条一致的认知经作者归并后仍是一致状态，不误报“认知待核对”', async () => {
      const data = fixture()
      addKnowledge(data, 0, { fact: '命题甲', state: 'knows', evidence: '林澈以为城主已经死了。' })
      addKnowledge(data, 0, { fact: '命题乙', state: 'knows', evidence: '林澈仍然信任苏禾。' })
      addKnowledge(data, 1, { fact: '命题丙', state: 'knows' }, mergeOf(catalogEntry(data, '命题甲', 1), catalogEntry(data, '命题乙', 1)))
      await mountCodex()
      expect(wrapper!.findAll('.matrix thead th')).toHaveLength(2)
      const cell = matrixCell('person-0')
      expect(cell.get('.cell-state').classes()).toContain('knows')
      expect(cell.text()).not.toContain('认知待核对')
      expect(cell.text()).toContain('自第 1 章')
      expect(wrapper!.get('.codex-detail').text()).not.toContain('不能任选一条当作一致状态')
    })

    it('有正文来源的已埋设事件算已发生，作者手填的已埋设事件仍是计划', async () => {
      const data = fixture(), chapter = data.novel.chapters[0]
      const planted = { id: 'plant', chapterIndex: 0, title: '门边的钥匙', description: '', characters: [], type: '伏笔' as const, status: 'planted' as const, source: 'ai' as const, storyTime: '第一夜', timestamp: now }
      data.novel.eventLog = [planted, { id: 'draft', chapterIndex: 1, title: '作者设想的伏笔', description: '', characters: [], type: '伏笔', status: 'planted', source: 'user', timestamp: now }]
      appendEntityRevision(data.novel.eventLog[0], captureEntityRevision('event', undefined, data.novel.eventLog[0], { kind: 'chapter', chapterId: chapter.id, chapterIndex: 0,
        sourceVersionId: buildAnalysisSourceVersionId(chapter.content), evidence: [{ quote: '林澈以为城主已经死了。' }] }, now, 'plant-source'))
      await mountCodex(); await tab('时间线')
      const rows = wrapper!.findAll('.timeline-row')
      const rowOf = (title: string) => rows.find(row => row.text().includes(title))!
      expect(rows).toHaveLength(2)
      expect(rowOf('门边的钥匙').classes()).not.toContain('planned')
      expect(rowOf('门边的钥匙').text()).toContain('发生记录')
      expect(rowOf('门边的钥匙').text()).not.toContain('计划，非已发生')
      expect(rowOf('作者设想的伏笔').classes()).toContain('planned')
      expect(rowOf('作者设想的伏笔').text()).toContain('计划，非已发生')
    })

    it('没有章节的作品仍显示作者填写的基础关系', async () => {
      const data = fixture()
      data.novel.chapters.splice(0, data.novel.chapters.length)
      data.novel.characters[0].relationships = [{ targetId: 'person-1', targetName: '苏禾', relation: '信任', dimension: 'trust' }]
      await mountCodex(); await tab('关系网')
      expect(wrapper!.findAll('.relationship-line')).toHaveLength(1)
      expect(wrapper!.get('.relation-source').text()).toBe('林澈→苏禾')
      expect(wrapper!.find('.invalid-panel').exists()).toBe(false)
    })
  })

  it('读取、切章、切页和选择都不修改作品、Canon 或未决候选，资料与回顾入口仍保留', async () => {
    const data = linkedKnowledge()
    const before = JSON.stringify([data.novel, data.workspace.getCanonMutations(data.novel.id), data.workspace.getCandidates(data.novel.id)])
    await mountCodex()
    await matrixCell('person-1').trigger('click')
    await wrapper!.get('input[type="range"]').setValue('0'); await flushPromises()
    for (const label of ['人物', '关系网', '时间线', '资料与回顾']) await tab(label)
    expect(wrapper!.get('.resource-grid').text()).toContain('故事回顾')
    expect(wrapper!.get('.codex-links').text()).toContain('本书资料')
    expect(JSON.stringify([data.novel, data.workspace.getCanonMutations(data.novel.id), data.workspace.getCandidates(data.novel.id)])).toBe(before)
  })

  it.skipIf(process.env.CODEX_MATRIX_BENCHMARK !== '1')('输出大型知情矩阵挂载基准', async () => {
    const data = largeMatrixFixture()
    const started = performance.now()
    await mountCodex()
    const mountMs = performance.now() - started
    const matrixWrap = wrapper!.get('.matrix-wrap')
    console.log(JSON.stringify({
      benchmark: 'codex-matrix-mount', characters: data.novel.characters.length, propositions: 120,
      cells: data.novel.characters.length * 120, renderedCells: wrapper!.findAll('.matrix-cell').length,
      mountMs: Number(mountMs.toFixed(2)), htmlBytes: wrapper!.html().length,
    }))
    expect(wrapper!.findAll('.matrix thead th')).toHaveLength(121)
    expect(wrapper!.findAll('.matrix-cell').length).toBeLessThan(data.novel.characters.length * 120)
    expect(wrapper!.findAll('.matrix-cell').length).toBeGreaterThan(0)
    const matrixElement = matrixWrap.element as HTMLElement
    matrixElement.scrollTop = (data.novel.characters.length - 1) * 58
    await matrixWrap.trigger('scroll'); await flushPromises()
    expect(wrapper!.find('.matrix-cell[data-character-id="matrix-person-79"][data-fact-id="matrix-fact-119"]').exists()).toBe(true)
    await matrixCell('matrix-person-79', 'matrix-fact-119').trigger('click'); await flushPromises()
    expect(wrapper!.get('.detail-person h2').text()).toBe('人物79')
  }, 120_000)
})
