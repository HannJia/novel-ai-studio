import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Novel, Chapter, Volume, Character, DialogueMessage, CreateWizardForm, WritingStyle, NovelSettings, DataPanelItem, DataPanelChange, ChapterRevision, ChapterRevisionSource, EventLogEntry, StoryArc, StoryArcNode, ChapterPlan, StoryStateProposal, SceneNote, ChapterVersion, StoryClock } from '@/types/novel'
import { genres } from '@/data/genres'
import { loadAllNovelsFromDb, saveNovelToDb, deleteNovelFromDb } from '@/services/db/novels'
import { createRevisionPersistence, type PreparedPersistence } from './revisionPersistence'
import { countNovelWords } from '@/utils/format'
import { resolveChapterLengthPolicy, type ChapterLengthPolicy } from '@/services/chapterLength'
import { createChapterRevision, getChapterRevision, listChapterRevisions, updateChapterRevisionStatus } from '@/services/db/chapterRevisions'
import { pruneDataPanelChangeHistory, type DataPanelHistoryCleanup } from '@/services/dataPanel'
import { preserveDataPanelReferenceHistory } from '@/services/dataPanelReference'
import { appendPlanningVersion, createPlanningSnapshot } from '@/services/planningVersions'
import { captureDataPanelBaseline, captureDataClockBaseline as captureClockBaseline, editDataPanel, decideDataPanelProposals, queueDataPanelAutomation, editDataStoryClock } from '@/services/dataPanelTransactions'
import { bindAuthorDataPanelProposalSource, dataPanelProposalSourceIsCurrent } from '@/services/dataPanelProposalSource'
import { usesProjectKernel } from '@/services/projectKernelClient'
import { readStoryAggregate } from '@/services/storyAggregate'
import type { ChapterSelectionRevision } from '@/types/novel'
import { validateSelectionRevision } from '@/services/selectionRevisionMetadata'
import { buildChapterReviewSignature, buildReviewContextVersion } from '@/services/reconstructionReviewVersion'
import { buildBoundKnowledgeSignature } from '@/services/knowledgeContext'
import { useKnowledgeStore } from './knowledge'
import { useReconstructionWorkspaceStore } from './reconstructionWorkspace'
import { createChapterSourceBinding } from '@/services/derivedSources'
import { appendEntityRevision, captureEntityRevision } from '@/services/entityProvenance'
import type { EntityDefinitionEdit } from '@/services/entityDefinitionEditing'
import { createStoryClock, invalidateStoryTimeSources, type StoryTimeConfirmation } from '@/services/storyTime'
import { confirmDataChapterTime, confirmStoryTimeRelative } from '@/services/dataPanelTransactions'
import type { StoryImpactChange, StoryImpactKind } from '@/types/storyImpact'
import { captureStoryImpact } from '@/services/storyImpactAnalysis'
import { appendStoryImpactReport, captureStoryContextBaseline, editDefinitionsWithImpact, editNovelContextWithImpact, editStoryArcWithImpact,
  editVolumeWithImpact, editVolumeCollectionWithImpact, invalidateWrittenChapterReviews,
  type StoryContextField } from '@/services/storyImpactTransactions'
import { applyStoryArcEdit, type StoryArcEdit, type ArcEditImpact } from '@/services/storyArcEditing'
import { storyProposalSourceIsCurrent } from '@/services/storyProposalSource'
import { storyStateProposalTargetAllowed } from '@/services/storyPlanning'
import { applyChapterPlanEdit, type ChapterPlanEdit, type ChapterPlanInput } from '@/services/storyPlanTransactions'
import { captureChapterDeletionBaseline as captureDeletionBaseline, assertChapterDeletionBaseline, deleteChaptersWithImpact,
  type ChapterDeletionBaseline } from '@/services/chapterDeletionTransactions'

// 生成唯一 ID
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8)
}

function findGenreLabels(genreValue: string, subGenreValue: string) {
  const genre = genres.find(item => item.value === genreValue)
  const subGenre = genre?.children.find(item => item.value === subGenreValue)
  return { genreLabel: genre?.label || genreValue, subGenreLabel: subGenre?.label || subGenreValue }
}

/** Build a new novel without publishing it to Pinia or marking it dirty. */
export function createNovelDraft(form: CreateWizardForm, now = new Date().toISOString(), id = generateId()): Novel {
  const blank = form.creationInput?.method === 'blank'
  const genre = blank ? '' : form.genre, subGenre = blank ? '' : form.subGenre
  const { genreLabel, subGenreLabel } = findGenreLabels(genre, subGenre)
  if (form.workingTitle !== undefined && typeof form.workingTitle !== 'string') throw new Error('作品名称必须是文字')
  const origin = form.storyTimeOrigin
  if (origin !== undefined && (!origin || typeof origin !== 'object' || typeof origin.day !== 'number'
    || !Number.isFinite(origin.day) || origin.day < 0 || (origin.label !== undefined && typeof origin.label !== 'string'))) {
    throw new Error('创建时的故事起点必须是作者明确确认的有效数字。')
  }
  return {
    id,
    title: form.workingTitle?.trim() || '未命名小说',
    genre,
    subGenre,
    genreLabel,
    subGenreLabel,
    tags: blank ? [] : JSON.parse(JSON.stringify(form.tags)),
    targetWordCountMin: blank ? 0 : form.targetWordCountMin,
    targetWordCountMax: blank ? 0 : form.targetWordCountMax,
    currentWordCount: 0,
    writingStyle: blank ? defaultWritingStyle() : JSON.parse(JSON.stringify(form.writingStyle)),
    writingMode: form.writingMode === 'ai' ? 'ai' : 'manual',
    settings: blank ? defaultSettings() : JSON.parse(JSON.stringify(form.settings)),
    outline: '',
    volumes: [],
    synopsis: '',
    chapters: [],
    characters: [],
    chatHistory: [],
    inspirationHistory: [],
    knowledgeBaseIds: form.knowledgeEnabled === false ? [] : JSON.parse(JSON.stringify(form.knowledgeBaseIds || [])),
    eventLog: [],
    storyArcs: [],
    chapterPlans: [],
    storyStateProposals: [],
    dataPanels: [],
    dataPanelChanges: [],
    storyClock: origin === undefined ? undefined : createStoryClock(id, now, origin.day, origin.label),
    status: 'creating',
    createdAt: now,
    updatedAt: now,
  }
}

