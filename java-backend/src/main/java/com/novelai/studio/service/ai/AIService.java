package com.novelai.studio.service.ai;

import com.novelai.studio.entity.AiConfig;
import com.novelai.studio.service.AiConfigService;
import com.novelai.studio.service.ai.adapter.*;
import com.novelai.studio.service.ai.dto.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;

/**
 * AI 服务
 * 管理 AI 适配器，提供统一的 AI 调用接口
 */
@Service
public class AIService {

    private static final Logger log = LoggerFactory.getLogger(AIService.class);

    @Autowired
    private AiConfigService aiConfigService;

    // 缓存适配器实例
    private final Map<String, AIAdapter> adapterCache = new ConcurrentHashMap<>();

    /**
     * 使用默认配置生成内容
     */
    public GenerateResult generate(String prompt) {
        return generate(prompt, null, null);
    }

    /**
     * 使用指定配置生成内容
     */
    public GenerateResult generate(String prompt, String configId, GenerateOptions options) {
        AIAdapter adapter = getAdapter(configId);
        if (adapter == null) {
            return GenerateResult.builder()
                    .finishReason("error")
                    .errorMessage("No AI configuration found")
                    .build();
        }
        return adapter.generate(prompt, options);
    }

    /**
     * 多轮对话
     */
    public GenerateResult chat(List<ChatMessage> messages, String configId, GenerateOptions options) {
        AIAdapter adapter = getAdapter(configId);
        if (adapter == null) {
            return GenerateResult.builder()
                    .finishReason("error")
                    .errorMessage("No AI configuration found")
                    .build();
        }
        return adapter.chat(messages, options);
    }

    /**
     * 流式生成
     */
    public GenerateResult generateStream(String prompt, String configId, GenerateOptions options, Consumer<String> consumer) {
        AIAdapter adapter = getAdapter(configId);
        if (adapter == null) {
            return GenerateResult.builder()
                    .finishReason("error")
                    .errorMessage("No AI configuration found")
                    .build();
        }
        return adapter.generateStream(prompt, options, consumer);
    }

    /**
     * 流式对话
     */
    public GenerateResult chatStream(List<ChatMessage> messages, String configId, GenerateOptions options, Consumer<String> consumer) {
        AIAdapter adapter = getAdapter(configId);
        if (adapter == null) {
            return GenerateResult.builder()
                    .finishReason("error")
                    .errorMessage("No AI configuration found")
                    .build();
        }
        return adapter.chatStream(messages, options, consumer);
    }

    /**
     * 测试配置连接
     */
    public boolean testConnection(String configId) {
        AIAdapter adapter = getAdapter(configId);
        if (adapter == null) {
            return false;
        }
        return adapter.testConnection();
    }

    /**
     * 获取可用模型列表
     */
    public List<String> listModels(String configId) {
        AIAdapter adapter = getAdapter(configId);
        if (adapter == null) {
            return List.of();
        }
        return adapter.listModels();
    }

    /**
     * 获取适配器实例
     */
    private AIAdapter getAdapter(String configId) {
        AiConfig config;

        if (configId != null && !configId.isEmpty()) {
            config = aiConfigService.getById(configId);
        } else {
            config = aiConfigService.getDefaultConfig();
        }

        if (config == null) {
            log.warn("No AI config found for id: {}", configId);
            return null;
        }

        // 从缓存获取或创建新适配器
        return adapterCache.computeIfAbsent(config.getId(), id -> createAdapter(config));
    }

    /**
     * 根据配置创建适配器
     */
    private AIAdapter createAdapter(AiConfig config) {
        AIProvider provider = AIProvider.fromCode(config.getProvider());

        switch (provider) {
            case OPENAI:
            case CUSTOM:
            case QIANWEN:
                // OpenAI 兼容的 API（包括火山引擎、通义千问等）
                return new OpenAIAdapter(
                        config.getApiKey(),
                        config.getBaseUrl(),
                        config.getModel()
                );
            case ZHIPU:
                // 智谱 GLM API（使用专用适配器）
                return new ZhipuAdapter(
                        config.getApiKey(),
                        config.getBaseUrl(),
                        config.getModel()
                );
            case GEMINI:
                // Google Gemini API
                return new GeminiAdapter(
                        config.getApiKey(),
                        config.getBaseUrl(),
                        config.getModel()
                );
            case CLAUDE:
                return new ClaudeAdapter(
                        config.getApiKey(),
                        config.getBaseUrl(),
                        config.getModel()
                );
            case OLLAMA:
                return new OllamaAdapter(
                        config.getApiKey(),
                        config.getBaseUrl(),
                        config.getModel()
                );
            case WENXIN:
                // 文心一言使用OpenAI兼容接口
                return new OpenAIAdapter(
                        config.getApiKey(),
                        config.getBaseUrl(),
                        config.getModel()
                );
            default:
                log.warn("Unknown AI provider: {}", config.getProvider());
                return null;
        }
    }

    /**
     * 清除适配器缓存（配置更新时调用）
     */
    public void clearAdapterCache(String configId) {
        if (configId != null) {
            adapterCache.remove(configId);
        }
    }

    /**
     * 清除所有适配器缓存
     */
    public void clearAllAdapterCache() {
        adapterCache.clear();
    }
}
