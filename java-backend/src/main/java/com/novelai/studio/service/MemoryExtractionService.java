package com.novelai.studio.service;

import com.novelai.studio.entity.Chapter;
import com.novelai.studio.entity.ChapterSummary;
import com.novelai.studio.entity.CharacterStateChange;
import com.novelai.studio.entity.StoryEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 记忆自动提取服务
 * 章节保存后自动提取摘要、事件、角色状态变化等记忆信息
 */
@Service
public class MemoryExtractionService {

    private static final Logger log = LoggerFactory.getLogger(MemoryExtractionService.class);

    @Autowired
    private ChapterService chapterService;

    @Autowired
    private ChapterSummaryService chapterSummaryService;

    @Autowired
    private StoryEventService storyEventService;

    @Autowired
    private CharacterStateChangeService characterStateChangeService;

    /**
     * 异步提取章节的所有记忆信息
     * 包括：摘要（L2）、事件（L3）、角色状态变化
     */
    @Async
    public void extractMemoryAsync(String chapterId) {
        log.info("开始异步提取章节记忆: {}", chapterId);

        try {
            Chapter chapter = chapterService.getById(chapterId);
            if (chapter == null || chapter.getContent() == null || chapter.getContent().isEmpty()) {
                log.warn("章节不存在或内容为空: {}", chapterId);
                return;
            }

            // 1. 提取章节摘要（L2短期记忆）
            extractSummary(chapterId);

            // 2. 提取故事事件（L3长期记忆）
            extractEvents(chapterId);

            // 3. 提取角色状态变化
            extractCharacterStateChanges(chapterId);

            log.info("章节记忆提取完成: {}", chapterId);
        } catch (Exception e) {
            log.error("章节记忆提取失败: {}", chapterId, e);
        }
    }

    /**
     * 提取章节摘要
     */
    public ChapterSummary extractSummary(String chapterId) {
        log.info("提取章节摘要: {}", chapterId);
        try {
            ChapterSummary summary = chapterSummaryService.generateSummary(chapterId);
            if (summary != null) {
                log.info("章节摘要提取成功: {}", chapterId);
            }
            return summary;
        } catch (Exception e) {
            log.error("章节摘要提取失败: {}", chapterId, e);
            return null;
        }
    }

    /**
     * 提取故事事件
     */
    public List<StoryEvent> extractEvents(String chapterId) {
        log.info("提取故事事件: {}", chapterId);
        try {
            // 先删除该章节的旧事件
            storyEventService.deleteByChapterId(chapterId);

            // 提取新事件
            List<StoryEvent> events = storyEventService.extractEventsFromChapter(chapterId);
            log.info("故事事件提取成功: {} 个事件, 章节: {}", events.size(), chapterId);
            return events;
        } catch (Exception e) {
            log.error("故事事件提取失败: {}", chapterId, e);
            return List.of();
        }
    }

    /**
     * 提取角色状态变化
     */
    public List<CharacterStateChange> extractCharacterStateChanges(String chapterId) {
        log.info("提取角色状态变化: {}", chapterId);
        try {
            List<CharacterStateChange> changes = characterStateChangeService.extractFromChapter(chapterId);
            log.info("角色状态变化提取成功: {} 个变化, 章节: {}", changes.size(), chapterId);
            return changes;
        } catch (Exception e) {
            log.error("角色状态变化提取失败: {}", chapterId, e);
            return List.of();
        }
    }

    /**
     * 同步提取所有记忆（用于手动触发）
     */
    public MemoryExtractionResult extractMemorySync(String chapterId) {
        log.info("开始同步提取章节记忆: {}", chapterId);

        MemoryExtractionResult result = new MemoryExtractionResult();

        Chapter chapter = chapterService.getById(chapterId);
        if (chapter == null || chapter.getContent() == null || chapter.getContent().isEmpty()) {
            result.setSuccess(false);
            result.setMessage("章节不存在或内容为空");
            return result;
        }

        result.setSummary(extractSummary(chapterId));
        result.setEvents(extractEvents(chapterId));
        result.setStateChanges(extractCharacterStateChanges(chapterId));
        result.setSuccess(true);
        result.setMessage("记忆提取完成");

        return result;
    }

    /**
     * 批量提取书籍所有章节的记忆
     */
    @Async
    public void extractBookMemoryAsync(String bookId) {
        log.info("开始批量提取书籍记忆: {}", bookId);

        List<Chapter> chapters = chapterService.getChaptersByBook(bookId);
        for (Chapter chapter : chapters) {
            if (chapter.getContent() != null && !chapter.getContent().isEmpty()) {
                try {
                    extractMemoryAsync(chapter.getId());
                    // 避免过于频繁的API调用
                    Thread.sleep(1000);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }

        log.info("书籍记忆批量提取完成: {}", bookId);
    }

    /**
     * 记忆提取结果
     */
    public static class MemoryExtractionResult {
        private boolean success;
        private String message;
        private ChapterSummary summary;
        private List<StoryEvent> events;
        private List<CharacterStateChange> stateChanges;

        public boolean isSuccess() {
            return success;
        }

        public void setSuccess(boolean success) {
            this.success = success;
        }

        public String getMessage() {
            return message;
        }

        public void setMessage(String message) {
            this.message = message;
        }

        public ChapterSummary getSummary() {
            return summary;
        }

        public void setSummary(ChapterSummary summary) {
            this.summary = summary;
        }

        public List<StoryEvent> getEvents() {
            return events;
        }

        public void setEvents(List<StoryEvent> events) {
            this.events = events;
        }

        public List<CharacterStateChange> getStateChanges() {
            return stateChanges;
        }

        public void setStateChanges(List<CharacterStateChange> stateChanges) {
            this.stateChanges = stateChanges;
        }
    }
}
