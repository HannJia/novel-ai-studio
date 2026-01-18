package com.novelai.studio.service.review;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.novelai.studio.entity.*;
import com.novelai.studio.mapper.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import jakarta.annotation.PostConstruct;
import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * 规则引擎服务
 * 管理和执行审查规则
 */
@Service
public class RuleEngineService {

    private static final Logger log = LoggerFactory.getLogger(RuleEngineService.class);

    @Autowired
    private BookMapper bookMapper;

    @Autowired
    private ChapterMapper chapterMapper;

    @Autowired
    private CharacterMapper characterMapper;

    @Autowired
    private WorldSettingMapper worldSettingMapper;

    @Autowired
    private ForeshadowMapper foreshadowMapper;

    @Autowired
    private StoryEventMapper storyEventMapper;

    @Autowired
    private CharacterStateChangeMapper characterStateChangeMapper;

    @Autowired
    private ChapterSummaryMapper chapterSummaryMapper;

    @Autowired
    private ReviewIssueMapper reviewIssueMapper;

    /**
     * 注册的规则列表
     */
    private final List<ReviewRule> rules = new ArrayList<>();

    /**
     * 规则按类型分类
     */
    private final Map<String, List<ReviewRule>> rulesByLevel = new ConcurrentHashMap<>();

    /**
     * 初始化时自动注入所有规则Bean
     */
    @Autowired(required = false)
    public void setRules(List<ReviewRule> rules) {
        if (rules != null) {
            this.rules.addAll(rules);
            categorizeRules();
            log.info("Loaded {} review rules", rules.size());
        }
    }

    @PostConstruct
    public void init() {
        categorizeRules();
    }

    /**
     * 按级别分类规则
     */
    private void categorizeRules() {
        rulesByLevel.clear();
        for (ReviewRule rule : rules) {
            rulesByLevel.computeIfAbsent(rule.getLevel(), k -> new ArrayList<>()).add(rule);
        }
        // 按优先级排序
        for (List<ReviewRule> levelRules : rulesByLevel.values()) {
            levelRules.sort(Comparator.comparingInt(ReviewRule::getPriority));
        }
    }

    /**
     * 注册规则
     */
    public void registerRule(ReviewRule rule) {
        rules.add(rule);
        rulesByLevel.computeIfAbsent(rule.getLevel(), k -> new ArrayList<>()).add(rule);
        log.info("Registered rule: {} ({})", rule.getName(), rule.getLevel());
    }

    /**
     * 获取所有规则
     */
    public List<ReviewRule> getAllRules() {
        return Collections.unmodifiableList(rules);
    }

    /**
     * 获取指定级别的规则
     */
    public List<ReviewRule> getRulesByLevel(String level) {
        return rulesByLevel.getOrDefault(level, Collections.emptyList());
    }

