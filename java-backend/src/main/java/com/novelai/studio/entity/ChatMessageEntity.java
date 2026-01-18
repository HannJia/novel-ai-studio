package com.novelai.studio.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * AI对话消息实体
 */
@Data
@TableName("chat_messages")
public class ChatMessageEntity {

    @TableId(type = IdType.ASSIGN_UUID)
    private String id;

    /**
     * 所属会话ID
     */
    private String sessionId;

    /**
     * 角色：user/assistant/system
     */
    private String role;

    /**
     * 消息内容
     */
    private String content;

    /**
     * AI推理过程（如有）
     */
    private String reasoning;

    /**
     * 消息Token数
     */
    private Integer tokenCount;

    /**
     * 使用的模型
     */
    private String model;

    /**
     * 生成耗时（毫秒）
     */
    private Integer duration;

    /**
     * 是否为错误消息
     */
    private Boolean isError;

    /**
     * 额外元数据（JSON格式）
     */
    private String metadata;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    /**
     * 角色常量
     */
    public static final String ROLE_USER = "user";
    public static final String ROLE_ASSISTANT = "assistant";
    public static final String ROLE_SYSTEM = "system";
}
