package com.novelai.studio.service.review.rules;

import com.novelai.studio.entity.Chapter;
import com.novelai.studio.entity.ReviewIssue;
import com.novelai.studio.entity.StoryEvent;
import com.novelai.studio.service.review.ReviewContext;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.*;

/**
 * 时间线冲突规则
 * 检测章节中的时间描述是否与故事事件时间线矛盾
 */
@Component
public class TimelineConflictRule extends AbstractReviewRule {

    // 时间先后关系词
    private static final List<String> BEFORE_WORDS = Arrays.asList(
        "之前", "以前", "前", "曾经", "过去", "早些时候", "先前", "此前"
    );
    private static final List<String> AFTER_WORDS = Arrays.asList(
        "之后", "以后", "后", "随后", "接下来", "此后", "稍后"
    );

    public TimelineConflictRule() {
        super(
            "timeline_conflict",
            "检测时间线冲突：检查章节中的时间描述是否与已发生事件的时间顺序矛盾",
            "error",
            "timeline_conflict",
            95
        );
    }

    @Override
    public List<ReviewIssue> check(ReviewContext context) {
        Chapter currentChapter = context.getCurrentChapter();
        if (currentChapter == null || currentChapter.getContent() == null) {
            return noIssues();
        }

        List<StoryEvent> events = context.getStoryEvents();
        if (events == null || events.isEmpty()) {
            return noIssues();
        }

        List<ReviewIssue> issues = new ArrayList<>();
        String content = currentChapter.getContent();
        int currentChapterOrder = currentChapter.getOrderNum();

        // 按时间线顺序排序事件
        List<StoryEvent> sortedEvents = new ArrayList<>(events);
        sortedEvents.sort(Comparator.comparingInt(e -> e.getTimelineOrder() != null ? e.getTimelineOrder() : 0));

        // 获取当前章节之前的事件
        List<StoryEvent> pastEvents = new ArrayList<>();
        for (StoryEvent event : sortedEvents) {
            if (event.getChapterOrder() != null && event.getChapterOrder() < currentChapterOrder) {
                pastEvents.add(event);
            }
        }

        // 检查时间描述冲突
        issues.addAll(checkTimeDescriptionConflicts(context, content, currentChapter, pastEvents));

        // 检查事件顺序引用冲突
        issues.addAll(checkEventOrderConflicts(context, content, currentChapter, sortedEvents));

        return issues;
    }

    /**
     * 检查时间描述冲突
     */
    private List<ReviewIssue> checkTimeDescriptionConflicts(
            ReviewContext context,
            String content,
            Chapter currentChapter,
            List<StoryEvent> pastEvents) {

        List<ReviewIssue> issues = new ArrayList<>();
        String[] paragraphs = content.split("\n");

        for (int paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex++) {
            String paragraph = paragraphs[paragraphIndex];

            // 检查是否提到过去的事件发生在"之后"的矛盾表述
            for (StoryEvent pastEvent : pastEvents) {
                String eventTitle = pastEvent.getTitle();
                if (eventTitle != null && paragraph.contains(eventTitle)) {
                    // 检查是否有矛盾的时间表述
                    for (String afterWord : AFTER_WORDS) {
                        if (paragraph.contains(eventTitle + afterWord) ||
                            paragraph.contains(afterWord + eventTitle)) {
                            issues.add(createTimelineIssue(
                                context,
                                currentChapter,
                                paragraphIndex,
                                "时间线矛盾：事件顺序错误",
                                String.format("事件「%s」发生在第%d章，但当前章节(第%d章)描述其在「%s」，与时间线矛盾",
                                    eventTitle,
                                    pastEvent.getChapterOrder(),
                                    currentChapter.getOrderNum(),
                                    afterWord),
                                paragraph,
                                pastEvent
                            ));
                        }
                    }
                }
            }
        }

        return issues;
    }

