package com.novelai.studio.controller;

import com.novelai.studio.common.Result;
import com.novelai.studio.entity.Chapter;
import com.novelai.studio.service.ChapterService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 章节控制器
 */
@RestController
@RequestMapping("/api/chapters")
public class ChapterController {

    @Autowired
    private ChapterService chapterService;

    /**
     * 获取书籍的章节列表
     */
    @GetMapping("/book/{bookId}")
    public Result<List<Chapter>> getChaptersByBook(@PathVariable String bookId) {
        List<Chapter> chapters = chapterService.getChaptersByBook(bookId);
        return Result.success(chapters);
    }

    /**
     * 获取章节详情
     */
    @GetMapping("/{id}")
    public Result<Chapter> getChapter(@PathVariable String id) {
        Chapter chapter = chapterService.getById(id);
        if (chapter == null) {
            return Result.notFound("章节不存在");
        }
        return Result.success(chapter);
    }

    /**
     * 创建章节
     */
    @PostMapping
    public Result<Chapter> createChapter(@RequestBody Chapter chapter) {
        if (chapter.getBookId() == null || chapter.getBookId().isEmpty()) {
            return Result.badRequest("书籍ID不能为空");
        }
        if (chapter.getTitle() == null || chapter.getTitle().isEmpty()) {
            return Result.badRequest("章节标题不能为空");
        }

        Chapter created = chapterService.createChapter(chapter);
        return Result.success(created);
    }

    /**
     * 更新章节
     */
    @PutMapping("/{id}")
    public Result<Chapter> updateChapter(@PathVariable String id, @RequestBody Chapter chapter) {
        Chapter updated = chapterService.updateChapter(id, chapter);
        if (updated == null) {
            return Result.notFound("章节不存在");
        }
        return Result.success(updated);
    }

    /**
     * 删除章节
     */
    @DeleteMapping("/{id}")
    public Result<Void> deleteChapter(@PathVariable String id) {
        boolean success = chapterService.deleteChapter(id);
        if (!success) {
            return Result.notFound("章节不存在");
        }
        return Result.success();
    }

    /**
     * 重新排序章节
     */
    @PostMapping("/book/{bookId}/reorder")
    public Result<Void> reorderChapters(
            @PathVariable String bookId,
            @RequestBody List<String> chapterIds) {
        chapterService.reorderChapters(bookId, chapterIds);
        return Result.success();
    }
}
