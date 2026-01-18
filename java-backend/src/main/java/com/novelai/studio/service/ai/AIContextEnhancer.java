package com.novelai.studio.service.ai;

import com.novelai.studio.entity.Character;
import com.novelai.studio.entity.WorldSetting;
import com.novelai.studio.service.CharacterService;
import com.novelai.studio.service.ChapterSummaryService;
import com.novelai.studio.service.ForeshadowService;
import com.novelai.studio.service.StoryEventService;
import com.novelai.studio.service.CharacterStateChangeService;
import com.novelai.studio.service.WorldSettingService;
import com.novelai.studio.service.knowledge.KnowledgeSearchService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * AI上下文增强服务
 *
 * 在AI生成时自动注入角色、设定和知识库信息
 * 支持缓存机制，避免重复构建相同上下文
 */
@Service
public class AIContextEnhancer {

    @Autowired
    private CharacterService characterService;

    @Autowired
    private WorldSettingService worldSettingService;

    @Autowired
    private KnowledgeSearchService knowledgeSearchService;

    @Autowired
    @Lazy
    private ChapterSummaryService chapterSummaryService;

    @Autowired
    @Lazy
    private StoryEventService storyEventService;

    @Autowired
    @Lazy
    private CharacterStateChangeService characterStateChangeService;

    @Autowired
    @Lazy
    private ForeshadowService foreshadowService;

    /**
     * 上下文缓存：cacheKey -> CacheEntry
     */
    private final Map<String, CacheEntry> contextCache = new ConcurrentHashMap<>();

    /**
     * 缓存过期时间（秒），默认5分钟
     */
    @Value("${ai.context.cache.ttl:300}")
    private int cacheTtlSeconds;

    /**
     * 最大缓存条目数
     */
    private static final int MAX_CACHE_SIZE = 100;

    /**
     * 缓存条目
     */
    private static class CacheEntry {
        final String content;
        final Instant createdAt;

        CacheEntry(String content) {
            this.content = content;
            this.createdAt = Instant.now();
        }

        boolean isExpired(int ttlSeconds) {
            return Instant.now().isAfter(createdAt.plusSeconds(ttlSeconds));
        }
    }

    /**
     * 构建增强的上下文
     */
    public String buildEnhancedContext(String bookId, String query, boolean includeCharacters,
                                        boolean includeSettings, boolean includeKnowledge) {
        StringBuilder context = new StringBuilder();

        // 添加角色信息（带缓存）
        if (includeCharacters) {
            String characterContext = buildCharacterContextCached(bookId);
            if (!characterContext.isEmpty()) {
                context.append(characterContext).append("\n\n");
            }
        }

        // 添加设定信息（带缓存）
        if (includeSettings) {
            String settingContext = buildSettingContextCached(bookId);
            if (!settingContext.isEmpty()) {
                context.append(settingContext).append("\n\n");
            }
        }

        // 添加知识库检索结果（不缓存，因为query每次不同）
        if (includeKnowledge && query != null && !query.isEmpty()) {
            String knowledgeContext = knowledgeSearchService.getRelevantContext(bookId, query, 3);
            if (!knowledgeContext.isEmpty()) {
                context.append(knowledgeContext).append("\n\n");
            }
        }

        return context.toString();
    }

    /**
     * 构建角色上下文（带缓存）
     */
    public String buildCharacterContextCached(String bookId) {
        String cacheKey = "character:" + bookId;
        return getOrBuildCache(cacheKey, () -> buildCharacterContext(bookId));
    }

    /**
     * 构建设定上下文（带缓存）
     */
    public String buildSettingContextCached(String bookId) {
        String cacheKey = "setting:" + bookId;
        return getOrBuildCache(cacheKey, () -> buildSettingContext(bookId));
    }

    /**
     * 获取或构建缓存
     */
    private String getOrBuildCache(String cacheKey, java.util.function.Supplier<String> builder) {
        // 检查缓存
        CacheEntry entry = contextCache.get(cacheKey);
        if (entry != null && !entry.isExpired(cacheTtlSeconds)) {
            return entry.content;
        }

        // 清理过期缓存（如果缓存过大）
        if (contextCache.size() >= MAX_CACHE_SIZE) {
            cleanExpiredCache();
        }

        // 构建新内容并缓存
        String content = builder.get();
        contextCache.put(cacheKey, new CacheEntry(content));
        return content;
    }

    /**
     * 清理过期缓存
     */
    private void cleanExpiredCache() {
        contextCache.entrySet().removeIf(entry -> entry.getValue().isExpired(cacheTtlSeconds));
    }

    /**
     * 使书籍的缓存失效（当角色或设定更新时调用）
     */
    public void invalidateCache(String bookId) {
        contextCache.remove("character:" + bookId);
        contextCache.remove("setting:" + bookId);
    }

