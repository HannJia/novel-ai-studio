package com.novelai.studio.controller;

import com.novelai.studio.common.Result;
import com.novelai.studio.service.ai.AIService;
import com.novelai.studio.service.ai.dto.ChatMessage;
import com.novelai.studio.service.ai.dto.GenerateOptions;
import com.novelai.studio.service.ai.dto.GenerateResult;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * AI生成控制器
 */
@RestController
@RequestMapping("/api/ai")
public class AiGenerateController {

    @Autowired
    private AIService aiService;

    private final ExecutorService executorService = Executors.newCachedThreadPool();

    /**
     * 生成请求体
     */
    public static class GenerateRequest {
        private String prompt;
        private String configId;
        private String systemPrompt;
        private String model;
        private Integer maxTokens;
        private Double temperature;
        private Double topP;
        private String[] stopSequences;

        public String getPrompt() { return prompt; }
        public void setPrompt(String prompt) { this.prompt = prompt; }
        public String getConfigId() { return configId; }
        public void setConfigId(String configId) { this.configId = configId; }
        public String getSystemPrompt() { return systemPrompt; }
        public void setSystemPrompt(String systemPrompt) { this.systemPrompt = systemPrompt; }
        public String getModel() { return model; }
        public void setModel(String model) { this.model = model; }
        public Integer getMaxTokens() { return maxTokens; }
        public void setMaxTokens(Integer maxTokens) { this.maxTokens = maxTokens; }
        public Double getTemperature() { return temperature; }
        public void setTemperature(Double temperature) { this.temperature = temperature; }
        public Double getTopP() { return topP; }
        public void setTopP(Double topP) { this.topP = topP; }
        public String[] getStopSequences() { return stopSequences; }
        public void setStopSequences(String[] stopSequences) { this.stopSequences = stopSequences; }

        public GenerateOptions toOptions() {
            return GenerateOptions.builder()
                    .systemPrompt(systemPrompt)
                    .model(model)
                    .maxTokens(maxTokens)
                    .temperature(temperature)
                    .topP(topP)
                    .stopSequences(stopSequences)
                    .build();
        }
    }

    /**
     * 多轮对话请求体
     */
    public static class ChatRequest {
        private List<Map<String, String>> messages;
        private String configId;
        private String model;
        private Integer maxTokens;
        private Double temperature;
        private Double topP;

        public List<Map<String, String>> getMessages() { return messages; }
        public void setMessages(List<Map<String, String>> messages) { this.messages = messages; }
        public String getConfigId() { return configId; }
        public void setConfigId(String configId) { this.configId = configId; }
        public String getModel() { return model; }
        public void setModel(String model) { this.model = model; }
        public Integer getMaxTokens() { return maxTokens; }
        public void setMaxTokens(Integer maxTokens) { this.maxTokens = maxTokens; }
        public Double getTemperature() { return temperature; }
        public void setTemperature(Double temperature) { this.temperature = temperature; }
        public Double getTopP() { return topP; }
        public void setTopP(Double topP) { this.topP = topP; }

        public GenerateOptions toOptions() {
            return GenerateOptions.builder()
                    .model(model)
                    .maxTokens(maxTokens)
                    .temperature(temperature)
                    .topP(topP)
                    .build();
        }

        public List<ChatMessage> toChatMessages() {
            return messages.stream()
                    .map(m -> new ChatMessage(m.get("role"), m.get("content")))
                    .toList();
        }
    }

    /**
     * 同步生成内容
     */
    @PostMapping("/generate")
    public Result<GenerateResult> generate(@RequestBody GenerateRequest request) {
        if (request.getPrompt() == null || request.getPrompt().isEmpty()) {
            return Result.badRequest("提示词不能为空");
        }

        GenerateResult result = aiService.generate(
                request.getPrompt(),
                request.getConfigId(),
                request.toOptions()
        );

        if ("error".equals(result.getFinishReason())) {
            return Result.error(result.getErrorMessage());
        }

        return Result.success(result);
    }

