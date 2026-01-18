package com.novelai.studio.service.review.rules;

import com.novelai.studio.entity.Chapter;
import com.novelai.studio.entity.ReviewIssue;
import com.novelai.studio.entity.StoryEvent;
import com.novelai.studio.entity.WorldSetting;
import com.novelai.studio.service.review.ReviewContext;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.*;

/**
 * 地理位置冲突规则
 * 检测角色在短时间内出现在不合理的不同地点
 */
@Component
public class LocationConflictRule extends AbstractReviewRule {

    // 表示同时或短时间的词汇
    private static final List<String> SIMULTANEOUS_WORDS = Arrays.asList(
        "同时", "此时", "这时", "与此同时", "正当", "就在", "恰好", "刚刚", "刚才", "方才"
    );

    // 表示移动或到达的词汇
    private static final List<String> MOVEMENT_WORDS = Arrays.asList(
        "到达", "抵达", "来到", "进入", "离开", "前往", "赶到", "回到", "飞到", "传送"
    );

    public LocationConflictRule() {
        super(
            "location_conflict",
            "检测地理位置冲突：检查角色是否在不合理的时间内出现在不同地点",
            "error",
            "location_conflict",
            90
        );
    }

    @Override
    public List<ReviewIssue> check(ReviewContext context) {
        Chapter currentChapter = context.getCurrentChapter();
        if (currentChapter == null || currentChapter.getContent() == null) {
            return noIssues();
        }

        List<ReviewIssue> issues = new ArrayList<>();
        String content = currentChapter.getContent();

        // 获取世界观设定中的地点信息
        List<WorldSetting> worldSettings = context.getWorldSettings();
        Set<String> knownLocations = extractLocations(worldSettings);

        // 获取故事事件中的地点信息
        List<StoryEvent> events = context.getStoryEvents();
        Map<String, List<LocationMention>> characterLocationHistory = buildLocationHistory(events, currentChapter.getOrderNum());

        // 获取角色名称映射
        Map<String, String> characterNameToId = context.getCharacterNameToId();

        if (characterNameToId == null || characterNameToId.isEmpty()) {
            return noIssues();
        }

        // 分析当前章节中的位置提及
        String[] paragraphs = content.split("\n");
        Map<String, List<LocationMention>> currentChapterLocations = new HashMap<>();

        for (int paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex++) {
            String paragraph = paragraphs[paragraphIndex];

            // 检查每个角色在当前段落中的位置
            for (Map.Entry<String, String> entry : characterNameToId.entrySet()) {
                String characterName = entry.getKey();
                String characterId = entry.getValue();

                if (paragraph.contains(characterName)) {
                    // 尝试从段落中提取位置信息
                    String location = extractLocationFromParagraph(paragraph, knownLocations);
                    if (location != null) {
                        LocationMention mention = new LocationMention(
                            characterId,
                            characterName,
                            location,
                            paragraphIndex,
                            currentChapter.getId()
                        );
                        currentChapterLocations
                            .computeIfAbsent(characterId, k -> new ArrayList<>())
                            .add(mention);
                    }
                }
            }
        }

        // 检查同一章节内的位置冲突
        for (List<LocationMention> mentions : currentChapterLocations.values()) {
            if (mentions.size() >= 2) {
                for (int i = 0; i < mentions.size() - 1; i++) {
                    LocationMention current = mentions.get(i);
                    LocationMention next = mentions.get(i + 1);

                    // 检查是否在相邻段落中出现在不同地点
                    if (!current.location.equals(next.location) &&
                        Math.abs(current.paragraphIndex - next.paragraphIndex) <= 2) {

                        // 检查是否有合理的移动描述
                        boolean hasMovement = false;
                        for (int p = current.paragraphIndex; p <= next.paragraphIndex && p < paragraphs.length; p++) {
                            if (containsMovementWord(paragraphs[p])) {
                                hasMovement = true;
                                break;
                            }
                        }

                        if (!hasMovement) {
                            // 检查是否有"同时"这样的词表示不可能的同时出现
                            String relevantText = paragraphs[next.paragraphIndex];
                            if (containsSimultaneousWord(relevantText)) {
                                issues.add(createLocationIssue(
                                    context,
                                    currentChapter,
                                    next.paragraphIndex,
                                    "地理位置冲突：不可能同时出现",
                                    String.format("角色「%s」在第%d段出现在「%s」，又在第%d段同时出现在「%s」，这在物理上不可能",
                                        current.characterName,
                                        current.paragraphIndex + 1,
                                        current.location,
                                        next.paragraphIndex + 1,
                                        next.location),
                                    relevantText
                                ));
                            } else {
                                issues.add(createLocationIssue(
                                    context,
                                    currentChapter,
                                    next.paragraphIndex,
                                    "地理位置冲突：位置突变",
                                    String.format("角色「%s」从「%s」突然出现在「%s」，缺少移动过程的描述",
                                        current.characterName,
                                        current.location,
                                        next.location),
                                    relevantText
                                ));
                            }
                        }
                    }
                }
            }
        }

        // 检查与历史章节的位置冲突
        for (Map.Entry<String, List<LocationMention>> entry : currentChapterLocations.entrySet()) {
            String characterId = entry.getKey();
            List<LocationMention> currentMentions = entry.getValue();
            List<LocationMention> historyMentions = characterLocationHistory.get(characterId);

            if (historyMentions != null && !historyMentions.isEmpty() && !currentMentions.isEmpty()) {
                LocationMention lastHistory = historyMentions.get(historyMentions.size() - 1);
                LocationMention firstCurrent = currentMentions.get(0);

                // 如果上一章节结束时在A地点，当前章节开始就在B地点（无过渡）
                if (!lastHistory.location.equals(firstCurrent.location)) {
                    String firstParagraph = paragraphs[firstCurrent.paragraphIndex];
                    if (!containsMovementWord(firstParagraph)) {
                        issues.add(createLocationIssue(
                            context,
                            currentChapter,
                            firstCurrent.paragraphIndex,
                            "地理位置冲突：跨章节位置不连续",
                            String.format("角色「%s」在前一章节最后位于「%s」，本章节直接出现在「%s」，缺少移动说明",
                                firstCurrent.characterName,
                                lastHistory.location,
                                firstCurrent.location),
                            firstParagraph
                        ));
                    }
                }
            }
        }

        return issues;
    }

