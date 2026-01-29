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
     * AI初始化小说接口 - 生成简介、大纲、角色和推荐书名
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

        // 获取高级设置
        @SuppressWarnings("unchecked")
        Map<String, Object> advancedSettings = (Map<String, Object>) request.get("advancedSettings");

        if (title == null || title.isEmpty()) {
            return Result.badRequest("书名不能为空");
        }

        // 构建生成提示词
        StringBuilder prompt = new StringBuilder();
        prompt.append("请为以下小说生成完整的初始设定，包括简介、大纲、主要角色和推荐书名。\n\n");
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

        // 处理高级设置
        if (advancedSettings != null) {
            // 处理叙事设置
            @SuppressWarnings("unchecked")
            Map<String, Object> narrativeSettings = (Map<String, Object>) advancedSettings.get("narrative");
            if (narrativeSettings != null) {
                String perspective = (String) narrativeSettings.get("perspective");
                String tense = (String) narrativeSettings.get("tense");
                if (perspective != null && !perspective.isEmpty()) {
                    prompt.append("【叙事视角】").append(getNarrativePerspectiveName(perspective)).append("\n");
                }
                if (tense != null && !tense.isEmpty()) {
                    prompt.append("【叙述时态】").append(getNarrativeTenseName(tense)).append("\n");
                }
            }

            // 处理世界观设置
            @SuppressWarnings("unchecked")
            Map<String, Object> worldBuildingSettings = (Map<String, Object>) advancedSettings.get("worldBuilding");
            if (worldBuildingSettings != null) {
                String era = (String) worldBuildingSettings.get("era");
                String powerSystem = (String) worldBuildingSettings.get("powerSystem");
                String powerSystemCustom = (String) worldBuildingSettings.get("powerSystemCustom");
                String techLevel = (String) worldBuildingSettings.get("techLevel");
                if (era != null && !era.isEmpty()) {
                    prompt.append("【时代背景】").append(getEraSettingName(era)).append("\n");
                }
                if (powerSystem != null && !powerSystem.isEmpty()) {
                    prompt.append("【力量体系】").append(getPowerSystemName(powerSystem));
                    if ("custom".equals(powerSystem) && powerSystemCustom != null && !powerSystemCustom.isEmpty()) {
                        prompt.append("：").append(powerSystemCustom);
                    }
                    prompt.append("\n");
                }
                if (techLevel != null && !techLevel.isEmpty()) {
                    prompt.append("【科技水平】").append(getTechLevelName(techLevel)).append("\n");
                }
            }

            // 处理主角设置
            @SuppressWarnings("unchecked")
            Map<String, Object> protagonistSettings = (Map<String, Object>) advancedSettings.get("protagonist");
            if (protagonistSettings != null) {
                String personality = (String) protagonistSettings.get("personality");
                String romanceLine = (String) protagonistSettings.get("romanceLine");
                String haremSize = (String) protagonistSettings.get("haremSize");

                if (personality != null && !personality.isEmpty()) {
                    prompt.append("【主角性格】").append(getPersonalityName(personality)).append("\n");
                }
                if (romanceLine != null && !romanceLine.isEmpty()) {
                    String romanceDesc = getRomanceLineName(romanceLine);
                    prompt.append("【感情线】").append(romanceDesc);
                    if ("harem".equals(romanceLine) && haremSize != null && !haremSize.isEmpty()) {
                        prompt.append("（").append(getHaremSizeName(haremSize)).append("）");
                    }
                    prompt.append("\n");
                    // 强调感情线约束
                    if ("none".equals(romanceLine)) {
                        prompt.append("⚠️ 重要约束：本书【无CP/无感情线】，角色之间不能有任何恋爱关系、红颜知己、暧昧对象等。所有角色关系仅限于：同盟、对手、师徒、朋友、亲人等非恋爱关系。\n");
                    } else if ("harem".equals(romanceLine)) {
                        prompt.append("⚠️ 重要约束：本书为【后宫文】，需要生成多个女主角色，并在角色标签中标记【女主】。\n");
                    }
                }

                // 处理金手指设置
                @SuppressWarnings("unchecked")
                Map<String, Object> goldenFinger = (Map<String, Object>) protagonistSettings.get("goldenFinger");
                if (goldenFinger != null) {
                    String gfType = (String) goldenFinger.get("type");
                    String gfName = (String) goldenFinger.get("name");
                    String gfDesc = (String) goldenFinger.get("description");
                    String gfLimit = (String) goldenFinger.get("limitation");
                    String gfGrowth = (String) goldenFinger.get("growthPath");
                    if (gfType != null && !"none".equals(gfType)) {
                        prompt.append("【金手指】").append(getGoldenFingerTypeName(gfType));
                        if (gfName != null && !gfName.isEmpty()) {
                            prompt.append("（").append(gfName).append("）");
                        }
                        if (gfDesc != null && !gfDesc.isEmpty()) {
                            prompt.append("：").append(gfDesc);
                        }
                        prompt.append("\n");
                        if (gfLimit != null && !gfLimit.isEmpty()) {
                            prompt.append("  限制条件：").append(gfLimit).append("\n");
                        }
                        if (gfGrowth != null && !gfGrowth.isEmpty()) {
                            prompt.append("  成长路线：").append(gfGrowth).append("\n");
                        }
                    }
                }
            }

            // 处理剧情偏好
            @SuppressWarnings("unchecked")
            Map<String, Object> plotSettings = (Map<String, Object>) advancedSettings.get("plot");
            if (plotSettings != null) {
                String pacing = (String) plotSettings.get("pacing");
                String conflictDensity = (String) plotSettings.get("conflictDensity");
                String angstLevel = (String) plotSettings.get("angstLevel");
                String ending = (String) plotSettings.get("ending");
                if (pacing != null && !pacing.isEmpty()) {
                    prompt.append("【节奏偏好】").append(getPacingName(pacing)).append("\n");
                }
                if (conflictDensity != null && !conflictDensity.isEmpty()) {
                    prompt.append("【爽点密度】").append(getConflictDensityName(conflictDensity)).append("\n");
                }
                if (angstLevel != null && !angstLevel.isEmpty()) {
                    prompt.append("【虐点程度】").append(getAngstLevelName(angstLevel)).append("\n");
                }
                if (ending != null && !ending.isEmpty()) {
                    prompt.append("【结局倾向】").append(getEndingName(ending)).append("\n");
                }
            }

            // 处理写作风格
            @SuppressWarnings("unchecked")
            Map<String, Object> writingSettings = (Map<String, Object>) advancedSettings.get("writing");
            if (writingSettings != null) {
                String writingStyle = (String) writingSettings.get("style");
                String dialogueRatio = (String) writingSettings.get("dialogueRatio");
                if (writingStyle != null && !writingStyle.isEmpty()) {
                    prompt.append("【文笔风格】").append(getWritingStyleName(writingStyle)).append("\n");
                }
                if (dialogueRatio != null && !dialogueRatio.isEmpty()) {
                    prompt.append("【对话比例】").append(getDialogueRatioName(dialogueRatio)).append("\n");
                }
            }

            // 处理禁忌/偏好
            @SuppressWarnings("unchecked")
            Map<String, Object> preferencesSettings = (Map<String, Object>) advancedSettings.get("preferences");
            if (preferencesSettings != null) {
                @SuppressWarnings("unchecked")
                java.util.List<String> forbiddenElements = (java.util.List<String>) preferencesSettings.get("forbiddenElements");
                @SuppressWarnings("unchecked")
                java.util.List<String> requiredElements = (java.util.List<String>) preferencesSettings.get("requiredElements");
                String referenceWorks = (String) preferencesSettings.get("referenceWorks");
                if (forbiddenElements != null && !forbiddenElements.isEmpty()) {
                    prompt.append("【禁用元素】").append(String.join("、", forbiddenElements)).append("\n");
                }
                if (requiredElements != null && !requiredElements.isEmpty()) {
                    prompt.append("【必含元素】").append(String.join("、", requiredElements)).append("\n");
                }
                if (referenceWorks != null && !referenceWorks.isEmpty()) {
                    prompt.append("【参考作品】").append(referenceWorks).append("\n");
                }
            }
        }

        prompt.append("\n请按以下JSON格式输出，不要输出其他内容：\n");
        prompt.append("```json\n");
        prompt.append("{\n");
        prompt.append("  \"description\": \"小说简介（150-300字，吸引读者的简介）\",\n");
        prompt.append("  \"outline\": \"全书大纲（500-800字，包含主线剧情、关键转折点、高潮和结局方向）\",\n");
        prompt.append("  \"characters\": [\n");
        prompt.append("    {\"name\": \"角色名\", \"role\": \"protagonist/supporting/antagonist\", \"tags\": [\"女主\"/\"重要配角\"/\"导师\"等标签], \"description\": \"角色简介（50-100字）\"},\n");
        prompt.append("    ...\n");
        prompt.append("  ],\n");
        prompt.append("  \"suggestedTitles\": [\"推荐书名1\", \"推荐书名2\", \"推荐书名3\"]\n");
        prompt.append("}\n");
        prompt.append("```\n");
        prompt.append("请生成3-5个主要角色（根据感情线设定决定女主数量）。\n");
        prompt.append("角色标签可选：女主、男主、重要配角、感情对象、导师/师父、对手、搞笑担当、神秘人物。\n");
        prompt.append("推荐书名需要根据故事内容和类型风格生成3个吸引人的备选书名。");

        GenerateOptions options = GenerateOptions.builder()
                .systemPrompt("你是一位专业的网络小说策划师，擅长设计引人入胜的故事。请严格按照JSON格式输出，确保输出是有效的JSON。必须严格遵守用户指定的感情线设定。")
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

    private String getPersonalityName(String personality) {
        if (personality == null) return "";
        switch (personality) {
            case "calm": return "冷静理智";
            case "hotblooded": return "热血冲动";
            case "cunning": return "腹黑算计";
            case "honest": return "老实憨厚";
            case "ruthless": return "心狠手辣";
            case "kind": return "善良正义";
            default: return personality;
        }
    }

    private String getRomanceLineName(String romanceLine) {
        if (romanceLine == null) return "";
        switch (romanceLine) {
            case "none": return "无CP/无感情线";
            case "single": return "单女主/单男主";
            case "harem": return "后宫";
            case "bl": return "BL";
            case "gl": return "GL";
            case "slow_burn": return "慢热感情";
            default: return romanceLine;
        }
    }

    private String getGoldenFingerTypeName(String type) {
        if (type == null) return "";
        switch (type) {
            case "system": return "系统流";
            case "space": return "空间流/储物流";
            case "inheritance": return "传承流";
            case "rebirth": return "重生流";
            case "bloodline": return "血脉流";
            case "cultivation": return "功法流";
            case "artifact": return "神器流";
            case "none": return "无金手指";
            default: return type;
        }
    }

    private String getHaremSizeName(String size) {
        if (size == null) return "";
        switch (size) {
            case "small": return "2-3人";
            case "medium": return "4-5人";
            case "large": return "6人以上";
            default: return size;
        }
    }

    private String getNarrativePerspectiveName(String perspective) {
        if (perspective == null) return "";
        switch (perspective) {
            case "first_person": return "第一人称";
            case "third_limited": return "第三人称限知";
            case "third_omniscient": return "第三人称全知";
            case "multi_pov": return "多视角切换";
            default: return perspective;
        }
    }

    private String getNarrativeTenseName(String tense) {
        if (tense == null) return "";
        switch (tense) {
            case "past": return "过去时";
            case "present": return "现在时";
            default: return tense;
        }
    }

    private String getEraSettingName(String era) {
        if (era == null) return "";
        switch (era) {
            case "ancient": return "古代";
            case "modern": return "现代";
            case "future": return "未来";
            case "alternate": return "架空";
            default: return era;
        }
    }

    private String getPowerSystemName(String powerSystem) {
        if (powerSystem == null) return "";
        switch (powerSystem) {
            case "realm": return "境界制（练气→渡劫）";
            case "level": return "等级制";
            case "bloodline": return "血脉制";
            case "martial": return "武学制";
            case "magic": return "魔法制";
            case "none": return "无体系";
            case "custom": return "自定义";
            default: return powerSystem;
        }
    }

    private String getTechLevelName(String techLevel) {
        if (techLevel == null) return "";
        switch (techLevel) {
            case "primitive": return "原始";
            case "medieval": return "中世纪";
            case "modern": return "现代";
            case "near_future": return "近未来";
            case "far_future": return "超未来";
            default: return techLevel;
        }
    }

    private String getPacingName(String pacing) {
        if (pacing == null) return "";
        switch (pacing) {
            case "fast": return "快节奏爽文";
            case "slow": return "慢热铺垫";
            case "balanced": return "张弛有度";
            default: return pacing;
        }
    }

    private String getConflictDensityName(String density) {
        if (density == null) return "";
        switch (density) {
            case "high": return "高频打脸";
            case "moderate": return "适度冲突";
            case "low": return "重剧情深度";
            default: return density;
        }
    }

    private String getAngstLevelName(String level) {
        if (level == null) return "";
        switch (level) {
            case "none": return "全程顺利";
            case "minor": return "小挫折";
            case "major": return "大起大落";
            case "heavy": return "持续虐心";
            default: return level;
        }
    }

    private String getEndingName(String ending) {
        if (ending == null) return "";
        switch (ending) {
            case "happy": return "HE（圆满结局）";
            case "bad": return "BE（悲剧结局）";
            case "open": return "开放式结局";
            default: return ending;
        }
    }

    private String getWritingStyleName(String style) {
        if (style == null) return "";
        switch (style) {
            case "plain": return "白话直白";
            case "literary": return "文艺优美";
            case "humorous": return "幽默诙谐";
            case "serious": return "严谨冷峻";
            default: return style;
        }
    }

    private String getDialogueRatioName(String ratio) {
        if (ratio == null) return "";
        switch (ratio) {
            case "dialogue_heavy": return "多对话";
            case "balanced": return "均衡";
            case "narration_heavy": return "多叙述";
            default: return ratio;
        }
    }
}
