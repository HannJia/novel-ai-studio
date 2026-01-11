package com.novelai.studio.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 章节实体
 */
@Data
@TableName("chapters")
public class Chapter {

    @TableId(type = IdType.ASSIGN_UUID)
    private String id;

    /**
     * 所属书籍ID
     */
    private String bookId;

    /**
     * 所属卷ID
     */
    private String volumeId;

    /**
     * 章节标题
     */
    private String title;

    /**
     * 章节正文
     */
    private String content;

    /**
     * 章节大纲
     */
    private String outline;

    /**
     * AI生成的摘要
     */
    private String summary;

    /**
     * 字数（不含标点）
     */
    private Integer wordCount;

    /**
     * 排序序号
     */
    private Integer orderNum;

    /**
     * 状态：draft/completed/reviewing
     */
    private String status;

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
