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
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

/**
 * Google Gemini API 适配器
 * 支持 Gemini 2.0 Flash, Gemini 1.5 Pro 等模型
 *
 * API 文档: https://ai.google.dev/gemini-api/docs
 */
public class GeminiAdapter extends AbstractAIAdapter {

    private static final String DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
    private static final String DEFAULT_MODEL = "gemini-2.0-flash";

    private final OkHttpClient httpClient;
    private final ObjectMapper objectMapper;

    public GeminiAdapter(String apiKey) {
        this(apiKey, DEFAULT_BASE_URL, DEFAULT_MODEL);
    }

    public GeminiAdapter(String apiKey, String baseUrl) {
        this(apiKey, baseUrl, DEFAULT_MODEL);
    }

    public GeminiAdapter(String apiKey, String baseUrl, String defaultModel) {
        super(apiKey, baseUrl != null ? baseUrl : DEFAULT_BASE_URL, defaultModel != null ? defaultModel : DEFAULT_MODEL);

        this.httpClient = new OkHttpClient.Builder()
                .connectTimeout(60, TimeUnit.SECONDS)
                .readTimeout(180, TimeUnit.SECONDS)
                .writeTimeout(60, TimeUnit.SECONDS)
                .build();

        this.objectMapper = new ObjectMapper();
    }

    @Override
    public String getName() {
        return "Google Gemini";
    }

    @Override
    public AIProvider getProvider() {
        return AIProvider.GEMINI;
    }

