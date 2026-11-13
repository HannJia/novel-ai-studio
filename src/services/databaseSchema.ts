import type { Database } from 'sql.js'

export const PROJECT_SCHEMA_VERSION = 3
export class UnsupportedProjectSchemaError extends Error {
  constructor() { super('仅支持 V3 项目数据，请在 V3 中新建项目。原数据文件未修改。'); this.name = 'UnsupportedProjectSchemaError' }
}

const PROJECT_SCHEMA = `
    CREATE TABLE IF NOT EXISTS project_history (
      revision TEXT PRIMARY KEY, created_at TEXT NOT NULL, label TEXT NOT NULL,
      novel_id TEXT NOT NULL, source_revision TEXT, value TEXT NOT NULL,
      project_ids TEXT
    );
    CREATE TABLE IF NOT EXISTS inspiration_sessions (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS cloud_sync_state (
      id TEXT PRIMARY KEY, value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cloud_sync_conflicts (
      id TEXT PRIMARY KEY, value TEXT NOT NULL, created_at TEXT NOT NULL
    );

    -- 小说主表
    CREATE TABLE IF NOT EXISTS novels (
      id TEXT PRIMARY KEY,
      title TEXT,
      genre TEXT, sub_genre TEXT,
      genre_label TEXT, sub_genre_label TEXT,
      tags TEXT,           -- JSON 数组
      target_min INTEGER, target_max INTEGER,
      current_word_count INTEGER DEFAULT 0,
      writing_style TEXT,  -- JSON
      settings TEXT,       -- JSON
      outline TEXT,
      synopsis TEXT,
      knowledge_base_ids TEXT, -- JSON 数组
      chapter_plans TEXT DEFAULT '[]', -- next / near / far 章节计划
      chapter_plan_confirmed INTEGER DEFAULT 0,
      story_state_proposals TEXT DEFAULT '[]', -- 待审批的故事状态变更
      story_clock TEXT DEFAULT '{}', -- JSON
      status TEXT DEFAULT 'creating',
      created_at TEXT, updated_at TEXT,
      writing_mode TEXT,
      chapter_length_policy TEXT,
      cover_id TEXT,
      chat_web_search INTEGER DEFAULT 0,
      inspiration_history TEXT NOT NULL DEFAULT '[]'
    );

    -- 分卷表
    CREATE TABLE IF NOT EXISTS volumes (
      id TEXT PRIMARY KEY,
      novel_id TEXT REFERENCES novels(id) ON DELETE CASCADE,
      volume_index INTEGER,
      title TEXT, theme TEXT, summary TEXT,
      key_turning_points TEXT, character_changes TEXT,
      estimated_chapters INTEGER, estimated_word_count INTEGER,
      versions TEXT DEFAULT '[]'
    );

    -- 章节表
    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY,
      novel_id TEXT REFERENCES novels(id) ON DELETE CASCADE,
      volume_index INTEGER, chapter_index INTEGER,
      title TEXT, content TEXT, summary TEXT,
      summary_source TEXT,
      banned_review TEXT DEFAULT '', content_review TEXT DEFAULT '',
      content_review_signature TEXT DEFAULT '',
      review_rewrite_blocked_signature TEXT DEFAULT '',
      scene_notes TEXT DEFAULT '[]',
      versions TEXT DEFAULT '[]',
      word_count INTEGER DEFAULT 0,
      story_days_elapsed REAL DEFAULT 0,
      story_day REAL,
      status TEXT DEFAULT 'draft',
      archived_at TEXT,
      created_at TEXT, updated_at TEXT,
      content_review_coverage TEXT
    );

    -- AI or user-proposed chapter changes. Proposals are applied only after approval.
    CREATE TABLE IF NOT EXISTS chapter_revisions (
      id TEXT PRIMARY KEY,
      novel_id TEXT REFERENCES novels(id) ON DELETE CASCADE,
      chapter_id TEXT REFERENCES chapters(id) ON DELETE CASCADE,
      base_content TEXT NOT NULL,
      proposed_content TEXT NOT NULL,
      diff TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'user',
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      applied_at TEXT,
      selection_json TEXT
    );

    -- 角色表
    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      novel_id TEXT REFERENCES novels(id) ON DELETE CASCADE,
      name TEXT, aliases TEXT,
      identity TEXT, personality TEXT,
      power_level TEXT, faction TEXT,
      status TEXT DEFAULT '活跃',
      first_appear_chapter INTEGER,
      description TEXT, relationships TEXT, -- JSON
      events TEXT, avatar_color TEXT, avatar_id TEXT, provenance TEXT
    );

    -- 剧情时间线事件
    CREATE TABLE IF NOT EXISTS story_events (
      id TEXT PRIMARY KEY,
      novel_id TEXT REFERENCES novels(id) ON DELETE CASCADE,
      chapter_index INTEGER,
      category TEXT,        -- main_plot/sub_plot/foreshadowing/turning_point/battle/other
      scope TEXT DEFAULT 'chapter', -- global/volume/chapter
      title TEXT,
      description TEXT,
      characters TEXT,      -- JSON 数组
      status TEXT,          -- planted/developing/resolved/abandoned
      hint_count INTEGER DEFAULT 0,
      story_time TEXT DEFAULT '',
      location TEXT DEFAULT '',
      target_chapter INTEGER,
      importance INTEGER DEFAULT 3,
      source TEXT DEFAULT 'user',
      related_arc_ids TEXT DEFAULT '[]',
      evidence TEXT DEFAULT '',
      last_progress_chapter INTEGER,
      resolved_chapter INTEGER,
      provenance TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    -- 跨章节叙事弧线；节点以 JSON 保存，随弧线一起原子更新。
    CREATE TABLE IF NOT EXISTS story_arcs (
      id TEXT PRIMARY KEY,
      novel_id TEXT REFERENCES novels(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      arc_type TEXT NOT NULL DEFAULT 'sub',
      importance INTEGER NOT NULL DEFAULT 3,
      status TEXT NOT NULL DEFAULT 'active',
      reactivate_at TEXT DEFAULT '',
      character_ids TEXT DEFAULT '[]',
      design TEXT DEFAULT '{}',
      nodes TEXT DEFAULT '[]',
      provenance TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 数据面板对象表
    CREATE TABLE IF NOT EXISTS data_panels (
      id TEXT PRIMARY KEY,
      novel_id TEXT REFERENCES novels(id) ON DELETE CASCADE,
      category TEXT,
      name TEXT,
      fields TEXT,
      related_keywords TEXT,
      owner_item_id TEXT,
      equipment_state TEXT DEFAULT 'stored',
      last_mention_chapter_index INTEGER,
      created_at TEXT,
      updated_at TEXT,
      versions TEXT DEFAULT '[]',
      reference_history TEXT
    );

    -- 数据面板变更建议表
    CREATE TABLE IF NOT EXISTS data_panel_changes (
      id TEXT PRIMARY KEY,
      novel_id TEXT REFERENCES novels(id) ON DELETE CASCADE,
      item_id TEXT,
      field_id TEXT,
      item_name TEXT,
      field_name TEXT,
      old_value TEXT,
      new_value TEXT,
      reason TEXT,
      confidence TEXT DEFAULT 'clear',
      mutation TEXT,
      source_binding TEXT,
      chapter_index INTEGER,
      status TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    -- AI 对话历史表
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      novel_id TEXT REFERENCES novels(id) ON DELETE CASCADE,
      role TEXT, content TEXT,
      timestamp TEXT,
      search_record TEXT,
      failed INTEGER DEFAULT 0
    );

    -- 知识库表
    CREATE TABLE IF NOT EXISTS knowledge_bases (
      id TEXT PRIMARY KEY,
      name TEXT,
      description TEXT,
      created_at TEXT,
      summary TEXT DEFAULT '',
      summary_level TEXT DEFAULT 'standard',
      summary_updated_at TEXT DEFAULT '',
      summary_source TEXT,
      summary_history TEXT
    );

    -- 知识库条目表
    CREATE TABLE IF NOT EXISTS knowledge_entries (
      id TEXT PRIMARY KEY,
      kb_id TEXT REFERENCES knowledge_bases(id) ON DELETE CASCADE,
      category TEXT,
      title TEXT,
      content TEXT,
      summary TEXT DEFAULT '',
      tags TEXT, -- JSON
      created_at TEXT,
      updated_at TEXT,
      summary_source TEXT,
      summary_history TEXT
    );

    -- 语义记忆索引：知识库、章节摘要、角色、事件、数据面板统一召回
    CREATE TABLE IF NOT EXISTS semantic_index (
      id TEXT PRIMARY KEY,
      novel_id TEXT,
      source_type TEXT,
      source_id TEXT,
      title TEXT,
      content TEXT,
      embedding TEXT,
      metadata TEXT,
      updated_at TEXT
    );

    -- AI 后台任务记录：用于批量任务、失败排查和重启后的任务状态保留
    CREATE TABLE IF NOT EXISTS ai_tasks (
      id TEXT PRIMARY KEY,
      name TEXT,
      group_name TEXT,
      status TEXT,
      error TEXT,
      created_at TEXT,
      updated_at TEXT,
      completed_at TEXT
    );

    -- V3 创作工作区：保存契约、规划、审校和作者确认边界。
    CREATE TABLE IF NOT EXISTS reconstruction_editor_drafts (
      novel_id TEXT NOT NULL,
      id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      status TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (novel_id, id)
    );
    -- Keep all current project deletes and restores transactional.
    CREATE TRIGGER IF NOT EXISTS delete_novel_editor_drafts AFTER DELETE ON novels
    BEGIN
      DELETE FROM reconstruction_editor_drafts WHERE novel_id = OLD.id;
    END;

    CREATE TABLE IF NOT EXISTS reconstruction_creation_drafts (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reconstruction_candidates (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      chapter_id TEXT,
      status TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reconstruction_review_findings (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      status TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reconstruction_chapter_reviews (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      source_version_id TEXT NOT NULL,
      status TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reconstruction_story_memories (
      id TEXT NOT NULL,
      novel_id TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (novel_id, id)
    );

    CREATE TABLE IF NOT EXISTS reconstruction_impact_reports (
      id TEXT NOT NULL,
      novel_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (novel_id, id)
    );

    CREATE TABLE IF NOT EXISTS reconstruction_canon_mutations (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL UNIQUE,
      novel_id TEXT NOT NULL,
      value TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );

    -- V3 AI runs: one novel may have multiple runs, keyed by (novel_id, id).
    -- The value column keeps the complete AiRun contract while the scalar
    -- columns make the current state available for future queries.
    CREATE TABLE IF NOT EXISTS reconstruction_ai_runs (
      id TEXT NOT NULL,
      novel_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      task_type TEXT NOT NULL,
      target_id TEXT,
      chapter_start INTEGER,
      chapter_end INTEGER,
      token_budget INTEGER,
      used_tokens INTEGER,
      status TEXT NOT NULL,
      checkpoint TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (novel_id, id)
    );

    CREATE INDEX IF NOT EXISTS idx_novels_updated_at ON novels(updated_at);
    CREATE INDEX IF NOT EXISTS idx_chapters_novel_index ON chapters(novel_id, chapter_index);
    CREATE INDEX IF NOT EXISTS idx_story_events_novel_category_status ON story_events(novel_id, category, status);
    CREATE INDEX IF NOT EXISTS idx_story_arcs_novel_status ON story_arcs(novel_id, status, importance);
    CREATE INDEX IF NOT EXISTS idx_knowledge_entries_kb_category ON knowledge_entries(kb_id, category);
    CREATE INDEX IF NOT EXISTS idx_data_panel_changes_novel_status_chapter ON data_panel_changes(novel_id, status, chapter_index);
    CREATE INDEX IF NOT EXISTS idx_semantic_index_novel_source ON semantic_index(novel_id, source_type);
    CREATE INDEX IF NOT EXISTS idx_ai_tasks_status_created ON ai_tasks(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_chapter_revisions_chapter_status ON chapter_revisions(chapter_id, status, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_reconstruction_creation_novel ON reconstruction_creation_drafts(novel_id);
    CREATE INDEX IF NOT EXISTS idx_reconstruction_candidates_novel_chapter ON reconstruction_candidates(novel_id, chapter_id, status);
    CREATE INDEX IF NOT EXISTS idx_reconstruction_findings_novel_chapter ON reconstruction_review_findings(novel_id, chapter_id, status);
    CREATE INDEX IF NOT EXISTS idx_reconstruction_reviews_novel_chapter ON reconstruction_chapter_reviews(novel_id, chapter_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_reconstruction_mutations_novel_applied ON reconstruction_canon_mutations(novel_id, applied_at);
    CREATE INDEX IF NOT EXISTS idx_reconstruction_ai_runs_novel_updated ON reconstruction_ai_runs(novel_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_reconstruction_impact_reports_novel_created ON reconstruction_impact_reports(novel_id, created_at, id);

    PRAGMA user_version = 3;
`
const TABLE_COLUMNS: Record<string, string[]> = Object.fromEntries([...PROJECT_SCHEMA.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\);/g)].map(match => [match[1], match[2].replace(/--[^\n]*/g, '').split(',').map(part => part.trim().match(/^(\w+)\s+(?:TEXT|INTEGER|REAL|BLOB)\b/)?.[1]).filter((name): name is string => !!name)]))

export function assertCurrentSchema(database: Database): void {
  if (database.exec('PRAGMA user_version')[0]?.values[0]?.[0] !== PROJECT_SCHEMA_VERSION) throw new UnsupportedProjectSchemaError()
  for (const [table, expected] of Object.entries(TABLE_COLUMNS)) {
    const columns = new Set(database.exec('PRAGMA table_info(' + table + ')')[0]?.values.map(row => row[1]) || [])
    if (expected.some(column => !columns.has(column))) throw new UnsupportedProjectSchemaError()
  }
}

export function initializeSchema(database: Database): boolean {
  const version = database.exec('PRAGMA user_version')[0]?.values[0]?.[0]
  const tables = database.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")[0]?.values || []
  if (tables.length) { assertCurrentSchema(database); return false }
  if (version !== 0) throw new UnsupportedProjectSchemaError()
  database.exec(PROJECT_SCHEMA)
  assertCurrentSchema(database)
  return true
}