    /**
     * 流式生成内容（SSE）
     */
    @PostMapping(value = "/generate/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter generateStream(@RequestBody GenerateRequest request) {
        SseEmitter emitter = new SseEmitter(300000L); // 5分钟超时

        executorService.execute(() -> {
            try {
                aiService.generateStream(
                        request.getPrompt(),
                        request.getConfigId(),
                        request.toOptions(),
                        chunk -> {
                            try {
                                emitter.send(SseEmitter.event()
                                        .name("message")
                                        .data(Map.of("content", chunk)));
                            } catch (IOException e) {
                                emitter.completeWithError(e);
                            }
                        }
                );

                emitter.send(SseEmitter.event()
                        .name("done")
                        .data(Map.of("status", "completed")));
                emitter.complete();
            } catch (Exception e) {
                try {
                    emitter.send(SseEmitter.event()
                            .name("error")
                            .data(Map.of("error", e.getMessage())));
                } catch (IOException ignored) {}
                emitter.completeWithError(e);
            }
        });

        return emitter;
    }

    /**
     * 多轮对话
     */
    @PostMapping("/chat")
    public Result<GenerateResult> chat(@RequestBody ChatRequest request) {
        if (request.getMessages() == null || request.getMessages().isEmpty()) {
            return Result.badRequest("消息列表不能为空");
        }

        GenerateResult result = aiService.chat(
                request.toChatMessages(),
                request.getConfigId(),
                request.toOptions()
        );

        if ("error".equals(result.getFinishReason())) {
            return Result.error(result.getErrorMessage());
        }

        return Result.success(result);
    }

    /**
     * 流式多轮对话（SSE）
     */
    @PostMapping(value = "/chat/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter chatStream(@RequestBody ChatRequest request) {
        SseEmitter emitter = new SseEmitter(300000L);

        executorService.execute(() -> {
            try {
                aiService.chatStream(
                        request.toChatMessages(),
                        request.getConfigId(),
                        request.toOptions(),
                        chunk -> {
                            try {
                                emitter.send(SseEmitter.event()
                                        .name("message")
                                        .data(Map.of("content", chunk)));
                            } catch (IOException e) {
                                emitter.completeWithError(e);
                            }
                        }
                );

                emitter.send(SseEmitter.event()
                        .name("done")
                        .data(Map.of("status", "completed")));
                emitter.complete();
            } catch (Exception e) {
                try {
                    emitter.send(SseEmitter.event()
                            .name("error")
                            .data(Map.of("error", e.getMessage())));
                } catch (IOException ignored) {}
                emitter.completeWithError(e);
            }
        });

        return emitter;
    }

    /**
     * 小说续写接口
     */
    @PostMapping("/continue-writing")
    public Result<GenerateResult> continueWriting(@RequestBody Map<String, Object> request) {
        String content = (String) request.get("content");
        String outline = (String) request.get("outline");
        String configId = (String) request.get("configId");
        Integer wordCount = (Integer) request.get("wordCount");

        if (content == null || content.isEmpty()) {
            return Result.badRequest("内容不能为空");
        }

        // 构建续写提示词
        StringBuilder prompt = new StringBuilder();
        prompt.append("请根据以下已有内容继续创作小说。\n\n");

        if (outline != null && !outline.isEmpty()) {
            prompt.append("【章节大纲】\n").append(outline).append("\n\n");
        }

        prompt.append("【已有内容】\n").append(content).append("\n\n");

        if (wordCount != null && wordCount > 0) {
            prompt.append("请续写约").append(wordCount).append("字。\n\n");
        } else {
            prompt.append("请续写约500字。\n\n");
        }

        prompt.append("【续写内容】\n");

        GenerateOptions options = GenerateOptions.builder()
                .systemPrompt("你是一位专业的小说作家，擅长网络小说创作。你需要根据给定的大纲和已有内容，以流畅自然的方式续写故事。保持文风一致，情节连贯。")
                .maxTokens(wordCount != null ? Math.min(wordCount * 2, 4096) : 2048)
                .temperature(0.8)
                .build();

        GenerateResult result = aiService.generate(prompt.toString(), configId, options);

        if ("error".equals(result.getFinishReason())) {
            return Result.error(result.getErrorMessage());
        }

        return Result.success(result);
    }