    /**
     * 从世界观设定中提取已知地点
     */
    private Set<String> extractLocations(List<WorldSetting> worldSettings) {
        Set<String> locations = new HashSet<>();
        if (worldSettings == null) {
            return locations;
        }

        for (WorldSetting setting : worldSettings) {
            if ("location".equals(setting.getCategory()) || "geography".equals(setting.getCategory())) {
                locations.add(setting.getName());
            }
        }
        return locations;
    }

    /**
     * 构建角色历史位置记录
     */
    private Map<String, List<LocationMention>> buildLocationHistory(List<StoryEvent> events, int currentChapterOrder) {
        Map<String, List<LocationMention>> history = new HashMap<>();

        if (events == null) {
            return history;
        }

        for (StoryEvent event : events) {
            if (event.getChapterOrder() != null &&
                event.getChapterOrder() < currentChapterOrder &&
                event.getLocation() != null &&
                event.getInvolvedCharacters() != null) {

                for (String characterId : event.getInvolvedCharacters()) {
                    LocationMention mention = new LocationMention(
                        characterId,
                        null,
                        event.getLocation(),
                        0,
                        event.getChapterId()
                    );
                    history.computeIfAbsent(characterId, k -> new ArrayList<>()).add(mention);
                }
            }
        }

        return history;
    }

    /**
     * 从段落中提取位置信息
     */
    private String extractLocationFromParagraph(String paragraph, Set<String> knownLocations) {
        // 首先检查已知地点
        for (String location : knownLocations) {
            if (paragraph.contains(location)) {
                return location;
            }
        }

        // 使用常见的位置标记词提取
        String[] locationMarkers = {"在", "到", "来到", "进入", "离开", "位于"};
        for (String marker : locationMarkers) {
            int idx = paragraph.indexOf(marker);
            if (idx >= 0 && idx + marker.length() < paragraph.length()) {
                // 提取标记词后的内容作为可能的位置
                String afterMarker = paragraph.substring(idx + marker.length());
                // 简单提取：取到下一个标点或动词为止
                StringBuilder location = new StringBuilder();
                for (char c : afterMarker.toCharArray()) {
                    if (Character.isLetterOrDigit(c) || c == '的' || c == '里' || c == '中' || c == '上' || c == '下') {
                        location.append(c);
                        if (location.length() >= 10) break; // 限制长度
                    } else if (location.length() > 0) {
                        break;
                    }
                }
                if (location.length() >= 2) {
                    return location.toString();
                }
            }
        }

        return null;
    }

    /**
     * 检查是否包含表示移动的词汇
     */
    private boolean containsMovementWord(String text) {
        for (String word : MOVEMENT_WORDS) {
            if (text.contains(word)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 检查是否包含表示同时的词汇
     */
    private boolean containsSimultaneousWord(String text) {
        for (String word : SIMULTANEOUS_WORDS) {
            if (text.contains(word)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 创建位置冲突问题
     */
    private ReviewIssue createLocationIssue(
            ReviewContext context,
            Chapter chapter,
            int paragraphIndex,
            String title,
            String description,
            String originalText) {

        Map<String, Object> location = new HashMap<>();
        location.put("paragraph", paragraphIndex);
        location.put("originalText", originalText.length() > 200 ? originalText.substring(0, 200) + "..." : originalText);

        return ReviewIssue.builder()
                .bookId(context.getBook().getId())
                .chapterId(chapter.getId())
                .chapterOrder(chapter.getOrderNum())
                .level(getLevel())
                .type(getType())
                .title(title)
                .description(description)
                .location(location)
                .suggestion("请添加角色移动的描述，或修正位置信息使其连贯")
                .confidence(new BigDecimal("0.80"))
                .status("open")
                .build();
    }

    /**
     * 位置提及记录
     */
    private static class LocationMention {
        final String characterId;
        final String characterName;
        final String location;
        final int paragraphIndex;
        final String chapterId;

        LocationMention(String characterId, String characterName, String location, int paragraphIndex, String chapterId) {
            this.characterId = characterId;
            this.characterName = characterName;
            this.location = location;
            this.paragraphIndex = paragraphIndex;
            this.chapterId = chapterId;
        }
    }
}