    /**
     * 清空所有缓存
     */
    public void clearAllCache() {
        contextCache.clear();
    }

    /**
     * 构建角色上下文
     */
    public String buildCharacterContext(String bookId) {
        List<Character> characters = characterService.getCharactersByBook(bookId);
        if (characters.isEmpty()) {
            return "";
        }

        StringBuilder sb = new StringBuilder();
        sb.append("【主要角色信息】\n\n");

        // 按类型分组
        Map<String, List<Character>> byType = characters.stream()
                .collect(Collectors.groupingBy(c -> c.getType() != null ? c.getType() : "other"));

        // 先列出主角
        List<Character> protagonists = byType.get("protagonist");
        if (protagonists != null && !protagonists.isEmpty()) {
            sb.append("= 主角 =\n");
            for (Character c : protagonists) {
                appendCharacterInfo(sb, c);
            }
            sb.append("\n");
        }

        // 配角
        List<Character> supporting = byType.get("supporting");
        if (supporting != null && !supporting.isEmpty()) {
            sb.append("= 配角 =\n");
            for (Character c : supporting) {
                appendCharacterInfo(sb, c);
            }
            sb.append("\n");
        }

        // 反派
        List<Character> antagonists = byType.get("antagonist");
        if (antagonists != null && !antagonists.isEmpty()) {
            sb.append("= 反派 =\n");
            for (Character c : antagonists) {
                appendCharacterInfo(sb, c);
            }
        }

        return sb.toString();
    }

    /**
     * 构建设定上下文
     */
    public String buildSettingContext(String bookId) {
        List<WorldSetting> settings = worldSettingService.getSettingsByBook(bookId);
        if (settings.isEmpty()) {
            return "";
        }

        StringBuilder sb = new StringBuilder();
        sb.append("【世界观设定】\n\n");

        // 按分类分组
        Map<String, List<WorldSetting>> byCategory = settings.stream()
                .collect(Collectors.groupingBy(s -> s.getCategory() != null ? s.getCategory() : "other"));

        // 力量体系
        appendSettingCategory(sb, byCategory.get("power_system"), "力量体系");

        // 重要物品
        appendSettingCategory(sb, byCategory.get("item"), "物品道具");

        // 地点
        appendSettingCategory(sb, byCategory.get("location"), "地点场景");

        // 组织
        appendSettingCategory(sb, byCategory.get("organization"), "组织势力");

        // 其他
        appendSettingCategory(sb, byCategory.get("other"), "其他设定");

        return sb.toString();
    }

    /**
     * 为特定章节构建上下文
     */
    public String buildChapterContext(String bookId, String chapterTitle, String previousContent) {
        StringBuilder context = new StringBuilder();

        // 添加基础上下文
        context.append(buildEnhancedContext(bookId, chapterTitle, true, true, true));

        // 添加前文内容摘要（如果有）
        if (previousContent != null && !previousContent.isEmpty()) {
            context.append("【前文内容】\n");
            // 限制长度
            if (previousContent.length() > 2000) {
                context.append(previousContent.substring(previousContent.length() - 2000));
            } else {
                context.append(previousContent);
            }
            context.append("\n\n");
        }

        return context.toString();
    }

    /**
     * 添加角色信息
     */
    private void appendCharacterInfo(StringBuilder sb, Character c) {
        sb.append("- ").append(c.getName());

        // 别名
        if (c.getAliases() != null && !c.getAliases().isEmpty()) {
            sb.append("（又名：").append(String.join("、", c.getAliases())).append("）");
        }

        sb.append("\n");

        // 档案信息
        Map<String, Object> profile = c.getProfile();
        if (profile != null) {
            if (profile.get("gender") != null && !profile.get("gender").toString().isEmpty()) {
                sb.append("  性别：").append(profile.get("gender")).append("\n");
            }
            if (profile.get("personality") != null && !profile.get("personality").toString().isEmpty()) {
                sb.append("  性格：").append(profile.get("personality")).append("\n");
            }
            if (profile.get("abilities") != null && !profile.get("abilities").toString().isEmpty()) {
                sb.append("  能力：").append(profile.get("abilities")).append("\n");
            }
        }

        // 状态信息
        Map<String, Object> state = c.getState();
        if (state != null) {
            Object isAlive = state.get("isAlive");
            if (Boolean.FALSE.equals(isAlive)) {
                sb.append("  状态：已故\n");
            }
            if (state.get("powerLevel") != null && !state.get("powerLevel").toString().isEmpty()) {
                sb.append("  实力：").append(state.get("powerLevel")).append("\n");
            }
        }
    }

