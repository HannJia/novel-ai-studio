import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Novel, Chapter, Volume, Character, DialogueMessage, CreateWizardForm, WritingStyle, NovelSettings, DataPanelItem, DataPanelChange, ChapterRevision, ChapterRevisionSource, EventLogEntry, StoryArc, StoryArcNode, ChapterPlan, StoryStateProposal, SceneNote, ChapterVersion, DataPanelVersion } from '@/types/novel'
import { genres } from '@/data/genres'
import { loadAllNovelsFromDb, saveNovelToDb, deleteNovelFromDb } from '@/services/db/novels'
import { createRevisionPersistence } from './revisionPersistence'
import { countNovelWords } from '@/utils/format'
import { createChapterRevision, getChapterRevision, listChapterRevisions, updateChapterRevisionStatus } from '@/services/db/chapterRevisions'
import {
  buildDataPanelAutomationSuggestions,
  calculateDataPanelFields,
  initializeElapsedRuleBaselines,
  pruneDataPanelChangeHistory,
  settleDataPanelAutomationRules,
  type DataPanelHistoryCleanup,
} from '@/services/dataPanel'
import { appendPlanningVersion, createPlanningSnapshot } from '@/services/planningVersions'

// 生成唯一 ID
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8)
}

function appendSnapshot<T extends { id: string; label: string; savedAt: string; snapshot: string }>(versions: T[] | undefined, snapshot: string, label: string): T[] {
  const previous = versions || []
  if (previous[previous.length - 1]?.snapshot === snapshot) return previous
  return [...previous, {
    id: generateId(),
    label: label || '编辑前版本',
    savedAt: new Date().toISOString(),
    snapshot,
  } as T].slice(-20)
}

function chapterSnapshot(chapter: Chapter): string {
  return JSON.stringify({ title: chapter.title, content: chapter.content, summary: chapter.summary, status: chapter.status })
}

function dataPanelSnapshot(item: DataPanelItem): string {
  return JSON.stringify({ category: item.category, name: item.name, fields: item.fields, relatedKeywords: item.relatedKeywords, lastMentionChapterIndex: item.lastMentionChapterIndex })
}

