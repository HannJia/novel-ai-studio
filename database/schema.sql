-- =============================================
-- NovelAI Studio 数据库表结构
-- 数据库：MySQL 8.0+
-- 字符集：utf8mb4
-- =============================================

-- 创建数据库
CREATE DATABASE IF NOT EXISTS novel_ai_studio
    DEFAULT CHARACTER SET utf8mb4
    DEFAULT COLLATE utf8mb4_unicode_ci;

USE novel_ai_studio;

-- 书籍表
CREATE TABLE IF NOT EXISTS books (
    id VARCHAR(36) PRIMARY KEY COMMENT '书籍ID(UUID)',
    title VARCHAR(200) NOT NULL COMMENT '书名',
    author VARCHAR(100) DEFAULT '' COMMENT '作者',
    genre VARCHAR(50) NOT NULL COMMENT '类型：xuanhuan/dushi/kehuan等',
    style VARCHAR(50) NOT NULL COMMENT '风格：qingsong/yansu/rexue等',
    description TEXT COMMENT '简介',
    cover_image VARCHAR(500) COMMENT '封面图片路径',
    status VARCHAR(20) DEFAULT 'writing' COMMENT '状态：writing/paused/completed',
    word_count INT UNSIGNED DEFAULT 0 COMMENT '总字数（不含标点）',
    chapter_count INT UNSIGNED DEFAULT 0 COMMENT '章节数',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    INDEX idx_status (status),
    INDEX idx_genre (genre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='书籍表';

-- 卷表
CREATE TABLE IF NOT EXISTS volumes (
    id VARCHAR(36) PRIMARY KEY COMMENT '卷ID(UUID)',
    book_id VARCHAR(36) NOT NULL COMMENT '所属书籍ID',
    title VARCHAR(200) NOT NULL COMMENT '卷名',
    order_num INT NOT NULL COMMENT '排序序号',
    word_count INT UNSIGNED DEFAULT 0 COMMENT '字数',
    chapter_count INT UNSIGNED DEFAULT 0 COMMENT '章节数',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_book_id (book_id),
    INDEX idx_order (book_id, order_num),
    CONSTRAINT fk_volumes_book FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='卷表';

-- 章节表
CREATE TABLE IF NOT EXISTS chapters (
    id VARCHAR(36) PRIMARY KEY COMMENT '章节ID(UUID)',
    book_id VARCHAR(36) NOT NULL COMMENT '所属书籍ID',
    volume_id VARCHAR(36) COMMENT '所属卷ID',
    title VARCHAR(200) NOT NULL COMMENT '章节标题',
    content LONGTEXT COMMENT '章节正文',
    outline TEXT COMMENT '章节大纲',
    summary TEXT COMMENT 'AI生成的摘要',
    word_count INT UNSIGNED DEFAULT 0 COMMENT '字数（不含标点）',
    order_num INT NOT NULL COMMENT '排序序号',
    status VARCHAR(20) DEFAULT 'draft' COMMENT '状态：draft/completed/reviewing',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_book_id (book_id),
    INDEX idx_book_order (book_id, order_num),
    INDEX idx_volume_id (volume_id),
    CONSTRAINT fk_chapters_book FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
    CONSTRAINT fk_chapters_volume FOREIGN KEY (volume_id) REFERENCES volumes(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='章节表';

-- 章节版本历史表
CREATE TABLE IF NOT EXISTS chapter_versions (
    id VARCHAR(36) PRIMARY KEY COMMENT '版本ID(UUID)',
    chapter_id VARCHAR(36) NOT NULL COMMENT '章节ID',
    content LONGTEXT NOT NULL COMMENT '版本内容',
    word_count INT UNSIGNED DEFAULT 0 COMMENT '字数',
    version_num INT NOT NULL COMMENT '版本号',
    source VARCHAR(20) DEFAULT 'manual' COMMENT '来源：manual/ai_generated',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_chapter_id (chapter_id),
    INDEX idx_chapter_version (chapter_id, version_num),
    CONSTRAINT fk_versions_chapter FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='章节版本历史表';

-- 角色表
CREATE TABLE IF NOT EXISTS characters (
    id VARCHAR(36) PRIMARY KEY COMMENT '角色ID(UUID)',
    book_id VARCHAR(36) NOT NULL COMMENT '所属书籍ID',
    name VARCHAR(100) NOT NULL COMMENT '角色名',
    aliases JSON COMMENT '别名列表',
    type VARCHAR(20) NOT NULL COMMENT '类型：protagonist/supporting/antagonist/other',
    profile JSON COMMENT '角色档案',
    state JSON COMMENT '角色状态',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_book_id (book_id),
    INDEX idx_name (book_id, name),
    CONSTRAINT fk_characters_book FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色表';

-- 设定表
CREATE TABLE IF NOT EXISTS world_settings (
    id VARCHAR(36) PRIMARY KEY COMMENT '设定ID(UUID)',
    book_id VARCHAR(36) NOT NULL COMMENT '所属书籍ID',
    category VARCHAR(50) NOT NULL COMMENT '分类：power_system/item/location/organization/other',
    name VARCHAR(200) NOT NULL COMMENT '设定名称',
    content TEXT COMMENT '设定内容',
    tags JSON COMMENT '标签列表',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_book_id (book_id),
    INDEX idx_category (book_id, category),
    CONSTRAINT fk_settings_book FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='世界观设定表';

-- 大纲表
CREATE TABLE IF NOT EXISTS outlines (
    id VARCHAR(36) PRIMARY KEY COMMENT '大纲ID(UUID)',
    book_id VARCHAR(36) NOT NULL COMMENT '所属书籍ID',
    type VARCHAR(20) NOT NULL COMMENT '类型：book/volume/chapter',
    reference_id VARCHAR(36) COMMENT '关联的卷ID或章节ID',
    content TEXT COMMENT '大纲内容',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_book_id (book_id),
    INDEX idx_type (book_id, type),
    CONSTRAINT fk_outlines_book FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='大纲表';

-- 伏笔表
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
    CONSTRAINT fk_foreshadows_book FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='伏笔表';

-- AI配置表
CREATE TABLE IF NOT EXISTS ai_configs (
    id VARCHAR(36) PRIMARY KEY COMMENT '配置ID(UUID)',
    name VARCHAR(100) NOT NULL COMMENT '配置名称',
    provider VARCHAR(50) NOT NULL COMMENT '提供商：openai/claude/qianwen/ollama等',
    api_key VARCHAR(500) NOT NULL COMMENT 'API密钥（加密存储）',
    base_url VARCHAR(500) COMMENT 'API地址',
    model VARCHAR(100) NOT NULL COMMENT '模型名称',
    max_tokens INT UNSIGNED DEFAULT 4096 COMMENT '最大Token数',
    temperature DECIMAL(3,2) DEFAULT 0.70 COMMENT '温度参数',
    top_p DECIMAL(3,2) DEFAULT 1.00 COMMENT 'Top-P参数',
    is_default TINYINT(1) DEFAULT 0 COMMENT '是否默认配置',
    usage_tasks JSON DEFAULT ('["all"]') COMMENT '适用任务列表',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_provider (provider),
    INDEX idx_default (is_default)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI配置表';

-- Token使用记录表
CREATE TABLE IF NOT EXISTS token_usage (
    id VARCHAR(36) PRIMARY KEY COMMENT '记录ID(UUID)',
    book_id VARCHAR(36) COMMENT '关联书籍ID',
    config_id VARCHAR(36) NOT NULL COMMENT 'AI配置ID',
    task VARCHAR(50) NOT NULL COMMENT '任务类型：generate/review/summary/chat',
    prompt_tokens INT UNSIGNED NOT NULL COMMENT '提示Token数',
    completion_tokens INT UNSIGNED NOT NULL COMMENT '完成Token数',
    total_tokens INT UNSIGNED NOT NULL COMMENT '总Token数',
    estimated_cost DECIMAL(10,4) DEFAULT 0 COMMENT '估算费用(元)',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_book_id (book_id),
    INDEX idx_config_id (config_id),
    INDEX idx_created_at (created_at),
    INDEX idx_task (task),
    CONSTRAINT fk_usage_config FOREIGN KEY (config_id) REFERENCES ai_configs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Token使用记录表';

-- 用户设置表
CREATE TABLE IF NOT EXISTS user_settings (
    setting_key VARCHAR(100) PRIMARY KEY COMMENT '设置键',
    setting_value TEXT NOT NULL COMMENT '设置值',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户设置表';
