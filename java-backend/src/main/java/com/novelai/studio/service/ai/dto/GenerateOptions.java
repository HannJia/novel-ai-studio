package com.novelai.studio.service.ai.dto;

import lombok.Data;
import lombok.Builder;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;

/**
 * AI 生成选项
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class GenerateOptions {

    /**
     * 模型名称
     */
    private String model;

    /**
     * 最大生成 Token 数
     */
    @Builder.Default
    private Integer maxTokens = 2048;

    /**
     * 温度参数（0-2）
     */
    @Builder.Default
    private Double temperature = 0.7;

    /**
     * Top-P 参数
     */
    @Builder.Default
    private Double topP = 1.0;

    /**
     * 停止序列
     */
    private String[] stopSequences;

    /**
     * 系统提示词
     */
    private String systemPrompt;
}
