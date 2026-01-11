package com.novelai.studio.entity;

import com.baomidou.mybatisplus.annotation.*;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import lombok.Data;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

/**
 * AI配置实体
 */
@Data
@TableName(value = "ai_configs", autoResultMap = true)
public class AiConfig {

    @TableId(type = IdType.ASSIGN_UUID)
    private String id;

    /**
     * 配置名称
     */
    private String name;

    /**
     * 提供商：openai/claude/qianwen/ollama等
     */
    private String provider;

    /**
     * API密钥（加密存储）
     */
    private String apiKey;

    /**
     * API地址
     */
    private String baseUrl;

    /**
     * 模型名称
     */
    private String model;

    /**
     * 最大Token数
     */
    private Integer maxTokens;

    /**
     * 温度参数
     */
    private BigDecimal temperature;

    /**
     * Top-P参数
     */
    private BigDecimal topP;

    /**
     * 是否默认配置
     */
    private Boolean isDefault;

    /**
     * 适用任务列表
     */
    @TableField(typeHandler = JacksonTypeHandler.class)
    private List<String> usageTasks;

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
