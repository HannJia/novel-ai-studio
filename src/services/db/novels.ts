import { queryAll, execute, initDb, runTransaction } from '../database'
import type { EventLogEntry, Novel } from '@/types/novel'
import { upsertRow } from './upsert'

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
  chat_web_search?: number
  inspiration_history?: string
  knowledge_base_ids: string; chapter_plans?: string; story_state_proposals?: string
  chapter_plan_confirmed?: number
  status: string; created_at: string; updated_at: string
}

function rowToNovel(row: NovelRow): Novel {
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
  }
}

// 加载所有小说及其关联数据
export async function loadAllNovelsFromDb(): Promise<Novel[]> {
  await initDb()
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
    novel.chapters = queryAll<Record<string, any>>('SELECT * FROM chapters WHERE novel_id = ? ORDER BY chapter_index ASC', [novel.id]).map(r => ({
      id: r.id,
      volumeIndex: r.volume_index,
      chapterIndex: r.chapter_index,
      title: r.title,
      content: r.content,
      summary: r.summary,
      bannedReview: r.banned_review || '',
      contentReview: r.content_review || '',
      contentReviewSignature: r.content_review_signature || '',
      sceneNotes: JSON.parse(r.scene_notes || '[]'),
      versions: JSON.parse(r.versions || '[]'),
      wordCount: r.word_count,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }))

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
      avatarColor: r.avatar_color
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
      scope: r.scope,
      status: r.status,
      hintCount: r.hint_count,
      storyTime: r.story_time || '',
      location: r.location || '',
      targetChapter: r.target_chapter ?? undefined,
      importance: normalizeImportance(r.importance),
      source: r.source === 'ai' ? 'ai' : 'user',
      timestamp: r.created_at,
      updatedAt: r.updated_at || r.created_at,
    }))

    // 载入跨章节叙事弧线
    novel.storyArcs = queryAll<Record<string, any>>(
      'SELECT * FROM story_arcs WHERE novel_id = ? ORDER BY importance DESC, created_at ASC',
      [novel.id],
    ).map(r => ({
      id: r.id,
      title: r.title,
      description: r.description || '',
      type: r.arc_type || 'sub',
      importance: normalizeImportance(r.importance),
      status: r.status || 'active',
      reactivateAt: r.reactivate_at || '',
      characterIds: JSON.parse(r.character_ids || '[]'),
      nodes: JSON.parse(r.nodes || '[]'),
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
      lastMentionChapterIndex: r.last_mention_chapter_index ?? undefined,
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
      chapterIndex: r.chapter_index,
      status: r.status,
      createdAt: r.created_at
    }))

  }

  return novels
}

// 同步小说快照；SQL 比较已有行，仅写入变化的数据，保留未修改正文。
export async function saveNovelToDb(novel: Novel) {
  await initDb()
  await runTransaction(() => writeNovelRows(novel))
}

