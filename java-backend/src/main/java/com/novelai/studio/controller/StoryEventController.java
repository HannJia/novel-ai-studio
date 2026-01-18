package com.novelai.studio.controller;

import com.novelai.studio.common.Result;
import com.novelai.studio.entity.StoryEvent;
import com.novelai.studio.service.StoryEventService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 故事事件控制器
 */
@RestController
@RequestMapping("/api/events")
public class StoryEventController {

    @Autowired
    private StoryEventService storyEventService;

    /**
     * 获取书籍的所有事件
     */
    @GetMapping("/book/{bookId}")
    public Result<List<StoryEvent>> getByBookId(@PathVariable String bookId) {
        List<StoryEvent> events = storyEventService.getByBookId(bookId);
        return Result.success(events);
    }

    /**
     * 获取章节的所有事件
     */
    @GetMapping("/chapter/{chapterId}")
    public Result<List<StoryEvent>> getByChapterId(@PathVariable String chapterId) {
        List<StoryEvent> events = storyEventService.getByChapterId(chapterId);
        return Result.success(events);
    }

    /**
     * 获取书籍的主要事件
     */
    @GetMapping("/book/{bookId}/major")
    public Result<List<StoryEvent>> getMajorEvents(@PathVariable String bookId) {
        List<StoryEvent> events = storyEventService.getMajorEvents(bookId);
        return Result.success(events);
    }

    /**
     * 获取涉及特定角色的事件
     */
    @GetMapping("/book/{bookId}/character/{characterId}")
    public Result<List<StoryEvent>> getByCharacter(
            @PathVariable String bookId,
            @PathVariable String characterId) {
        List<StoryEvent> events = storyEventService.getByCharacter(bookId, characterId);
        return Result.success(events);
    }

    /**
     * 获取指定章节之前的所有事件
     */
    @GetMapping("/book/{bookId}/before/{chapterOrder}")
    public Result<List<StoryEvent>> getBeforeChapter(
            @PathVariable String bookId,
            @PathVariable int chapterOrder) {
        List<StoryEvent> events = storyEventService.getBeforeChapter(bookId, chapterOrder);
        return Result.success(events);
    }

    /**
     * 获取事件详情
     */
    @GetMapping("/{id}")
    public Result<StoryEvent> getById(@PathVariable String id) {
        StoryEvent event = storyEventService.getById(id);
        return Result.success(event);
    }

    /**
     * 创建事件
     */
    @PostMapping
    public Result<StoryEvent> createEvent(@RequestBody StoryEvent event) {
        StoryEvent created = storyEventService.createEvent(event);
        return Result.success(created);
    }

    /**
     * 批量创建事件
     */
    @PostMapping("/batch")
    public Result<List<StoryEvent>> createEvents(@RequestBody List<StoryEvent> events) {
        List<StoryEvent> created = storyEventService.createEvents(events);
        return Result.success(created);
    }

    /**
     * AI从章节中提取事件
     */
    @PostMapping("/extract/{chapterId}")
    public Result<List<StoryEvent>> extractEvents(@PathVariable String chapterId) {
        List<StoryEvent> events = storyEventService.extractEventsFromChapter(chapterId);
        return Result.success(events);
    }

    /**
     * 更新事件
     */
    @PutMapping("/{id}")
    public Result<StoryEvent> updateEvent(@PathVariable String id, @RequestBody StoryEvent event) {
        event.setId(id);
        storyEventService.updateById(event);
        return Result.success(event);
    }

    /**
     * 删除事件
     */
    @DeleteMapping("/{id}")
    public Result<Void> deleteEvent(@PathVariable String id) {
        storyEventService.removeById(id);
        return Result.success(null);
    }

    /**
     * 删除章节的所有事件
     */
    @DeleteMapping("/chapter/{chapterId}")
    public Result<Void> deleteByChapterId(@PathVariable String chapterId) {
        storyEventService.deleteByChapterId(chapterId);
        return Result.success(null);
    }

    /**
     * 构建事件时间线上下文
     */
    @GetMapping("/context/{bookId}/{chapterOrder}")
    public Result<String> buildTimelineContext(
            @PathVariable String bookId,
            @PathVariable int chapterOrder) {
        String context = storyEventService.buildTimelineContext(bookId, chapterOrder);
        return Result.success(context);
    }
}
