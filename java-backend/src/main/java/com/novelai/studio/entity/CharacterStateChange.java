package com.novelai.studio.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 角色状态变更记录实体
 */
@Data
@TableName("character_state_changes")
public class CharacterStateChange {

    @TableId(type = IdType.ASSIGN_UUID)
    private String id;

    /**
     * 角色ID
     */
    private String characterId;

    /**
     * 所属书籍ID
     */
    private String bookId;

    /**
     * 章节ID
     */
    private String chapterId;

    /**
     * 章节序号
     */
    private Integer chapterOrder;

    /**
     * 变更字段
     */
    private String field;

    /**
     * 旧值
     */
    private String oldValue;

    /**
     * 新值
     */
    private String newValue;

    /**
     * 变更原因
     */
    private String reason;

    /**
     * 创建时间
     */
    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;
}
