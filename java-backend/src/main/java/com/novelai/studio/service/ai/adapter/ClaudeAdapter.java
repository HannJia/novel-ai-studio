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
 * Anthropic Claude API 适配器
 * 支持 Claude 3.5 Sonnet, Claude 3 Opus, Claude 3 Haiku 等模型
 */
public class ClaudeAdapter extends AbstractAIAdapter {

    private static final String DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
    private static final String DEFAULT_MODEL = "claude-3-5-sonnet-20241022";
    private static final String API_VERSION = "2023-06-01";

    private final OkHttpClient httpClient;
    private final ObjectMapper objectMapper;

    public ClaudeAdapter(String apiKey) {
        this(apiKey, DEFAULT_BASE_URL, DEFAULT_MODEL);
    }

    public ClaudeAdapter(String apiKey, String baseUrl) {
        this(apiKey, baseUrl, DEFAULT_MODEL);
    }

    public ClaudeAdapter(String apiKey, String baseUrl, String defaultModel) {
        super(apiKey, baseUrl != null ? baseUrl : DEFAULT_BASE_URL,
              defaultModel != null ? defaultModel : DEFAULT_MODEL);
        this.httpClient = new OkHttpClient.Builder()
                .connectTimeout(60, TimeUnit.SECONDS)
                .readTimeout(180, TimeUnit.SECONDS)
                .writeTimeout(60, TimeUnit.SECONDS)
                .build();
        this.objectMapper = new ObjectMapper();
    }

    @Override
    public String getName() {
        return "Claude";
    }

    @Override
    public AIProvider getProvider() {
        return AIProvider.CLAUDE;
    }

    @Override
    public GenerateResult chat(List<ChatMessage> messages, GenerateOptions options) {
        long startTime = System.currentTimeMillis();
        try {
            String systemPrompt = null;
            List<ChatMessage> chatMessages = new ArrayList<>();
            for (ChatMessage msg : messages) {
                if ("system".equals(msg.getRole())) {
                    systemPrompt = msg.getContent();
                } else {
                    chatMessages.add(msg);
                }
            }
            if (options != null && options.getSystemPrompt() != null) {
                systemPrompt = options.getSystemPrompt();
            }

            String requestBody = buildChatRequestBody(chatMessages, systemPrompt, options, false);
            Request request = buildRequest("/messages", requestBody);

            try (Response response = httpClient.newCall(request).execute()) {
                String responseBody = response.body() != null ? response.body().string() : "";
                if (!response.isSuccessful()) {
                    log.error("Claude API error: {} - {}", response.code(), responseBody);
                    return createErrorResult(parseErrorMessage(responseBody, response.code()),
                            System.currentTimeMillis() - startTime);
                }
                return parseChatResponse(responseBody, System.currentTimeMillis() - startTime);
            }
        } catch (Exception e) {
            log.error("Claude chat error", e);
            return createErrorResult("Request failed: " + e.getMessage(),
                    System.currentTimeMillis() - startTime);
        }
    }

