package com.novelai.studio.controller;

import com.novelai.studio.common.Result;
import com.novelai.studio.service.MemoryExtractionService;
import com.novelai.studio.service.MemoryExtractionService.MemoryExtractionResult;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

/**
 * 记忆提取控制器
 * 用于手动触发记忆提取
 */
@RestController
@RequestMapping("/api/memory")
public class MemoryExtractionController {

    @Autowired
    private MemoryExtractionService memoryExtractionService;

    /**
     * 为章节提取记忆（同步）
     */
    @PostMapping("/extract/chapter/{chapterId}")
    public Result<MemoryExtractionResult> extractChapterMemory(@PathVariable String chapterId) {
        MemoryExtractionResult result = memoryExtractionService.extractMemorySync(chapterId);
        if (result.isSuccess()) {
            return Result.success(result);
        } else {
            return Result.badRequest(result.getMessage());
        }
    }

    /**
     * 为章节提取记忆（异步）
     */
    @PostMapping("/extract/chapter/{chapterId}/async")
    public Result<Void> extractChapterMemoryAsync(@PathVariable String chapterId) {
        memoryExtractionService.extractMemoryAsync(chapterId);
        return Result.success();
    }

    /**
     * 为书籍所有章节提取记忆（异步）
     */
    @PostMapping("/extract/book/{bookId}")
    public Result<Void> extractBookMemory(@PathVariable String bookId) {
        memoryExtractionService.extractBookMemoryAsync(bookId);
        return Result.success();
    }
}
