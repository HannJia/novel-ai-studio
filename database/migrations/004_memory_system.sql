-- =============================================
-- 阶段四：记忆系统数据库表
-- 创建日期：2026-01-16
-- =============================================

USE novel_ai_studio;

-- 章节摘要表（L2短期记忆）
CREATE TABLE IF NOT EXISTS chapter_summaries (
    id VARCHAR(36) PRIMARY KEY COMMENT '摘要ID(UUID)',
    chapter_id VARCHAR(36) NOT NULL UNIQUE COMMENT '章节ID',
    book_id VARCHAR(36) NOT NULL COMMENT '所属书籍ID',
    chapter_order INT NOT NULL COMMENT '章节序号',
    summary TEXT NOT NULL COMMENT '摘要内容（500-1000字）',
    key_events JSON COMMENT '关键事件列表',
    characters_appeared JSON COMMENT '出场角色ID列表',
    emotional_tone VARCHAR(50) COMMENT '情感基调',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_book_id (book_id),
    INDEX idx_chapter_order (book_id, chapter_order),
    CONSTRAINT fk_summaries_chapter FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
    CONSTRAINT fk_summaries_book FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='章节摘要表（L2短期记忆）';

-- 故事事件表（L3长期记忆）
CREATE TABLE IF NOT EXISTS story_events (
    id VARCHAR(36) PRIMARY KEY COMMENT '事件ID(UUID)',
    book_id VARCHAR(36) NOT NULL COMMENT '所属书籍ID',
    chapter_id VARCHAR(36) NOT NULL COMMENT '所属章节ID',
    chapter_order INT NOT NULL COMMENT '章节序号',
    title VARCHAR(200) NOT NULL COMMENT '事件标题',
    description TEXT COMMENT '事件描述',
    event_type VARCHAR(20) DEFAULT 'minor' COMMENT '事件类型：major/minor/background',
    involved_characters JSON COMMENT '涉及角色ID列表',
    location VARCHAR(200) COMMENT '发生地点',
    timeline_order INT COMMENT '故事内时间顺序',
    impact TEXT COMMENT '事件影响',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_book_id (book_id),
    INDEX idx_chapter_id (chapter_id),
    INDEX idx_timeline (book_id, timeline_order),
    INDEX idx_event_type (book_id, event_type),
    CONSTRAINT fk_events_book FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
    CONSTRAINT fk_events_chapter FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='故事事件表（L3长期记忆）';

-- 角色状态变更记录表
CREATE TABLE IF NOT EXISTS character_state_changes (
    id VARCHAR(36) PRIMARY KEY COMMENT '记录ID(UUID)',
    character_id VARCHAR(36) NOT NULL COMMENT '角色ID',
    book_id VARCHAR(36) NOT NULL COMMENT '所属书籍ID',
    chapter_id VARCHAR(36) NOT NULL COMMENT '章节ID',
    chapter_order INT NOT NULL COMMENT '章节序号',
    field VARCHAR(50) NOT NULL COMMENT '变更字段',
    old_value TEXT COMMENT '旧值',
    new_value TEXT COMMENT '新值',
    reason VARCHAR(500) COMMENT '变更原因',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_character_id (character_id),
    INDEX idx_book_id (book_id),
    INDEX idx_chapter_order (character_id, chapter_order),
    CONSTRAINT fk_state_changes_character FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
    CONSTRAINT fk_state_changes_book FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色状态变更记录表';

-- 确保伏笔表存在（如果之前没有创建）
CREATE TABLE IF NOT EXISTS foreshadows (
    id VARCHAR(36) PRIMARY KEY COMMENT '伏笔ID(UUID)',
    book_id VARCHAR(36) NOT NULL COMMENT '所属书籍ID',
    title VARCHAR(200) NOT NULL COMMENT '伏笔标题',
    type VARCHAR(20) NOT NULL COMMENT '类型：prophecy/item/character/event/hint',
    importance VARCHAR(20) DEFAULT 'minor' COMMENT '重要性：major/minor/subtle',
    status VARCHAR(20) DEFAULT 'planted' COMMENT '状态：planted/partial/resolved/abandoned',
    planted_chapter INT NOT NULL COMMENT '埋设章节序号',
    planted_chapter_id VARCHAR(36) NOT NULL COMMENT '埋设章节ID',
    planted_text TEXT COMMENT '埋设原文',
    expected_resolve VARCHAR(500) COMMENT '预期回收点',
    related_characters JSON COMMENT '相关角色ID列表',
    resolution_chapters JSON COMMENT '回收章节序号列表',
    resolution_notes TEXT COMMENT '回收说明',
    source VARCHAR(20) DEFAULT 'manual' COMMENT '来源：manual/ai_detected',
    confidence DECIMAL(5,4) COMMENT 'AI识别置信度',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_book_id (book_id),
    INDEX idx_status (book_id, status),
    INDEX idx_importance (book_id, importance),
    INDEX idx_planted_chapter (book_id, planted_chapter),
    CONSTRAINT fk_foreshadows_book FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='伏笔表';

-- 更新已有表的索引（如果需要）
-- ALTER TABLE chapters ADD INDEX idx_summary (book_id, summary(100)) IF NOT EXISTS;
