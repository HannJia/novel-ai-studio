package com.novelai.studio.service.ai.adapter;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.novelai.studio.service.ai.dto.*;
import okhttp3.*;
import okhttp3.sse.EventSource;
import okhttp3.sse.EventSourceListener;
import okhttp3.sse.EventSources;

import java.io.IOException;
import java.util.*;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

/**
 * 智谱 GLM API 适配器
 * 支持 GLM-4、GLM-4-Flash、GLM-4.7 等模型
 * 使用 Bearer Token 认证方式（直接使用 API Key）
 *
 * 参考文档: https://docs.bigmodel.cn/api-reference
 */
public class ZhipuAdapter extends AbstractAIAdapter {

    private static final String DEFAULT_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
    private static final String DEFAULT_MODEL = "glm-4-flash";

    private final OkHttpClient httpClient;
    private final ObjectMapper objectMapper;

    public ZhipuAdapter(String apiKey) {
        this(apiKey, DEFAULT_BASE_URL, DEFAULT_MODEL);
    }

    public ZhipuAdapter(String apiKey, String baseUrl) {
        this(apiKey, baseUrl, DEFAULT_MODEL);
    }

    public ZhipuAdapter(String apiKey, String baseUrl, String defaultModel) {
        super(apiKey, baseUrl != null ? baseUrl : DEFAULT_BASE_URL, defaultModel != null ? defaultModel : DEFAULT_MODEL);

        this.httpClient = new OkHttpClient.Builder()
                .connectTimeout(60, TimeUnit.SECONDS)
                .readTimeout(180, TimeUnit.SECONDS)  // 智谱生成可能较慢
                .writeTimeout(60, TimeUnit.SECONDS)
                .build();

        this.objectMapper = new ObjectMapper();
    }

    @Override
    public String getName() {
        return "Zhipu GLM";
    }

    @Override
    public AIProvider getProvider() {
        return AIProvider.ZHIPU;
    }

    @Override
    public GenerateResult chat(List<ChatMessage> messages, GenerateOptions options) {
        long startTime = System.currentTimeMillis();

        try {
            String requestBody = buildChatRequestBody(messages, options, false);
            Request request = buildRequest("/chat/completions", requestBody);

            log.debug("Zhipu request URL: {}", request.url());
            log.debug("Zhipu request body: {}", requestBody);

            try (Response response = httpClient.newCall(request).execute()) {
                String responseBody = response.body() != null ? response.body().string() : "";

                if (!response.isSuccessful()) {
                    log.error("Zhipu API error: {} - {}", response.code(), responseBody);
                    String errorMsg = parseErrorMessage(responseBody, response.code());
                    return createErrorResult(errorMsg, System.currentTimeMillis() - startTime);
                }

                log.debug("Zhipu response: {}", responseBody);
                return parseChatResponse(responseBody, System.currentTimeMillis() - startTime);
            }
        } catch (Exception e) {
            log.error("Zhipu chat error", e);
            return createErrorResult("Request failed: " + e.getMessage(),
                    System.currentTimeMillis() - startTime);
        }
    }