    /**
     * 检查事件顺序引用冲突
     */
    private List<ReviewIssue> checkEventOrderConflicts(
            ReviewContext context,
            String content,
            Chapter currentChapter,
            List<StoryEvent> sortedEvents) {

        List<ReviewIssue> issues = new ArrayList<>();
        String[] paragraphs = content.split("\n");

        // 构建事件提及的位置映射
        Map<String, List<Integer>> eventMentions = new HashMap<>();
        for (int i = 0; i < paragraphs.length; i++) {
            String paragraph = paragraphs[i];
            for (StoryEvent event : sortedEvents) {
                if (event.getTitle() != null && paragraph.contains(event.getTitle())) {
                    eventMentions.computeIfAbsent(event.getId(), k -> new ArrayList<>()).add(i);
                }
            }
        }

        // 检查同一段落中提及多个事件时的顺序
        for (int paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex++) {
            String paragraph = paragraphs[paragraphIndex];
            List<StoryEvent> mentionedEvents = new ArrayList<>();

            for (StoryEvent event : sortedEvents) {
                if (event.getTitle() != null && paragraph.contains(event.getTitle())) {
                    mentionedEvents.add(event);
                }
            }

            // 如果一个段落提及了多个事件，检查描述顺序是否与时间线一致
            if (mentionedEvents.size() >= 2) {
                for (int i = 0; i < mentionedEvents.size() - 1; i++) {
                    StoryEvent event1 = mentionedEvents.get(i);
                    StoryEvent event2 = mentionedEvents.get(i + 1);

                    int pos1 = paragraph.indexOf(event1.getTitle());
                    int pos2 = paragraph.indexOf(event2.getTitle());

                    Integer order1 = event1.getTimelineOrder();
                    Integer order2 = event2.getTimelineOrder();

                    if (order1 != null && order2 != null) {
                        // 检查是否有"先...后"这样的顺序描述
                        String between = paragraph.substring(Math.min(pos1, pos2), Math.max(pos1 + event1.getTitle().length(), pos2 + event2.getTitle().length()));

                        boolean hasBeforeWord = BEFORE_WORDS.stream().anyMatch(between::contains);
                        boolean hasAfterWord = AFTER_WORDS.stream().anyMatch(between::contains);

                        if (hasBeforeWord || hasAfterWord) {
                            // 根据文本中的先后顺序判断
                            boolean textOrder = pos1 < pos2; // event1在文本中先出现
                            boolean timelineOrder = order1 < order2; // event1在时间线上先发生

                            if (hasBeforeWord && textOrder != timelineOrder) {
                                issues.add(createTimelineIssue(
                                    context,
                                    currentChapter,
                                    paragraphIndex,
                                    "时间线矛盾：事件顺序描述错误",
                                    String.format("「%s」和「%s」的时间顺序描述与实际时间线不符",
                                        event1.getTitle(), event2.getTitle()),
                                    paragraph,
                                    event1
                                ));
                            }
                        }
                    }
                }
            }
        }

        return issues;
    }

    /**
     * 创建时间线问题
     */
    private ReviewIssue createTimelineIssue(
            ReviewContext context,
            Chapter chapter,
            int paragraphIndex,
            String title,
            String description,
            String originalText,
            StoryEvent relatedEvent) {

        Map<String, Object> location = new HashMap<>();
        location.put("paragraph", paragraphIndex);
        location.put("originalText", originalText.length() > 200 ? originalText.substring(0, 200) + "..." : originalText);

        Map<String, Object> reference = new HashMap<>();
        if (relatedEvent != null) {
            reference.put("chapterId", relatedEvent.getChapterId());
            reference.put("chapterOrder", relatedEvent.getChapterOrder());
            reference.put("eventTitle", relatedEvent.getTitle());
            reference.put("timelineOrder", relatedEvent.getTimelineOrder());
        }

        return ReviewIssue.builder()
                .bookId(context.getBook().getId())
                .chapterId(chapter.getId())
                .chapterOrder(chapter.getOrderNum())
                .level(getLevel())
                .type(getType())
                .title(title)
                .description(description)
                .location(location)
                .suggestion("请检查并修正时间描述，确保与故事时间线一致")
                .reference(reference)
                .confidence(new BigDecimal("0.85"))
                .status("open")
                .build();
    }
}
