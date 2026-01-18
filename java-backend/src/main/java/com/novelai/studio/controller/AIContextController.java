package com.novelai.studio.controller;

import com.novelai.studio.common.Result;
import com.novelai.studio.service.ai.AIContextEnhancer;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * AI上下文增强控制器
 */
@RestController
@RequestMapping("/api/ai/context")
public class AIContextController {

    @Autowired
    private AIContextEnhancer aiContextEnhancer;

    /**
     * 获取增强上下文
     */
    @GetMapping("/enhanced/{bookId}")
    public Result<String> getEnhancedContext(
            @PathVariable String bookId,
            @RequestParam(required = false) String query,
            @RequestParam(defaultValue = "true") boolean includeCharacters,
            @RequestParam(defaultValue = "true") boolean includeSettings,
            @RequestParam(defaultValue = "true") boolean includeKnowledge) {

        String context = aiContextEnhancer.buildEnhancedContext(
                bookId, query, includeCharacters, includeSettings, includeKnowledge);
        return Result.success(context);
    }

    /**
     * 获取角色上下文
     */
    @GetMapping("/characters/{bookId}")
    public Result<String> getCharacterContext(@PathVariable String bookId) {
        String context = aiContextEnhancer.buildCharacterContext(bookId);
        return Result.success(context);
    }

    /**
     * 获取设定上下文
     */
    @GetMapping("/settings/{bookId}")
    public Result<String> getSettingContext(@PathVariable String bookId) {
        String context = aiContextEnhancer.buildSettingContext(bookId);
        return Result.success(context);
    }

    /**
     * 获取章节生成上下文
     */
    @PostMapping("/chapter/{bookId}")
    public Result<String> getChapterContext(
            @PathVariable String bookId,
            @RequestBody Map<String, String> request) {

        String chapterTitle = request.get("chapterTitle");
        String previousContent = request.get("previousContent");

        String context = aiContextEnhancer.buildChapterContext(bookId, chapterTitle, previousContent);
        return Result.success(context);
    }
}