    @Override
    public GenerateResult chatStream(List<ChatMessage> messages, GenerateOptions options, Consumer<String> consumer) {
        long startTime = System.currentTimeMillis();
        StringBuilder fullContent = new StringBuilder();
        CountDownLatch latch = new CountDownLatch(1);
        final String[] finishReason = {"stop"};
        final String[] errorMessage = {null};

        try {
            String requestBody = buildChatRequestBody(messages, options, true);
            Request request = buildRequest("/chat/completions", requestBody);

            EventSource.Factory factory = EventSources.createFactory(httpClient);
            EventSourceListener listener = new EventSourceListener() {
                @Override
                public void onEvent(EventSource eventSource, String id, String type, String data) {
                    if ("[DONE]".equals(data)) {
                        latch.countDown();
                        return;
                    }

                    try {
                        JsonNode node = objectMapper.readTree(data);
                        JsonNode choices = node.get("choices");
                        if (choices != null && choices.isArray() && choices.size() > 0) {
                            JsonNode choice = choices.get(0);
                            JsonNode delta = choice.get("delta");

                            if (delta != null && delta.has("content")) {
                                String content = delta.get("content").asText();
                                fullContent.append(content);
                                if (consumer != null) {
                                    consumer.accept(content);
                                }
                            }

                            if (choice.has("finish_reason") && !choice.get("finish_reason").isNull()) {
                                finishReason[0] = choice.get("finish_reason").asText();
                            }
                        }
                    } catch (Exception e) {
                        log.error("Error parsing SSE data", e);
                    }
                }

                @Override
                public void onFailure(EventSource eventSource, Throwable t, Response response) {
                    errorMessage[0] = t != null ? t.getMessage() : "Unknown error";
                    if (response != null) {
                        try {
                            String body = response.body() != null ? response.body().string() : "";
                            errorMessage[0] = parseErrorMessage(body, response.code());
                        } catch (IOException ignored) {}
                    }
                    finishReason[0] = "error";
                    latch.countDown();
                }

                @Override
                public void onClosed(EventSource eventSource) {
                    latch.countDown();
                }
            };

            factory.newEventSource(request, listener);

            // 等待流完成，最多等待 5 分钟
            latch.await(5, TimeUnit.MINUTES);

            long duration = System.currentTimeMillis() - startTime;

            if (errorMessage[0] != null) {
                return createErrorResult(errorMessage[0], duration);
            }

            int estimatedTokens = estimateTokens(fullContent.toString());

            return createSuccessResult(
                    fullContent.toString(),
                    getEffectiveModel(options),
                    0,
                    estimatedTokens,
                    finishReason[0],
                    duration
            );

        } catch (Exception e) {
            log.error("Zhipu stream chat error", e);
            return createErrorResult("Stream request failed: " + e.getMessage(),
                    System.currentTimeMillis() - startTime);
        }
    }

    @Override
    public boolean testConnection() {
        try {
            // 发送一个简单的测试请求
            List<ChatMessage> messages = List.of(ChatMessage.user("你好"));
            GenerateOptions options = GenerateOptions.builder()
                    .maxTokens(10)
                    .build();

            GenerateResult result = chat(messages, options);
            return !"error".equals(result.getFinishReason());
        } catch (Exception e) {
            log.error("Zhipu connection test failed", e);
            return false;
        }
    }

    @Override
    public List<String> listModels() {
        // 智谱目前没有提供列出模型的 API，返回已知模型列表
        return Arrays.asList(
                "glm-4.7",
                "glm-4-plus",
                "glm-4-0520",
                "glm-4",
                "glm-4-air",
                "glm-4-airx",
                "glm-4-long",
                "glm-4-flashx",
                "glm-4-flash",
                "glm-4v-plus",
                "glm-4v",
                "glm-4v-flash"
        );
    }

    private String buildChatRequestBody(List<ChatMessage> messages, GenerateOptions options, boolean stream) throws Exception {
        ObjectNode root = objectMapper.createObjectNode();

        root.put("model", getEffectiveModel(options));
        root.put("max_tokens", getEffectiveMaxTokens(options));
        root.put("temperature", getEffectiveTemperature(options));
        root.put("top_p", getEffectiveTopP(options));
        root.put("stream", stream);

        ArrayNode messagesArray = root.putArray("messages");
        for (ChatMessage msg : messages) {
            ObjectNode msgNode = messagesArray.addObject();
            msgNode.put("role", msg.getRole());
            msgNode.put("content", msg.getContent());
        }

        // 智谱不支持 stop 参数，忽略它

        return objectMapper.writeValueAsString(root);
    }

    private Request buildRequest(String endpoint, String body) {
        // 智谱 API 支持直接使用 API Key 进行 Bearer 认证
        // 参考: https://docs.bigmodel.cn/api-reference
        return new Request.Builder()
                .url(baseUrl + endpoint)
                .header("Authorization", "Bearer " + apiKey)
                .header("Content-Type", "application/json")
                .post(RequestBody.create(body, MediaType.parse("application/json")))
                .build();
    }

