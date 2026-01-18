package com.novelai.studio.controller;

import com.novelai.studio.common.Result;
import com.novelai.studio.service.knowledge.KnowledgeSearchService;
import com.novelai.studio.service.knowledge.SearchResult;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.util.List;
import java.util.Map;

/**
 * 知识库检索控制器
 */
@RestController
@RequestMapping("/api/knowledge/search")
public class KnowledgeSearchController {

    @Autowired
    private KnowledgeSearchService knowledgeSearchService;

    /**
     * 索引文件
     */
    @PostMapping("/index/{fileId}")
    public Result<Integer> indexFile(@PathVariable String fileId) {
        try {
            int chunkCount = knowledgeSearchService.indexFile(fileId);
            return Result.success(chunkCount);
        } catch (IOException e) {
            return Result.error("索引失败: " + e.getMessage());
        }
    }

    /**
     * 搜索知识库
     */
    @GetMapping("/book/{bookId}")
    public Result<List<SearchResult>> search(
            @PathVariable String bookId,
            @RequestParam String query,
            @RequestParam(defaultValue = "5") int topK,
            @RequestParam(required = false) Float minRelevance) {
        String bid = "global".equals(bookId) ? null : bookId;
        List<SearchResult> results;
        if (minRelevance != null) {
            results = knowledgeSearchService.search(bid, query, topK, minRelevance);
        } else {
            results = knowledgeSearchService.search(bid, query, topK);
        }
        return Result.success(results);
    }

    /**
     * 搜索单个文件
     */
    @GetMapping("/file/{fileId}")
    public Result<List<SearchResult>> searchInFile(
            @PathVariable String fileId,
            @RequestParam String query,
            @RequestParam(defaultValue = "5") int topK,
            @RequestParam(required = false) Float minRelevance) {
        List<SearchResult> results;
        if (minRelevance != null) {
            results = knowledgeSearchService.searchInFile(fileId, query, topK, minRelevance);
        } else {
            results = knowledgeSearchService.searchInFile(fileId, query, topK);
        }
        return Result.success(results);
    }

    /**
     * 获取相关上下文（用于AI生成）
     */
    @GetMapping("/context/{bookId}")
    public Result<String> getRelevantContext(
            @PathVariable String bookId,
            @RequestParam String query,
            @RequestParam(defaultValue = "3") int maxChunks) {
        String bid = "global".equals(bookId) ? null : bookId;
        String context = knowledgeSearchService.getRelevantContext(bid, query, maxChunks);
        return Result.success(context);
    }

    /**
     * 清除文件索引
     */
    @DeleteMapping("/index/{fileId}")
    public Result<Void> clearIndex(@PathVariable String fileId) {
        knowledgeSearchService.clearIndex(fileId);
        return Result.success();
    }

    /**
     * 清除书籍所有索引
     */
    @DeleteMapping("/index/book/{bookId}")
    public Result<Void> clearBookIndex(@PathVariable String bookId) {
        String bid = "global".equals(bookId) ? null : bookId;
        knowledgeSearchService.clearBookIndex(bid);
        return Result.success();
    }

    /**
     * 获取当前相关度阈值
     */
    @GetMapping("/threshold")
    public Result<Float> getRelevanceThreshold() {
        return Result.success(knowledgeSearchService.getRelevanceThreshold());
    }

    /**
     * 设置相关度阈值
     */
    @PutMapping("/threshold")
    public Result<Float> setRelevanceThreshold(@RequestBody Map<String, Float> request) {
        Float threshold = request.get("threshold");
        if (threshold == null) {
            return Result.badRequest("阈值不能为空");
        }
        try {
            knowledgeSearchService.setRelevanceThreshold(threshold);
            return Result.success(threshold);
        } catch (IllegalArgumentException e) {
            return Result.badRequest(e.getMessage());
        }
    }
}
