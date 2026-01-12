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
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

/**
 * OpenAI API 适配器
 * 支持 GPT-3.5, GPT-4 等模型
 * 兼容 OpenAI API 格式的其他服务（如 Azure OpenAI, 国内中转）
 */
public class OpenAIAdapter extends AbstractAIAdapter {

    private static final String DEFAULT_BASE_URL = "https://api.openai.com/v1";
    private static final String DEFAULT_MODEL = "gpt-3.5-turbo";

    private final OkHttpClient httpClient;
    private final ObjectMapper objectMapper;

    public OpenAIAdapter(String apiKey) {
        this(apiKey, DEFAULT_BASE_URL, DEFAULT_MODEL);
    }

    public OpenAIAdapter(String apiKey, String baseUrl) {
        this(apiKey, baseUrl, DEFAULT_MODEL);
    }

    public OpenAIAdapter(String apiKey, String baseUrl, String defaultModel) {
        super(apiKey, baseUrl != null ? baseUrl : DEFAULT_BASE_URL, defaultModel != null ? defaultModel : DEFAULT_MODEL);

        this.httpClient = new OkHttpClient.Builder()
                .connectTimeout(60, TimeUnit.SECONDS)
                .readTimeout(120, TimeUnit.SECONDS)
                .writeTimeout(60, TimeUnit.SECONDS)
                .build();

        this.objectMapper = new ObjectMapper();
    }

    @Override
    public String getName() {
        return "OpenAI";
    }

    @Override
    public AIProvider getProvider() {
        return AIProvider.OPENAI;
    }

    @Override
    public GenerateResult chat(List<ChatMessage> messages, GenerateOptions options) {
        long startTime = System.currentTimeMillis();

        try {
            String requestBody = buildChatRequestBody(messages, options, false);
            Request request = buildRequest("/chat/completions", requestBody);

            try (Response response = httpClient.newCall(request).execute()) {
                if (!response.isSuccessful()) {
                    String errorBody = response.body() != null ? response.body().string() : "Unknown error";
                    return createErrorResult("API request failed: " + response.code() + " - " + errorBody,
                            System.currentTimeMillis() - startTime);
                }

                String responseBody = response.body().string();
                return parseChatResponse(responseBody, System.currentTimeMillis() - startTime);
            }
        } catch (Exception e) {
            log.error("OpenAI chat error", e);
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
                            errorMessage[0] = response.body() != null ? response.body().string() : errorMessage[0];
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

            // 流式响应不返回准确的 token 数，这里估算
            int estimatedTokens = estimateTokens(fullContent.toString());

            return createSuccessResult(
                    fullContent.toString(),
                    getEffectiveModel(options),
                    0, // 流式不返回 prompt tokens
                    estimatedTokens,
                    finishReason[0],
                    duration
            );

        } catch (Exception e) {
            log.error("OpenAI stream chat error", e);
            return createErrorResult("Stream request failed: " + e.getMessage(),
                    System.currentTimeMillis() - startTime);
        }
    }

    @Override
    public boolean testConnection() {
        try {
            Request request = new Request.Builder()
                    .url(baseUrl + "/models")
                    .header("Authorization", "Bearer " + apiKey)
                    .get()
                    .build();

            try (Response response = httpClient.newCall(request).execute()) {
                return response.isSuccessful();
            }
        } catch (Exception e) {
            log.error("OpenAI connection test failed", e);
            return false;
        }
    }

    @Override
    public List<String> listModels() {
        try {
            Request request = new Request.Builder()
                    .url(baseUrl + "/models")
                    .header("Authorization", "Bearer " + apiKey)
                    .get()
                    .build();

            try (Response response = httpClient.newCall(request).execute()) {
                if (!response.isSuccessful()) {
                    return getDefaultModelList();
                }

                String body = response.body().string();
                JsonNode root = objectMapper.readTree(body);
                JsonNode data = root.get("data");

                List<String> models = new ArrayList<>();
                if (data != null && data.isArray()) {
                    for (JsonNode model : data) {
                        String id = model.get("id").asText();
                        // 只返回聊天模型
                        if (id.contains("gpt")) {
                            models.add(id);
                        }
                    }
                }

                return models.isEmpty() ? getDefaultModelList() : models;
            }
        } catch (Exception e) {
            log.error("Failed to list models", e);
            return getDefaultModelList();
        }
    }

    private List<String> getDefaultModelList() {
        return Arrays.asList(
                "gpt-4-turbo-preview",
                "gpt-4",
                "gpt-3.5-turbo",
                "gpt-3.5-turbo-16k"
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

        if (options != null && options.getStopSequences() != null && options.getStopSequences().length > 0) {
            ArrayNode stopArray = root.putArray("stop");
            for (String stop : options.getStopSequences()) {
                stopArray.add(stop);
            }
        }

        return objectMapper.writeValueAsString(root);
    }

    private Request buildRequest(String endpoint, String body) {
        return new Request.Builder()
                .url(baseUrl + endpoint)
                .header("Authorization", "Bearer " + apiKey)
                .header("Content-Type", "application/json")
                .post(RequestBody.create(body, MediaType.parse("application/json")))
                .build();
    }

    private GenerateResult parseChatResponse(String responseBody, long duration) throws Exception {
        JsonNode root = objectMapper.readTree(responseBody);

        JsonNode choices = root.get("choices");
        if (choices == null || !choices.isArray() || choices.size() == 0) {
            return createErrorResult("No choices in response", duration);
        }

        JsonNode choice = choices.get(0);
        JsonNode message = choice.get("message");
        String content = message != null && message.has("content") ? message.get("content").asText() : "";
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

        return createSuccessResult(content, model, promptTokens, completionTokens, finishReason, duration);
    }

    /**
     * 简单估算 token 数（中文约 2 字符/token，英文约 4 字符/token）
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

        return (chineseCount / 2) + (otherCount / 4) + 1;
    }
}
