package com.novelai.studio.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * AI任务分配配置实体
 */
@Data
@TableName("ai_task_assignments")
public class AiTaskAssignment {

    @TableId(type = IdType.ASSIGN_UUID)
    private String id;

    /**
     * 任务类型：generate/review/summary/chat/outline
     */
    private String taskType;

    /**
     * AI配置ID
     */
    private String aiConfigId;

    /**
     * 优先级（数字越大优先级越高）
     */
    private Integer priority;

    /**
     * 是否启用
     */
    private Boolean isEnabled;

    /**
     * 应用条件（JSON格式）
     */
    private String conditions;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;

    /**
     * 任务类型常量
     */
    public static final String TASK_GENERATE = "generate";
    public static final String TASK_REVIEW = "review";
    public static final String TASK_SUMMARY = "summary";
    public static final String TASK_CHAT = "chat";
    public static final String TASK_OUTLINE = "outline";
}