    /**
     * 添加设定分类
     */
    private void appendSettingCategory(StringBuilder sb, List<WorldSetting> settings, String categoryName) {
        if (settings == null || settings.isEmpty()) {
            return;
        }

        sb.append("= ").append(categoryName).append(" =\n");
        for (WorldSetting s : settings) {
            sb.append("- ").append(s.getName());
            if (s.getContent() != null && !s.getContent().isEmpty()) {
                // 限制内容长度
                String content = s.getContent();
                if (content.length() > 200) {
                    content = content.substring(0, 200) + "...";
                }
                sb.append("：").append(content);
            }
            sb.append("\n");
        }
        sb.append("\n");
    }

    // ========== 记忆系统整合方法 ==========

    /**
     * 构建完整的记忆增强上下文（包含所有记忆层级）
     *
     * @param bookId 书籍ID
     * @param currentChapterOrder 当前章节序号
     * @param query 查询关键词（用于知识库检索）
     * @return 完整的记忆上下文
     */
    public String buildFullMemoryContext(String bookId, int currentChapterOrder, String query) {
        StringBuilder context = new StringBuilder();

        // L0: 角色和设定信息（带缓存）
        String characterContext = buildCharacterContextCached(bookId);
        if (!characterContext.isEmpty()) {
            context.append(characterContext).append("\n\n");
        }

        String settingContext = buildSettingContextCached(bookId);
        if (!settingContext.isEmpty()) {
            context.append(settingContext).append("\n\n");
        }

        // L2: 前文章节摘要
        String summaryContext = chapterSummaryService.buildPreviousContext(bookId, currentChapterOrder, 10);
        if (!summaryContext.isEmpty()) {
            context.append(summaryContext).append("\n\n");
        }

        // L3: 重要事件时间线
        String eventContext = storyEventService.buildTimelineContext(bookId, currentChapterOrder);
        if (!eventContext.isEmpty()) {
            context.append(eventContext).append("\n\n");
        }

        // L3: 角色当前状态
        String stateContext = characterStateChangeService.buildCharacterStateContext(bookId, currentChapterOrder);
        if (!stateContext.isEmpty()) {
            context.append(stateContext).append("\n\n");
        }

        // 伏笔提醒
        String foreshadowContext = foreshadowService.buildForeshadowReminder(bookId, currentChapterOrder);
        if (!foreshadowContext.isEmpty()) {
            context.append(foreshadowContext).append("\n\n");
        }

        // 知识库检索
        if (query != null && !query.isEmpty()) {
            String knowledgeContext = knowledgeSearchService.getRelevantContext(bookId, query, 3);
            if (!knowledgeContext.isEmpty()) {
                context.append(knowledgeContext).append("\n\n");
            }
        }

        return context.toString();
    }

    /**
     * 构建用于章节生成的完整上下文
     *
     * @param bookId 书籍ID
     * @param currentChapterOrder 当前章节序号
     * @param chapterTitle 章节标题
     * @param previousContent 前一章的内容（L1即时记忆）
     * @return 完整的生成上下文
     */
    public String buildChapterGenerationContext(String bookId, int currentChapterOrder,
                                                  String chapterTitle, String previousContent) {
        StringBuilder context = new StringBuilder();

        // 添加记忆系统上下文
        context.append(buildFullMemoryContext(bookId, currentChapterOrder, chapterTitle));

        // L1: 即时记忆 - 前一章内容摘要
        if (previousContent != null && !previousContent.isEmpty()) {
            context.append("【前文内容（即时记忆）】\n");
            // 限制长度，保留最近的内容
            if (previousContent.length() > 3000) {
                context.append("...\n");
                context.append(previousContent.substring(previousContent.length() - 3000));
            } else {
                context.append(previousContent);
            }
            context.append("\n\n");
        }

        return context.toString();
    }

    /**
     * 构建用于续写的上下文
     *
     * @param bookId 书籍ID
     * @param chapterOrder 章节序号
     * @param currentContent 当前章节已有内容
     * @return 续写上下文
     */
    public String buildContinueContext(String bookId, int chapterOrder, String currentContent) {
        StringBuilder context = new StringBuilder();

        // 添加精简的记忆上下文
        String characterContext = buildCharacterContextCached(bookId);
        if (!characterContext.isEmpty()) {
            context.append(characterContext).append("\n\n");
        }

        // 伏笔提醒（可能需要在续写中回收）
        String foreshadowContext = foreshadowService.buildForeshadowReminder(bookId, chapterOrder);
        if (!foreshadowContext.isEmpty()) {
            context.append(foreshadowContext).append("\n\n");
        }

        // 当前内容作为即时记忆
        if (currentContent != null && !currentContent.isEmpty()) {
            context.append("【当前章节内容】\n");
            // 保留最近的内容
            if (currentContent.length() > 2000) {
                context.append("...\n");
                context.append(currentContent.substring(currentContent.length() - 2000));
            } else {
                context.append(currentContent);
            }
            context.append("\n\n");
        }

        return context.toString();
    }
}