const copyEntity = <T extends Character | EventLogEntry | StoryArc | StoryArcNode>(entity: T): T => JSON.parse(JSON.stringify(entity))

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
  return JSON.stringify({ title: chapter.title, content: chapter.content, summary: chapter.summary, summarySource: chapter.summarySource, status: chapter.status })
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
  const deletingChapters = new Set<string>()
  function assertChapterEditAvailable(novelId: string) {
    if (deletingChapters.has(novelId)) throw new Error('章节删除正在保存，请等待完成后再编辑章节。')
  }

  const persistence = createRevisionPersistence(novels, isInitialized, async snapshot => {
    // A newly attached library must exist before validating the complete project.
    if (usesProjectKernel()) await useKnowledgeStore().flushPendingSaves()
    await saveNovelToDb(snapshot)
  })
  const { saveError, saving, hasPendingSaves } = persistence
  const saveNovelNow = persistence.saveNow
  const flushPendingSaves = persistence.flush
  async function transactNovel<R>(id: string, prepare: (draft: Novel) => Promise<PreparedPersistence<R>>): Promise<R> {
    await useKnowledgeStore().flushPendingSaves()
    return persistence.transact(id, prepare, (committed, merged) => {
      for (const chapter of merged.chapters) {
        const saved = committed.chapters.find(item => item.id === chapter.id)
        if (saved && chapter.status === saved.status && ['completed', 'reviewed', 'finalized'].includes(saved.status)
          && (chapter.content !== saved.content || chapter.title !== saved.title)) {
          chapter.status = 'writing'
          chapter.contentReviewSignature = ''
          chapter.contentReviewCoverage = undefined
        }
      }
      return merged
    })
  }
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

  // 创建新小说
  function addNovel(form: CreateWizardForm): Novel {
    const novel = createNovelDraft(form)
    novels.value.unshift(novel)
    persistence.markDirty(novel.id)
    return novel
  }

  // 获取单个小说
  function getNovel(id: string): Novel | undefined {
    return novels.value.find(n => n.id === id)
  }

  /** Publish only after the creation aggregate has been durably committed. */
  function publishCreatedNovel(novel: Novel): Novel {
    const existing = getNovel(novel.id)
    if (existing) return existing
    const published = JSON.parse(JSON.stringify(novel)) as Novel
    novels.value.unshift(published)
    return published
  }

  // 按书切换正文创作方式
  function setWritingMode(id: string, mode: NonNullable<Novel['writingMode']>) {
    const novel = getNovel(id)
    if (!novel || (mode !== 'ai' && mode !== 'manual')) return
    novel.writingMode = mode
    touchNovel(novel, new Date().toISOString())
  }

  /** 设置内置封面；传空字符串恢复按类型自动匹配。封面只影响显示，不触发影响分析或审核失效。 */
  function setCover(id: string, coverId: string) {
    const novel = getNovel(id)
    if (!novel || typeof coverId !== 'string' || coverId.length > 64) return
    if ((novel.coverId || '') === coverId) return
    if (coverId) novel.coverId = coverId
    else delete novel.coverId
    touchNovel(novel, new Date().toISOString())
  }

  function setChapterLengthPolicy(id: string, value: ChapterLengthPolicy) {
    const novel = getNovel(id)
    if (!novel) return
    novel.chapterLengthPolicy = resolveChapterLengthPolicy(value)
    touchNovel(novel, new Date().toISOString())
  }

  async function saveChapterLengthPolicy(id: string, value: ChapterLengthPolicy) {
    const policy = resolveChapterLengthPolicy(value)
    await transactNovel(id, async draft => {
      draft.chapterLengthPolicy = policy
      draft.updatedAt = new Date().toISOString()
      return { persist: () => saveNovelToDb(draft), value: undefined }
    })
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
    assertChapterEditAvailable(novelId)
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
      contentReviewCoverage: chapterData.contentReviewCoverage,
      reviewRewriteBlockedSignature: chapterData.reviewRewriteBlockedSignature || '',
      sceneNotes: chapterData.sceneNotes || [],
      versions: chapterData.versions || [],
      wordCount: countNovelWords(chapterData.content || ''),
      storyDaysElapsed: Number.isFinite(Number(chapterData.storyDaysElapsed)) ? Math.max(0, Number(chapterData.storyDaysElapsed)) : 0,
      storyDay: chapterData.storyDay,
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    chapter.summarySource = chapterData.summarySource || (chapter.summary.trim() && chapter.content.trim()
      ? createChapterSourceBinding(chapter, chapter.summary, 'author', chapter.createdAt) : undefined)
    novel.chapters.push(chapter)
    novel.currentWordCount = novel.chapters.reduce((sum, c) => sum + c.wordCount, 0)
    touchNovel(novel, new Date().toISOString())
    return chapter
  }

  // 更新章节
  function updateChapter(novelId: string, chapterId: string, updates: Partial<Chapter>): boolean {
    assertChapterEditAvailable(novelId)
    const novel = novels.value.find(n => n.id === novelId)
    if (!novel) return false
    const chapter = novel.chapters.find(c => c.id === chapterId)
    if (!chapter || chapter.status === 'locked') return false
    const before = chapterSnapshot(chapter)
    if (updates.summary !== undefined && !Object.prototype.hasOwnProperty.call(updates, 'summarySource')) {
      const sourceChapter = { ...chapter, content: updates.content ?? chapter.content }
      updates = { ...updates, summarySource: updates.summary.trim() && sourceChapter.content.trim()
        ? createChapterSourceBinding(sourceChapter, updates.summary, 'author', new Date().toISOString()) : undefined }
    }
    const next = { ...chapter, ...updates, wordCount: updates.content === undefined ? chapter.wordCount : countNovelWords(updates.content || '') } as Chapter
    if (before !== chapterSnapshot(next) && (updates.content !== undefined || updates.title !== undefined || updates.summary !== undefined)) {
      chapter.versions = appendSnapshot<ChapterVersion>(chapter.versions, before, '编辑前版本')
    }
    Object.assign(chapter, updates)
    invalidateStoryTimeSources(novel)
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
    assertChapterEditAvailable(novelId)
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

  async function restoreChapterVersion(novelId: string, chapterId: string, versionId: string, expectedChapter?: string): Promise<boolean> {
    const baseline = expectedChapter ?? JSON.stringify(getNovel(novelId)?.chapters.find(item => item.id === chapterId))
    return useReconstructionWorkspaceStore().transactStory(novelId, aggregate => {
      const { novel, workspace } = aggregate
      const chapter = novel.chapters.find(item => item.id === chapterId)
      if (!chapter || chapter.status === 'locked') throw new Error('章节不存在或已锁定。')
      if (JSON.stringify(chapter) !== baseline) throw new Error('章节已变化，请重新打开历史版本后核对。')
      const version = chapter.versions?.find(item => item.id === versionId)
      if (!version) throw new Error('历史版本不存在，请重新打开后核对。')
      let snapshot: Partial<Chapter>
      try { snapshot = JSON.parse(version.snapshot) } catch { throw new Error('历史版本格式无效，未恢复。') }
      if (!snapshot || typeof snapshot.content !== 'string'
        || snapshot.title !== undefined && typeof snapshot.title !== 'string'
        || snapshot.summary !== undefined && typeof snapshot.summary !== 'string') throw new Error('历史版本格式无效，未恢复。')
      const updates = { title: snapshot.title ?? chapter.title, content: snapshot.content, summary: snapshot.summary ?? '', summarySource: snapshot.summarySource }
      const fields = (Object.keys(updates) as Array<keyof typeof updates>).filter(field => JSON.stringify(chapter[field]) !== JSON.stringify(updates[field]))
      if (!fields.length) return false
      const before = captureStoryImpact(novel, workspace), now = new Date().toISOString()
      const signature = (item: Chapter) => buildChapterReviewSignature(item.content, buildReviewContextVersion(novel, item,
        useKnowledgeStore().knowledgeBases, workspace.creationDraft, workspace.canonMutations, workspace.storyMemories))
      const inputs = new Map(novel.chapters.filter(item => item.content.trim()).map(item => [item.id, signature(item)]))
      chapter.versions = appendSnapshot<ChapterVersion>(chapter.versions, chapterSnapshot(chapter), '恢复前版本')
      Object.assign(chapter, updates, { wordCount: countNovelWords(updates.content), updatedAt: now })
      invalidateStoryTimeSources(novel)
      if (fields.includes('content') || fields.includes('title')) {
        chapter.status = chapter.content.trim() ? 'writing' : 'draft'
        chapter.contentReviewSignature = ''; chapter.contentReviewCoverage = undefined; chapter.reviewRewriteBlockedSignature = ''
      }
      novel.currentWordCount = novel.chapters.reduce((sum, item) => sum + item.wordCount, 0)
      novel.updatedAt = now
      const unchanged = novel.chapters.filter(item => inputs.get(item.id) === signature(item)).map(item => item.id)
      const reviewChapterIds = invalidateWrittenChapterReviews(aggregate, unchanged)
      appendStoryImpactReport(aggregate, before, [{ target: { kind: 'chapter', id: chapter.id, label: chapter.title || '未命名章节' },
        action: 'update', fields }], reviewChapterIds, now, generateId, undefined, 'changed-inputs')
      return true
    }, changed => !changed)
  }

  async function saveChapterSummary(novelId: string, chapterId: string, expectedContent: string, expectedSummary: string,
    summary = expectedSummary, origin: 'ai' | 'author' = 'author'): Promise<void> {
    await useReconstructionWorkspaceStore().transactStory(novelId, aggregate => {
      const { novel, workspace } = aggregate
      const chapter = novel.chapters.find(item => item.id === chapterId)
      if (!chapter || chapter.status === 'locked') throw new Error('章节不存在或已锁定。')
      if (chapter.content !== expectedContent || chapter.summary !== expectedSummary) throw new Error('正文或总结已变化，请重新核对后保存。')
      const now = new Date().toISOString()
      const binding = summary.trim() ? createChapterSourceBinding(chapter, summary, origin, now) : undefined
      const bindingSignature = (value: Chapter['summarySource']) => value
        ? JSON.stringify([value.chapterId, value.sourceVersionId, value.derivedValue, value.origin]) : ''
      if (chapter.summary === summary && bindingSignature(chapter.summarySource) === bindingSignature(binding)) return false
      const before = captureStoryImpact(novel, workspace)
      const signature = (item: Chapter) => buildChapterReviewSignature(item.content, buildReviewContextVersion(novel, item,
        useKnowledgeStore().knowledgeBases, workspace.creationDraft, workspace.canonMutations, workspace.storyMemories))
      const inputs = new Map(novel.chapters.map(item => [item.id, signature(item)]))
      const fields = chapter.summary === summary ? ['summarySource'] : ['summary', 'summarySource']
      chapter.versions = appendSnapshot<ChapterVersion>(chapter.versions, chapterSnapshot(chapter), '更新总结前版本')
      Object.assign(chapter, { summary, summarySource: binding, updatedAt: now })
      novel.updatedAt = now
      const unchanged = novel.chapters.filter(item => inputs.get(item.id) === signature(item)).map(item => item.id)
      appendStoryImpactReport(aggregate, before, [{ target: { kind: 'chapter', id: chapter.id, label: chapter.title || '未命名章节' },
        action: 'update', fields }], invalidateWrittenChapterReviews(aggregate, unchanged), now, generateId, undefined, 'changed-inputs')
      return true
    }, changed => !changed)
  }

  async function proposeChapterRevision(
    novelId: string,
    chapterId: string,
    proposedContent: string,
    source: ChapterRevisionSource = 'ai',
    reason = '',
    options: { selection?: ChapterSelectionRevision; expectedBaseContent?: string } = {},
  ): Promise<ChapterRevision | null> {
    assertChapterEditAvailable(novelId)
    const chapter = novels.value.find(n => n.id === novelId)?.chapters.find(c => c.id === chapterId)
    if (!chapter || chapter.status === 'locked' || chapter.content === proposedContent) return null
    const baseContent = chapter.content
    if (options.expectedBaseContent !== undefined && baseContent !== options.expectedBaseContent) throw new Error('正文已经变化，请重新生成选区候选。')
    if (usesProjectKernel()) await flushPendingSaves()
    if (options.selection) {
      const currentNovel = getNovel(novelId), currentChapter = currentNovel?.chapters.find(item => item.id === chapterId)
      const expected = await readStoryAggregate(novelId)
      if (!currentNovel || !currentChapter || currentChapter.content !== baseContent
        || options.selection.contextVersion !== buildReviewContextVersion(currentNovel, currentChapter, useKnowledgeStore().knowledgeBases,
          expected.workspace.creationDraft, expected.workspace.canonMutations, expected.workspace.storyMemories)) throw new Error('正文或写作依据已经变化，请重新生成选区候选。')
    }
    return createChapterRevision(novelId, chapterId, baseContent, proposedContent, source, reason, options.selection)
  }

  async function acceptChapterRevision(novelId: string, chapterId: string, revisionId: string): Promise<ChapterRevision | null> {
    if (!getNovel(novelId)?.chapters.some(chapter => chapter.id === chapterId)) return null
    type RevisionPreparation = { revision: ChapterRevision | null; acceptedAt?: string }
    type RevisionOutcome = { kind: 'missing' | 'unchanged' | 'stale' | 'accepted'; revision: ChapterRevision | null }
    const prepared: RevisionPreparation = { revision: null }
    const outcome = await useReconstructionWorkspaceStore().transactStory<RevisionOutcome, RevisionPreparation>(
      novelId,
      (aggregate, queued) => {
        const { novel, workspace } = aggregate
        const revision = queued.revision
        const chapter = novel.chapters.find(chapter => chapter.id === chapterId)
        if (!revision || !chapter || revision.novelId !== novelId || revision.chapterId !== chapterId) return { kind: 'missing', revision: null }
        if (revision.status !== 'pending') return { kind: 'unchanged', revision }
        if (chapter.status === 'locked') throw new Error('Locked chapters cannot be changed')
        if (chapter.content !== revision.baseContent) return { kind: 'stale', revision }
        validateSelectionRevision(revision)
        if (revision.selection && revision.selection.contextVersion !== buildReviewContextVersion(novel, chapter, useKnowledgeStore().knowledgeBases,
          workspace.creationDraft, workspace.canonMutations, workspace.storyMemories)) throw new Error('写作依据已经变化，请重新生成选区候选。')

        const before = captureStoryImpact(novel, workspace)
        const now = new Date().toISOString()
        chapter.versions = appendSnapshot<ChapterVersion>(chapter.versions, chapterSnapshot(chapter), '接受修订前版本')
        Object.assign(chapter, { content: revision.proposedContent, status: 'writing', contentReviewSignature: '',
          contentReviewCoverage: undefined, reviewRewriteBlockedSignature: '', wordCount: countNovelWords(revision.proposedContent), updatedAt: now })
        invalidateStoryTimeSources(novel)
        novel.currentWordCount = novel.chapters.reduce((sum, item) => sum + item.wordCount, 0)
        novel.updatedAt = now
        const after = captureStoryImpact(novel, workspace)
        const target = after.refs.get(JSON.stringify(['chapter', chapter.id])) || before.refs.get(JSON.stringify(['chapter', chapter.id]))
        if (!target) throw new Error('找不到本次修订的影响对象，未保存。')
        appendStoryImpactReport(aggregate, before, [{ target, action: 'update', fields: ['content'] }],
          invalidateWrittenChapterReviews(aggregate), now, () => 'revision:' + revision.id + ':' + now, after)
        const accepted: ChapterRevision = { ...revision, status: 'accepted', appliedAt: now, updatedAt: now }
        queued.acceptedAt = now
        return { kind: 'accepted', revision: accepted }
      },
      value => value.kind !== 'accepted',
      undefined,
      {
        prepare: async () => {
          // This read is intentionally after both per-story queues have started.
          prepared.revision = await getChapterRevision(revisionId)
          return prepared
        },
        revisionAcceptance: value => value.acceptedAt && value.revision
          ? { expected: value.revision, acceptedAt: value.acceptedAt }
          : undefined,
      },
    )
    if (outcome.kind === 'stale' && outcome.revision) {
      await updateChapterRevisionStatus(outcome.revision.id, 'stale', undefined, 'pending')
      throw new Error('The chapter changed after this proposal was created')
    }
    return outcome.revision
  }

  async function rejectChapterRevision(revisionId: string): Promise<void> {
    const revision = await getChapterRevision(revisionId)
    if (revision?.status === 'pending') await updateChapterRevisionStatus(revisionId, 'rejected', undefined, 'pending')
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

  function deletionWorkspaceBaseline(novelId: string): string {
    const workspace = useReconstructionWorkspaceStore()
    return JSON.stringify([workspace.getCreationDraft(novelId), workspace.getCandidates(novelId), workspace.getReviewFindings(novelId),
      workspace.getChapterReviews(novelId), workspace.getCanonMutations(novelId), workspace.getStoryMemories(novelId),
      workspace.getAiRuns(novelId), workspace.getImpactReports(novelId)])
  }

  /** Capture when opening a confirmation dialog, not after the author confirms. */
  function captureChapterDeletionBaseline(novelId: string, chapterId?: string): ChapterDeletionBaseline {
    const novel = getNovel(novelId)
    if (!novel) throw new Error('作品已不存在，请重新打开。')
    return captureDeletionBaseline(novel, chapterId, deletionWorkspaceBaseline(novelId))
  }

  async function commitChapterDeletion(novelId: string, chapterId: string | undefined, opening?: ChapterDeletionBaseline): Promise<boolean> {
    const current = getNovel(novelId)
    if (!current || !current.chapters.some(chapter => chapterId === undefined || chapter.id === chapterId)) return false
    // Copy before the first await: a caller cannot retarget an enqueued request.
    const baseline = { ...(opening ?? captureChapterDeletionBaseline(novelId, chapterId)) }
    let ownsGuard = false
    try {
      return await useReconstructionWorkspaceStore().transactStory(novelId, aggregate => {
        if (!aggregate.novel.chapters.some(chapter => chapterId === undefined || chapter.id === chapterId)) return false
        const live = getNovel(novelId)
        if (!live) throw new Error('作品已不存在。')
        assertChapterDeletionBaseline(live, chapterId, baseline)
        if (deletionWorkspaceBaseline(novelId) !== baseline.workspace) throw new Error('审核或故事决定已经变化，请重新打开删除确认。')
        const changed = deleteChaptersWithImpact(aggregate, chapterId, baseline, new Date().toISOString(), generateId, useKnowledgeStore().knowledgeBases)
        if (changed) {
          deletingChapters.add(novelId); ownsGuard = true
        }
        return changed
      }, changed => !changed, () => {
        const live = getNovel(novelId)
        if (!live) throw new Error('作品已不存在。')
        assertChapterDeletionBaseline(live, chapterId, baseline)
        if (deletionWorkspaceBaseline(novelId) !== baseline.workspace) throw new Error('审核或故事决定已经变化，删除未保存。')
      })
    } finally {
      if (ownsGuard) deletingChapters.delete(novelId)
    }
  }

  function deleteChapter(novelId: string, chapterId: string, baseline?: ChapterDeletionBaseline): Promise<boolean> {
    return commitChapterDeletion(novelId, chapterId, baseline)
  }

  function clearChapters(novelId: string, baseline?: ChapterDeletionBaseline): Promise<boolean> {
    return commitChapterDeletion(novelId, undefined, baseline)
  }

  // Author definitions share the same durable transaction as review and Canon records.
  function captureDefinition<T>(value: T): T {
    if (Array.isArray(value)) return value.map(item => captureDefinition(item)) as T
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, captureDefinition(item)])) as T
    return value
  }
  async function commitEntityDefinitions(novelId: string, input: EntityDefinitionEdit[]) {
    const edits = captureDefinition(input)
    return useReconstructionWorkspaceStore().transactStory(novelId, aggregate =>
      editDefinitionsWithImpact(aggregate, edits, new Date().toISOString(), generateId))
  }

  async function commitStoryContext(novelId: string, updates: Parameters<typeof editNovelContextWithImpact>[1]['updates'], fields: StoryContextField[], baseline?: string) {
    const current = getNovel(novelId)
    if (!current) throw new Error('作品不存在，请重新打开。')
    const expectedBaseline = baseline ?? captureStoryContextBaseline(current)
    const captured = JSON.parse(JSON.stringify(updates)) as typeof updates
    return useReconstructionWorkspaceStore().transactStory(novelId, aggregate =>
      editNovelContextWithImpact(aggregate, { updates: captured, fields, expectedBaseline }, new Date().toISOString(), generateId), changed => !changed)
  }

  async function updateOutlineWithImpact(novelId: string, outline: string, baseline?: string) {
    return commitStoryContext(novelId, { outline }, ['outline'], baseline)
  }

  async function updateTitleWithImpact(novelId: string, title: string) {
    return commitStoryContext(novelId, { title }, ['title'])
  }

  function capturePlanningEditBaseline(novelId: string, volumeId?: string) {
    const novel = getNovel(novelId), volume = novel?.volumes.find(item => item.id === volumeId)
    if (!novel || (volumeId && !volume)) throw new Error('作品或分卷不存在，请重新打开。')
    return { context: captureStoryContextBaseline(novel), volumes: JSON.stringify(novel.volumes),
      volume: volume ? JSON.stringify(volume) : undefined, knowledge: buildBoundKnowledgeSignature(novel) }
  }
  function assertPlanningEditBaseline(novel: Novel, baseline: ReturnType<typeof capturePlanningEditBaseline>) {
    if (captureStoryContextBaseline(novel) !== baseline.context || buildBoundKnowledgeSignature(novel) !== baseline.knowledge) {
      throw new Error('分卷规划、作品设定或参考资料已经变化，请重新核对后再保存。')
    }
  }

  async function setVolumesWithImpact(novelId: string, volumes: Volume[], baseline = capturePlanningEditBaseline(novelId)) {
    const novel = getNovel(novelId)
    if (!novel) throw new Error('作品不存在，请重新打开。')
    const expected = { ...baseline }, captured = JSON.parse(JSON.stringify(volumes)) as Volume[]
    return useReconstructionWorkspaceStore().transactStory(novelId, aggregate => {
      assertPlanningEditBaseline(aggregate.novel, expected)
      return editVolumeCollectionWithImpact(aggregate, captured, expected.volumes, new Date().toISOString(), generateId)
    }, changed => !changed)
  }

  async function updateVolumeWithImpact(novelId: string, volumeId: string, updates: Partial<Volume>, baseline = capturePlanningEditBaseline(novelId, volumeId)) {
    const novel = getNovel(novelId), current = novel?.volumes.find(volume => volume.id === volumeId)
    if (!novel || !current) throw new Error('分卷不存在，请刷新后重试。')
    const expected = { ...baseline }, captured = JSON.parse(JSON.stringify(updates)) as Partial<Volume>
    return useReconstructionWorkspaceStore().transactStory(novelId, aggregate => {
      assertPlanningEditBaseline(aggregate.novel, expected)
      return editVolumeWithImpact(aggregate, volumeId, expected.volume, captured, new Date().toISOString(), generateId)
    }, changed => !changed)
  }

  async function deleteVolumeWithImpact(novelId: string, volumeId: string, baseline?: ReturnType<typeof capturePlanningEditBaseline>) {
    const novel = getNovel(novelId)
    if (!novel || !novel.volumes.some(volume => volume.id === volumeId)) return false
    const volumes = novel.volumes.filter(volume => volume.id !== volumeId).map((volume, index) => ({ ...volume, volumeIndex: index }))
    return setVolumesWithImpact(novelId, volumes, baseline)
  }

  async function addCharacter(novelId: string, data: Partial<Character>): Promise<Character> {
    const [result] = await commitEntityDefinitions(novelId, [{ action: 'create', kind: 'character', data }])
    return getNovel(novelId)!.characters.find(character => character.id === result.entity!.id)!
  }

  async function updateCharacter(novelId: string, charId: string, updates: Partial<Character>): Promise<void> {
    const current = getNovel(novelId)?.characters.find(character => character.id === charId)
    if (!current) throw new Error('角色已删除，请重新打开列表。')
    await saveEntityDefinition(novelId, 'character', charId, JSON.stringify(current), updates)
  }

  async function deleteCharacter(novelId: string, charId: string, expectedEntity?: string): Promise<void> {
    const current = getNovel(novelId)?.characters.find(character => character.id === charId)
    if (!current) throw new Error('角色已删除，请重新打开列表。')
    await commitEntityDefinitions(novelId, [{ action: 'delete', kind: 'character', entityId: charId, expectedEntity: expectedEntity ?? JSON.stringify(current) }])
  }

  async function saveEntityDefinition(novelId: string, kind: 'character' | 'event', entityId: string, expectedEntity: string,
    updates: Partial<Character> | Partial<EventLogEntry>): Promise<void> {
    await commitEntityDefinitions(novelId, [{ action: 'update', kind, entityId, expectedEntity, updates }])
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

  // Event definitions use the author decision transaction, including status-only edits.
  async function addEvent(novelId: string, data: Omit<EventLogEntry, 'id' | 'timestamp'>): Promise<EventLogEntry> {
    const [result] = await commitEntityDefinitions(novelId, [{ action: 'create', kind: 'event', data }])
    return getNovel(novelId)!.eventLog.find(event => event.id === result.entity!.id)!
  }

  async function deleteEvent(novelId: string, eventId: string, expectedEntity?: string): Promise<void> {
    const current = getNovel(novelId)?.eventLog.find(event => event.id === eventId)
    if (!current) throw new Error('事件已删除，请重新打开列表。')
    await commitEntityDefinitions(novelId, [{ action: 'delete', kind: 'event', entityId: eventId, expectedEntity: expectedEntity ?? JSON.stringify(current) }])
  }

  async function updateEvent(novelId: string, eventId: string, updates: Partial<Omit<EventLogEntry, 'id' | 'timestamp'>>): Promise<void> {
    const current = getNovel(novelId)?.eventLog.find(event => event.id === eventId)
    if (!current) throw new Error('事件已删除，请重新打开列表。')
    await saveEntityDefinition(novelId, 'event', eventId, JSON.stringify(current), updates)
  }

  async function updateEventStatus(novelId: string, eventId: string, status: 'planted' | 'developing' | 'resolved' | 'abandoned', hintCount?: number): Promise<void> {
    await updateEvent(novelId, eventId, hintCount === undefined ? { status } : { status, hintCount })
  }

  // Arc edits are published only after the aggregate commits.
  async function commitStoryArcEdit(novelId: string, input: StoryArcEdit): Promise<ArcEditImpact> {
    const edit = JSON.parse(JSON.stringify(input)) as StoryArcEdit
    return useReconstructionWorkspaceStore().transactStory(novelId, aggregate =>
      editStoryArcWithImpact(aggregate, edit, new Date().toISOString(), generateId))
  }

  async function commitChapterPlanEdit(novelId: string, input: ChapterPlanEdit) {
    const edit = JSON.parse(JSON.stringify(input)) as ChapterPlanEdit
    const result = await useReconstructionWorkspaceStore().transactStory(novelId, aggregate =>
      applyChapterPlanEdit(aggregate, edit, new Date().toISOString(), generateId), value => !value.changed)
    return result.created || null
  }

  async function addChapterPlanWithImpact(novelId: string, data: ChapterPlanInput): Promise<ChapterPlan | null> {
    return commitChapterPlanEdit(novelId, { action: 'create', data })
  }

  async function updateChapterPlanWithImpact(novelId: string, planId: string, updates: Partial<Omit<ChapterPlan, 'id' | 'createdAt'>>) {
    const plan = getNovel(novelId)?.chapterPlans?.find(item => item.id === planId)
    if (!plan) throw new Error('章节计划已删除，请重新打开。')
    await commitChapterPlanEdit(novelId, { action: 'update', planId, expectedPlan: JSON.stringify(plan), updates })
  }

  async function deleteChapterPlanWithImpact(novelId: string, planId: string): Promise<boolean> {
    const plan = getNovel(novelId)?.chapterPlans?.find(item => item.id === planId)
    if (!plan) return false
    await commitChapterPlanEdit(novelId, { action: 'delete', planId, expectedPlan: JSON.stringify(plan) })
    return true
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
        plan.status = 'awaiting_review'
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
      && item.field === data.field && item.newValue === data.newValue && item.chapterIndex === data.chapterIndex
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

  async function applyStoryStateProposal(novelId: string, proposalId: string): Promise<boolean> {
    return useReconstructionWorkspaceStore().transactStory(novelId, aggregate => {
    const { novel, workspace } = aggregate
    const unchanged = () => false
    const proposal = novel?.storyStateProposals?.find(item => item.id === proposalId)
    if (!proposal || proposal.status !== 'pending') return unchanged()
    const chapter = novel.chapters.find(item => item.chapterIndex === proposal.chapterIndex)
    if (!storyProposalSourceIsCurrent(novel, proposal)) return unchanged()
    if (proposal.source === 'ai' && (!chapter || !storyStateProposalTargetAllowed(novel, chapter, proposal))) return unchanged()
    const now = new Date().toISOString()
    const before = captureStoryImpact(novel, workspace)

    let applied = false
    let impactKind: StoryImpactKind
    let impactId = proposal.targetId
    let impactAction: StoryImpactChange['action'] = 'update'
    let impactFields: string[] = [proposal.field]
    if (proposal.targetType === 'story_arc') {
      impactKind = 'arc'
      const target = novel.storyArcs?.find(item => item.id === proposal.targetId)
      if (target && proposal.field === 'status' && target.status === proposal.oldValue && ['active', 'paused', 'completed', 'abandoned'].includes(proposal.newValue)) {
        const before = copyEntity(target)
        target.status = proposal.newValue as StoryArc['status']
        appendEntityRevision(target, captureEntityRevision('arc', before, target, proposal.source === 'ai' ? proposal.chapterSource! : { kind: 'author' }, now, 'proposal-entity:' + proposal.id, ['status']))
        target.updatedAt = new Date().toISOString()
        impactAction = 'confirm'; impactFields = ['status']
        applied = true
      }
    } else if (proposal.targetType === 'arc_node') {
      impactKind = 'node'
      const arc = novel.storyArcs?.find(item => item.id === proposal.parentId || item.nodes.some(node => node.id === proposal.targetId))
      const target = arc?.nodes.find(item => item.id === proposal.targetId)
      if (arc && target && proposal.field === 'status' && target.status === proposal.oldValue && ['pending', 'completed', 'abandoned'].includes(proposal.newValue)) {
        if (proposal.newValue === 'completed' && !proposal.chapterSource) return unchanged()
        applyStoryArcEdit(novel, { action: 'node_status', arcId: arc.id, nodeId: target.id, expectedArc: JSON.stringify(arc),
          status: proposal.newValue as 'pending' | 'completed' | 'abandoned', source: proposal.chapterSource }, now, generateId)
        impactAction = 'confirm'; impactFields = ['status', 'actualChapter']
        applied = true
      } else if (arc && target && proposal.field === 'targetChapter' && String(target.targetChapter) === proposal.oldValue && Number.isFinite(Number(proposal.newValue))) {
        const before = copyEntity(target)
        target.targetChapter = Math.max(0, Math.round(Number(proposal.newValue)))
        appendEntityRevision(target, captureEntityRevision('arc_node', before, target, proposal.source === 'ai' ? proposal.chapterSource! : { kind: 'author' }, now, 'proposal-entity:' + proposal.id, ['targetChapter']))
        target.updatedAt = new Date().toISOString()
        arc.updatedAt = target.updatedAt
        impactFields = ['targetChapter']
        applied = true
      }
    } else if (proposal.targetType === 'event') {
      impactKind = 'event'
      const target = novel.eventLog.find(item => item.id === proposal.targetId)
      const before = target ? copyEntity(target) : undefined
      let updated = target
      if (proposal.field === 'create' && proposal.eventDraft && chapter
        && !novel.eventLog.some(item => item.type === '伏笔' && item.status !== 'abandoned'
          && item.title.trim().toLocaleLowerCase() === proposal.eventDraft?.title.trim().toLocaleLowerCase())) {
        const draft = proposal.eventDraft
        updated = {
          id: generateId(), timestamp: now, updatedAt: now,
          chapterIndex: proposal.chapterIndex, title: draft.title, description: draft.description,
          characters: draft.characters, type: '伏笔', scope: 'global', status: 'planted',
          targetChapter: draft.targetChapter, importance: 3, source: proposal.source,
          relatedArcIds: draft.relatedArcIds.filter(id => novel.storyArcs?.some(arc => arc.id === id)),
          evidence: proposal.evidence, lastProgressChapterIndex: proposal.chapterIndex,
          hintCount: 1,
        }
        novel.eventLog.push(updated)
        impactId = updated.id; impactAction = 'create'; impactFields = ['$exists']
        applied = true
      } else if (target && proposal.field === 'status' && (target.status || 'developing') === proposal.oldValue && ['planted', 'developing', 'resolved', 'abandoned'].includes(proposal.newValue)) {
        target.status = proposal.newValue as EventLogEntry['status']
        target.lastProgressChapterIndex = proposal.chapterIndex
        if (target.status === 'resolved') target.resolvedChapterIndex = proposal.chapterIndex
        target.updatedAt = new Date().toISOString()
        impactAction = 'confirm'; impactFields = ['status', 'lastProgressChapterIndex', ...(target.status === 'resolved' ? ['resolvedChapterIndex'] : [])]
        applied = true
      } else if (target && proposal.field === 'targetChapter' && String(target.targetChapter ?? target.chapterIndex) === proposal.oldValue && Number.isFinite(Number(proposal.newValue))) {
        target.targetChapter = Math.max(0, Math.round(Number(proposal.newValue)))
        target.updatedAt = new Date().toISOString()
        impactFields = ['targetChapter']
        applied = true
      }
      if (applied && updated) {
        const fields = proposal.field === 'status' ? ['status', 'lastProgressChapterIndex', ...(updated.status === 'resolved' ? ['resolvedChapterIndex'] : [])]
          : proposal.field === 'targetChapter' ? ['targetChapter'] : undefined
        appendEntityRevision(updated, captureEntityRevision('event', before, updated,
          proposal.source === 'ai' ? proposal.chapterSource! : { kind: 'author' }, now, 'proposal-entity:' + proposal.id, fields))
      }
    } else if (proposal.targetType === 'chapter_plan') {
      impactKind = 'plan'
      const target = novel.chapterPlans?.find(item => item.id === proposal.targetId)
      if (target && proposal.field === 'status' && target.status === proposal.oldValue && ['planned', 'active', 'awaiting_review', 'completed', 'archived'].includes(proposal.newValue)) {
        target.status = proposal.newValue as ChapterPlan['status']
        target.updatedAt = new Date().toISOString()
        impactAction = 'confirm'; impactFields = ['status']
        applied = true
      }
    }

    if (!applied) return unchanged()
    const reviewChapterIds = invalidateWrittenChapterReviews(aggregate)
    proposal.status = 'accepted'
    proposal.updatedAt = now
    novel.updatedAt = now
    const after = captureStoryImpact(novel, workspace)
    const targetKey = JSON.stringify([impactKind!, impactId])
    const target = after.refs.get(targetKey) || before.refs.get(targetKey)
    if (!target) throw new Error('找不到本次状态提案对应的剧情对象，未保存。')
    appendStoryImpactReport(aggregate, before, [{ target, action: impactAction, fields: impactFields }], reviewChapterIds,
      now, generateId, after)
    return true
    }, value => value === false)
  }

  async function rejectStoryStateProposal(novelId: string, proposalId: string): Promise<boolean> {
    return useReconstructionWorkspaceStore().transactStory(novelId, ({ novel }) => {
      const proposal = novel.storyStateProposals?.find(item => item.id === proposalId)
      if (!proposal || proposal.status !== 'pending') return false
      proposal.status = 'rejected'
      proposal.updatedAt = new Date().toISOString()
      novel.updatedAt = proposal.updatedAt
      return true
    }, changed => !changed)
  }

  // Data operations publish only after the aggregate has been saved.
  function captureDataPanelEditBaseline(novelId: string, itemId = ''): string {
    const novel = getNovel(novelId)
    return novel ? captureDataPanelBaseline(novel, itemId) : ''
  }
  function captureDataClockBaseline(novelId: string): string {
    const novel = getNovel(novelId)
    return novel ? captureClockBaseline(novel) : ''
  }
  const copyDataUpdates = (value: Partial<DataPanelItem>): Partial<DataPanelItem> => Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, entry === undefined ? undefined : JSON.parse(JSON.stringify(entry))]))

  async function addDataPanelItem(novelId: string, itemData: Omit<Partial<DataPanelItem>, 'id' | 'createdAt' | 'updatedAt'>, expectedBaseline = captureDataPanelEditBaseline(novelId)): Promise<DataPanelItem | null> {
    if (!getNovel(novelId)) return null
    const baseline = expectedBaseline, item = copyDataUpdates(itemData)
    const outcome = await useReconstructionWorkspaceStore().transactStory(novelId, aggregate =>
      editDataPanel(aggregate, { action: 'create', item }, baseline, new Date().toISOString(), generateId), result => !result.changed)
    const saved = outcome.item
    return saved ? getNovel(novelId)?.dataPanels.find(row => row.id === saved.id) || null : null
  }
  async function updateDataPanelItem(novelId: string, itemId: string, updates: Partial<DataPanelItem>, expectedBaseline = captureDataPanelEditBaseline(novelId, itemId)): Promise<boolean> {
    if (!getNovel(novelId)) return false
    const item = copyDataUpdates(updates)
    const outcome = await useReconstructionWorkspaceStore().transactStory(novelId, aggregate =>
      editDataPanel(aggregate, { action: 'update', itemId, item }, expectedBaseline, new Date().toISOString(), generateId), result => !result.changed)
    return Boolean(outcome.item)
  }
  async function restoreDataPanelVersion(novelId: string, itemId: string, versionId: string, expectedBaseline = captureDataPanelEditBaseline(novelId, itemId)): Promise<boolean> {
    if (!getNovel(novelId)) return false
    const outcome = await useReconstructionWorkspaceStore().transactStory(novelId, aggregate =>
      editDataPanel(aggregate, { action: 'restore', itemId, versionId }, expectedBaseline, new Date().toISOString(), generateId), result => !result.changed)
    return Boolean(outcome.item)
  }
  async function deleteDataPanelItem(novelId: string, itemId: string, expectedBaseline = captureDataPanelEditBaseline(novelId, itemId)): Promise<boolean> {
    if (!getNovel(novelId)) return false
    const outcome = await useReconstructionWorkspaceStore().transactStory(novelId, aggregate =>
      editDataPanel(aggregate, { action: 'delete', itemId }, expectedBaseline, new Date().toISOString(), generateId), result => !result.changed)
    return Boolean(outcome.item)
  }
  /** Explicit author-created suggestion; model results must use commitChapterAnalysis. */
  async function addDataPanelChange(novelId: string, input: Omit<DataPanelChange, 'id' | 'createdAt' | 'status'>): Promise<DataPanelChange | null> {
    const sourceNovel = getNovel(novelId)
    if (!sourceNovel) return null
    const change = JSON.parse(JSON.stringify(input)) as typeof input
    const now = new Date().toISOString()
    const entry: DataPanelChange = { ...change, id: generateId(), sourceBinding: bindAuthorDataPanelProposalSource(sourceNovel, change), confidence: change.confidence || 'clear', status: 'pending', createdAt: now }
    const saved = await useReconstructionWorkspaceStore().transactStory(novelId, ({ novel }) => {
      if (novel.dataPanelChanges.some(row => change.mutation?.kind === 'create' && row.mutation?.kind === 'create'
        ? row.itemName === change.itemName && (row.status === 'pending' || row.chapterIndex === change.chapterIndex)
        : row.itemId === change.itemId && row.fieldId === change.fieldId && row.chapterIndex === change.chapterIndex)) return null
      if (!dataPanelProposalSourceIsCurrent(novel, entry)) throw new Error('数据提案的目标已变化，请重新核对后提交。')
      novel.dataPanelChanges.unshift(entry); novel.updatedAt = now
      return entry
    }, result => !result)
    return saved ? getNovel(novelId)?.dataPanelChanges.find(row => row.id === saved.id) || null : null
  }
  async function applyDataPanelChange(novelId: string, changeId: string, newValue?: string): Promise<boolean> {
    return Boolean(await applyDataPanelChanges(novelId, [changeId], newValue === undefined ? {} : { [changeId]: newValue }))
  }
  async function rejectDataPanelChange(novelId: string, changeId: string): Promise<boolean> {
    return Boolean(await rejectDataPanelChanges(novelId, [changeId]))
  }
  async function applyDataPanelChanges(novelId: string, changeIds: string[], drafts: Record<string, string> = {}): Promise<number> {
    if (!getNovel(novelId)) return 0
    const ids = [...changeIds], values = { ...drafts }
    return useReconstructionWorkspaceStore().transactStory(novelId, aggregate =>
      decideDataPanelProposals(aggregate, ids, 'accept', values, new Date().toISOString(), generateId), count => !count)
  }
  async function rejectDataPanelChanges(novelId: string, changeIds: string[]): Promise<number> {
    if (!getNovel(novelId)) return 0
    const ids = [...changeIds]
    return useReconstructionWorkspaceStore().transactStory(novelId, aggregate =>
      decideDataPanelProposals(aggregate, ids, 'reject', {}, new Date().toISOString(), generateId), count => !count)
  }
  async function cleanupDataPanelChanges(novelId: string, cleanup: DataPanelHistoryCleanup): Promise<number> {
    if (!getNovel(novelId)) return 0
    const captured = { ...cleanup }
    return useReconstructionWorkspaceStore().transactStory(novelId, ({ novel }) => {
      const result = pruneDataPanelChangeHistory(novel.dataPanelChanges, captured)
      if (result.removed) {
        preserveDataPanelReferenceHistory(novel)
        novel.dataPanelChanges = result.changes; novel.updatedAt = new Date().toISOString()
      }
      return result.removed
    }, count => !count)
  }
  async function queueAutomaticDataPanelChanges(novelId: string, chapterIndex: number, expectedContent: string): Promise<number> {
    const sourceNovel = getNovel(novelId)
    if (!sourceNovel) return 0
    const sourceChapterId = sourceNovel.chapters.find(chapter => chapter.chapterIndex === chapterIndex)?.id
    const result = await useReconstructionWorkspaceStore().transactStory(novelId, ({ novel }) => {
      if (!sourceChapterId || !novel.chapters.some(chapter => chapter.id === sourceChapterId && chapter.chapterIndex === chapterIndex)) {
        throw new Error('自动推算所依据的章节已变化，请重新核对。')
      }
      return queueDataPanelAutomation(novel, chapterIndex, expectedContent, new Date().toISOString(), generateId)
    }, result => !result.changed)
    return result.added
  }
  async function advanceStoryClock(novelId: string, elapsedDays: number, chapterIndex?: number): Promise<StoryClock | null> {
    const novel = getNovel(novelId)
    if (!novel) return null
    if (!Number.isFinite(elapsedDays) || elapsedDays < 0) throw new Error('经过天数必须是有效的非负数字。')
    const chapter = novel.chapters.find(row => row.chapterIndex === chapterIndex)
    if (!chapter) throw new Error('相对推进必须明确指定章节。')
    const baseline = captureClockBaseline(novel), chapterId = chapter.id
    const outcome = await useReconstructionWorkspaceStore().transactStory(novelId, aggregate =>
      confirmStoryTimeRelative(aggregate, chapterId, elapsedDays, baseline, new Date().toISOString(), generateId), result => !result.changed)
    return outcome.clock
  }
  async function confirmChapterStoryTime(novelId: string, input: Omit<StoryTimeConfirmation, 'source'>, baseline: string): Promise<StoryClock | null> {
    if (!getNovel(novelId)) return null
    const outcome = await useReconstructionWorkspaceStore().transactStory(novelId, aggregate =>
      confirmDataChapterTime(aggregate, { ...input, source: 'author' }, baseline, new Date().toISOString(), generateId), result => !result.changed)
    return outcome.clock
  }
  async function setStoryClock(novelId: string, currentDay: number, label?: string, expectedBaseline = captureDataClockBaseline(novelId)): Promise<StoryClock | null> {
    if (!getNovel(novelId)) return null
    const outcome = await useReconstructionWorkspaceStore().transactStory(novelId, aggregate =>
      editDataStoryClock(aggregate, currentDay, label, expectedBaseline, new Date().toISOString(), generateId), result => !result.changed)
    return outcome.clock
  }

  return {
    capturePlanningEditBaseline,
    novels,
    activeNovels,
    archivedNovels,
    trashedNovels,
    addNovel,
    getNovel,
    publishCreatedNovel,
    deleteNovel,
    purgeNovel,
    restoreNovel,
    archiveNovel,
    unarchiveNovel,
    updateTitle,
    updateOutline,
    updateTitleWithImpact,
    updateOutlineWithImpact,
    setWritingMode,
    setCover,
    setChapterLengthPolicy,
    saveChapterLengthPolicy,
    setStatus,
    addChapter,
    updateChapter,
    saveChapterSummary,
    addSceneNote,
    restoreChapterVersion,
    proposeChapterRevision,
    acceptChapterRevision,
    rejectChapterRevision,
    getChapterRevisions,
    setVolumes,
    setVolumesWithImpact,
    setChapterPlanConfirmed,
    updateVolume,
    updateVolumeWithImpact,
    restoreVolumeVersion,
    deleteVolume,
    deleteVolumeWithImpact,
    deleteChapter,
    captureChapterDeletionBaseline,
    clearChapters,
    addCharacter,
    updateCharacter,
    saveEntityDefinition,
    commitEntityDefinitions,
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
    commitStoryArcEdit,
    commitChapterPlanEdit,
    addChapterPlanWithImpact,
    updateChapterPlanWithImpact,
    deleteChapterPlanWithImpact,
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
    captureDataPanelEditBaseline,
    captureDataClockBaseline,
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
    advanceStoryClock,
    confirmChapterStoryTime,
    setStoryClock,
    defaultWritingStyle,
    defaultSettings,
    initStore,
    saveNovelNow,
    transactNovel,
    flushPendingSaves,
    isInitialized,
  }
})