    /**
     * 构建审查上下文
     */
    public ReviewContext buildContext(String bookId, String chapterId) {
        Book book = bookMapper.selectById(bookId);
        if (book == null) {
            throw new IllegalArgumentException("Book not found: " + bookId);
        }

        // 获取所有章节
        QueryWrapper<Chapter> chapterQuery = new QueryWrapper<>();
        chapterQuery.eq("book_id", bookId).orderByAsc("order_num");
        List<Chapter> allChapters = chapterMapper.selectList(chapterQuery);

        // 获取当前章节
        Chapter currentChapter = null;
        if (chapterId != null) {
            currentChapter = chapterMapper.selectById(chapterId);
        }

        // 获取角色
        QueryWrapper<com.novelai.studio.entity.Character> charQuery = new QueryWrapper<>();
        charQuery.eq("book_id", bookId);
        List<com.novelai.studio.entity.Character> characters = characterMapper.selectList(charQuery);

        // 构建角色名称映射
        Map<String, String> characterNameToId = new HashMap<>();
        Map<String, com.novelai.studio.entity.Character> characterById = new HashMap<>();
        for (com.novelai.studio.entity.Character character : characters) {
            characterById.put(character.getId(), character);
            characterNameToId.put(character.getName(), character.getId());
            if (character.getAliases() != null) {
                for (String alias : character.getAliases()) {
                    characterNameToId.put(alias, character.getId());
                }
            }
        }

        // 获取世界观设定
        QueryWrapper<WorldSetting> settingQuery = new QueryWrapper<>();
        settingQuery.eq("book_id", bookId);
        List<WorldSetting> worldSettings = worldSettingMapper.selectList(settingQuery);

        // 获取伏笔
        QueryWrapper<Foreshadow> foreshadowQuery = new QueryWrapper<>();
        foreshadowQuery.eq("book_id", bookId);
        List<Foreshadow> foreshadows = foreshadowMapper.selectList(foreshadowQuery);

        // 获取故事事件
        QueryWrapper<StoryEvent> eventQuery = new QueryWrapper<>();
        eventQuery.eq("book_id", bookId).orderByAsc("chapter_order");
        List<StoryEvent> storyEvents = storyEventMapper.selectList(eventQuery);

        // 获取角色状态变更
        List<CharacterStateChange> stateChanges = new ArrayList<>();
        for (com.novelai.studio.entity.Character character : characters) {
            QueryWrapper<CharacterStateChange> stateQuery = new QueryWrapper<>();
            stateQuery.eq("character_id", character.getId()).orderByAsc("chapter_order");
            stateChanges.addAll(characterStateChangeMapper.selectList(stateQuery));
        }

        // 获取章节摘要
        List<ChapterSummary> summaries = new ArrayList<>();
        for (Chapter chapter : allChapters) {
            QueryWrapper<ChapterSummary> summaryQuery = new QueryWrapper<>();
            summaryQuery.eq("chapter_id", chapter.getId());
            ChapterSummary summary = chapterSummaryMapper.selectOne(summaryQuery);
            if (summary != null) {
                summaries.add(summary);
            }
        }

        return ReviewContext.builder()
                .book(book)
                .currentChapter(currentChapter)
                .allChapters(allChapters)
                .characters(characters)
                .characterNameToId(characterNameToId)
                .characterById(characterById)
                .worldSettings(worldSettings)
                .foreshadows(foreshadows)
                .storyEvents(storyEvents)
                .characterStateChanges(stateChanges)
                .chapterSummaries(summaries)
                .reviewMode(chapterId != null ? "single" : "full")
                .build();
    }

    /**
     * 执行单章节审查
     */
    public ReviewReport reviewChapter(String bookId, String chapterId) {
        return reviewChapter(bookId, chapterId, null);
    }

    /**
     * 执行单章节审查（指定级别）
     */
    public ReviewReport reviewChapter(String bookId, String chapterId, List<String> levels) {
        LocalDateTime startTime = LocalDateTime.now();
        long startMs = System.currentTimeMillis();

        // 构建上下文
        ReviewContext context = buildContext(bookId, chapterId);

        // 清除该章节的旧问题
        QueryWrapper<ReviewIssue> deleteQuery = new QueryWrapper<>();
        deleteQuery.eq("chapter_id", chapterId);
        reviewIssueMapper.delete(deleteQuery);

        // 执行规则
        List<ReviewIssue> allIssues = new ArrayList<>();
        int rulesExecuted = 0;

        List<ReviewRule> rulesToExecute = getRulesToExecute(levels);
        for (ReviewRule rule : rulesToExecute) {
            if (!rule.isEnabled()) {
                continue;
            }
            try {
                List<ReviewIssue> issues = rule.check(context);
                if (issues != null && !issues.isEmpty()) {
                    // 补充书籍和章节信息
                    for (ReviewIssue issue : issues) {
                        issue.setBookId(bookId);
                        if (issue.getChapterId() == null) {
                            issue.setChapterId(chapterId);
                        }
                        if (issue.getChapterOrder() == null && context.getCurrentChapter() != null) {
                            issue.setChapterOrder(context.getCurrentChapter().getOrderNum());
                        }
                        // 保存到数据库
                        reviewIssueMapper.insert(issue);
                    }
                    allIssues.addAll(issues);
                }
                rulesExecuted++;
            } catch (Exception e) {
                log.error("Rule {} execution failed: {}", rule.getName(), e.getMessage(), e);
            }
        }

        long endMs = System.currentTimeMillis();
        LocalDateTime endTime = LocalDateTime.now();

        // 统计
        Map<String, Integer> issuesByLevel = allIssues.stream()
                .collect(Collectors.groupingBy(ReviewIssue::getLevel, Collectors.summingInt(i -> 1)));
        Map<String, Integer> issuesByType = allIssues.stream()
                .collect(Collectors.groupingBy(ReviewIssue::getType, Collectors.summingInt(i -> 1)));

        return ReviewReport.builder()
                .id(UUID.randomUUID().toString())
                .bookId(bookId)
                .chapterIds(Collections.singletonList(chapterId))
                .totalIssues(allIssues.size())
                .issuesByLevel(issuesByLevel)
                .issuesByType(issuesByType)
                .issues(allIssues)
                .startTime(startTime)
                .endTime(endTime)
                .duration(endMs - startMs)
                .reviewMode("single")
                .rulesExecuted(rulesExecuted)
                .build();
    }

