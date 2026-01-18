package com.novelai.studio.entity;

import com.baomidou.mybatisplus.annotation.*;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import lombok.Data;
import lombok.Builder;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.Map;

/**
 * 审查问题实体
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@TableName(value = "review_issues", autoResultMap = true)
public class ReviewIssue {

    @TableId(type = IdType.ASSIGN_UUID)
    private String id;

    /**
     * 所属书籍ID
     */
    private String bookId;

    /**
     * 所属章节ID
     */
    private String chapterId;

    /**
     * 章节序号
     */
    private Integer chapterOrder;

    /**
     * 级别：error/warning/suggestion/info
     * Level A = error
     * Level B = warning
     * Level C = suggestion
     * Level D = info
     */
    private String level;

    /**
     * 问题类型
     * Level A: character_death_conflict, name_inconsistency, timeline_conflict, power_level_conflict, location_conflict
     * Level B: personality_deviation, ability_exceeded, setting_conflict, item_anomaly
     * Level C: causality_doubt, pacing_issue, emotion_abrupt, foreshadow_forgotten
     * Level D: viewpoint_drift, style_inconsistency
     */
    private String type;

    /**
     * 问题标题
     */
    private String title;

    /**
     * 问题描述
     */
    private String description;

    /**
     * 位置信息（JSON格式）
     * {paragraph: number, startOffset?: number, endOffset?: number, originalText?: string}
     */
    @TableField(typeHandler = JacksonTypeHandler.class)
    private Map<String, Object> location;

    /**
     * 修改建议
     */
    private String suggestion;

    /**
     * 参考信息（JSON格式）
     * {chapterId?: string, chapterOrder?: number, text?: string}
     */
    @TableField(typeHandler = JacksonTypeHandler.class)
    private Map<String, Object> reference;

    /**
     * 置信度（AI检测时）
     */
    private BigDecimal confidence;

    /**
     * 状态：open/fixed/ignored
     */
    @Builder.Default
    private String status = "open";

    /**
     * 创建时间
     */
    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    /**
     * 更新时间
     */
    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;
}
