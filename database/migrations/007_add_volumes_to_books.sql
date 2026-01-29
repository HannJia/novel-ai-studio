-- 为 books 表添加 volumes 字段（分卷大纲）
-- 如果 outline 字段不存在也一并添加

USE novel_ai_studio;

-- 添加 outline 字段（如果不存在）
SET @s = (SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = 'novel_ai_studio'
     AND TABLE_NAME = 'books'
     AND COLUMN_NAME = 'outline') = 0,
    'ALTER TABLE books ADD COLUMN outline TEXT COMMENT ''全书大纲'' AFTER description;',
    'SELECT ''outline column already exists'';'
));
PREPARE stmt FROM @s;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 添加 volumes 字段（JSON格式存储分卷大纲）
SET @s = (SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = 'novel_ai_studio'
     AND TABLE_NAME = 'books'
     AND COLUMN_NAME = 'volumes') = 0,
    'ALTER TABLE books ADD COLUMN volumes JSON COMMENT ''分卷大纲（JSON格式）'' AFTER outline;',
    'SELECT ''volumes column already exists'';'
));
PREPARE stmt FROM @s;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
