package com.novelai.studio.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * AI对话会话实体
 */
@Data
@TableName("chat_sessions")
public class ChatSession {

    @TableId(type = IdType.ASSIGN_UUID)
    private String id;

    /**
     * 关联书籍ID（可选）
     */
    private String bookId;

    /**
     * 会话标题
     */
    private String title;

    /**
     * 上下文类型：general/book/chapter/character
     */
    private String contextType;

    /**
     * 上下文关联ID
     */
    private String contextRefId;

    /**
     * 使用的AI配置ID
     */
    private String aiConfigId;

    /**
     * 消息数量
     */
    private Integer messageCount;

    /**
     * 累计Token消耗
     */
    private Integer tokenCount;

    /**
     * 是否置顶
     */
    private Boolean isPinned;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;

    /**
     * 上下文类型常量
     */
    public static final String CONTEXT_GENERAL = "general";
    public static final String CONTEXT_BOOK = "book";
    public static final String CONTEXT_CHAPTER = "chapter";
    public static final String CONTEXT_CHARACTER = "character";
}