    @Override
    public GenerateResult chat(List<ChatMessage> messages, GenerateOptions options) {
        long startTime = System.currentTimeMillis();

        try {
            String model = getEffectiveModel(options);
            String requestBody = buildGeminiRequestBody(messages, options);
            Request request = buildRequest(model, requestBody, false);

            log.debug("Gemini request URL: {}", request.url());
            log.debug("Gemini request body: {}", requestBody);

            try (Response response = httpClient.newCall(request).execute()) {
                String responseBody = response.body() != null ? response.body().string() : "";

                if (!response.isSuccessful()) {
                    log.error("Gemini API error: {} - {}", response.code(), responseBody);
                    String errorMsg = parseErrorMessage(responseBody, response.code());
                    return createErrorResult(errorMsg, System.currentTimeMillis() - startTime);
                }

                log.debug("Gemini response: {}", responseBody);
                return parseGeminiResponse(responseBody, model, System.currentTimeMillis() - startTime);
            }
        } catch (Exception e) {
            log.error("Gemini chat error", e);
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
            String model = getEffectiveModel(options);
            String requestBody = buildGeminiRequestBody(messages, options);
            Request request = buildRequest(model, requestBody, true);

            EventSource.Factory factory = EventSources.createFactory(httpClient);
            EventSourceListener listener = new EventSourceListener() {
                @Override
                public void onEvent(EventSource eventSource, String id, String type, String data) {
                    try {
                        JsonNode node = objectMapper.readTree(data);
                        JsonNode candidates = node.get("candidates");

                        if (candidates != null && candidates.isArray() && candidates.size() > 0) {
                            JsonNode candidate = candidates.get(0);
                            JsonNode content = candidate.get("content");

                            if (content != null && content.has("parts")) {
                                JsonNode parts = content.get("parts");
                                if (parts.isArray() && parts.size() > 0) {
                                    String text = parts.get(0).has("text") ? parts.get(0).get("text").asText() : "";
                                    if (!text.isEmpty()) {
                                        fullContent.append(text);
                                        if (consumer != null) {
                                            consumer.accept(text);
                                        }
                                    }
                                }
                            }

                            if (candidate.has("finishReason") && !candidate.get("finishReason").isNull()) {
                                finishReason[0] = candidate.get("finishReason").asText();
                                if ("STOP".equals(finishReason[0])) {
                                    finishReason[0] = "stop";
                                }
                            }
                        }
                    } catch (Exception e) {
                        log.error("Error parsing Gemini SSE data", e);
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
                    model,
                    0,
                    estimatedTokens,
                    finishReason[0],
                    duration
            );

        } catch (Exception e) {
            log.error("Gemini stream chat error", e);
            return createErrorResult("Stream request failed: " + e.getMessage(),
                    System.currentTimeMillis() - startTime);
        }
    }

    @Override
    public boolean testConnection() {
        try {
            List<ChatMessage> messages = List.of(ChatMessage.user("Hello"));
            GenerateOptions options = GenerateOptions.builder()
                    .maxTokens(10)
                    .build();

            GenerateResult result = chat(messages, options);
            return !"error".equals(result.getFinishReason());
        } catch (Exception e) {
            log.error("Gemini connection test failed", e);
            return false;
        }
    }

    @Override
    public List<String> listModels() {
        // Gemini 可用模型列表
        return Arrays.asList(
                "gemini-2.0-flash",
                "gemini-2.0-flash-lite",
                "gemini-1.5-pro",
                "gemini-1.5-pro-latest",
                "gemini-1.5-flash",
                "gemini-1.5-flash-latest",
                "gemini-1.5-flash-8b",
                "gemini-1.0-pro"
        );
    }

    /**
     * 构建 Gemini API 请求体
     * Gemini 使用不同于 OpenAI 的格式
     */
    private String buildGeminiRequestBody(List<ChatMessage> messages, GenerateOptions options) throws Exception {
        ObjectNode root = objectMapper.createObjectNode();

        // 构建 contents 数组
        ArrayNode contentsArray = root.putArray("contents");

        String systemInstruction = null;

        for (ChatMessage msg : messages) {
            if ("system".equals(msg.getRole())) {
                // Gemini 使用 systemInstruction 而不是 system role
                systemInstruction = msg.getContent();
                continue;
            }

            ObjectNode contentNode = contentsArray.addObject();
            // Gemini 使用 "user" 和 "model" 而不是 "user" 和 "assistant"
            String role = "assistant".equals(msg.getRole()) ? "model" : msg.getRole();
            contentNode.put("role", role);

            ArrayNode partsArray = contentNode.putArray("parts");
            ObjectNode partNode = partsArray.addObject();
            partNode.put("text", msg.getContent());
        }

        // 添加系统指令
        if (systemInstruction != null || (options != null && options.getSystemPrompt() != null)) {
            String sysPrompt = systemInstruction != null ? systemInstruction : options.getSystemPrompt();
            ObjectNode sysNode = root.putObject("systemInstruction");
            ArrayNode sysPartsArray = sysNode.putArray("parts");
            ObjectNode sysPartNode = sysPartsArray.addObject();
            sysPartNode.put("text", sysPrompt);
        }

        // 生成配置
        ObjectNode generationConfig = root.putObject("generationConfig");
        generationConfig.put("maxOutputTokens", getEffectiveMaxTokens(options));
        generationConfig.put("temperature", getEffectiveTemperature(options));
        generationConfig.put("topP", getEffectiveTopP(options));

        // 安全设置 - 放宽限制以适应小说创作
        ArrayNode safetySettings = root.putArray("safetySettings");
        String[] categories = {
            "HARM_CATEGORY_HARASSMENT",
            "HARM_CATEGORY_HATE_SPEECH",
            "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            "HARM_CATEGORY_DANGEROUS_CONTENT"
        };
        for (String category : categories) {
            ObjectNode setting = safetySettings.addObject();
            setting.put("category", category);
            setting.put("threshold", "BLOCK_NONE");
        }

        return objectMapper.writeValueAsString(root);
    }

    /**
     * 构建请求
     */
    private Request buildRequest(String model, String body, boolean stream) {
        String endpoint = stream ? "streamGenerateContent" : "generateContent";
        String url = String.format("%s/models/%s:%s?key=%s", baseUrl, model, endpoint, apiKey);

        if (stream) {
            url += "&alt=sse";
        }

        return new Request.Builder()
                .url(url)
                .header("Content-Type", "application/json")
                .post(RequestBody.create(body, MediaType.parse("application/json")))
                .build();
    }

    /**
     * 解析 Gemini 响应
     */
    private GenerateResult parseGeminiResponse(String responseBody, String model, long duration) throws Exception {
        JsonNode root = objectMapper.readTree(responseBody);

        // 检查是否有错误
        if (root.has("error")) {
            JsonNode error = root.get("error");
            String code = error.has("code") ? error.get("code").asText() : "unknown";
            String message = error.has("message") ? error.get("message").asText() : "Unknown error";
            return createErrorResult("Gemini Error " + code + ": " + message, duration);
        }

        JsonNode candidates = root.get("candidates");
        if (candidates == null || !candidates.isArray() || candidates.size() == 0) {
            // 检查是否因为安全过滤被阻止
            if (root.has("promptFeedback")) {
                JsonNode feedback = root.get("promptFeedback");
                if (feedback.has("blockReason")) {
                    return createErrorResult("内容被安全过滤拦截: " + feedback.get("blockReason").asText(), duration);
                }
            }
            return createErrorResult("No candidates in response", duration);
        }

        JsonNode candidate = candidates.get(0);

        // 检查完成原因
        String finishReason = "stop";
        if (candidate.has("finishReason")) {
            finishReason = candidate.get("finishReason").asText();
            if ("STOP".equals(finishReason)) {
                finishReason = "stop";
            } else if ("SAFETY".equals(finishReason)) {
                return createErrorResult("内容因安全原因被中止", duration);
            }
        }

        // 提取内容
        String content = "";
        JsonNode contentNode = candidate.get("content");
        if (contentNode != null && contentNode.has("parts")) {
            JsonNode parts = contentNode.get("parts");
            if (parts.isArray() && parts.size() > 0) {
                StringBuilder sb = new StringBuilder();
                for (JsonNode part : parts) {
                    if (part.has("text")) {
                        sb.append(part.get("text").asText());
                    }
                }
                content = sb.toString();
            }
        }

        // 解析 token 使用情况
        int promptTokens = 0;
        int completionTokens = 0;
        JsonNode usageMetadata = root.get("usageMetadata");
        if (usageMetadata != null) {
            promptTokens = usageMetadata.has("promptTokenCount") ? usageMetadata.get("promptTokenCount").asInt() : 0;
            completionTokens = usageMetadata.has("candidatesTokenCount") ? usageMetadata.get("candidatesTokenCount").asInt() : 0;
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
                return "Gemini API错误 [" + code + "]: " + message;
            }
        } catch (Exception ignored) {}
        return "HTTP " + httpCode + ": " + responseBody;
    }

    /**
     * 估算 token 数
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
