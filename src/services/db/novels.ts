import { queryAll, execute, initDb, runTransaction } from '../database'
import type { Chapter, EventLogEntry, Novel, StoryArc } from '@/types/novel'
import { upsertRow } from './upsert'
import { resolveChapterLengthPolicy } from '../chapterLength'
import { normalizeStoredReviewCoverage } from '../chapterReviewAcceptance'
import { usesProjectKernel, readKernelBackup } from '../projectKernelClient'
import { saveKernelNovel, deleteKernelNovel } from '../projectKernelRepository'
import { normalizeStoryClock, invalidateStoryTimeSources } from '../storyTime'

function normalizeImportance(value: unknown): 1 | 2 | 3 | 4 | 5 {
  return Math.min(5, Math.max(1, Number(value) || 3)) as 1 | 2 | 3 | 4 | 5
}

export function eventTypeToCategory(type: EventLogEntry['type'] | string | undefined): string {
  const map: Record<string, string> = {
    主线: 'main_plot',
    支线: 'sub_plot',
    伏笔: 'foreshadowing',
    转折: 'turning_point',
    战斗: 'battle',
    其他: 'other',
  }
  return type ? (map[type] || type) : 'other'
}

export function eventCategoryToType(category: string | undefined): EventLogEntry['type'] {
  const map: Record<string, EventLogEntry['type']> = {
    main_plot: '主线',
    sub_plot: '支线',
    foreshadowing: '伏笔',
    turning_point: '转折',
    battle: '战斗',
    other: '其他',
  }
  return category ? (map[category] || '其他') : '其他'
}

interface NovelRow {
  id: string; title: string; genre: string; sub_genre: string
  genre_label: string; sub_genre_label: string; tags: string
  target_min: number; target_max: number; current_word_count: number
  writing_style: string; settings: string; outline: string; synopsis: string
  writing_mode?: string
  cover_id?: string | null
  chapter_length_policy?: string
  chat_web_search?: number
  inspiration_history?: string
  knowledge_base_ids: string; chapter_plans?: string; story_state_proposals?: string; story_clock?: string
  chapter_plan_confirmed?: number
  status: string; created_at: string; updated_at: string
}

function parseLengthPolicy(value?: string): Novel['chapterLengthPolicy'] {
  try { return value ? resolveChapterLengthPolicy(JSON.parse(value)) : undefined } catch { return undefined }
}

function parseReviewCoverage(value?: string): Novel['chapters'][number]['contentReviewCoverage'] {
  try { return normalizeStoredReviewCoverage(JSON.parse(value || 'null')) } catch { return undefined }
}