// Synchronous SQL writer, also used by a single whole-project import transaction.
export function writeNovelRows(novel: Novel) {
    // 1. 更新主表
    upsertRow('novels', 'id, title, genre, sub_genre, genre_label, sub_genre_label, tags, target_min, target_max, current_word_count, writing_style, settings, outline, synopsis, knowledge_base_ids, chapter_plans, chapter_plan_confirmed, story_state_proposals, status, created_at, updated_at, writing_mode, chat_web_search, inspiration_history', [
      novel.id, novel.title, novel.genre, novel.subGenre, novel.genreLabel, novel.subGenreLabel,
      JSON.stringify(novel.tags), novel.targetWordCountMin, novel.targetWordCountMax, novel.currentWordCount,
      JSON.stringify(novel.writingStyle), JSON.stringify(novel.settings), novel.outline, novel.synopsis,
      JSON.stringify(novel.knowledgeBaseIds), JSON.stringify(novel.chapterPlans || []), novel.chapterPlanConfirmed ? 1 : 0,
      JSON.stringify(novel.storyStateProposals || []), novel.status, novel.createdAt, novel.updatedAt, novel.writingMode || null,
      novel.chatWebSearchEnabled ? 1 : 0,
      JSON.stringify(novel.inspirationHistory || []),
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
    const currentChapterIds = new Set(novel.chapters.map(c => c.id))
    const removedChapterIds = existingChapterIds.filter(id => !currentChapterIds.has(id))
    for (const id of removedChapterIds) {
      execute('DELETE FROM chapter_revisions WHERE chapter_id = ?', [id])
      execute('DELETE FROM chapters WHERE id = ?', [id])
    }
    for (const c of novel.chapters) {
      upsertRow('chapters', 'id, novel_id, volume_index, chapter_index, title, content, summary, banned_review, content_review, content_review_signature, scene_notes, versions, word_count, status, created_at, updated_at', [c.id, novel.id, c.volumeIndex, c.chapterIndex, c.title, c.content, c.summary, c.bannedReview || '', c.contentReview || '', c.contentReviewSignature || '', JSON.stringify(c.sceneNotes || []), JSON.stringify(c.versions || []), c.wordCount, c.status, c.createdAt, c.updatedAt])
    }

    // 4. 角色：只写入有变化的行 + 删除已移除的
    const existingCharIds = queryAll<{ id: string }>('SELECT id FROM characters WHERE novel_id = ?', [novel.id]).map(r => r.id)
    const currentCharIds = new Set(novel.characters.map(c => c.id))
    const removedCharIds = existingCharIds.filter(id => !currentCharIds.has(id))
    for (const id of removedCharIds) {
      execute('DELETE FROM characters WHERE id = ?', [id])
    }
    for (const c of novel.characters) {
      upsertRow('characters', 'id, novel_id, name, aliases, identity, personality, power_level, faction, status, first_appear_chapter, description, relationships, events, avatar_color', [c.id, novel.id, c.name, JSON.stringify(c.aliases), c.identity, c.personality, c.powerLevel, c.faction, c.status, c.firstAppearChapter, c.description, JSON.stringify(c.relationships), JSON.stringify(c.events), c.avatarColor])
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
      upsertRow('story_events', 'id, novel_id, chapter_index, category, scope, title, description, characters, status, hint_count, story_time, location, target_chapter, importance, source, created_at, updated_at', [
        e.id, novel.id, e.chapterIndex, category, e.scope || 'chapter',
        e.title, e.description, JSON.stringify(e.characters), e.status || 'resolved', e.hintCount || 0,
        e.storyTime || '', e.location || '', e.targetChapter ?? null, e.importance || 3, e.source || 'user',
        e.timestamp, e.updatedAt || e.timestamp
      ])
    }

    // 7. 故事弧线：节点随弧线原子保存
    const existingArcIds = queryAll<{ id: string }>('SELECT id FROM story_arcs WHERE novel_id = ?', [novel.id]).map(r => r.id)
    const currentArcIds = new Set((novel.storyArcs || []).map(arc => arc.id))
    for (const id of existingArcIds.filter(id => !currentArcIds.has(id))) {
      execute('DELETE FROM story_arcs WHERE id = ?', [id])
    }
    for (const arc of novel.storyArcs || []) {
      upsertRow('story_arcs', 'id, novel_id, title, description, arc_type, importance, status, reactivate_at, character_ids, nodes, created_at, updated_at', [
        arc.id, novel.id, arc.title, arc.description, arc.type, arc.importance, arc.status,
        arc.reactivateAt || '', JSON.stringify(arc.characterIds || []), JSON.stringify(arc.nodes || []),
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
      upsertRow('data_panels', 'id, novel_id, category, name, fields, related_keywords, last_mention_chapter_index, versions, created_at, updated_at', [
        item.id, novel.id, item.category, item.name, JSON.stringify(item.fields || []),
        JSON.stringify(item.relatedKeywords || []), item.lastMentionChapterIndex ?? null, JSON.stringify(item.versions || []), item.createdAt, item.updatedAt
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
      upsertRow('data_panel_changes', 'id, novel_id, item_id, field_id, item_name, field_name, old_value, new_value, reason, confidence, chapter_index, status, created_at', [
        change.id, novel.id, change.itemId, change.fieldId, change.itemName, change.fieldName,
        change.oldValue, change.newValue, change.reason, change.confidence || 'clear', change.chapterIndex, change.status, change.createdAt
      ])
    }
}

// 删除小说
export async function deleteNovelFromDb(novelId: string) {
  await initDb()
  await runTransaction(() => {
    for (const table of ['chapter_revisions', 'chat_messages', 'data_panel_changes', 'data_panels', 'story_arcs', 'story_events', 'characters', 'chapters', 'volumes', 'semantic_index']) {
      execute(`DELETE FROM ${table} WHERE novel_id = ?`, [novelId])
    }
    execute('DELETE FROM novels WHERE id = ?', [novelId])
  })
}

export function clearNovelRows() {
    for (const table of ['chapter_revisions', 'chat_messages', 'data_panel_changes', 'data_panels', 'story_arcs', 'story_events', 'characters', 'chapters', 'volumes', 'semantic_index', 'novels']) {
      execute(`DELETE FROM ${table}`)
    }
}
