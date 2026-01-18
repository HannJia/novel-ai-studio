-- =============================================
-- NovelAI Studio 审查系统表结构
-- 阶段五：逻辑审查功能
-- =============================================

USE novel_ai_studio;

-- 审查问题表
CREATE TABLE IF NOT EXISTS review_issues (
    id VARCHAR(36) PRIMARY KEY COMMENT '问题ID(UUID)',
    book_id VARCHAR(36) NOT NULL COMMENT '所属书籍ID',
    chapter_id VARCHAR(36) COMMENT '所属章节ID',
    chapter_order INT COMMENT '章节序号',
    level VARCHAR(20) NOT NULL COMMENT '级别：error/warning/suggestion/info',
    type VARCHAR(50) NOT NULL COMMENT '问题类型',
    title VARCHAR(200) NOT NULL COMMENT '问题标题',
    description TEXT COMMENT '问题描述',
    location JSON COMMENT '位置信息',
    suggestion TEXT COMMENT '修改建议',
    reference JSON COMMENT '参考信息',
    confidence DECIMAL(3,2) COMMENT 'AI检测置信度',
    status VARCHAR(20) DEFAULT 'open' COMMENT '状态：open/fixed/ignored',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    INDEX idx_book_id (book_id),
    INDEX idx_chapter_id (chapter_id),
    INDEX idx_book_level (book_id, level),
    INDEX idx_book_status (book_id, status),
    INDEX idx_type (type),
    CONSTRAINT fk_review_issues_book FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
    CONSTRAINT fk_review_issues_chapter FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='审查问题表';

-- 审查历史记录表（可选，用于追踪审查历史）
CREATE TABLE IF NOT EXISTS review_history (
    id VARCHAR(36) PRIMARY KEY COMMENT '记录ID(UUID)',
    book_id VARCHAR(36) NOT NULL COMMENT '书籍ID',
    chapter_id VARCHAR(36) COMMENT '章节ID（单章审查时）',
    review_mode VARCHAR(20) NOT NULL COMMENT '审查模式：single/batch/full',
    rules_executed INT DEFAULT 0 COMMENT '执行的规则数',
    issues_found INT DEFAULT 0 COMMENT '发现的问题数',
    errors_count INT DEFAULT 0 COMMENT '错误数',
    warnings_count INT DEFAULT 0 COMMENT '警告数',
    suggestions_count INT DEFAULT 0 COMMENT '建议数',
    duration_ms BIGINT DEFAULT 0 COMMENT '审查耗时(毫秒)',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '审查时间',
    INDEX idx_book_id (book_id),
    INDEX idx_created_at (created_at),
    CONSTRAINT fk_review_history_book FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='审查历史记录表';
