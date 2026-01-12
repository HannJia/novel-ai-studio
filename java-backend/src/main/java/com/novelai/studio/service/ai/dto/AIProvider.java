package com.novelai.studio.service.ai.dto;

/**
 * AI 提供商枚举
 */
public enum AIProvider {
    /**
     * OpenAI (GPT 系列)
     */
    OPENAI("openai", "OpenAI"),

    /**
     * Anthropic Claude
     */
    CLAUDE("claude", "Claude"),

    /**
     * 阿里通义千问
     */
    QIANWEN("qianwen", "通义千问"),

    /**
     * 百度文心一言
     */
    WENXIN("wenxin", "文心一言"),

    /**
     * 智谱 AI
     */
    ZHIPU("zhipu", "智谱AI"),

    /**
     * 本地 Ollama
     */
    OLLAMA("ollama", "Ollama"),

    /**
     * 自定义 API
     */
    CUSTOM("custom", "自定义");

    private final String code;
    private final String displayName;

    AIProvider(String code, String displayName) {
        this.code = code;
        this.displayName = displayName;
    }

    public String getCode() {
        return code;
    }

    public String getDisplayName() {
        return displayName;
    }

    /**
     * 根据 code 获取枚举
     */
    public static AIProvider fromCode(String code) {
        for (AIProvider provider : values()) {
            if (provider.code.equals(code)) {
                return provider;
            }
        }
        throw new IllegalArgumentException("Unknown AI provider: " + code);
    }
}
