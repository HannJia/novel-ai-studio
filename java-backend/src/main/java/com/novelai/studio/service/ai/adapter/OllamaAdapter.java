package com.novelai.studio.service.ai.adapter;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.novelai.studio.service.ai.dto.*;
import okhttp3.*;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

/**
 * Ollama 本地模型适配器
 * 支持 Llama, Mistral, Qwen 等本地部署的模型
 *
 * Ollama API 文档: https://github.com/ollama/ollama/blob/main/docs/api.md
 */
public class OllamaAdapter extends AbstractAIAdapter {

    private static final String DEFAULT_BASE_URL = "http://localhost:11434";
    private static final String DEFAULT_MODEL = "llama3.2";

    private final OkHttpClient httpClient;
    private final ObjectMapper objectMapper;

    public OllamaAdapter() {
        this(null, DEFAULT_BASE_URL, DEFAULT_MODEL);
    }

    public OllamaAdapter(String baseUrl) {
        this(null, baseUrl, DEFAULT_MODEL);
    }

    public OllamaAdapter(String apiKey, String baseUrl, String defaultModel) {
        super(apiKey, baseUrl != null ? baseUrl : DEFAULT_BASE_URL,
              defaultModel != null ? defaultModel : DEFAULT_MODEL);
        this.httpClient = new OkHttpClient.Builder()
                .connectTimeout(30, TimeUnit.SECONDS)
                .readTimeout(300, TimeUnit.SECONDS)
                .writeTimeout(60, TimeUnit.SECONDS)
                .build();
        this.objectMapper = new ObjectMapper();
    }

    @Override
    public String getName() {
        return "Ollama";
    }

    @Override
    public AIProvider getProvider() {
        return AIProvider.OLLAMA;
    }

    @Override
    public GenerateResult chat(List<ChatMessage> messages, GenerateOptions options) {
        long startTime = System.currentTimeMillis();
        try {
            String requestBody = buildChatRequestBody(messages, options, false);
            Request request = buildRequest("/api/chat", requestBody);

            try (Response response = httpClient.newCall(request).execute()) {
                String responseBody = response.body() != null ? response.body().string() : "";
                if (!response.isSuccessful()) {
                    log.error("Ollama API error: {} - {}", response.code(), responseBody);
                    return createErrorResult("Ollama API错误: " + response.code(),
                            System.currentTimeMillis() - startTime);
                }
                return parseChatResponse(responseBody, System.currentTimeMillis() - startTime);
            }
        } catch (Exception e) {
            log.error("Ollama chat error", e);
            return createErrorResult("请求失败: " + e.getMessage(),
                    System.currentTimeMillis() - startTime);
        }
    }

