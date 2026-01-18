-- 添加 GLM-4 配置并设为默认
-- 首先取消所有现有配置的默认状态
UPDATE ai_configs SET is_default = 0 WHERE is_default = 1;

-- 删除已有的 GLM 配置（如果存在）
DELETE FROM ai_configs WHERE name LIKE '%GLM%' OR name LIKE '%智谱%';

-- 插入新的 GLM-4 配置作为默认
INSERT INTO ai_configs (
    id,
    name,
    provider,
    api_key,
    base_url,
    model,
    max_tokens,
    temperature,
    top_p,
    is_default,
    usage_tasks,
    created_at,
    updated_at
) VALUES (
    UUID(),
    'GLM-4 创作',
    'zhipu',
    '00a817c2512e42f98a3eb13822d0b183.63e2s8cS8GUVGgVJ',
    'https://open.bigmodel.cn/api/paas/v4',
    'glm-4-flash',
    8192,
    0.70,
    0.95,
    1,
    '["all"]',
    NOW(),
    NOW()
);

-- 查看当前配置
SELECT id, name, provider, model, is_default FROM ai_configs;
