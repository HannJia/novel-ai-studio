package com.novelai.studio.service;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.novelai.studio.entity.Chapter;
import com.novelai.studio.entity.StoryEvent;
import com.novelai.studio.mapper.StoryEventMapper;
import com.novelai.studio.service.ai.AIService;
import com.novelai.studio.service.ai.dto.GenerateResult;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

/**
 * 故事事件服务（L3长期记忆）
 */
@Service
public class StoryEventService extends ServiceImpl<StoryEventMapper, StoryEvent> {

    @Autowired
    private StoryEventMapper storyEventMapper;

    @Autowired
    private ChapterService chapterService;

    @Autowired
    private AIService aiService;

    /**
     * 获取书籍的所有事件
     */
    public List<StoryEvent> getByBookId(String bookId) {
        return storyEventMapper.selectByBookId(bookId);
    }

    /**
     * 获取章节的所有事件
     */
    public List<StoryEvent> getByChapterId(String chapterId) {
        return storyEventMapper.selectByChapterId(chapterId);
    }

    /**
     * 获取书籍的主要事件
     */
    public List<StoryEvent> getMajorEvents(String bookId) {
        return storyEventMapper.selectMajorEvents(bookId);
    }

    /**
     * 获取涉及特定角色的事件
     */
    public List<StoryEvent> getByCharacter(String bookId, String characterId) {
        return storyEventMapper.selectByCharacter(bookId, characterId);
    }

    /**
     * 获取指定章节之前的所有事件
     */
    public List<StoryEvent> getBeforeChapter(String bookId, int beforeOrder) {
        return storyEventMapper.selectBeforeChapter(bookId, beforeOrder);
    }

    /**
     * 创建事件
     */
    public StoryEvent createEvent(StoryEvent event) {
        // 设置时间线序号
        if (event.getTimelineOrder() == null) {
            event.setTimelineOrder(storyEventMapper.getNextTimelineOrder(event.getBookId()));
        }
        save(event);
        return event;
    }

    /**
     * 批量创建事件
     */
    public List<StoryEvent> createEvents(List<StoryEvent> events) {
        for (StoryEvent event : events) {
            if (event.getTimelineOrder() == null) {
                event.setTimelineOrder(storyEventMapper.getNextTimelineOrder(event.getBookId()));
            }
        }
        saveBatch(events);
        return events;
    }

    /**
     * 从章节内容中提取事件（AI辅助）
     */
    public List<StoryEvent> extractEventsFromChapter(String chapterId) {
        Chapter chapter = chapterService.getById(chapterId);
        if (chapter == null || chapter.getContent() == null || chapter.getContent().isEmpty()) {
            return new ArrayList<>();
        }

        // 构建AI提示
        String prompt = buildEventExtractionPrompt(chapter);

        // 调用AI提取事件
        GenerateResult result = aiService.generate(prompt);
        if (result == null || result.getContent() == null || result.getContent().isEmpty()) {
            return new ArrayList<>();
        }

        // 解析AI响应
        List<StoryEvent> events = parseEventResponse(result.getContent(), chapter);

        // 保存事件
        if (!events.isEmpty()) {
            saveBatch(events);
        }

        return events;
    }

    /**
     * 构建事件提取的AI提示
     */
    private String buildEventExtractionPrompt(Chapter chapter) {
        StringBuilder prompt = new StringBuilder();
        prompt.append("请从以下小说章节中提取重要事件。\n\n");
        prompt.append("【章节标题】").append(chapter.getTitle()).append("\n\n");
        prompt.append("【章节内容】\n").append(chapter.getContent()).append("\n\n");
        prompt.append("请按以下JSON数组格式输出事件列表：\n");
        prompt.append("[\n");
        prompt.append("  {\n");
        prompt.append("    \"title\": \"事件标题（简短概括）\",\n");
        prompt.append("    \"description\": \"事件详细描述\",\n");
        prompt.append("    \"eventType\": \"事件类型：major（重大）/minor（次要）/background（背景）\",\n");
        prompt.append("    \"involvedCharacters\": [\"涉及角色名1\", \"涉及角色名2\"],\n");
        prompt.append("    \"location\": \"发生地点\",\n");
        prompt.append("    \"impact\": \"事件对剧情的影响\"\n");
        prompt.append("  }\n");
        prompt.append("]\n\n");
        prompt.append("注意：\n");
        prompt.append("1. 只提取对剧情有意义的事件，忽略日常琐事\n");
        prompt.append("2. 按事件在章节中出现的顺序排列\n");
        prompt.append("3. 重大事件（major）指影响主线剧情的关键转折\n");
        prompt.append("4. 次要事件（minor）指对角色或支线有影响的事件\n");
        prompt.append("5. 背景事件（background）指丰富世界观的事件\n");
        return prompt.toString();
    }

    /**
     * 解析AI响应为事件列表
     */
    @SuppressWarnings("unchecked")
    private List<StoryEvent> parseEventResponse(String response, Chapter chapter) {
        List<StoryEvent> events = new ArrayList<>();
        int nextTimelineOrder = storyEventMapper.getNextTimelineOrder(chapter.getBookId());

        try {
            // 提取JSON数组部分
            int jsonStart = response.indexOf("[");
            int jsonEnd = response.lastIndexOf("]") + 1;
            if (jsonStart >= 0 && jsonEnd > jsonStart) {
                String jsonStr = response.substring(jsonStart, jsonEnd);
                com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
                List<java.util.Map<String, Object>> jsonList = mapper.readValue(jsonStr, List.class);

                for (java.util.Map<String, Object> json : jsonList) {
                    StoryEvent event = new StoryEvent();
                    event.setBookId(chapter.getBookId());
                    event.setChapterId(chapter.getId());
                    event.setChapterOrder(chapter.getOrderNum());
                    event.setTitle((String) json.get("title"));
                    event.setDescription((String) json.get("description"));
                    event.setEventType((String) json.get("eventType"));
                    event.setLocation((String) json.get("location"));
                    event.setImpact((String) json.get("impact"));
                    event.setTimelineOrder(nextTimelineOrder++);

                    Object characters = json.get("involvedCharacters");
                    if (characters instanceof List) {
                        event.setInvolvedCharacters(((List<?>) characters).stream()
                                .map(Object::toString)
                                .collect(Collectors.toList()));
                    }

                    events.add(event);
                }
            }
        } catch (Exception e) {
            // 解析失败，返回空列表
        }

        return events;
    }

    /**
     * 构建事件时间线上下文（用于AI生成）
     */
    public String buildTimelineContext(String bookId, int currentChapterOrder) {
        List<StoryEvent> events = getBeforeChapter(bookId, currentChapterOrder);
        if (events.isEmpty()) {
            return "";
        }

        // 只取主要事件
        List<StoryEvent> majorEvents = events.stream()
                .filter(e -> "major".equals(e.getEventType()))
                .collect(Collectors.toList());

        if (majorEvents.isEmpty()) {
            return "";
        }

        StringBuilder context = new StringBuilder();
        context.append("【重要事件回顾】\n\n");

        for (StoryEvent e : majorEvents) {
            context.append("- ").append(e.getTitle());
            if (e.getImpact() != null && !e.getImpact().isEmpty()) {
                context.append("（").append(e.getImpact()).append("）");
            }
            context.append("\n");
        }

        return context.toString();
    }

    /**
     * 删除章节的所有事件
     */
    public void deleteByChapterId(String chapterId) {
        List<StoryEvent> events = getByChapterId(chapterId);
        if (!events.isEmpty()) {
            removeByIds(events.stream().map(StoryEvent::getId).collect(Collectors.toList()));
        }
    }
}
