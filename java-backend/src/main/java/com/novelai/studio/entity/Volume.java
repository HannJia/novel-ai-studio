package com.novelai.studio.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 卷实体
 */
@Data
@TableName("volumes")
public class Volume {

    @TableId(type = IdType.ASSIGN_UUID)
    private String id;

    /**
     * 所属书籍ID
     */
    private String bookId;

    /**
     * 卷名
     */
    private String title;

    /**
     * 排序序号
     */
    private Integer orderNum;

    /**
     * 字数
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