    private GenerateResult parseChatResponse(String responseBody, long duration) throws Exception {
        JsonNode root = objectMapper.readTree(responseBody);

        // 检查是否有错误
        if (root.has("error")) {
            JsonNode error = root.get("error");
            String code = error.has("code") ? error.get("code").asText() : "unknown";
            String message = error.has("message") ? error.get("message").asText() : "Unknown error";
            return createErrorResult("Error " + code + ": " + message, duration);
        }

        JsonNode choices = root.get("choices");
        if (choices == null || !choices.isArray() || choices.size() == 0) {
            return createErrorResult("No choices in response", duration);
        }

        JsonNode choice = choices.get(0);
        JsonNode message = choice.get("message");

        // GLM-4.7 等推理模型返回的内容分为两个字段：
        // - reasoning_content: 推理/思考过程
        // - content: 最终答案/正文
        String content = "";
        String reasoning = null;

        if (message != null) {
            // 提取 reasoning_content（推理过程）
            if (message.has("reasoning_content") && !message.get("reasoning_content").isNull()) {
                reasoning = message.get("reasoning_content").asText();
                log.debug("Found reasoning_content from GLM reasoning model, length: {}", reasoning.length());
            }

            // 提取 content（最终内容）
            if (message.has("content") && !message.get("content").isNull()) {
                content = message.get("content").asText();
            }

            // 如果 content 为空但有 reasoning，说明模型只返回了推理过程
            // 这种情况下将 reasoning 作为 content 使用（兼容旧逻辑）
            if ((content == null || content.isEmpty()) && reasoning != null && !reasoning.isEmpty()) {
                log.warn("No content field, using reasoning_content as content");
                content = reasoning;
                reasoning = null;
            }
        }

        String finishReason = choice.has("finish_reason") ? choice.get("finish_reason").asText() : "stop";

        // 解析 token 使用情况
        int promptTokens = 0;
        int completionTokens = 0;
        JsonNode usage = root.get("usage");
        if (usage != null) {
            promptTokens = usage.has("prompt_tokens") ? usage.get("prompt_tokens").asInt() : 0;
            completionTokens = usage.has("completion_tokens") ? usage.get("completion_tokens").asInt() : 0;
        }

        String model = root.has("model") ? root.get("model").asText() : defaultModel;

        // 如果有推理内容，使用带 reasoning 的结果构建方法
        if (reasoning != null && !reasoning.isEmpty()) {
            return createSuccessResultWithReasoning(content, reasoning, model, promptTokens, completionTokens, finishReason, duration);
        }

        return createSuccessResult(content, model, promptTokens, completionTokens, finishReason, duration);
    }

    /**
     * 解析错误消息
     */
    private String parseErrorMessage(String responseBody, int httpCode) {
        try {
            JsonNode root = objectMapper.readTree(responseBody);
            if (root.has("error")) {
                JsonNode error = root.get("error");
                String code = error.has("code") ? error.get("code").asText() : String.valueOf(httpCode);
                String message = error.has("message") ? error.get("message").asText() : "Unknown error";
                return "智谱API错误 [" + code + "]: " + message;
            }
        } catch (Exception ignored) {}
        return "HTTP " + httpCode + ": " + responseBody;
    }

    /**
     * 估算 token 数（中文约 1.5 字符/token）
     */
    private int estimateTokens(String text) {
        if (text == null || text.isEmpty()) {
            return 0;
        }

        int chineseCount = 0;
        int otherCount = 0;

        for (char c : text.toCharArray()) {
            if (Character.toString(c).matches("[\\u4e00-\\u9fa5]")) {
                chineseCount++;
            } else {
                otherCount++;
            }
        }

        // 智谱的 token 计算：中文约 1.5 字/token
        return (int) (chineseCount / 1.5) + (otherCount / 4) + 1;
    }
}
