package com.novelai.studio.service.review;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.util.Arrays;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 实时审查服务
 * 提供章节保存时的自动审查功能
 */
@Service
public class RealtimeReviewService {

    private static final Logger log = LoggerFactory.getLogger(RealtimeReviewService.class);

    @Autowired
    private RuleEngineService ruleEngineService;

    /**
     * 防抖时间（毫秒）
     */
    private static final long DEBOUNCE_TIME = 3000;

    /**
     * 最后审查时间记录
     */
    private final Map<String, Long> lastReviewTime = new ConcurrentHashMap<>();

    /**
     * 审查结果缓存
     */
    private final Map<String, ReviewReport> reviewCache = new ConcurrentHashMap<>();

    /**
     * 章节保存时触发的快速审查
     * 仅执行Level A规则（确定性错误）
     */
    @Async
    public void onChapterSaved(String bookId, String chapterId) {
        String key = chapterId;

        // 防抖处理
        long now = System.currentTimeMillis();
        Long lastTime = lastReviewTime.get(key);
        if (lastTime != null && now - lastTime < DEBOUNCE_TIME) {
            log.debug("Debouncing review for chapter: {}", chapterId);
            return;
        }
        lastReviewTime.put(key, now);

        try {
            log.info("Starting realtime review for chapter: {}", chapterId);

            // 只执行Level A规则
            ReviewReport report = ruleEngineService.reviewChapter(
                    bookId,
                    chapterId,
                    Arrays.asList(ReviewLevel.ERROR)
            );

            // 缓存结果
            reviewCache.put(key, report);

            log.info("Realtime review completed for chapter: {}, found {} issues",
                    chapterId, report.getTotalIssues());

        } catch (Exception e) {
            log.error("Realtime review failed for chapter: {}", chapterId, e);
        }
    }

    /**
     * 获取章节的最新审查报告（来自缓存）
     */
    public ReviewReport getCachedReport(String chapterId) {
        return reviewCache.get(chapterId);
    }

    /**
     * 清除章节的审查缓存
     */
    public void clearCache(String chapterId) {
        reviewCache.remove(chapterId);
        lastReviewTime.remove(chapterId);
    }

    /**
     * 清除所有缓存
     */
    public void clearAllCache() {
        reviewCache.clear();
        lastReviewTime.clear();
    }

    /**
     * 手动触发实时审查
     */
    public ReviewReport triggerReview(String bookId, String chapterId) {
        try {
            ReviewReport report = ruleEngineService.reviewChapter(
                    bookId,
                    chapterId,
                    Arrays.asList(ReviewLevel.ERROR)
            );
            reviewCache.put(chapterId, report);
            return report;
        } catch (Exception e) {
            log.error("Manual realtime review failed: {}", e.getMessage(), e);
            return null;
        }
    }
}
