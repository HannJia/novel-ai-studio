package com.novelai.studio.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 书籍实体
 */
@Data
@TableName("books")
public class Book {

    @TableId(type = IdType.ASSIGN_UUID)
    private String id;

    /**
     * 书名
     */
    private String title;

    /**
     * 作者
     */
    private String author;

    /**
     * 类型：xuanhuan/dushi/kehuan等
     */
    private String genre;

    /**
     * 风格：qingsong/yansu/rexue等
     */
    private String style;

    /**
     * 简介
     */
    private String description;

    /**
     * 全书大纲
     */
    private String outline;

    /**
     * 分卷大纲（JSON格式存储）
     */
    private String volumes;

    /**
     * 封面图片路径
     */
    private String coverImage;

    /**
     * 状态：writing/paused/completed
     */
    private String status;

    /**
     * 总字数（不含标点）
     */
    private Integer wordCount;

    /**
     * 章节数
     */
    private Integer chapterCount;

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
