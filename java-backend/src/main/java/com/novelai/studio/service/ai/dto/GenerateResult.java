package com.novelai.studio.service.ai.dto;

import lombok.Data;
import lombok.Builder;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;

/**
 * AI 生成结果
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class GenerateResult {

    /**
     * 生成的内容
     */
    private String content;

    /**
     * 使用的模型
     */
    private String model;

    /**
     * Token 使用情况
     */
    private TokenUsage tokenUsage;

    /**
     * 结束原因：stop（正常结束）、length（达到最大长度）、error（出错）
     */
    private String finishReason;

    /**
     * 耗时（毫秒）
     */
    private Long duration;

    /**
     * 错误信息（如果有）
     */
    private String errorMessage;

    /**
     * Token 使用统计
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class TokenUsage {
        /**
         * 提示词 Token 数
         */
        private Integer promptTokens;

        /**
         * 生成 Token 数
         */
        private Integer completionTokens;

        /**
         * 总 Token 数
         */
        private Integer totalTokens;
    }
}