    /**
     * 大纲生成接口
     */
    @PostMapping("/generate-outline")
    public Result<GenerateResult> generateOutline(@RequestBody Map<String, Object> request) {
        String bookTitle = (String) request.get("bookTitle");
        String genre = (String) request.get("genre");
        String style = (String) request.get("style");
        String description = (String) request.get("description");
        String configId = (String) request.get("configId");
        String type = (String) request.getOrDefault("type", "chapter"); // chapter/volume/book

        if (bookTitle == null || bookTitle.isEmpty()) {
            return Result.badRequest("书名不能为空");
        }

        StringBuilder prompt = new StringBuilder();
        prompt.append("请为以下小说生成").append(getOutlineTypeName(type)).append("。\n\n");
        prompt.append("【书名】").append(bookTitle).append("\n");

        if (genre != null && !genre.isEmpty()) {
            prompt.append("【类型】").append(genre).append("\n");
        }
        if (style != null && !style.isEmpty()) {
            prompt.append("【风格】").append(style).append("\n");
        }
        if (description != null && !description.isEmpty()) {
            prompt.append("【简介】").append(description).append("\n");
        }

        prompt.append("\n请生成详细的大纲，包括主要情节点和人物动态。");

        GenerateOptions options = GenerateOptions.builder()
                .systemPrompt("你是一位经验丰富的小说策划，擅长设计引人入胜的故事大纲。你的大纲应该结构清晰、情节紧凑、有起承转合。")
                .maxTokens(2048)
                .temperature(0.7)
                .build();

        GenerateResult result = aiService.generate(prompt.toString(), configId, options);

        if ("error".equals(result.getFinishReason())) {
            return Result.error(result.getErrorMessage());
        }

        return Result.success(result);
    }

    private String getOutlineTypeName(String type) {
        switch (type) {
            case "book": return "全书大纲";
            case "volume": return "卷大纲";
            case "chapter":
            default: return "章节大纲";
        }
    }

    /**
     * AI初始化小说接口 - 生成简介、大纲、角色
     */
    @PostMapping("/initialize-novel")
    public Result<Map<String, Object>> initializeNovel(@RequestBody Map<String, Object> request) {
        String title = (String) request.get("title");
        String genre = (String) request.get("genre");
        String style = (String) request.get("style");
        String protagonist = (String) request.get("protagonist");
        String worldKeywords = (String) request.get("worldKeywords");
        String coreConflict = (String) request.get("coreConflict");
        String configId = (String) request.get("configId");

        if (title == null || title.isEmpty()) {
            return Result.badRequest("书名不能为空");
        }

        // 构建生成提示词
        StringBuilder prompt = new StringBuilder();
        prompt.append("请为以下小说生成完整的初始设定，包括简介、大纲和主要角色。\n\n");
        prompt.append("【书名】").append(title).append("\n");
        prompt.append("【类型】").append(getGenreName(genre)).append("\n");
        prompt.append("【风格】").append(getStyleName(style)).append("\n");

        if (protagonist != null && !protagonist.isEmpty()) {
            prompt.append("【主角设定】").append(protagonist).append("\n");
        }
        if (worldKeywords != null && !worldKeywords.isEmpty()) {
            prompt.append("【世界观关键词】").append(worldKeywords).append("\n");
        }
        if (coreConflict != null && !coreConflict.isEmpty()) {
            prompt.append("【核心冲突】").append(coreConflict).append("\n");
        }

        prompt.append("\n请按以下JSON格式输出，不要输出其他内容：\n");
        prompt.append("```json\n");
        prompt.append("{\n");
        prompt.append("  \"description\": \"小说简介（150-300字，吸引读者的简介）\",\n");
        prompt.append("  \"outline\": \"全书大纲（500-800字，包含主线剧情、关键转折点、高潮和结局方向）\",\n");
        prompt.append("  \"characters\": [\n");
        prompt.append("    {\"name\": \"角色名\", \"role\": \"protagonist/supporting/antagonist\", \"description\": \"角色简介（50-100字）\"},\n");
        prompt.append("    ...\n");
        prompt.append("  ]\n");
        prompt.append("}\n");
        prompt.append("```\n");
        prompt.append("请生成3-5个主要角色。");

        GenerateOptions options = GenerateOptions.builder()
                .systemPrompt("你是一位专业的网络小说策划师，擅长设计引人入胜的故事。请严格按照JSON格式输出，确保输出是有效的JSON。")
                .maxTokens(4096)
                .temperature(0.8)
                .build();

        GenerateResult result = aiService.generate(prompt.toString(), configId, options);

        if ("error".equals(result.getFinishReason())) {
            return Result.error(result.getErrorMessage());
        }

        // 解析JSON结果
        try {
            String content = result.getContent();
            // 提取JSON部分
            int jsonStart = content.indexOf("{");
            int jsonEnd = content.lastIndexOf("}") + 1;
            if (jsonStart >= 0 && jsonEnd > jsonStart) {
                String jsonStr = content.substring(jsonStart, jsonEnd);
                com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
                Map<String, Object> parsed = mapper.readValue(jsonStr, Map.class);
                return Result.success(parsed);
            } else {
                // 如果无法解析JSON，返回原始内容
                return Result.success(Map.of(
                        "description", content,
                        "outline", "",
                        "characters", List.of()
                ));
            }
        } catch (Exception e) {
            // JSON解析失败，返回原始内容
            return Result.success(Map.of(
                    "description", result.getContent(),
                    "outline", "",
                    "characters", List.of()
            ));
        }
    }

