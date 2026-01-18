package com.novelai.studio.controller;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.novelai.studio.common.Result;
import com.novelai.studio.entity.ReviewIssue;
import com.novelai.studio.mapper.ReviewIssueMapper;
import com.novelai.studio.service.review.ReviewLevel;
import com.novelai.studio.service.review.ReviewReport;
import com.novelai.studio.service.review.ReviewRule;
import com.novelai.studio.service.review.RuleEngineService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 审查控制器
 * 提供逻辑审查相关的API
 */
@RestController
@RequestMapping("/api/review")
public class ReviewController {

    @Autowired
    private RuleEngineService ruleEngineService;

    @Autowired
    private ReviewIssueMapper reviewIssueMapper;

    /**
     * 获取所有可用规则
     */
    @GetMapping("/rules")
    public Result<List<Map<String, Object>>> getRules() {
        List<ReviewRule> rules = ruleEngineService.getAllRules();
        List<Map<String, Object>> result = rules.stream()
                .map(r -> {
                    Map<String, Object> map = new HashMap<>();
                    map.put("name", r.getName());
                    map.put("description", r.getDescription());
                    map.put("level", r.getLevel());
                    map.put("type", r.getType());
                    map.put("requiresAI", r.requiresAI());
                    map.put("enabled", r.isEnabled());
                    map.put("priority", r.getPriority());
                    return map;
                })
                .collect(Collectors.toList());
        return Result.success(result);
    }

    /**
     * 审查单个章节
     */
    @PostMapping("/chapter/{bookId}/{chapterId}")
    public Result<ReviewReport> reviewChapter(
            @PathVariable String bookId,
            @PathVariable String chapterId,
            @RequestParam(required = false) String levels) {

        List<String> levelList = null;
        if (levels != null && !levels.isEmpty()) {
            levelList = Arrays.asList(levels.split(","));
        }

        ReviewReport report = ruleEngineService.reviewChapter(bookId, chapterId, levelList);
        return Result.success(report);
    }

    /**
     * 审查整本书
     */
    @PostMapping("/book/{bookId}")
    public Result<ReviewReport> reviewBook(
            @PathVariable String bookId,
            @RequestParam(required = false) String levels) {

        List<String> levelList = null;
        if (levels != null && !levels.isEmpty()) {
            levelList = Arrays.asList(levels.split(","));
        }

        ReviewReport report = ruleEngineService.reviewBook(bookId, levelList);
        return Result.success(report);
    }

    /**
     * 快速审查（仅Level A规则）
     */
    @PostMapping("/quick/{bookId}/{chapterId}")
    public Result<ReviewReport> quickReview(
            @PathVariable String bookId,
            @PathVariable String chapterId) {

        ReviewReport report = ruleEngineService.reviewChapter(bookId, chapterId,
                Arrays.asList(ReviewLevel.ERROR));
        return Result.success(report);
    }

    /**
     * 获取书籍的所有审查问题
     */
    @GetMapping("/issues/book/{bookId}")
    public Result<List<ReviewIssue>> getBookIssues(@PathVariable String bookId) {
        QueryWrapper<ReviewIssue> query = new QueryWrapper<>();
        query.eq("book_id", bookId).orderByDesc("created_at");
        List<ReviewIssue> issues = reviewIssueMapper.selectList(query);
        return Result.success(issues);
    }

    /**
     * 获取章节的审查问题
     */
    @GetMapping("/issues/chapter/{chapterId}")
    public Result<List<ReviewIssue>> getChapterIssues(@PathVariable String chapterId) {
        QueryWrapper<ReviewIssue> query = new QueryWrapper<>();
        query.eq("chapter_id", chapterId).orderByDesc("created_at");
        List<ReviewIssue> issues = reviewIssueMapper.selectList(query);
        return Result.success(issues);
    }

    /**
     * 获取书籍未解决的问题统计
     */
    @GetMapping("/stats/{bookId}")
    public Result<Map<String, Object>> getBookStats(@PathVariable String bookId) {
        QueryWrapper<ReviewIssue> query = new QueryWrapper<>();
        query.eq("book_id", bookId).eq("status", "open");
        List<ReviewIssue> openIssues = reviewIssueMapper.selectList(query);

        Map<String, Long> byLevel = openIssues.stream()
                .collect(Collectors.groupingBy(ReviewIssue::getLevel, Collectors.counting()));

        Map<String, Long> byType = openIssues.stream()
                .collect(Collectors.groupingBy(ReviewIssue::getType, Collectors.counting()));

        Map<String, Object> stats = new HashMap<>();
        stats.put("total", openIssues.size());
        stats.put("byLevel", byLevel);
        stats.put("byType", byType);
        stats.put("error", byLevel.getOrDefault("error", 0L));
        stats.put("warning", byLevel.getOrDefault("warning", 0L));
        stats.put("suggestion", byLevel.getOrDefault("suggestion", 0L));
        stats.put("info", byLevel.getOrDefault("info", 0L));

        return Result.success(stats);
    }

    /**
     * 更新问题状态
     */
    @PutMapping("/issues/{issueId}/status")
    public Result<Void> updateIssueStatus(
            @PathVariable String issueId,
            @RequestBody Map<String, String> body) {

        String status = body.get("status");
        if (status == null || (!status.equals("open") && !status.equals("fixed") && !status.equals("ignored"))) {
            return Result.error("无效的状态值");
        }

        UpdateWrapper<ReviewIssue> update = new UpdateWrapper<>();
        update.eq("id", issueId).set("status", status);
        reviewIssueMapper.update(null, update);

        return Result.success(null);
    }

    /**
     * 批量更新问题状态
     */
    @PutMapping("/issues/batch-status")
    public Result<Void> batchUpdateStatus(@RequestBody Map<String, Object> body) {
        @SuppressWarnings("unchecked")
        List<String> issueIds = (List<String>) body.get("issueIds");
        String status = (String) body.get("status");

        if (issueIds == null || issueIds.isEmpty()) {
            return Result.error("请选择要更新的问题");
        }
        if (status == null || (!status.equals("open") && !status.equals("fixed") && !status.equals("ignored"))) {
            return Result.error("无效的状态值");
        }

        UpdateWrapper<ReviewIssue> update = new UpdateWrapper<>();
        update.in("id", issueIds).set("status", status);
        reviewIssueMapper.update(null, update);

        return Result.success(null);
    }

    /**
     * 删除单个问题
     */
    @DeleteMapping("/issues/{issueId}")
    public Result<Void> deleteIssue(@PathVariable String issueId) {
        reviewIssueMapper.deleteById(issueId);
        return Result.success(null);
    }

    /**
     * 清除书籍的所有问题
     */
    @DeleteMapping("/issues/book/{bookId}")
    public Result<Void> clearBookIssues(@PathVariable String bookId) {
        QueryWrapper<ReviewIssue> query = new QueryWrapper<>();
        query.eq("book_id", bookId);
        reviewIssueMapper.delete(query);
        return Result.success(null);
    }

    /**
     * 获取单个问题详情
     */
    @GetMapping("/issues/{issueId}")
    public Result<ReviewIssue> getIssue(@PathVariable String issueId) {
        ReviewIssue issue = reviewIssueMapper.selectById(issueId);
        if (issue == null) {
            return Result.error("问题不存在");
        }
        return Result.success(issue);
    }
}
