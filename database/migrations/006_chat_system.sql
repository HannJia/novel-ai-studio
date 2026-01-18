-- =============================================
-- NovelAI Studio 数据库迁移 006
-- AI对话系统
-- =============================================

USE novel_ai_studio;

-- 对话会话表
CREATE TABLE IF NOT EXISTS chat_sessions (
    id VARCHAR(36) PRIMARY KEY COMMENT '会话ID(UUID)',
    book_id VARCHAR(36) COMMENT '关联书籍ID（可选）',
    title VARCHAR(200) NOT NULL DEFAULT '新对话' COMMENT '会话标题',
    context_type VARCHAR(50) DEFAULT 'general' COMMENT '上下文类型：general/book/chapter/character',
    context_ref_id VARCHAR(36) COMMENT '上下文关联ID（章节ID或角色ID等）',
    ai_config_id VARCHAR(36) COMMENT '使用的AI配置ID',
    message_count INT UNSIGNED DEFAULT 0 COMMENT '消息数量',
    token_count INT UNSIGNED DEFAULT 0 COMMENT '累计Token消耗',
    is_pinned TINYINT(1) DEFAULT 0 COMMENT '是否置顶',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    INDEX idx_book_id (book_id),
    INDEX idx_context (context_type, context_ref_id),
    INDEX idx_created_at (created_at DESC),
    INDEX idx_pinned (is_pinned DESC, updated_at DESC),
    CONSTRAINT fk_chat_sessions_book FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE SET NULL,
    CONSTRAINT fk_chat_sessions_config FOREIGN KEY (ai_config_id) REFERENCES ai_configs(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI对话会话表';

-- 对话消息表
CREATE TABLE IF NOT EXISTS chat_messages (
    id VARCHAR(36) PRIMARY KEY COMMENT '消息ID(UUID)',
    session_id VARCHAR(36) NOT NULL COMMENT '所属会话ID',
    role VARCHAR(20) NOT NULL COMMENT '角色：user/assistant/system',
    content TEXT NOT NULL COMMENT '消息内容',
    reasoning TEXT COMMENT 'AI推理过程（如有）',
    token_count INT UNSIGNED DEFAULT 0 COMMENT '消息Token数',
    model VARCHAR(100) COMMENT '使用的模型',
    duration INT UNSIGNED COMMENT '生成耗时（毫秒）',
    is_error TINYINT(1) DEFAULT 0 COMMENT '是否为错误消息',
    metadata JSON COMMENT '额外元数据',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    INDEX idx_session_id (session_id),
    INDEX idx_session_created (session_id, created_at),
    INDEX idx_role (role),
    CONSTRAINT fk_chat_messages_session FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI对话消息表';

-- AI任务分配配置表
CREATE TABLE IF NOT EXISTS ai_task_assignments (
    id VARCHAR(36) PRIMARY KEY COMMENT '配置ID(UUID)',
    task_type VARCHAR(50) NOT NULL COMMENT '任务类型：generate/review/summary/chat/outline',
    ai_config_id VARCHAR(36) NOT NULL COMMENT 'AI配置ID',
    priority INT DEFAULT 0 COMMENT '优先级（数字越大优先级越高）',
    is_enabled TINYINT(1) DEFAULT 1 COMMENT '是否启用',
    conditions JSON COMMENT '应用条件（如特定书籍类型）',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_task_type (task_type),
    INDEX idx_enabled_priority (is_enabled, priority DESC),
    CONSTRAINT fk_task_assignments_config FOREIGN KEY (ai_config_id) REFERENCES ai_configs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI任务分配配置表';

-- 为ai_configs表添加用于对话的字段（如果不存在）
ALTER TABLE ai_configs
ADD COLUMN IF NOT EXISTS is_chat_enabled TINYINT(1) DEFAULT 1 COMMENT '是否启用对话功能';

-- 插入默认任务分配（使用默认AI配置）
-- 注意：这里使用子查询获取默认配置ID
INSERT INTO ai_task_assignments (id, task_type, ai_config_id, priority, is_enabled)
SELECT
    UUID(),
    task_type,
    (SELECT id FROM ai_configs WHERE is_default = 1 LIMIT 1),
    1,
    1
FROM (
    SELECT 'generate' AS task_type UNION ALL
    SELECT 'review' UNION ALL
    SELECT 'summary' UNION ALL
    SELECT 'chat' UNION ALL
    SELECT 'outline'
) AS tasks
WHERE EXISTS (SELECT 1 FROM ai_configs WHERE is_default = 1)
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP;