    /**
     * AI修改小说设定接口
     */
    @PostMapping("/refine-novel")
    public Result<Map<String, Object>> refineNovel(@RequestBody Map<String, Object> request) {
        @SuppressWarnings("unchecked")
        Map<String, Object> currentContent = (Map<String, Object>) request.get("currentContent");
        String userRequest = (String) request.get("userRequest");
        String configId = (String) request.get("configId");

        if (currentContent == null) {
            return Result.badRequest("当前内容不能为空");
        }
        if (userRequest == null || userRequest.isEmpty()) {
            return Result.badRequest("修改要求不能为空");
        }

        String currentDescription = (String) currentContent.getOrDefault("description", "");
        String currentOutline = (String) currentContent.getOrDefault("outline", "");
        @SuppressWarnings("unchecked")
        List<Map<String, String>> currentCharacters = (List<Map<String, String>>) currentContent.getOrDefault("characters", List.of());

        StringBuilder prompt = new StringBuilder();
        prompt.append("请根据用户的修改要求，修改以下小说设定。\n\n");
        prompt.append("【当前简介】\n").append(currentDescription).append("\n\n");
        prompt.append("【当前大纲】\n").append(currentOutline).append("\n\n");
        prompt.append("【当前角色】\n");
        for (Map<String, String> character : currentCharacters) {
            prompt.append("- ").append(character.get("name")).append("（").append(character.get("role")).append("）：").append(character.get("description")).append("\n");
        }
        prompt.append("\n【用户修改要求】\n").append(userRequest).append("\n\n");

        prompt.append("请按以下JSON格式输出修改后的内容：\n");
        prompt.append("```json\n");
        prompt.append("{\n");
        prompt.append("  \"description\": \"修改后的简介\",\n");
        prompt.append("  \"outline\": \"修改后的大纲\",\n");
        prompt.append("  \"characters\": [{\"name\": \"角色名\", \"role\": \"protagonist/supporting/antagonist\", \"description\": \"角色简介\"}, ...]\n");
        prompt.append("}\n");
        prompt.append("```");

        GenerateOptions options = GenerateOptions.builder()
                .systemPrompt("你是一位专业的网络小说策划师。请根据用户的修改要求调整小说设定，保持整体风格一致。请严格按照JSON格式输出。")
                .maxTokens(4096)
                .temperature(0.7)
                .build();

        GenerateResult result = aiService.generate(prompt.toString(), configId, options);

        if ("error".equals(result.getFinishReason())) {
            return Result.error(result.getErrorMessage());
        }

        // 解析JSON结果
        try {
            String content = result.getContent();
            int jsonStart = content.indexOf("{");
            int jsonEnd = content.lastIndexOf("}") + 1;
            if (jsonStart >= 0 && jsonEnd > jsonStart) {
                String jsonStr = content.substring(jsonStart, jsonEnd);
                com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
                Map<String, Object> parsed = mapper.readValue(jsonStr, Map.class);
                return Result.success(parsed);
            } else {
                return Result.success(currentContent);
            }
        } catch (Exception e) {
            return Result.success(currentContent);
        }
    }

    private String getGenreName(String genre) {
        if (genre == null) return "其他";
        switch (genre) {
            case "xuanhuan": return "玄幻";
            case "xiuzhen": return "修真";
            case "dushi": return "都市";
            case "kehuan": return "科幻";
            case "lishi": return "历史";
            case "yanqing": return "言情";
            case "xuanyi": return "悬疑";
            default: return "其他";
        }
    }

    private String getStyleName(String style) {
        if (style == null) return "轻松";
        switch (style) {
            case "qingsong": return "轻松";
            case "yansu": return "严肃";
            case "rexue": return "热血";
            case "nuexin": return "虐心";
            case "huaji": return "搞笑";
            case "heian": return "黑暗";
            default: return "轻松";
        }
    }
}