    /**
     * 执行全书审查
     */
    public ReviewReport reviewBook(String bookId) {
        return reviewBook(bookId, null);
    }

    /**
     * 执行全书审查（指定级别）
     */
    public ReviewReport reviewBook(String bookId, List<String> levels) {
        LocalDateTime startTime = LocalDateTime.now();
        long startMs = System.currentTimeMillis();

        // 构建上下文
        ReviewContext context = buildContext(bookId, null);
        context.setReviewMode("full");

        // 清除该书籍的旧问题
        QueryWrapper<ReviewIssue> deleteQuery = new QueryWrapper<>();
        deleteQuery.eq("book_id", bookId);
        reviewIssueMapper.delete(deleteQuery);

        // 对每个章节执行规则
        List<ReviewIssue> allIssues = new ArrayList<>();
        List<String> chapterIds = new ArrayList<>();
        int rulesExecuted = 0;

        List<ReviewRule> rulesToExecute = getRulesToExecute(levels);

        for (Chapter chapter : context.getAllChapters()) {
            chapterIds.add(chapter.getId());
            context.setCurrentChapter(chapter);

            for (ReviewRule rule : rulesToExecute) {
                if (!rule.isEnabled()) {
                    continue;
                }
                try {
                    List<ReviewIssue> issues = rule.check(context);
                    if (issues != null && !issues.isEmpty()) {
                        for (ReviewIssue issue : issues) {
                            issue.setBookId(bookId);
                            if (issue.getChapterId() == null) {
                                issue.setChapterId(chapter.getId());
                            }
                            if (issue.getChapterOrder() == null) {
                                issue.setChapterOrder(chapter.getOrderNum());
                            }
                            reviewIssueMapper.insert(issue);
                        }
                        allIssues.addAll(issues);
                    }
                    rulesExecuted++;
                } catch (Exception e) {
                    log.error("Rule {} execution failed for chapter {}: {}",
                            rule.getName(), chapter.getTitle(), e.getMessage(), e);
                }
            }
        }

        long endMs = System.currentTimeMillis();
        LocalDateTime endTime = LocalDateTime.now();

        // 统计
        Map<String, Integer> issuesByLevel = allIssues.stream()
                .collect(Collectors.groupingBy(ReviewIssue::getLevel, Collectors.summingInt(i -> 1)));
        Map<String, Integer> issuesByType = allIssues.stream()
                .collect(Collectors.groupingBy(ReviewIssue::getType, Collectors.summingInt(i -> 1)));

        return ReviewReport.builder()
                .id(UUID.randomUUID().toString())
                .bookId(bookId)
                .chapterIds(chapterIds)
                .totalIssues(allIssues.size())
                .issuesByLevel(issuesByLevel)
                .issuesByType(issuesByType)
                .issues(allIssues)
                .startTime(startTime)
                .endTime(endTime)
                .duration(endMs - startMs)
                .reviewMode("full")
                .rulesExecuted(rulesExecuted)
                .build();
    }

    /**
     * 获取要执行的规则
     */
    private List<ReviewRule> getRulesToExecute(List<String> levels) {
        if (levels == null || levels.isEmpty()) {
            return new ArrayList<>(rules);
        }
        return rules.stream()
                .filter(r -> levels.contains(r.getLevel()))
                .sorted(Comparator.comparingInt(ReviewRule::getPriority))
                .collect(Collectors.toList());
    }
}
