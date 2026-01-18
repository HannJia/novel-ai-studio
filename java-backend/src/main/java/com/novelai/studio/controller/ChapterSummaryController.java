package com.novelai.studio.controller;

import com.novelai.studio.common.Result;
import com.novelai.studio.entity.ChapterSummary;
import com.novelai.studio.service.ChapterSummaryService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 章节摘要控制器
 */
@RestController
@RequestMapping("/api/summaries")
public class ChapterSummaryController {

    @Autowired
    private ChapterSummaryService chapterSummaryService;

    /**
     * 获取章节的摘要
     */
    @GetMapping("/chapter/{chapterId}")
    public Result<ChapterSummary> getByChapterId(@PathVariable String chapterId) {
        ChapterSummary summary = chapterSummaryService.getByChapterId(chapterId);
        return Result.success(summary);
    }

    /**
     * 获取书籍的所有章节摘要
     */
    @GetMapping("/book/{bookId}")
    public Result<List<ChapterSummary>> getByBookId(@PathVariable String bookId) {
        List<ChapterSummary> summaries = chapterSummaryService.getByBookId(bookId);
        return Result.success(summaries);
    }

    /**
     * 获取指定章节之前的所有摘要
     */
    @GetMapping("/book/{bookId}/before/{chapterOrder}")
    public Result<List<ChapterSummary>> getBeforeChapter(
            @PathVariable String bookId,
            @PathVariable int chapterOrder) {
        List<ChapterSummary> summaries = chapterSummaryService.getBeforeChapter(bookId, chapterOrder);
        return Result.success(summaries);
    }

    /**
     * 获取最近N章的摘要
     */
    @GetMapping("/book/{bookId}/recent")
    public Result<List<ChapterSummary>> getRecentSummaries(
            @PathVariable String bookId,
            @RequestParam(defaultValue = "5") int limit) {
        List<ChapterSummary> summaries = chapterSummaryService.getRecentSummaries(bookId, limit);
        return Result.success(summaries);
    }

    /**
     * AI生成章节摘要
     */
    @PostMapping("/generate/{chapterId}")
    public Result<ChapterSummary> generateSummary(@PathVariable String chapterId) {
        ChapterSummary summary = chapterSummaryService.generateSummary(chapterId);
        if (summary == null) {
            return Result.error("生成摘要失败，请检查章节内容");
        }
        return Result.success(summary);
    }

    /**
     * 手动保存/更新摘要
     */
    @PostMapping
    public Result<ChapterSummary> saveSummary(@RequestBody ChapterSummary summary) {
        ChapterSummary saved = chapterSummaryService.saveSummary(summary);
        return Result.success(saved);
    }

    /**
     * 更新摘要
     */
    @PutMapping("/{id}")
    public Result<ChapterSummary> updateSummary(@PathVariable String id, @RequestBody ChapterSummary summary) {
        summary.setId(id);
        chapterSummaryService.updateById(summary);
        return Result.success(summary);
    }

    /**
     * 删除摘要
     */
    @DeleteMapping("/{id}")
    public Result<Void> deleteSummary(@PathVariable String id) {
        chapterSummaryService.removeById(id);
        return Result.success(null);
    }

    /**
     * 删除章节的摘要
     */
    @DeleteMapping("/chapter/{chapterId}")
    public Result<Void> deleteByChapterId(@PathVariable String chapterId) {
        chapterSummaryService.deleteByChapterId(chapterId);
        return Result.success(null);
    }

    /**
     * 构建前文摘要上下文
     */
    @GetMapping("/context/{bookId}/{chapterOrder}")
    public Result<String> buildPreviousContext(
            @PathVariable String bookId,
            @PathVariable int chapterOrder,
            @RequestParam(defaultValue = "10") int maxChapters) {
        String context = chapterSummaryService.buildPreviousContext(bookId, chapterOrder, maxChapters);
        return Result.success(context);
    }
}
