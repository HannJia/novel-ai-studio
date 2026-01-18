package com.novelai.studio.service.review;

import com.novelai.studio.entity.ReviewIssue;
import lombok.Data;
import lombok.Builder;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 审查报告
 */
@Data
@Builder
public class ReviewReport {

    /**
     * 报告ID
     */
    private String id;

    /**
     * 书籍ID
     */
    private String bookId;

    /**
     * 审查的章节ID列表
     */
    private List<String> chapterIds;

    /**
     * 问题总数
     */
    private int totalIssues;

    /**
     * 按级别统计
     */
    private Map<String, Integer> issuesByLevel;

    /**
     * 按类型统计
     */
    private Map<String, Integer> issuesByType;

    /**
     * 所有问题
     */
    private List<ReviewIssue> issues;

    /**
     * 审查开始时间
     */
    private LocalDateTime startTime;

    /**
     * 审查结束时间
     */
    private LocalDateTime endTime;

    /**
     * 审查耗时（毫秒）
     */
    private long duration;

    /**
     * 审查模式
     */
    private String reviewMode;

    /**
     * 执行的规则数量
     */
    private int rulesExecuted;
}