function rowToNovel(row: NovelRow): Novel {
  let storyClock: Novel['storyClock'] | undefined
  try { storyClock = normalizeStoryClock(JSON.parse(row.story_clock || '{}'), row.updated_at) } catch { storyClock = undefined }
  return {
    id: row.id,
    title: row.title,
    genre: row.genre,
    subGenre: row.sub_genre,
    genreLabel: row.genre_label,
    subGenreLabel: row.sub_genre_label,
    tags: JSON.parse(row.tags || '[]'),
    targetWordCountMin: row.target_min,
    targetWordCountMax: row.target_max,
    currentWordCount: row.current_word_count,
    writingStyle: JSON.parse(row.writing_style || '{}'),
    writingMode: row.writing_mode === 'ai' || row.writing_mode === 'manual' ? row.writing_mode : undefined,
    ...(row.cover_id ? { coverId: row.cover_id } : {}),
    chapterLengthPolicy: parseLengthPolicy(row.chapter_length_policy),
    chatWebSearchEnabled: row.chat_web_search === 1,
    settings: JSON.parse(row.settings || '{}'),
    outline: row.outline || '',
    synopsis: row.synopsis || '',
    knowledgeBaseIds: JSON.parse(row.knowledge_base_ids || '[]'),
    status: row.status as Novel['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // 以下通过关联查询填充
    volumes: [],
    chapters: [],
    characters: [],
    dataPanels: [],
    dataPanelChanges: [],
    chatHistory: [],
    inspirationHistory: JSON.parse(row.inspiration_history || '[]'),
    eventLog: [],
    storyArcs: [],
    chapterPlans: JSON.parse(row.chapter_plans || '[]'),
    chapterPlanConfirmed: row.chapter_plan_confirmed === 1,
    storyStateProposals: JSON.parse(row.story_state_proposals || '[]'),
    storyClock,
  }
}

// 加载所有小说及其关联数据
export async function loadAllNovelsFromDb(): Promise<Novel[]> {
  if (usesProjectKernel()) return (await readKernelBackup()).novels.map(normalizeLoadedStoryTime)
  await initDb()
  return readAllNovelRows()
}

/** Synchronous reader for a caller-owned project transaction. */
export function readAllNovelRows(): Novel[] {
  const novelsRow = queryAll<NovelRow>('SELECT * FROM novels ORDER BY updated_at DESC')
  const novels = novelsRow.map(rowToNovel)

  for (const novel of novels) {
    // 载入分卷
    novel.volumes = queryAll<Record<string, any>>('SELECT * FROM volumes WHERE novel_id = ? ORDER BY volume_index ASC', [novel.id]).map(r => ({
      id: r.id,
      volumeIndex: r.volume_index,
      title: r.title,
      theme: r.theme,
      summary: r.summary,
      keyTurningPoints: r.key_turning_points,
      characterChanges: r.character_changes,
      estimatedChapters: r.estimated_chapters,
      estimatedWordCount: r.estimated_word_count,
      versions: JSON.parse(r.versions || '[]'),
    }))

    // 载入章节
    const chapterRows = queryAll<Record<string, any>>('SELECT * FROM chapters WHERE novel_id = ? ORDER BY chapter_index ASC', [novel.id])
    const chapters = chapterRows.map(r => ({
      id: r.id,
      volumeIndex: r.volume_index,
      chapterIndex: r.chapter_index,
      title: r.title,
      content: r.content,
      summary: r.summary,
      summarySource: r.summary_source ? JSON.parse(r.summary_source) : undefined,
      bannedReview: r.banned_review || '',
      contentReview: r.content_review || '',
      contentReviewSignature: r.content_review_signature || '',
      contentReviewCoverage: parseReviewCoverage(r.content_review_coverage),
      reviewRewriteBlockedSignature: r.review_rewrite_blocked_signature || '',
      sceneNotes: JSON.parse(r.scene_notes || '[]'),
      versions: JSON.parse(r.versions || '[]'),
      wordCount: r.word_count,
      storyDaysElapsed: Number(r.story_days_elapsed) || 0,
      storyDay: r.story_day === null || r.story_day === undefined ? undefined : Number(r.story_day),
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      ...(r.archived_at ? { archivedAt: r.archived_at as string } : {}),
    }))
    novel.chapters = chapters.filter(chapter => !chapter.archivedAt)
    const archived = chapters.filter(chapter => !!chapter.archivedAt) as NonNullable<Novel['archivedChapters']>
    if (archived.length) novel.archivedChapters = archived.sort((a, b) => a.archivedAt.localeCompare(b.archivedAt) || a.id.localeCompare(b.id))

    // 载入角色
    novel.characters = queryAll<Record<string, any>>('SELECT * FROM characters WHERE novel_id = ?', [novel.id]).map(r => ({
      id: r.id,
      name: r.name,
      aliases: JSON.parse(r.aliases || '[]'),
      identity: r.identity,
      personality: r.personality,
      powerLevel: r.power_level,
      faction: r.faction,
      status: r.status,
      firstAppearChapter: r.first_appear_chapter,
      description: r.description,
      relationships: JSON.parse(r.relationships || '[]'),
      events: JSON.parse(r.events || '[]'),
      avatarColor: r.avatar_color,
      provenance: r.provenance ? JSON.parse(r.provenance) : undefined,
      ...(r.avatar_id ? { avatarId: r.avatar_id } : {}),
    }))

    // 载入对话
    novel.chatHistory = queryAll<Record<string, any>>('SELECT * FROM chat_messages WHERE novel_id = ? ORDER BY timestamp ASC', [novel.id]).map(r => ({
      id: r.id,
      role: r.role,
      content: r.content,
      timestamp: r.timestamp,
      search: r.search_record ? JSON.parse(r.search_record) : undefined,
      failed: r.failed === 1,
    }))

    // 载入事件
    novel.eventLog = queryAll<Record<string, any>>('SELECT * FROM story_events WHERE novel_id = ? ORDER BY chapter_index ASC, created_at ASC', [novel.id]).map(r => ({
      id: r.id,
      chapterIndex: r.chapter_index,
      title: r.title,
      description: r.description,
      characters: JSON.parse(r.characters || '[]'),
      type: eventCategoryToType(r.category),
      scope: r.scope ?? undefined,
      status: r.status ?? undefined,
      hintCount: r.hint_count ?? undefined,
      storyTime: r.story_time ?? undefined,
      location: r.location ?? undefined,
      targetChapter: r.target_chapter ?? undefined,
      importance: r.importance == null ? undefined : normalizeImportance(r.importance),
      source: r.source === 'ai' ? 'ai' : 'user',
      relatedArcIds: r.related_arc_ids ? JSON.parse(r.related_arc_ids) : undefined,
      evidence: r.evidence ?? undefined,
      lastProgressChapterIndex: r.last_progress_chapter ?? undefined,
      resolvedChapterIndex: r.resolved_chapter ?? undefined,
      provenance: r.provenance ? JSON.parse(r.provenance) : undefined,
      timestamp: r.created_at,
      updatedAt: r.updated_at || r.created_at,
    }))

    // 载入跨章节叙事弧线
    novel.storyArcs = queryAll<Record<string, any>>(
      'SELECT * FROM story_arcs WHERE novel_id = ? ORDER BY importance DESC, created_at ASC',
      [novel.id],
    ).map(r => ({
      ...(() => {
        const design = JSON.parse(r.design || '{}') as Partial<StoryArc>
        return {
          ...(design.goal !== undefined ? { goal: design.goal } : {}),
          ...(design.conflict !== undefined ? { conflict: design.conflict } : {}),
          ...(design.expectedResolution !== undefined ? { expectedResolution: design.expectedResolution } : {}),
          ...(design.dependencyArcIds !== undefined ? { dependencyArcIds: design.dependencyArcIds } : {}),
          ...(design.initialState !== undefined ? { initialState: design.initialState } : {}),
          ...(design.desire !== undefined ? { desire: design.desire } : {}),
          ...(design.fear !== undefined ? { fear: design.fear } : {}),
          ...(design.falseBelief !== undefined ? { falseBelief: design.falseBelief } : {}),
          ...(design.finalState !== undefined ? { finalState: design.finalState } : {}),
          ...(design.turningPointEventIds !== undefined ? { turningPointEventIds: design.turningPointEventIds } : {}),
        }
      })(),
      id: r.id,
      title: r.title,
      description: r.description || '',
      type: r.arc_type || 'sub',
      importance: normalizeImportance(r.importance),
      status: r.status || 'active',
      reactivateAt: r.reactivate_at || '',
      characterIds: JSON.parse(r.character_ids || '[]'),
      nodes: JSON.parse(r.nodes || '[]'),
      provenance: r.provenance ? JSON.parse(r.provenance) : undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }))
    // 载入数据面板
    novel.dataPanels = queryAll<Record<string, any>>('SELECT * FROM data_panels WHERE novel_id = ? ORDER BY created_at ASC', [novel.id]).map(r => ({
      id: r.id,
      category: r.category,
      name: r.name,
      fields: JSON.parse(r.fields || '[]'),
      relatedKeywords: JSON.parse(r.related_keywords || '[]'),
      ownerItemId: r.owner_item_id || undefined,
      equipmentState: r.equipment_state || undefined,
      lastMentionChapterIndex: r.last_mention_chapter_index ?? undefined,
      referenceHistory: r.reference_history ? JSON.parse(r.reference_history) : undefined,
      versions: JSON.parse(r.versions || '[]'),
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }))

    // 载入数据变更建议
    novel.dataPanelChanges = queryAll<Record<string, any>>('SELECT * FROM data_panel_changes WHERE novel_id = ? ORDER BY created_at DESC', [novel.id]).map(r => ({
      id: r.id,
      itemId: r.item_id,
      fieldId: r.field_id,
      itemName: r.item_name,
      fieldName: r.field_name,
      oldValue: r.old_value,
      newValue: r.new_value,
      reason: r.reason,
      confidence: r.confidence || 'clear',
      mutation: r.mutation ? JSON.parse(r.mutation) : undefined,
      sourceBinding: r.source_binding ? JSON.parse(r.source_binding) : undefined,
      chapterIndex: r.chapter_index,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at || undefined
    }))

  }

  return novels.map(normalizeLoadedStoryTime)
}

function normalizeLoadedStoryTime(novel: Novel): Novel {
  novel.storyClock = normalizeStoryClock(novel.storyClock, novel.updatedAt)
  invalidateStoryTimeSources(novel)
  return novel
}

// 同步小说快照；SQL 比较已有行，仅写入变化的数据，保留未修改正文。
export async function saveNovelToDb(novel: Novel) {
  if (usesProjectKernel()) return saveKernelNovel(novel)
  await initDb()
  await runTransaction(() => writeNovelRows(novel))
}

// Synchronous SQL writer, also used by a single whole-project import transaction.
export function writeNovelRows(novel: Novel) {
    // 1. 更新主表
    upsertRow('novels', 'id, title, genre, sub_genre, genre_label, sub_genre_label, tags, target_min, target_max, current_word_count, writing_style, settings, outline, synopsis, knowledge_base_ids, chapter_plans, chapter_plan_confirmed, story_state_proposals, story_clock, status, created_at, updated_at, writing_mode, chat_web_search, inspiration_history, chapter_length_policy, cover_id', [
      novel.id, novel.title, novel.genre, novel.subGenre, novel.genreLabel, novel.subGenreLabel,
      JSON.stringify(novel.tags), novel.targetWordCountMin, novel.targetWordCountMax, novel.currentWordCount,
      JSON.stringify(novel.writingStyle), JSON.stringify(novel.settings), novel.outline, novel.synopsis,
      JSON.stringify(novel.knowledgeBaseIds), JSON.stringify(novel.chapterPlans || []), novel.chapterPlanConfirmed ? 1 : 0,
      JSON.stringify(novel.storyStateProposals || []), JSON.stringify(novel.storyClock || {}), novel.status, novel.createdAt, novel.updatedAt, novel.writingMode || null,
      novel.chatWebSearchEnabled ? 1 : 0,
      JSON.stringify(novel.inspirationHistory || []),
      novel.chapterLengthPolicy ? JSON.stringify(resolveChapterLengthPolicy(novel.chapterLengthPolicy)) : null,
      novel.coverId || null,
    ])

    // 2. 分卷：只写入有变化的行 + 删除已移除的
    const existingVolumeIds = queryAll<{ id: string }>('SELECT id FROM volumes WHERE novel_id = ?', [novel.id]).map(r => r.id)
    const currentVolumeIds = new Set(novel.volumes.map(v => v.id))
    const removedVolumeIds = existingVolumeIds.filter(id => !currentVolumeIds.has(id))
    for (const id of removedVolumeIds) {
      execute('DELETE FROM volumes WHERE id = ?', [id])
    }
    for (const v of novel.volumes) {
      upsertRow('volumes', 'id, novel_id, volume_index, title, theme, summary, key_turning_points, character_changes, estimated_chapters, estimated_word_count, versions', [v.id, novel.id, v.volumeIndex, v.title, v.theme, v.summary, v.keyTurningPoints, v.characterChanges, v.estimatedChapters, v.estimatedWordCount, JSON.stringify(v.versions || [])])
    }

    // 3. 章节：只写入有变化的行 + 删除已移除的
    const existingChapterIds = queryAll<{ id: string }>('SELECT id FROM chapters WHERE novel_id = ?', [novel.id]).map(r => r.id)
    const allChapters: Array<Chapter & { archivedAt?: string }> = [...novel.chapters, ...(novel.archivedChapters || [])]
    const currentChapterIds = new Set(allChapters.map(c => c.id))
    const removedChapterIds = existingChapterIds.filter(id => !currentChapterIds.has(id))
    for (const id of removedChapterIds) {
      execute('DELETE FROM chapter_revisions WHERE chapter_id = ?', [id])
      execute('DELETE FROM chapters WHERE id = ?', [id])
    }
    for (const c of allChapters) {
      upsertRow('chapters', 'id, novel_id, volume_index, chapter_index, title, content, summary, summary_source, banned_review, content_review, content_review_signature, content_review_coverage, review_rewrite_blocked_signature, scene_notes, versions, word_count, story_days_elapsed, story_day, status, created_at, updated_at, archived_at', [c.id, novel.id, c.volumeIndex, c.chapterIndex, c.title, c.content, c.summary, c.summarySource ? JSON.stringify(c.summarySource) : null, c.bannedReview || '', c.contentReview || '', c.contentReviewSignature || '', c.contentReviewCoverage ? JSON.stringify(c.contentReviewCoverage) : null, c.reviewRewriteBlockedSignature || '', JSON.stringify(c.sceneNotes || []), JSON.stringify(c.versions || []), c.wordCount, c.storyDaysElapsed || 0, c.storyDay ?? null, c.status, c.createdAt, c.updatedAt, c.archivedAt ?? null])
    }

    // 4. 角色：只写入有变化的行 + 删除已移除的
    const existingCharIds = queryAll<{ id: string }>('SELECT id FROM characters WHERE novel_id = ?', [novel.id]).map(r => r.id)
    const currentCharIds = new Set(novel.characters.map(c => c.id))
    const removedCharIds = existingCharIds.filter(id => !currentCharIds.has(id))
    for (const id of removedCharIds) {
      execute('DELETE FROM characters WHERE id = ?', [id])
    }
    for (const c of novel.characters) {
      upsertRow('characters', 'id, novel_id, name, aliases, identity, personality, power_level, faction, status, first_appear_chapter, description, relationships, events, avatar_color, avatar_id, provenance', [c.id, novel.id, c.name, JSON.stringify(c.aliases), c.identity, c.personality, c.powerLevel, c.faction, c.status, c.firstAppearChapter, c.description, JSON.stringify(c.relationships), JSON.stringify(c.events), c.avatarColor, c.avatarId || null, c.provenance ? JSON.stringify(c.provenance) : null])
    }

    // 5. 对话：只写入有变化的行 + 删除已移除的
    const existingMsgIds = queryAll<{ id: string }>('SELECT id FROM chat_messages WHERE novel_id = ?', [novel.id]).map(r => r.id)
    const currentMsgIds = new Set(novel.chatHistory.map(m => m.id))
    const removedMsgIds = existingMsgIds.filter(id => !currentMsgIds.has(id))
    for (const id of removedMsgIds) {
      execute('DELETE FROM chat_messages WHERE id = ?', [id])
    }
    for (const cm of novel.chatHistory) {
      upsertRow('chat_messages', 'id, novel_id, role, content, timestamp, search_record, failed', [cm.id, novel.id, cm.role, cm.content, cm.timestamp, cm.search ? JSON.stringify(cm.search) : null, cm.failed ? 1 : 0])
    }

    // 6. 事件：只写入有变化的行 + 删除已移除的
    const existingEventIds = queryAll<{ id: string }>('SELECT id FROM story_events WHERE novel_id = ?', [novel.id]).map(r => r.id)
    const currentEventIds = new Set((novel.eventLog || []).map(e => e.id))
    const removedEventIds = existingEventIds.filter(id => !currentEventIds.has(id))
    for (const id of removedEventIds) {
      execute('DELETE FROM story_events WHERE id = ?', [id])
    }
    for (const e of novel.eventLog || []) {
      const category = eventTypeToCategory(e.type)
      upsertRow('story_events', 'id, novel_id, chapter_index, category, scope, title, description, characters, status, hint_count, story_time, location, target_chapter, importance, source, related_arc_ids, evidence, last_progress_chapter, resolved_chapter, created_at, updated_at, provenance', [
        e.id, novel.id, e.chapterIndex, category, e.scope ?? null,
        e.title, e.description, JSON.stringify(e.characters), e.status ?? null, e.hintCount ?? null,
        e.storyTime ?? null, e.location ?? null, e.targetChapter ?? null, e.importance ?? null, e.source || 'user',
        e.relatedArcIds ? JSON.stringify(e.relatedArcIds) : null, e.evidence ?? null, e.lastProgressChapterIndex ?? null, e.resolvedChapterIndex ?? null,
        e.timestamp, e.updatedAt || e.timestamp, e.provenance ? JSON.stringify(e.provenance) : null
      ])
    }

    // 7. 故事弧线：节点随弧线原子保存
    const existingArcIds = queryAll<{ id: string }>('SELECT id FROM story_arcs WHERE novel_id = ?', [novel.id]).map(r => r.id)
    const currentArcIds = new Set((novel.storyArcs || []).map(arc => arc.id))
    for (const id of existingArcIds.filter(id => !currentArcIds.has(id))) {
      execute('DELETE FROM story_arcs WHERE id = ?', [id])
    }
    for (const arc of novel.storyArcs || []) {
      const design = {
        goal: arc.goal,
        conflict: arc.conflict,
        expectedResolution: arc.expectedResolution,
        dependencyArcIds: arc.dependencyArcIds,
        initialState: arc.initialState,
        desire: arc.desire,
        fear: arc.fear,
        falseBelief: arc.falseBelief,
        finalState: arc.finalState,
        turningPointEventIds: arc.turningPointEventIds,
      }
      upsertRow('story_arcs', 'id, novel_id, title, description, arc_type, importance, status, reactivate_at, character_ids, design, nodes, provenance, created_at, updated_at', [
        arc.id, novel.id, arc.title, arc.description, arc.type, arc.importance, arc.status,
        arc.reactivateAt || '', JSON.stringify(arc.characterIds || []), JSON.stringify(design), JSON.stringify(arc.nodes || []),
        arc.provenance ? JSON.stringify(arc.provenance) : null,
        arc.createdAt, arc.updatedAt,
      ])
    }

    // 8. 数据面板：只写入有变化的行 + 删除已移除的
    const existingPanelIds = queryAll<{ id: string }>('SELECT id FROM data_panels WHERE novel_id = ?', [novel.id]).map(r => r.id)
    const currentPanelIds = new Set((novel.dataPanels || []).map(i => i.id))
    const removedPanelIds = existingPanelIds.filter(id => !currentPanelIds.has(id))
    for (const id of removedPanelIds) {
      execute('DELETE FROM data_panels WHERE id = ?', [id])
    }
    for (const item of novel.dataPanels || []) {
      upsertRow('data_panels', 'id, novel_id, category, name, fields, related_keywords, owner_item_id, equipment_state, last_mention_chapter_index, versions, created_at, updated_at, reference_history', [
        item.id, novel.id, item.category, item.name, JSON.stringify(item.fields || []),
        JSON.stringify(item.relatedKeywords || []), item.ownerItemId ?? null, item.equipmentState ?? 'stored', item.lastMentionChapterIndex ?? null,
        JSON.stringify(item.versions || []), item.createdAt, item.updatedAt, item.referenceHistory ? JSON.stringify(item.referenceHistory) : null
      ])
    }

    // 9. 数据变更建议：只写入有变化的行 + 删除已移除的
    const existingChangeIds = queryAll<{ id: string }>('SELECT id FROM data_panel_changes WHERE novel_id = ?', [novel.id]).map(r => r.id)
    const currentChangeIds = new Set((novel.dataPanelChanges || []).map(c => c.id))
    const removedChangeIds = existingChangeIds.filter(id => !currentChangeIds.has(id))
    for (const id of removedChangeIds) {
      execute('DELETE FROM data_panel_changes WHERE id = ?', [id])
    }
    for (const change of novel.dataPanelChanges || []) {
      upsertRow('data_panel_changes', 'id, novel_id, item_id, field_id, item_name, field_name, old_value, new_value, reason, confidence, mutation, source_binding, chapter_index, status, created_at, updated_at', [
        change.id, novel.id, change.itemId, change.fieldId, change.itemName, change.fieldName,
        change.oldValue, change.newValue, change.reason, change.confidence || 'clear', change.mutation ? JSON.stringify(change.mutation) : null,
        change.sourceBinding ? JSON.stringify(change.sourceBinding) : null,
        change.chapterIndex, change.status, change.createdAt, change.updatedAt || null
      ])
    }
}

// 删除小说
export async function deleteNovelFromDb(novelId: string) {
  if (usesProjectKernel()) return deleteKernelNovel(novelId)
  await initDb()
  await runTransaction(() => {
    for (const table of [
      'chapter_revisions', 'chat_messages', 'data_panel_changes', 'data_panels', 'story_arcs', 'story_events',
      'characters', 'chapters', 'volumes', 'semantic_index',
      'reconstruction_impact_reports', 'reconstruction_story_memories', 'reconstruction_ai_runs', 'reconstruction_canon_mutations', 'reconstruction_chapter_reviews', 'reconstruction_review_findings', 'reconstruction_candidates', 'reconstruction_creation_drafts',
    ]) {
      execute(`DELETE FROM ${table} WHERE novel_id = ?`, [novelId])
    }
    execute('DELETE FROM novels WHERE id = ?', [novelId])
  })
}

export function clearNovelRows() {
    for (const table of [
      'chapter_revisions', 'chat_messages', 'data_panel_changes', 'data_panels', 'story_arcs', 'story_events',
      'characters', 'chapters', 'volumes', 'semantic_index',
      'reconstruction_impact_reports', 'reconstruction_story_memories', 'reconstruction_ai_runs', 'reconstruction_canon_mutations', 'reconstruction_chapter_reviews', 'reconstruction_review_findings', 'reconstruction_candidates', 'reconstruction_creation_drafts', 'novels',
    ]) {
      execute(`DELETE FROM ${table}`)
    }
}
