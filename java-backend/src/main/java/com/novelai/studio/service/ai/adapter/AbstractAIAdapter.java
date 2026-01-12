package com.novelai.studio.service.ai.adapter;

import com.novelai.studio.service.ai.dto.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;

/**
 * AI 适配器抽象基类
 * 提供通用实现和工具方法
 */
public abstract class AbstractAIAdapter implements AIAdapter {

    protected final Logger log = LoggerFactory.getLogger(getClass());

    protected String apiKey;
    protected String baseUrl;
    protected String defaultModel;

    public AbstractAIAdapter(String apiKey, String baseUrl, String defaultModel) {
        this.apiKey = apiKey;
        this.baseUrl = baseUrl;
        this.defaultModel = defaultModel;
    }

    @Override
    public String getDefaultModel() {
        return defaultModel;
    }

    /**
     * 单轮对话的默认实现：转换为多轮对话
     */
    @Override
    public GenerateResult generate(String prompt, GenerateOptions options) {
        List<ChatMessage> messages = new ArrayList<>();

        // 添加系统提示词
        if (options != null && options.getSystemPrompt() != null) {
            messages.add(ChatMessage.system(options.getSystemPrompt()));
        }

        // 添加用户消息
        messages.add(ChatMessage.user(prompt));

        return chat(messages, options);
    }

    /**
     * 流式单轮对话的默认实现：转换为多轮对话
     */
    @Override
    public GenerateResult generateStream(String prompt, GenerateOptions options, Consumer<String> consumer) {
        List<ChatMessage> messages = new ArrayList<>();

        if (options != null && options.getSystemPrompt() != null) {
            messages.add(ChatMessage.system(options.getSystemPrompt()));
        }

        messages.add(ChatMessage.user(prompt));

        return chatStream(messages, options, consumer);
    }

    /**
     * 获取有效的模型名称
     */
    protected String getEffectiveModel(GenerateOptions options) {
        if (options != null && options.getModel() != null) {
            return options.getModel();
        }
        return defaultModel;
    }

    /**
     * 获取有效的最大 Token 数
     */
    protected int getEffectiveMaxTokens(GenerateOptions options) {
        if (options != null && options.getMaxTokens() != null) {
            return options.getMaxTokens();
        }
        return 2048;
    }

    /**
     * 获取有效的温度参数
     */
    protected double getEffectiveTemperature(GenerateOptions options) {
        if (options != null && options.getTemperature() != null) {
            return options.getTemperature();
        }
        return 0.7;
    }

    /**
     * 获取有效的 Top-P 参数
     */
    protected double getEffectiveTopP(GenerateOptions options) {
        if (options != null && options.getTopP() != null) {
            return options.getTopP();
        }
        return 1.0;
    }

    /**
     * 创建错误结果
     */
    protected GenerateResult createErrorResult(String errorMessage, long duration) {
        return GenerateResult.builder()
                .content("")
                .finishReason("error")
                .errorMessage(errorMessage)
                .duration(duration)
                .tokenUsage(GenerateResult.TokenUsage.builder()
                        .promptTokens(0)
                        .completionTokens(0)
                        .totalTokens(0)
                        .build())
                .build();
    }

    /**
     * 创建成功结果
     */
    protected GenerateResult createSuccessResult(String content, String model,
                                                  int promptTokens, int completionTokens,
                                                  String finishReason, long duration) {
        return GenerateResult.builder()
                .content(content)
                .model(model)
                .finishReason(finishReason)
                .duration(duration)
                .tokenUsage(GenerateResult.TokenUsage.builder()
                        .promptTokens(promptTokens)
                        .completionTokens(completionTokens)
                        .totalTokens(promptTokens + completionTokens)
                        .build())
                .build();
    }
}