    @Override
    public GenerateResult chatStream(List<ChatMessage> messages, GenerateOptions options,
                                      Consumer<String> consumer) {
        long startTime = System.currentTimeMillis();
        StringBuilder fullContent = new StringBuilder();
        int promptTokens = 0;
        int completionTokens = 0;

        try {
            String requestBody = buildChatRequestBody(messages, options, true);
            Request request = buildRequest("/api/chat", requestBody);

            try (Response response = httpClient.newCall(request).execute()) {
                if (!response.isSuccessful()) {
                    String errorBody = response.body() != null ? response.body().string() : "";
                    log.error("Ollama stream error: {} - {}", response.code(), errorBody);
                    return createErrorResult("Ollama API错误: " + response.code(),
                            System.currentTimeMillis() - startTime);
                }

                ResponseBody body = response.body();
                if (body == null) {
                    return createErrorResult("Empty response", System.currentTimeMillis() - startTime);
                }

                try (BufferedReader reader = new BufferedReader(
                        new InputStreamReader(body.byteStream()))) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        if (line.isEmpty()) continue;

                        try {
                            JsonNode node = objectMapper.readTree(line);

                            if (node.has("message")) {
                                JsonNode message = node.get("message");
                                if (message.has("content")) {
                                    String content = message.get("content").asText();
                                    fullContent.append(content);
                                    if (consumer != null) {
                                        consumer.accept(content);
                                    }
                                }
                            }

                            if (node.has("done") && node.get("done").asBoolean()) {
                                if (node.has("prompt_eval_count")) {
                                    promptTokens = node.get("prompt_eval_count").asInt();
                                }
                                if (node.has("eval_count")) {
                                    completionTokens = node.get("eval_count").asInt();
                                }
                                break;
                            }
                        } catch (Exception e) {
                            log.warn("Error parsing Ollama stream line: {}", line, e);
                        }
                    }
                }

                return createSuccessResult(
                        fullContent.toString(),
                        getEffectiveModel(options),
                        promptTokens,
                        completionTokens,
                        "stop",
                        System.currentTimeMillis() - startTime
                );
            }
        } catch (Exception e) {
            log.error("Ollama stream chat error", e);
            return createErrorResult("流式请求失败: " + e.getMessage(),
                    System.currentTimeMillis() - startTime);
        }
    }

    @Override
    public boolean testConnection() {
        try {
            Request request = new Request.Builder()
                    .url(baseUrl + "/api/tags")
                    .get()
                    .build();

            try (Response response = httpClient.newCall(request).execute()) {
                return response.isSuccessful();
            }
        } catch (Exception e) {
            log.error("Ollama connection test failed", e);
            return false;
        }
    }

    @Override
    public List<String> listModels() {
        try {
            Request request = new Request.Builder()
                    .url(baseUrl + "/api/tags")
                    .get()
                    .build();

            try (Response response = httpClient.newCall(request).execute()) {
                if (!response.isSuccessful()) {
                    return getDefaultModelList();
                }

                String body = response.body() != null ? response.body().string() : "";
                JsonNode root = objectMapper.readTree(body);
                JsonNode models = root.get("models");

                List<String> modelNames = new ArrayList<>();
                if (models != null && models.isArray()) {
                    for (JsonNode model : models) {
                        if (model.has("name")) {
                            modelNames.add(model.get("name").asText());
                        }
                    }
                }

                return modelNames.isEmpty() ? getDefaultModelList() : modelNames;
            }
        } catch (Exception e) {
            log.error("Failed to list Ollama models", e);
            return getDefaultModelList();
        }
    }

    private List<String> getDefaultModelList() {
        return Arrays.asList(
                "llama3.2",
                "llama3.1",
                "llama3",
                "mistral",
                "qwen2.5",
                "qwen2",
                "deepseek-coder-v2",
                "codellama",
                "phi3"
        );
    }

    private String buildChatRequestBody(List<ChatMessage> messages, GenerateOptions options,
                                         boolean stream) throws Exception {
        ObjectNode root = objectMapper.createObjectNode();
        root.put("model", getEffectiveModel(options));
        root.put("stream", stream);

        ArrayNode messagesArray = root.putArray("messages");
        for (ChatMessage msg : messages) {
            ObjectNode msgNode = messagesArray.addObject();
            msgNode.put("role", msg.getRole());
            msgNode.put("content", msg.getContent());
        }

        ObjectNode optionsNode = root.putObject("options");
        optionsNode.put("temperature", getEffectiveTemperature(options));
        optionsNode.put("top_p", getEffectiveTopP(options));
        optionsNode.put("num_predict", getEffectiveMaxTokens(options));

        if (options != null && options.getStopSequences() != null
                && options.getStopSequences().length > 0) {
            ArrayNode stopArray = optionsNode.putArray("stop");
            for (String stop : options.getStopSequences()) {
                stopArray.add(stop);
            }
        }

        return objectMapper.writeValueAsString(root);
    }

    private Request buildRequest(String endpoint, String body) {
        Request.Builder builder = new Request.Builder()
                .url(baseUrl + endpoint)
                .header("Content-Type", "application/json")
                .post(RequestBody.create(body, MediaType.parse("application/json")));

        if (apiKey != null && !apiKey.isEmpty()) {
            builder.header("Authorization", "Bearer " + apiKey);
        }

        return builder.build();
    }

    private GenerateResult parseChatResponse(String responseBody, long duration) throws Exception {
        JsonNode root = objectMapper.readTree(responseBody);

        String content = "";
        if (root.has("message")) {
            JsonNode message = root.get("message");
            if (message.has("content")) {
                content = message.get("content").asText();
            }
        }

        int promptTokens = root.has("prompt_eval_count") ? root.get("prompt_eval_count").asInt() : 0;
        int completionTokens = root.has("eval_count") ? root.get("eval_count").asInt() : 0;

        String model = root.has("model") ? root.get("model").asText() : defaultModel;

        boolean done = root.has("done") && root.get("done").asBoolean();
        String finishReason = done ? "stop" : "length";

        return createSuccessResult(content, model, promptTokens, completionTokens, finishReason, duration);
    }
}