    @Override
    public GenerateResult chatStream(List<ChatMessage> messages, GenerateOptions options,
                                      Consumer<String> consumer) {
        long startTime = System.currentTimeMillis();
        StringBuilder fullContent = new StringBuilder();
        CountDownLatch latch = new CountDownLatch(1);
        final String[] finishReason = {"stop"};
        final String[] errorMessage = {null};
        final int[] inputTokens = {0};
        final int[] outputTokens = {0};

        try {
            String systemPrompt = null;
            List<ChatMessage> chatMessages = new ArrayList<>();
            for (ChatMessage msg : messages) {
                if ("system".equals(msg.getRole())) {
                    systemPrompt = msg.getContent();
                } else {
                    chatMessages.add(msg);
                }
            }
            if (options != null && options.getSystemPrompt() != null) {
                systemPrompt = options.getSystemPrompt();
            }

            String requestBody = buildChatRequestBody(chatMessages, systemPrompt, options, true);
            Request request = buildRequest("/messages", requestBody);

            EventSource.Factory factory = EventSources.createFactory(httpClient);
            EventSourceListener listener = new EventSourceListener() {
                @Override
                public void onEvent(EventSource eventSource, String id, String type, String data) {
                    try {
                        JsonNode node = objectMapper.readTree(data);
                        String eventType = node.has("type") ? node.get("type").asText() : "";
                        switch (eventType) {
                            case "content_block_delta":
                                JsonNode delta = node.get("delta");
                                if (delta != null && delta.has("text")) {
                                    String text = delta.get("text").asText();
                                    fullContent.append(text);
                                    if (consumer != null) consumer.accept(text);
                                }
                                break;
                            case "message_start":
                                JsonNode message = node.get("message");
                                if (message != null && message.has("usage")) {
                                    inputTokens[0] = message.get("usage").has("input_tokens")
                                            ? message.get("usage").get("input_tokens").asInt() : 0;
                                }
                                break;
                            case "message_delta":
                                JsonNode msgDelta = node.get("delta");
                                if (msgDelta != null && msgDelta.has("stop_reason")) {
                                    String sr = msgDelta.get("stop_reason").asText();
                                    finishReason[0] = "end_turn".equals(sr) ? "stop" : sr;
                                }
                                JsonNode usage = node.get("usage");
                                if (usage != null && usage.has("output_tokens")) {
                                    outputTokens[0] = usage.get("output_tokens").asInt();
                                }
                                break;
                            case "message_stop":
                                latch.countDown();
                                break;
                            case "error":
                                JsonNode error = node.get("error");
                                errorMessage[0] = error != null ? error.get("message").asText() : "Unknown error";
                                finishReason[0] = "error";
                                latch.countDown();
                                break;
                        }
                    } catch (Exception e) {
                        log.error("Error parsing Claude SSE data", e);
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
            latch.await(5, TimeUnit.MINUTES);
            long duration = System.currentTimeMillis() - startTime;

            if (errorMessage[0] != null) {
                return createErrorResult(errorMessage[0], duration);
            }
            return createSuccessResult(fullContent.toString(), getEffectiveModel(options),
                    inputTokens[0], outputTokens[0], finishReason[0], duration);
        } catch (Exception e) {
            log.error("Claude stream chat error", e);
            return createErrorResult("Stream request failed: " + e.getMessage(),
                    System.currentTimeMillis() - startTime);
        }
    }

    @Override
    public boolean testConnection() {
        try {
            List<ChatMessage> messages = List.of(ChatMessage.user("Hello"));
            GenerateOptions options = GenerateOptions.builder().maxTokens(10).build();
            GenerateResult result = chat(messages, options);
            return !"error".equals(result.getFinishReason());
        } catch (Exception e) {
            log.error("Claude connection test failed", e);
            return false;
        }
    }

    @Override
    public List<String> listModels() {
        return Arrays.asList(
                "claude-sonnet-4-20250514",
                "claude-3-5-sonnet-20241022",
                "claude-3-5-haiku-20241022",
                "claude-3-opus-20240229",
                "claude-3-sonnet-20240229",
                "claude-3-haiku-20240307"
        );
    }

    private String buildChatRequestBody(List<ChatMessage> messages, String systemPrompt,
                                         GenerateOptions options, boolean stream) throws Exception {
        ObjectNode root = objectMapper.createObjectNode();
        root.put("model", getEffectiveModel(options));
        root.put("max_tokens", getEffectiveMaxTokens(options));
        root.put("temperature", getEffectiveTemperature(options));
        root.put("top_p", getEffectiveTopP(options));
        root.put("stream", stream);

        if (systemPrompt != null && !systemPrompt.isEmpty()) {
            root.put("system", systemPrompt);
        }

        ArrayNode messagesArray = root.putArray("messages");
        for (ChatMessage msg : messages) {
            if (!"system".equals(msg.getRole())) {
                ObjectNode msgNode = messagesArray.addObject();
                msgNode.put("role", msg.getRole());
                msgNode.put("content", msg.getContent());
            }
        }

        if (options != null && options.getStopSequences() != null
                && options.getStopSequences().length > 0) {
            ArrayNode stopArray = root.putArray("stop_sequences");
            for (String stop : options.getStopSequences()) {
                stopArray.add(stop);
            }
        }
        return objectMapper.writeValueAsString(root);
    }

    private Request buildRequest(String endpoint, String body) {
        return new Request.Builder()
                .url(baseUrl + endpoint)
                .header("x-api-key", apiKey)
                .header("anthropic-version", API_VERSION)
                .header("Content-Type", "application/json")
                .post(RequestBody.create(body, MediaType.parse("application/json")))
                .build();
    }

    private GenerateResult parseChatResponse(String responseBody, long duration) throws Exception {
        JsonNode root = objectMapper.readTree(responseBody);
        if (root.has("error")) {
            JsonNode error = root.get("error");
            String type = error.has("type") ? error.get("type").asText() : "unknown";
            String message = error.has("message") ? error.get("message").asText() : "Unknown error";
            return createErrorResult("Error " + type + ": " + message, duration);
        }

        String content = "";
        JsonNode contentArray = root.get("content");
        if (contentArray != null && contentArray.isArray()) {
            StringBuilder sb = new StringBuilder();
            for (JsonNode block : contentArray) {
                if (block.has("text")) sb.append(block.get("text").asText());
            }
            content = sb.toString();
        }

        String stopReason = root.has("stop_reason") ? root.get("stop_reason").asText() : "stop";
        String finishReason = "end_turn".equals(stopReason) ? "stop" : stopReason;

        int inputTokens = 0, outputTokens = 0;
        JsonNode usage = root.get("usage");
        if (usage != null) {
            inputTokens = usage.has("input_tokens") ? usage.get("input_tokens").asInt() : 0;
            outputTokens = usage.has("output_tokens") ? usage.get("output_tokens").asInt() : 0;
        }

        String model = root.has("model") ? root.get("model").asText() : defaultModel;
        return createSuccessResult(content, model, inputTokens, outputTokens, finishReason, duration);
    }

    private String parseErrorMessage(String responseBody, int httpCode) {
        try {
            JsonNode root = objectMapper.readTree(responseBody);
            if (root.has("error")) {
                JsonNode error = root.get("error");
                String type = error.has("type") ? error.get("type").asText() : String.valueOf(httpCode);
                String message = error.has("message") ? error.get("message").asText() : "Unknown error";
                return "Claude API错误 [" + type + "]: " + message;
            }
        } catch (Exception ignored) {}
        return "HTTP " + httpCode + ": " + responseBody;
    }
}
