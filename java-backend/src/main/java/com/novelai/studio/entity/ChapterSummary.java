package com.novelai.studio.entity;

import com.baomidou.mybatisplus.annotation.*;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 章节摘要实体（L2短期记忆）
 */
@Data
@TableName(value = "chapter_summaries", autoResultMap = true)
public class ChapterSummary {

    @TableId(type = IdType.ASSIGN_UUID)
    private String id;

    /**
     * 章节ID
     */
    private String chapterId;

    /**
     * 所属书籍ID
     */
    private String bookId;

    /**
     * 章节序号
     */
    private Integer chapterOrder;

    /**
     * 摘要内容（500-1000字）
     */
    private String summary;

    /**
     * 关键事件列表
     */
    @TableField(typeHandler = JacksonTypeHandler.class)
    private List<String> keyEvents;

    /**
     * 出场角色ID列表
     */
    @TableField(typeHandler = JacksonTypeHandler.class)
    private List<String> charactersAppeared;

    /**
     * 情感基调
     */
    private String emotionalTone;

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