function cleanCharacterName(value: string): string {
  return value
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/^[《》「」『』“”‘’"'\s]+|[《》「」『』“”‘’"'\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeCharacterName(value: string): string {
  return cleanCharacterName(value).toLowerCase()
}

function cleanMarkdownText(value: string): string {
  return value
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .trim()
}

// 默认写作风格
function defaultWritingStyle(): WritingStyle {
  return {
    narrativePov: 'third-limited',
    toneStyle: 'hot-blooded',
    descriptionDensity: 'balanced',
    dialogueStyle: 'colloquial',
    combatStyle: 'explosive',
    pacingControl: 'normal',
    emotionExpression: 'nuanced',
  }
}

// 默认核心设定
function defaultSettings(): NovelSettings {
  return {
    protagonist: {
      name: '',
      gender: '',
      age: '',
      background: '',
      personality: [],
      initialPower: '',
      cheatDescription: '',
      romanceTendency: '',
    },
    supportingCharacters: [],
    worldBuilding: {
      worldType: '',
      worldScale: '',
      socialStructure: '',
      techLevel: '',
      specialRules: '',
    },
    powerSystem: {
      systemName: '',
      levelHierarchy: '',
      combatStyleDesc: '',
      auxiliarySystems: '',
    },
    coreConflict: {
      mainConflict: '',
      mainVillain: '',
      factionConflicts: '',
      coreSuspense: '',
    },
    romance: {
      romanceType: '',
      developmentPace: '',
      toneChanges: '',
      emotionalConflict: '',
    },
    payoff: {
      faceSlapFrequency: '',
      levelUpPace: '',
      patterns: [],
    },
    structure: {
      foreshadowingDensity: '中等',
    },
    otherSettings: '',
  }
}

export const useNovelStore = defineStore('novel', () => {
  // 小说列表
  const novels = ref<Novel[]>([])
  const isInitialized = ref(false)

  const persistence = createRevisionPersistence(novels, isInitialized, saveNovelToDb)
  const { saveError, saving, hasPendingSaves } = persistence
  const saveNovelNow = persistence.saveNow
  const flushPendingSaves = persistence.flush
  function touchNovel(novel: Novel, timestamp = new Date().toISOString()) {
    novel.updatedAt = timestamp
    persistence.markDirty(novel.id)
  }

  // 异步初始化数据库
  async function initStore() {
    if (isInitialized.value) return
    const loaded = await loadAllNovelsFromDb()
    novels.value = loaded
    persistence.adopt()
    isInitialized.value = true
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        void flushPendingSaves().catch(() => undefined)
      })
    }
  }

  // 活跃的小说（非归档）
  const activeNovels = computed(() =>
    novels.value.filter(n => n.status !== 'archived' && n.status !== 'trash')
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  )

  // 已归档的小说
  const archivedNovels = computed(() =>
    novels.value.filter(n => n.status === 'archived')
  )
  const trashedNovels = computed(() => novels.value.filter(n => n.status === 'trash'))

  // 根据分类 value 查找显示名
  function findGenreLabels(genreValue: string, subGenreValue: string) {
    const genre = genres.find(g => g.value === genreValue)
    const subGenre = genre?.children.find(s => s.value === subGenreValue)
    return {
      genreLabel: genre?.label || genreValue,
      subGenreLabel: subGenre?.label || subGenreValue,
    }
  }

  // 创建新小说
  function addNovel(form: CreateWizardForm): Novel {
    const { genreLabel, subGenreLabel } = findGenreLabels(form.genre, form.subGenre)
    const now = new Date().toISOString()
    const novel: Novel = {
      id: generateId(),
      title: '未命名小说',
      genre: form.genre,
      subGenre: form.subGenre,
      genreLabel,
      subGenreLabel,
      tags: form.tags,
      targetWordCountMin: form.targetWordCountMin,
      targetWordCountMax: form.targetWordCountMax,
      currentWordCount: 0,
      writingStyle: { ...form.writingStyle },
      writingMode: form.writingMode === 'ai' ? 'ai' : 'manual',
      settings: JSON.parse(JSON.stringify(form.settings)),
      outline: '',
      volumes: [],
      synopsis: '',
      chapters: [],
      characters: [],
      chatHistory: [],
      inspirationHistory: [],
      knowledgeBaseIds: form.knowledgeEnabled === false ? [] : [...(form.knowledgeBaseIds || [])],
      eventLog: [],
      storyArcs: [],
      chapterPlans: [],
      storyStateProposals: [],
      dataPanels: [],
      dataPanelChanges: [],
      status: 'creating',
      createdAt: now,
      updatedAt: now,
    }
    novels.value.unshift(novel)
    persistence.markDirty(novel.id)
    return novel
  }

  // 获取单个小说
  function getNovel(id: string): Novel | undefined {
    return novels.value.find(n => n.id === id)
  }

  // 按书切换正文创作方式
  function setWritingMode(id: string, mode: NonNullable<Novel['writingMode']>) {
    const novel = getNovel(id)
    if (!novel || (mode !== 'ai' && mode !== 'manual')) return
    novel.writingMode = mode
    touchNovel(novel, new Date().toISOString())
  }

  function updateOutline(id: string, outline: string) {
    const novel = novels.value.find(n => n.id === id)
    if (novel) {
      novel.outline = outline
      touchNovel(novel, new Date().toISOString())
    }
  }

  // 设置小说状态
  function setStatus(id: string, status: Novel['status']) {
    const novel = novels.value.find(n => n.id === id)
    if (novel) {
      novel.status = status
      touchNovel(novel, new Date().toISOString())
    }
  }

  // 添加章节
  function addChapter(novelId: string, chapterData: Partial<Chapter>): Chapter | null {
    const novel = novels.value.find(n => n.id === novelId)
    if (!novel) return null
    const chapter: Chapter = {
      id: generateId(),
      volumeIndex: chapterData.volumeIndex || 0,
      chapterIndex: novel.chapters.length,
      title: chapterData.title || `第${novel.chapters.length + 1}章`,
      content: chapterData.content || '',
      summary: chapterData.summary || '',
      bannedReview: chapterData.bannedReview || '',
      contentReview: chapterData.contentReview || '',
      contentReviewSignature: chapterData.contentReviewSignature || '',
      reviewRewriteBlockedSignature: chapterData.reviewRewriteBlockedSignature || '',
      sceneNotes: chapterData.sceneNotes || [],
      versions: chapterData.versions || [],
      wordCount: countNovelWords(chapterData.content || ''),
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    novel.chapters.push(chapter)
    novel.currentWordCount = novel.chapters.reduce((sum, c) => sum + c.wordCount, 0)
    touchNovel(novel, new Date().toISOString())
    return chapter
  }

  // 更新章节
  function updateChapter(novelId: string, chapterId: string, updates: Partial<Chapter>): boolean {
    const novel = novels.value.find(n => n.id === novelId)
    if (!novel) return false
    const chapter = novel.chapters.find(c => c.id === chapterId)
    if (!chapter || chapter.status === 'locked') return false
    const before = chapterSnapshot(chapter)
    const next = { ...chapter, ...updates, wordCount: updates.content === undefined ? chapter.wordCount : countNovelWords(updates.content || '') } as Chapter
    if (before !== chapterSnapshot(next) && (updates.content !== undefined || updates.title !== undefined || updates.summary !== undefined)) {
      chapter.versions = appendSnapshot<ChapterVersion>(chapter.versions, before, '编辑前版本')
    }
    Object.assign(chapter, updates)
    if (updates.content !== undefined) {
      // 过滤空白符和换行，只统计实际文字
      chapter.wordCount = countNovelWords(updates.content)
    }
    chapter.updatedAt = new Date().toISOString()
    novel.currentWordCount = novel.chapters.reduce((sum, c) => sum + c.wordCount, 0)
    touchNovel(novel, new Date().toISOString())
    return true
  }

  function addSceneNote(novelId: string, chapterId: string, data: { title: string; content: string; source?: SceneNote['source'] }): SceneNote | null {
    const chapter = getNovel(novelId)?.chapters.find(item => item.id === chapterId)
    if (!chapter || !data.content.trim()) return null
    const now = new Date().toISOString()
    const note: SceneNote = { id: generateId(), title: data.title.trim() || '写作辅助笔记', content: data.content.trim(), source: data.source || 'user', createdAt: now, updatedAt: now }
    chapter.sceneNotes = [...(chapter.sceneNotes || []), note]
    chapter.updatedAt = now
    const novel = getNovel(novelId)
    if (novel) touchNovel(novel, now)
    return note
  }

  function restoreChapterVersion(novelId: string, chapterId: string, versionId: string): boolean {
    const novel = getNovel(novelId)
    const chapter = novel?.chapters.find(item => item.id === chapterId)
    const version = chapter?.versions?.find(item => item.id === versionId)
    if (!novel || !chapter || !version || chapter.status === 'locked') return false
    try {
      const snapshot = JSON.parse(version.snapshot) as Partial<Chapter>
      return updateChapter(novelId, chapterId, {
        title: String(snapshot.title || chapter.title), content: String(snapshot.content || ''),
        summary: String(snapshot.summary || ''), status: snapshot.status as Chapter['status'],
      })
    } catch { return false }
  }

  async function proposeChapterRevision(
    novelId: string,
    chapterId: string,
    proposedContent: string,
    source: ChapterRevisionSource = 'ai',
    reason = '',
  ): Promise<ChapterRevision | null> {
    const chapter = novels.value.find(n => n.id === novelId)?.chapters.find(c => c.id === chapterId)
    if (!chapter || chapter.status === 'locked' || chapter.content === proposedContent) return null
    return createChapterRevision(novelId, chapterId, chapter.content, proposedContent, source, reason)
  }

  async function acceptChapterRevision(novelId: string, chapterId: string, revisionId: string): Promise<ChapterRevision | null> {
    const revision = await getChapterRevision(revisionId)
    const chapter = novels.value.find(n => n.id === novelId)?.chapters.find(c => c.id === chapterId)
    if (!revision || !chapter || revision.novelId !== novelId || revision.chapterId !== chapterId) return null
    if (revision.status !== 'pending') return revision
    if (chapter.status === 'locked') throw new Error('Locked chapters cannot be changed')
    if (chapter.content !== revision.baseContent) {
      await updateChapterRevisionStatus(revision.id, 'stale')
      throw new Error('The chapter changed after this proposal was created')
    }

    updateChapter(novelId, chapterId, { content: revision.proposedContent })
    try {
      await saveNovelNow(novelId)
    } catch (err) {
      updateChapter(novelId, chapterId, { content: revision.baseContent })
      throw err
    }
    await updateChapterRevisionStatus(revision.id, 'accepted', new Date().toISOString())
    return { ...revision, status: 'accepted', appliedAt: new Date().toISOString() }
  }

  async function rejectChapterRevision(revisionId: string): Promise<void> {
    const revision = await getChapterRevision(revisionId)
    if (revision?.status === 'pending') await updateChapterRevisionStatus(revisionId, 'rejected')
  }

  async function getChapterRevisions(chapterId: string, limit = 50): Promise<ChapterRevision[]> {
    return listChapterRevisions(chapterId, limit)
  }

  // 删除小说
  async function deleteNovel(id: string) {
    const novel = novels.value.find(n => n.id === id)
    if (!novel) return
    novel.status = 'trash'
    touchNovel(novel, new Date().toISOString())
    await saveNovelNow(id)
  }

  async function purgeNovel(id: string) {
    const index = novels.value.findIndex(n => n.id === id)
    if (index !== -1) {
      await flushPendingSaves()
      await deleteNovelFromDb(id)
      novels.value = novels.value.filter(novel => novel.id !== id)
      persistence.forget(id)
    }
  }

  // Called only after the full project replacement has committed successfully.
  function adoptImportedNovels(imported: Novel[]) {
    novels.value = JSON.parse(JSON.stringify(imported))
    persistence.adopt()
  }

  function restoreNovel(id: string) {
    const novel = novels.value.find(n => n.id === id)
    if (novel?.status === 'trash') {
      novel.status = 'writing'
      touchNovel(novel, new Date().toISOString())
    }
  }

  // 归档小说
  function archiveNovel(id: string) {
    const novel = novels.value.find(n => n.id === id)
    if (novel) {
      novel.status = 'archived'
      touchNovel(novel, new Date().toISOString())
    }
  }

  // 取消归档
  function unarchiveNovel(id: string) {
    const novel = novels.value.find(n => n.id === id)
    if (novel) {
      novel.status = 'writing'
      touchNovel(novel, new Date().toISOString())
    }
  }

  // 更新小说标题
  function updateTitle(id: string, title: string) {
    const novel = novels.value.find(n => n.id === id)
    if (novel) {
      novel.title = title
      touchNovel(novel, new Date().toISOString())
    }
  }

  // 批量设置分卷（AI 生成后）
  function setVolumes(id: string, volumes: Volume[]) {
    const novel = novels.value.find(n => n.id === id)
    if (novel) {
      novel.volumes = volumes.map(volume => ({ ...volume, versions: volume.versions || [] }))
      touchNovel(novel, new Date().toISOString())
    }
  }

  function setChapterPlanConfirmed(novelId: string, confirmed: boolean) {
    const novel = novels.value.find(item => item.id === novelId)
    if (!novel) return
    novel.chapterPlanConfirmed = confirmed
    touchNovel(novel, new Date().toISOString())
  }

  // 更新分卷
  function updateVolume(novelId: string, volumeId: string, updates: Partial<Volume>) {
    const novel = novels.value.find(n => n.id === novelId)
    if (!novel) return
    const volume = novel.volumes?.find(v => v.id === volumeId)
    if (!volume) return
    const now = new Date().toISOString()
    const next = { ...volume, ...updates }
    const before = createPlanningSnapshot(volume)
    const after = createPlanningSnapshot(next)
    if (before !== after) {
      volume.versions = appendPlanningVersion(volume.versions, before, '编辑前版本', now)
    }
    Object.assign(volume, updates)
    touchNovel(novel, now)
  }

  function restoreVolumeVersion(novelId: string, volumeId: string, versionId: string): boolean {
    const novel = getNovel(novelId)
    const volume = novel?.volumes?.find(item => item.id === volumeId)
    const version = volume?.versions?.find(item => item.id === versionId)
    if (!novel || !volume || !version) return false
    try {
      const snapshot = JSON.parse(version.snapshot) as Partial<Volume>
      updateVolume(novelId, volumeId, {
        title: String(snapshot.title || volume.title), theme: String(snapshot.theme || ''),
        summary: String(snapshot.summary || ''), keyTurningPoints: String(snapshot.keyTurningPoints || ''),
        characterChanges: String(snapshot.characterChanges || ''),
        estimatedChapters: Number(snapshot.estimatedChapters) || volume.estimatedChapters,
        estimatedWordCount: Number(snapshot.estimatedWordCount) || volume.estimatedWordCount,
      })
      return true
    } catch { return false }
  }

  // 删除分卷
  function deleteVolume(novelId: string, volumeId: string) {
    const novel = novels.value.find(n => n.id === novelId)
    if (!novel || !novel.volumes) return
    const index = novel.volumes.findIndex(v => v.id === volumeId)
    if (index !== -1) {
      novel.volumes.splice(index, 1)
      // 重新排序
      novel.volumes.forEach((v, i) => v.volumeIndex = i)
      touchNovel(novel, new Date().toISOString())
    }
  }

  // 删除单个章节
  function deleteChapter(novelId: string, chapterId: string) {
    const novel = novels.value.find(n => n.id === novelId)
    if (!novel) return
    const idx = novel.chapters.findIndex(c => c.id === chapterId)
    if (idx === -1) return
    if (novel.chapters[idx].status === 'locked') return
    novel.chapters.splice(idx, 1)
    novel.chapters.forEach((c, i) => c.chapterIndex = i)
    novel.currentWordCount = novel.chapters.reduce((sum, c) => sum + c.wordCount, 0)
    touchNovel(novel, new Date().toISOString())
  }

  // 清空全部章节
  function clearChapters(novelId: string) {
    const novel = novels.value.find(n => n.id === novelId)
    if (!novel) return
    if (novel.chapters.some(chapter => chapter.status === 'locked')) return
    novel.chapters = []
    novel.currentWordCount = 0
    touchNovel(novel, new Date().toISOString())
  }

  // 角色库方法
  function addCharacter(novelId: string, charData: Partial<Character>): Character | null {
    const novel = novels.value.find(n => n.id === novelId)
    if (!novel) return null
    if (!novel.characters) novel.characters = []

    const name = cleanCharacterName(charData.name || '') || '未命名'
    const normalizedName = normalizeCharacterName(name)
    const existing = novel.characters.find(c => normalizeCharacterName(c.name) === normalizedName)
    if (existing) {
      existing.name = cleanCharacterName(existing.name) || name
      if (!existing.identity && charData.identity) existing.identity = cleanMarkdownText(charData.identity)
      if (!existing.personality && charData.personality) existing.personality = cleanMarkdownText(charData.personality)
      if (!existing.powerLevel && charData.powerLevel) existing.powerLevel = cleanMarkdownText(charData.powerLevel)
      if (!existing.faction && charData.faction) existing.faction = cleanMarkdownText(charData.faction)
      if (!existing.description && charData.description) existing.description = cleanMarkdownText(charData.description)
      if (Array.isArray(charData.relationships) && charData.relationships.length) {
        const known = new Set(existing.relationships.map(item =>
          `${item.targetId || item.targetName}|${item.relation}`,
        ))
        for (const relation of charData.relationships) {
          if (!relation?.targetName || !relation.relation) continue
          const key = `${relation.targetId || relation.targetName}|${relation.relation}`
          if (known.has(key)) continue
          existing.relationships.push({
            targetId: relation.targetId || '',
            targetName: relation.targetName,
            relation: cleanMarkdownText(relation.relation),
          })
          known.add(key)
        }
      }
      touchNovel(novel, new Date().toISOString())
      return existing
    }

    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9']
    const char: Character = {
      id: generateId(),
      name,
      aliases: charData.aliases || [],
      identity: cleanMarkdownText(charData.identity || ''),
      personality: cleanMarkdownText(charData.personality || ''),
      powerLevel: cleanMarkdownText(charData.powerLevel || ''),
      faction: cleanMarkdownText(charData.faction || ''),
      status: charData.status || '活跃',
      firstAppearChapter: charData.firstAppearChapter || 0,
      description: cleanMarkdownText(charData.description || ''),
      relationships: charData.relationships || [],
      events: charData.events || [],
      avatarColor: colors[novel.characters.length % colors.length],
    }
    novel.characters.push(char)
    touchNovel(novel, new Date().toISOString())
    return char
  }

  function updateCharacter(novelId: string, charId: string, updates: Partial<Character>) {
    const novel = novels.value.find(n => n.id === novelId)
    if (!novel) return
    const char = novel.characters?.find(c => c.id === charId)
    if (!char) return
    Object.assign(char, updates)
    touchNovel(novel, new Date().toISOString())
  }

  function deleteCharacter(novelId: string, charId: string) {
    const novel = novels.value.find(n => n.id === novelId)
    if (!novel?.characters) return
    const idx = novel.characters.findIndex(c => c.id === charId)
    if (idx !== -1) novel.characters.splice(idx, 1)
    touchNovel(novel, new Date().toISOString())
  }

  // 创建前的灵感讨论独立归档，不能被书内聊天清空或截断。
  function setInspirationHistory(novelId: string, messages: DialogueMessage[]) {
    const novel = getNovel(novelId)
    if (!novel) return
    novel.inspirationHistory = JSON.parse(JSON.stringify(messages))
    touchNovel(novel)
  }

  // AI 对话历史
  function setChatWebSearch(novelId: string, enabled: boolean) {
    const novel = getNovel(novelId)
    if (!novel) return
    novel.chatWebSearchEnabled = enabled
    touchNovel(novel, new Date().toISOString())
  }

  function addChatMessage(novelId: string, msg: DialogueMessage) {
    const novel = novels.value.find(n => n.id === novelId)
    if (!novel) return
    if (!novel.chatHistory) novel.chatHistory = []
    novel.chatHistory.push(msg)
    // 保留最近 50 条
    if (novel.chatHistory.length > 50) {
      novel.chatHistory = novel.chatHistory.slice(-50)
    }
    touchNovel(novel, new Date().toISOString())
  }

  function clearChatHistory(novelId: string) {
    const novel = novels.value.find(n => n.id === novelId)
    if (novel) {
      novel.chatHistory = []
      touchNovel(novel, new Date().toISOString())
    }
  }

  // 知识库绑定
  function bindKnowledgeBase(novelId: string, kbId: string) {
    const novel = getNovel(novelId)
    if (novel && !novel.knowledgeBaseIds?.includes(kbId)) {
      if (!novel.knowledgeBaseIds) novel.knowledgeBaseIds = []
      novel.knowledgeBaseIds.push(kbId)
      touchNovel(novel)
    }
  }

  function unbindKnowledgeBase(novelId: string, kbId: string) {
    const novel = getNovel(novelId)
    if (novel && novel.knowledgeBaseIds) {
      novel.knowledgeBaseIds = novel.knowledgeBaseIds.filter(id => id !== kbId)
      touchNovel(novel)
    }
  }

  // 事件表管理
  function addEvent(novelId: string, event: Omit<EventLogEntry, 'id' | 'timestamp'>) {
    const novel = getNovel(novelId)
    if (!novel) return null
    if (!novel.eventLog) novel.eventLog = []
    const title = event.title.trim()
    const exists = novel.eventLog.some(e =>
      e.chapterIndex === event.chapterIndex &&
      e.type === event.type &&
      e.title.trim() === title
    )
    if (exists) return null
    const now = new Date().toISOString()
    const created: EventLogEntry = {
      ...event,
      title,
      id: generateId(),
      importance: event.importance || 3,
      source: event.source || 'user',
      timestamp: now,
      updatedAt: now,
    }
    novel.eventLog.push(created)
    touchNovel(novel, now)
    return created
  }

  function deleteEvent(novelId: string, eventId: string) {
    const novel = getNovel(novelId)
    if (!novel || !novel.eventLog) return
    novel.eventLog = novel.eventLog.filter(e => e.id !== eventId)
    touchNovel(novel, new Date().toISOString())
  }

  function updateEvent(novelId: string, eventId: string, updates: Partial<Omit<EventLogEntry, 'id' | 'timestamp'>>) {
    const novel = getNovel(novelId)
    const event = novel?.eventLog?.find(item => item.id === eventId)
    if (!novel || !event) return
    const now = new Date().toISOString()
    Object.assign(event, updates, { updatedAt: now })
    touchNovel(novel, now)
  }

  function updateEventStatus(
    novelId: string,
    eventId: string,
    status: 'planted' | 'developing' | 'resolved' | 'abandoned',
    hintCount?: number,
  ) {
    const novel = getNovel(novelId)
    const event = novel?.eventLog?.find(item => item.id === eventId)
    if (!novel || !event) return
    event.status = status
    if (hintCount !== undefined) event.hintCount = hintCount
    event.updatedAt = new Date().toISOString()
    touchNovel(novel, event.updatedAt)
  }

  // 故事弧线管理
  function addStoryArc(novelId: string, data: Partial<Omit<StoryArc, 'id' | 'createdAt' | 'updatedAt'>>): StoryArc | null {
    const novel = getNovel(novelId)
    if (!novel) return null
    if (!novel.storyArcs) novel.storyArcs = []
    const now = new Date().toISOString()
    const arc: StoryArc = {
      id: generateId(),
      title: data.title?.trim() || '未命名弧线',
      description: data.description?.trim() || '',
      type: data.type || 'sub',
      importance: data.importance || 3,
      status: data.status || 'active',
      reactivateAt: data.reactivateAt?.trim() || '',
      characterIds: data.characterIds || [],
      nodes: data.nodes || [],
      createdAt: now,
      updatedAt: now,
    }
    novel.storyArcs.push(arc)
    touchNovel(novel, now)
    return arc
  }

  function updateStoryArc(novelId: string, arcId: string, updates: Partial<Omit<StoryArc, 'id' | 'createdAt'>>) {
    const novel = getNovel(novelId)
    const arc = novel?.storyArcs?.find(item => item.id === arcId)
    if (!novel || !arc) return
    const now = new Date().toISOString()
    Object.assign(arc, updates, { updatedAt: now })
    touchNovel(novel, now)
  }

  function deleteStoryArc(novelId: string, arcId: string) {
    const novel = getNovel(novelId)
    if (!novel?.storyArcs) return
    novel.storyArcs = novel.storyArcs.filter(item => item.id !== arcId)
    touchNovel(novel, new Date().toISOString())
  }

  function addStoryArcNode(
    novelId: string,
    arcId: string,
    data: Pick<StoryArcNode, 'title' | 'description' | 'targetChapter'>,
  ): StoryArcNode | null {
    const novel = getNovel(novelId)
    const arc = novel?.storyArcs?.find(item => item.id === arcId)
    if (!novel || !arc) return null
    const now = new Date().toISOString()
    const node: StoryArcNode = {
      id: generateId(),
      title: data.title.trim(),
      description: data.description.trim(),
      targetChapter: Math.max(0, data.targetChapter),
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    }
    arc.nodes.push(node)
    arc.nodes.sort((a, b) => a.targetChapter - b.targetChapter || a.createdAt.localeCompare(b.createdAt))
    arc.updatedAt = now
    touchNovel(novel, now)
    return node
  }

  function updateStoryArcNode(novelId: string, arcId: string, nodeId: string, updates: Partial<Omit<StoryArcNode, 'id' | 'createdAt'>>) {
    const novel = getNovel(novelId)
    const arc = novel?.storyArcs?.find(item => item.id === arcId)
    const node = arc?.nodes.find(item => item.id === nodeId)
    if (!novel || !arc || !node) return
    const now = new Date().toISOString()
    Object.assign(node, updates, { updatedAt: now })
    arc.nodes.sort((a, b) => a.targetChapter - b.targetChapter || a.createdAt.localeCompare(b.createdAt))
    arc.updatedAt = now
    touchNovel(novel, now)
  }

  function deleteStoryArcNode(novelId: string, arcId: string, nodeId: string) {
    const novel = getNovel(novelId)
    const arc = novel?.storyArcs?.find(item => item.id === arcId)
    if (!novel || !arc) return
    const now = new Date().toISOString()
    arc.nodes = arc.nodes.filter(item => item.id !== nodeId)
    arc.updatedAt = now
    touchNovel(novel, now)
  }

  function addChapterPlan(
    novelId: string,
    data: Omit<ChapterPlan, 'id' | 'createdAt' | 'updatedAt'>,
  ): ChapterPlan | null {
    const novel = getNovel(novelId)
    if (!novel) return null
    if (!novel.chapterPlans) novel.chapterPlans = []
    const now = new Date().toISOString()
    const start = Math.max(0, Math.round(data.targetChapterStart))
    const plan: ChapterPlan = {
      ...data,
      id: generateId(),
      title: data.title.trim(),
      objective: data.objective.trim(),
      summary: data.summary.trim(),
      beats: data.beats.map(item => item.trim()).filter(Boolean).slice(0, 12),
      targetChapterStart: start,
      targetChapterEnd: Math.max(start, Math.round(data.targetChapterEnd)),
      relatedArcIds: [...new Set(data.relatedArcIds)],
      relatedEventIds: [...new Set(data.relatedEventIds)],
      versions: data.versions || [],
      createdAt: now,
      updatedAt: now,
    }
    novel.chapterPlans.push(plan)
    touchNovel(novel, now)
    return plan
  }

  function updateChapterPlan(novelId: string, planId: string, updates: Partial<Omit<ChapterPlan, 'id' | 'createdAt'>>) {
    const novel = getNovel(novelId)
    const plan = novel?.chapterPlans?.find(item => item.id === planId)
    if (!novel || !plan) return
    const now = new Date().toISOString()
    const before = createPlanningSnapshot(plan)
    const after = createPlanningSnapshot({ ...plan, ...updates })
    if (before !== after) {
      plan.versions = appendPlanningVersion(plan.versions, before, '编辑前版本', now)
    }
    Object.assign(plan, updates, { updatedAt: now })
    plan.targetChapterStart = Math.max(0, Math.round(plan.targetChapterStart))
    plan.targetChapterEnd = Math.max(plan.targetChapterStart, Math.round(plan.targetChapterEnd))
    plan.beats = plan.beats.map(item => item.trim()).filter(Boolean).slice(0, 12)
    touchNovel(novel, now)
  }

  function restoreChapterPlanVersion(novelId: string, planId: string, versionId: string): boolean {
    const novel = getNovel(novelId)
    const plan = novel?.chapterPlans?.find(item => item.id === planId)
    const version = plan?.versions?.find(item => item.id === versionId)
    if (!novel || !plan || !version) return false
    try {
      const snapshot = JSON.parse(version.snapshot) as Partial<ChapterPlan>
      updateChapterPlan(novelId, planId, {
        horizon: snapshot.horizon, title: String(snapshot.title || plan.title), objective: String(snapshot.objective || ''),
        summary: String(snapshot.summary || ''), beats: Array.isArray(snapshot.beats) ? snapshot.beats.map(String) : [],
        targetChapterStart: Number(snapshot.targetChapterStart) || 0, targetChapterEnd: Number(snapshot.targetChapterEnd) || 0,
        status: snapshot.status as ChapterPlan['status'],
      })
      return true
    } catch { return false }
  }

  function ensureNextChapterPlan(novelId: string, completedChapterIndex: number): ChapterPlan | null {
    const novel = getNovel(novelId)
    if (!novel) return null
    const nextChapterIndex = Math.max(0, completedChapterIndex + 1)
    const existing = (novel.chapterPlans || []).find(plan =>
      plan.horizon === 'next'
      && (plan.status === 'planned' || plan.status === 'active')
      && plan.targetChapterStart <= nextChapterIndex
      && plan.targetChapterEnd >= nextChapterIndex,
    )
    if (existing) return existing

    const near = (novel.chapterPlans || []).find(plan =>
      plan.horizon === 'near'
      && (plan.status === 'planned' || plan.status === 'active')
      && plan.targetChapterEnd >= nextChapterIndex,
    )
    return addChapterPlan(novelId, {
      horizon: 'next',
      status: 'planned',
      title: `第 ${nextChapterIndex + 1} 章计划`,
      objective: near?.objective || '承接上一章结果，推动当前剧情目标继续发展',
      summary: near ? `从近期规划「${near.title}」中补齐下一章：${near.summary}` : '请在写作前补充本章冲突、推进节拍与收束条件。',
      beats: near?.beats?.slice(0, 3) || [],
      targetChapterStart: nextChapterIndex,
      targetChapterEnd: nextChapterIndex,
      relatedArcIds: near?.relatedArcIds || [],
      relatedEventIds: near?.relatedEventIds || [],
      source: 'user',
    })
  }

  function completeChapterPlans(novelId: string, chapterIndex: number): number {
    const novel = getNovel(novelId)
    if (!novel?.chapterPlans) return 0
    const now = new Date().toISOString()
    let completed = 0
    for (const plan of novel.chapterPlans) {
      if (
        plan.horizon === 'next'
        && (plan.status === 'planned' || plan.status === 'active')
        && plan.targetChapterStart <= chapterIndex
        && plan.targetChapterEnd >= chapterIndex
      ) {
        plan.status = 'completed'
        plan.updatedAt = now
        completed += 1
      }
    }
    if (completed) touchNovel(novel, now)
    return completed
  }

  function deleteChapterPlan(novelId: string, planId: string) {
    const novel = getNovel(novelId)
    if (!novel?.chapterPlans) return
    novel.chapterPlans = novel.chapterPlans.filter(item => item.id !== planId)
    if (novel.storyStateProposals) {
      novel.storyStateProposals = novel.storyStateProposals.filter(item => item.targetType !== 'chapter_plan' || item.targetId !== planId)
    }
    touchNovel(novel, new Date().toISOString())
  }

  function addStoryStateProposal(
    novelId: string,
    data: Omit<StoryStateProposal, 'id' | 'status' | 'createdAt' | 'updatedAt'>,
  ): StoryStateProposal | null {
    const novel = getNovel(novelId)
    if (!novel) return null
    if (!novel.storyStateProposals) novel.storyStateProposals = []
    const duplicate = novel.storyStateProposals.find(item =>
      item.status === 'pending' && item.targetType === data.targetType && item.targetId === data.targetId
      && item.field === data.field && item.newValue === data.newValue
    )
    if (duplicate) return duplicate
    const now = new Date().toISOString()
    const proposal: StoryStateProposal = {
      ...data,
      id: generateId(),
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    }
    novel.storyStateProposals.unshift(proposal)
    touchNovel(novel, now)
    return proposal
  }

  function applyStoryStateProposal(novelId: string, proposalId: string): boolean {
    const novel = getNovel(novelId)
    const proposal = novel?.storyStateProposals?.find(item => item.id === proposalId)
    if (!novel || !proposal || proposal.status !== 'pending') return false

    let applied = false
    if (proposal.targetType === 'story_arc') {
      const target = novel.storyArcs?.find(item => item.id === proposal.targetId)
      if (target && proposal.field === 'status' && target.status === proposal.oldValue && ['active', 'paused', 'completed', 'abandoned'].includes(proposal.newValue)) {
        target.status = proposal.newValue as StoryArc['status']
        target.updatedAt = new Date().toISOString()
        applied = true
      }
    } else if (proposal.targetType === 'arc_node') {
      const arc = novel.storyArcs?.find(item => item.id === proposal.parentId || item.nodes.some(node => node.id === proposal.targetId))
      const target = arc?.nodes.find(item => item.id === proposal.targetId)
      if (arc && target && proposal.field === 'status' && target.status === proposal.oldValue && ['pending', 'completed', 'abandoned'].includes(proposal.newValue)) {
        target.status = proposal.newValue as StoryArcNode['status']
        if (target.status === 'completed') target.actualChapter = proposal.chapterIndex
        target.updatedAt = new Date().toISOString()
        arc.updatedAt = target.updatedAt
        applied = true
      } else if (arc && target && proposal.field === 'targetChapter' && String(target.targetChapter) === proposal.oldValue && Number.isFinite(Number(proposal.newValue))) {
        target.targetChapter = Math.max(0, Math.round(Number(proposal.newValue)))
        target.updatedAt = new Date().toISOString()
        arc.updatedAt = target.updatedAt
        applied = true
      }
    } else if (proposal.targetType === 'event') {
      const target = novel.eventLog.find(item => item.id === proposal.targetId)
      if (target && proposal.field === 'status' && (target.status || 'developing') === proposal.oldValue && ['planted', 'developing', 'resolved', 'abandoned'].includes(proposal.newValue)) {
        target.status = proposal.newValue as EventLogEntry['status']
        target.updatedAt = new Date().toISOString()
        applied = true
      } else if (target && proposal.field === 'targetChapter' && String(target.targetChapter ?? target.chapterIndex) === proposal.oldValue && Number.isFinite(Number(proposal.newValue))) {
        target.targetChapter = Math.max(0, Math.round(Number(proposal.newValue)))
        target.updatedAt = new Date().toISOString()
        applied = true
      }
    } else if (proposal.targetType === 'chapter_plan') {
      const target = novel.chapterPlans?.find(item => item.id === proposal.targetId)
      if (target && proposal.field === 'status' && target.status === proposal.oldValue && ['planned', 'active', 'completed', 'archived'].includes(proposal.newValue)) {
        target.status = proposal.newValue as ChapterPlan['status']
        target.updatedAt = new Date().toISOString()
        applied = true
      }
    }

    if (!applied) return false
    proposal.status = 'accepted'
    proposal.updatedAt = new Date().toISOString()
    touchNovel(novel, proposal.updatedAt)
    return true
  }

  function rejectStoryStateProposal(novelId: string, proposalId: string) {
    const novel = getNovel(novelId)
    const proposal = novel?.storyStateProposals?.find(item => item.id === proposalId)
    if (!novel || !proposal || proposal.status !== 'pending') return
    proposal.status = 'rejected'
    proposal.updatedAt = new Date().toISOString()
    touchNovel(novel, proposal.updatedAt)
  }

  // 数据面板管理
  function addDataPanelItem(novelId: string, itemData: Omit<Partial<DataPanelItem>, 'id' | 'createdAt' | 'updatedAt'>): DataPanelItem | null {
    const novel = getNovel(novelId)
    if (!novel) return null
    if (!novel.dataPanels) novel.dataPanels = []
    const now = new Date().toISOString()
    const item: DataPanelItem = {
      id: generateId(),
      category: itemData.category || '自定义',
      name: itemData.name || '未命名数据',
      fields: itemData.fields || [],
      relatedKeywords: itemData.relatedKeywords || [],
      lastMentionChapterIndex: itemData.lastMentionChapterIndex,
      createdAt: now,
      updatedAt: now,
    }
    novel.dataPanels.push(item)
    touchNovel(novel, now)
    return item
  }

  function updateDataPanelItem(novelId: string, itemId: string, updates: Partial<DataPanelItem>) {
    const novel = getNovel(novelId)
    if (!novel?.dataPanels) return
    const item = novel.dataPanels.find(i => i.id === itemId)
    if (!item) return
    const before = dataPanelSnapshot(item)
    const after = dataPanelSnapshot({ ...item, ...updates } as DataPanelItem)
    if (before !== after) item.versions = appendSnapshot<DataPanelVersion>(item.versions, before, '编辑前版本')
    Object.assign(item, updates, { updatedAt: new Date().toISOString() })
    touchNovel(novel, new Date().toISOString())
  }

  function restoreDataPanelVersion(novelId: string, itemId: string, versionId: string): boolean {
    const novel = getNovel(novelId)
    const item = novel?.dataPanels?.find(candidate => candidate.id === itemId)
    const version = item?.versions?.find(candidate => candidate.id === versionId)
    if (!novel || !item || !version) return false
    try {
      const snapshot = JSON.parse(version.snapshot) as Partial<DataPanelItem>
      updateDataPanelItem(novelId, itemId, {
        category: snapshot.category as DataPanelItem['category'], name: String(snapshot.name || item.name),
        fields: Array.isArray(snapshot.fields) ? snapshot.fields as DataPanelItem['fields'] : item.fields,
        relatedKeywords: Array.isArray(snapshot.relatedKeywords) ? snapshot.relatedKeywords.map(String) : item.relatedKeywords,
        lastMentionChapterIndex: snapshot.lastMentionChapterIndex,
      })
      return true
    } catch { return false }
  }

  function deleteDataPanelItem(novelId: string, itemId: string) {
    const novel = getNovel(novelId)
    if (!novel?.dataPanels) return
    novel.dataPanels = novel.dataPanels.filter(i => i.id !== itemId)
    if (novel.dataPanelChanges) {
      novel.dataPanelChanges = novel.dataPanelChanges.filter(c => c.itemId !== itemId)
    }
    touchNovel(novel, new Date().toISOString())
  }

  function addDataPanelChange(novelId: string, change: Omit<DataPanelChange, 'id' | 'createdAt' | 'status'>): DataPanelChange | null {
    const novel = getNovel(novelId)
    if (!novel) return null
    if (!novel.dataPanelChanges) novel.dataPanelChanges = []
    const exists = novel.dataPanelChanges.some(c =>
      c.itemId === change.itemId &&
      c.fieldId === change.fieldId &&
      c.chapterIndex === change.chapterIndex
    )
    if (exists) return null
    const entry: DataPanelChange = {
      ...change,
      id: generateId(),
      confidence: change.confidence || 'clear',
      status: 'pending',
      createdAt: new Date().toISOString(),
    }
    novel.dataPanelChanges.unshift(entry)
    touchNovel(novel, new Date().toISOString())
    return entry
  }

  function applyDataPanelChange(novelId: string, changeId: string, newValue?: string): boolean {
    const novel = getNovel(novelId)
    if (!novel?.dataPanelChanges || !novel.dataPanels) return false
    const change = novel.dataPanelChanges.find(c => c.id === changeId)
    if (!change || change.status !== 'pending') return false
    const item = novel.dataPanels.find(i => i.id === change.itemId)
    const field = item?.fields.find(f => f.id === change.fieldId || f.name === change.fieldName)
    if (!field || !item) return false
    if (String(field.value) !== String(change.oldValue)) return false
    const value = newValue?.trim() || change.newValue
    if (!value.trim()) return false
    field.value = value
    change.newValue = value
    calculateDataPanelFields(item)
    settleDataPanelAutomationRules(item, change)
    item.lastMentionChapterIndex = change.chapterIndex
    item.updatedAt = new Date().toISOString()
    change.status = 'accepted'
    touchNovel(novel, new Date().toISOString())
    return true
  }

  function rejectDataPanelChange(novelId: string, changeId: string) {
    const novel = getNovel(novelId)
    if (!novel?.dataPanelChanges) return
    const change = novel.dataPanelChanges.find(c => c.id === changeId)
    if (!change || change.status !== 'pending') return
    const item = novel.dataPanels?.find(candidate => candidate.id === change.itemId)
    if (item) settleDataPanelAutomationRules(item, change)
    change.status = 'rejected'
    touchNovel(novel, new Date().toISOString())
  }

  function applyDataPanelChanges(novelId: string, changeIds: string[], drafts: Record<string, string> = {}): number {
    const novel = getNovel(novelId)
    if (!novel?.dataPanelChanges) return 0
    let applied = 0
    const selected = changeIds
      .map(changeId => novel.dataPanelChanges!.find(item => item.id === changeId))
      .filter((change): change is DataPanelChange => !!change && change.status === 'pending')
      .sort((a, b) => a.chapterIndex - b.chapterIndex || a.createdAt.localeCompare(b.createdAt))
    for (const change of selected) {
      const changeId = change.id
      if (applyDataPanelChange(novelId, changeId, drafts[changeId])) applied++
    }
    return applied
  }

  function rejectDataPanelChanges(novelId: string, changeIds: string[]): number {
    const novel = getNovel(novelId)
    if (!novel?.dataPanelChanges) return 0
    let rejected = 0
    for (const changeId of changeIds) {
      const change = novel.dataPanelChanges.find(item => item.id === changeId)
      if (!change || change.status !== 'pending') continue
      rejectDataPanelChange(novelId, changeId)
      rejected++
    }
    return rejected
  }

  function cleanupDataPanelChanges(novelId: string, cleanup: DataPanelHistoryCleanup): number {
    const novel = getNovel(novelId)
    if (!novel?.dataPanelChanges) return 0
    const result = pruneDataPanelChangeHistory(novel.dataPanelChanges, cleanup)
    if (!result.removed) return 0
    novel.dataPanelChanges = result.changes
    touchNovel(novel, new Date().toISOString())
    return result.removed
  }

  function queueAutomaticDataPanelChanges(novelId: string, chapterIndex: number, chapterText: string): number {
    const novel = getNovel(novelId)
    if (!novel?.dataPanels?.length) return 0
    const initialized = initializeElapsedRuleBaselines(novel.dataPanels)
    const suggestions = buildDataPanelAutomationSuggestions(novel.dataPanels, chapterIndex, chapterText)
    let added = 0
    for (const suggestion of suggestions) {
      const { rules, ...change } = suggestion
      const entry = addDataPanelChange(novelId, { ...change, confidence: 'clear' })
      if (!entry) continue
      for (const rule of rules) rule.pendingChapterIndex = chapterIndex
      added++
    }
    if (initialized || added) touchNovel(novel, new Date().toISOString())
    return added
  }

  return {
    novels,
    activeNovels,
    archivedNovels,
    trashedNovels,
    addNovel,
    getNovel,
    deleteNovel,
    purgeNovel,
    restoreNovel,
    archiveNovel,
    unarchiveNovel,
    updateTitle,
    updateOutline,
    setWritingMode,
    setStatus,
    addChapter,
    updateChapter,
    addSceneNote,
    restoreChapterVersion,
    proposeChapterRevision,
    acceptChapterRevision,
    rejectChapterRevision,
    getChapterRevisions,
    setVolumes,
    setChapterPlanConfirmed,
    updateVolume,
    restoreVolumeVersion,
    deleteVolume,
    deleteChapter,
    clearChapters,
    addCharacter,
    updateCharacter,
    deleteCharacter,
    addChatMessage,
    setInspirationHistory,
    setChatWebSearch,
    clearChatHistory,
    bindKnowledgeBase,
    unbindKnowledgeBase,
    addEvent,
    deleteEvent,
    updateEvent,
    updateEventStatus,
    addStoryArc,
    updateStoryArc,
    deleteStoryArc,
    addStoryArcNode,
    updateStoryArcNode,
    deleteStoryArcNode,
    addChapterPlan,
    updateChapterPlan,
    restoreChapterPlanVersion,
    adoptImportedNovels,
    saveError, saving, hasPendingSaves,
    deleteChapterPlan,
    completeChapterPlans,
    ensureNextChapterPlan,
    addStoryStateProposal,
    applyStoryStateProposal,
    rejectStoryStateProposal,
    addDataPanelItem,
    updateDataPanelItem,
    restoreDataPanelVersion,
    deleteDataPanelItem,
    addDataPanelChange,
    applyDataPanelChange,
    rejectDataPanelChange,
    applyDataPanelChanges,
    rejectDataPanelChanges,
    cleanupDataPanelChanges,
    queueAutomaticDataPanelChanges,
    defaultWritingStyle,
    defaultSettings,
    initStore,
    saveNovelNow,
    flushPendingSaves,
    isInitialized,
  }
})
