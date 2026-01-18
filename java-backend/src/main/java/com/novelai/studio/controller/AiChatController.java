package com.novelai.studio.controller;

import com.novelai.studio.entity.ChatMessageEntity;
import com.novelai.studio.entity.ChatSession;
import com.novelai.studio.service.ChatHistoryService;
import com.novelai.studio.service.ai.AIService;
import com.novelai.studio.service.ai.dto.GenerateOptions;
import com.novelai.studio.service.ai.dto.GenerateResult;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * AI对话控制器
 */
@RestController
@RequestMapping("/api/chat")
@CrossOrigin(origins = "*")
public class AiChatController {

    private static final Logger log = LoggerFactory.getLogger(AiChatController.class);

    @Autowired
    private ChatHistoryService chatHistoryService;

    @Autowired
    private AIService aiService;

    private final ExecutorService executorService = Executors.newCachedThreadPool();

    // ==================== 会话管理 ====================

    /**
     * 创建新会话
     */
    @PostMapping("/sessions")
    public ResponseEntity<ChatSession> createSession(@RequestBody CreateSessionRequest request) {
        ChatSession session = chatHistoryService.createSession(
                request.getBookId(),
                request.getTitle(),
                request.getContextType(),
                request.getContextRefId(),
                request.getAiConfigId()
        );
        return ResponseEntity.ok(session);
    }

    /**
     * 获取会话详情
     */
    @GetMapping("/sessions/{sessionId}")
    public ResponseEntity<ChatSession> getSession(@PathVariable String sessionId) {
        ChatSession session = chatHistoryService.getSession(sessionId);
        if (session == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(session);
    }

    /**
     * 获取所有会话列表
     */
    @GetMapping("/sessions")
    public ResponseEntity<List<ChatSession>> getSessions(
            @RequestParam(required = false) String bookId,
            @RequestParam(defaultValue = "50") int limit) {
        List<ChatSession> sessions;
        if (bookId != null && !bookId.isEmpty()) {
            sessions = chatHistoryService.getSessionsByBook(bookId);
        } else {
            sessions = chatHistoryService.getAllSessions(limit);
        }
        return ResponseEntity.ok(sessions);
    }

    /**
     * 更新会话标题
     */
    @PutMapping("/sessions/{sessionId}/title")
    public ResponseEntity<Void> updateSessionTitle(
            @PathVariable String sessionId,
            @RequestBody Map<String, String> body) {
        String title = body.get("title");
        chatHistoryService.updateSessionTitle(sessionId, title);
        return ResponseEntity.ok().build();
    }

    /**
     * 切换会话置顶
     */
    @PostMapping("/sessions/{sessionId}/toggle-pin")
    public ResponseEntity<Void> togglePinned(@PathVariable String sessionId) {
        chatHistoryService.togglePinned(sessionId);
        return ResponseEntity.ok().build();
    }

    /**
     * 删除会话
     */
    @DeleteMapping("/sessions/{sessionId}")
    public ResponseEntity<Void> deleteSession(@PathVariable String sessionId) {
        chatHistoryService.deleteSession(sessionId);
        return ResponseEntity.ok().build();
    }

    // ==================== 消息管理 ====================

    /**
     * 获取会话消息
     */
    @GetMapping("/sessions/{sessionId}/messages")
    public ResponseEntity<List<ChatMessageEntity>> getMessages(
            @PathVariable String sessionId,
            @RequestParam(defaultValue = "100") int limit) {
        List<ChatMessageEntity> messages;
        if (limit > 0 && limit < 100) {
            messages = chatHistoryService.getRecentMessages(sessionId, limit);
        } else {
            messages = chatHistoryService.getMessages(sessionId);
        }
        return ResponseEntity.ok(messages);
    }

    /**
     * 清空会话消息
     */
    @DeleteMapping("/sessions/{sessionId}/messages")
    public ResponseEntity<Void> clearMessages(@PathVariable String sessionId) {
        chatHistoryService.clearMessages(sessionId);
        return ResponseEntity.ok().build();
    }

    // ==================== 对话功能 ====================

    /**
     * 发送消息（非流式）
     */
    @PostMapping("/sessions/{sessionId}/send")
    public ResponseEntity<ChatResponse> sendMessage(
            @PathVariable String sessionId,
            @RequestBody SendMessageRequest request) {

        ChatSession session = chatHistoryService.getSession(sessionId);
        if (session == null) {
            return ResponseEntity.notFound().build();
        }

        // 保存用户消息
        chatHistoryService.addUserMessage(sessionId, request.getMessage());

        // 构建系统提示词
        String systemPrompt = chatHistoryService.buildSystemPrompt(session);

        // 构建对话消息
        List<com.novelai.studio.service.ai.dto.ChatMessage> messages =
                chatHistoryService.buildChatMessages(sessionId, systemPrompt, 20);

        // 添加当前用户消息
        messages.add(com.novelai.studio.service.ai.dto.ChatMessage.user(request.getMessage()));

        // 构建生成选项
        GenerateOptions options = GenerateOptions.builder()
                .maxTokens(request.getMaxTokens() != null ? request.getMaxTokens() : 2048)
                .temperature(request.getTemperature() != null ? request.getTemperature() : 0.7)
                .build();

        // 调用AI
        String configId = session.getAiConfigId();
        GenerateResult result = aiService.chat(messages, configId, options);

        // 保存AI回复
        ChatMessageEntity assistantMsg;
        if ("error".equals(result.getFinishReason())) {
            assistantMsg = chatHistoryService.addErrorMessage(sessionId, result.getErrorMessage());
        } else {
            assistantMsg = chatHistoryService.addAssistantMessage(
                    sessionId,
                    result.getContent(),
                    result.getReasoning(),
                    result.getTokenUsage() != null ? result.getTokenUsage().getTotalTokens() : 0,
                    result.getModel(),
                    result.getDuration() != null ? result.getDuration().intValue() : 0
            );
        }

        ChatResponse response = new ChatResponse();
        response.setMessage(assistantMsg);
        response.setTokenUsage(result.getTokenUsage());
        response.setDuration(result.getDuration());

        return ResponseEntity.ok(response);
    }

    /**
     * 发送消息（流式）
     */
    @PostMapping(value = "/sessions/{sessionId}/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter streamMessage(
            @PathVariable String sessionId,
            @RequestBody SendMessageRequest request) {

        SseEmitter emitter = new SseEmitter(300000L); // 5分钟超时

        executorService.execute(() -> {
            try {
                ChatSession session = chatHistoryService.getSession(sessionId);
                if (session == null) {
                    emitter.send(SseEmitter.event().name("error").data("Session not found"));
                    emitter.complete();
                    return;
                }

                // 保存用户消息
                chatHistoryService.addUserMessage(sessionId, request.getMessage());

                // 构建系统提示词
                String systemPrompt = chatHistoryService.buildSystemPrompt(session);

                // 构建对话消息
                List<com.novelai.studio.service.ai.dto.ChatMessage> messages =
                        chatHistoryService.buildChatMessages(sessionId, systemPrompt, 20);

                messages.add(com.novelai.studio.service.ai.dto.ChatMessage.user(request.getMessage()));

                // 构建生成选项
                GenerateOptions options = GenerateOptions.builder()
                        .maxTokens(request.getMaxTokens() != null ? request.getMaxTokens() : 2048)
                        .temperature(request.getTemperature() != null ? request.getTemperature() : 0.7)
                        .build();

                StringBuilder fullContent = new StringBuilder();

                // 流式调用AI
                String configId = session.getAiConfigId();
                GenerateResult result = aiService.chatStream(messages, configId, options, chunk -> {
                    try {
                        fullContent.append(chunk);
                        emitter.send(SseEmitter.event().name("chunk").data(chunk));
                    } catch (Exception e) {
                        log.error("Error sending SSE chunk", e);
                    }
                });

                // 保存AI回复
                ChatMessageEntity assistantMsg;
                if ("error".equals(result.getFinishReason())) {
                    assistantMsg = chatHistoryService.addErrorMessage(sessionId, result.getErrorMessage());
                    emitter.send(SseEmitter.event().name("error").data(result.getErrorMessage()));
                } else {
                    assistantMsg = chatHistoryService.addAssistantMessage(
                            sessionId,
                            fullContent.toString(),
                            result.getReasoning(),
                            result.getTokenUsage() != null ? result.getTokenUsage().getTotalTokens() : 0,
                            result.getModel(),
                            result.getDuration() != null ? result.getDuration().intValue() : 0
                    );

                    // 发送完成事件
                    Map<String, Object> doneData = new HashMap<>();
                    doneData.put("messageId", assistantMsg.getId());
                    doneData.put("tokenUsage", result.getTokenUsage());
                    doneData.put("duration", result.getDuration());
                    emitter.send(SseEmitter.event().name("done").data(doneData));
                }

                emitter.complete();

            } catch (Exception e) {
                log.error("Error in stream chat", e);
                try {
                    emitter.send(SseEmitter.event().name("error").data(e.getMessage()));
                } catch (Exception ignored) {}
                emitter.completeWithError(e);
            }
        });

        return emitter;
    }

    // ==================== 请求/响应对象 ====================

    public static class CreateSessionRequest {
        private String bookId;
        private String title;
        private String contextType;
        private String contextRefId;
        private String aiConfigId;

        public String getBookId() { return bookId; }
        public void setBookId(String bookId) { this.bookId = bookId; }
        public String getTitle() { return title; }
        public void setTitle(String title) { this.title = title; }
        public String getContextType() { return contextType; }
        public void setContextType(String contextType) { this.contextType = contextType; }
        public String getContextRefId() { return contextRefId; }
        public void setContextRefId(String contextRefId) { this.contextRefId = contextRefId; }
        public String getAiConfigId() { return aiConfigId; }
        public void setAiConfigId(String aiConfigId) { this.aiConfigId = aiConfigId; }
    }

    public static class SendMessageRequest {
        private String message;
        private Integer maxTokens;
        private Double temperature;

        public String getMessage() { return message; }
        public void setMessage(String message) { this.message = message; }
        public Integer getMaxTokens() { return maxTokens; }
        public void setMaxTokens(Integer maxTokens) { this.maxTokens = maxTokens; }
        public Double getTemperature() { return temperature; }
        public void setTemperature(Double temperature) { this.temperature = temperature; }
    }

    public static class ChatResponse {
        private ChatMessageEntity message;
        private GenerateResult.TokenUsage tokenUsage;
        private Long duration;

        public ChatMessageEntity getMessage() { return message; }
        public void setMessage(ChatMessageEntity message) { this.message = message; }
        public GenerateResult.TokenUsage getTokenUsage() { return tokenUsage; }
        public void setTokenUsage(GenerateResult.TokenUsage tokenUsage) { this.tokenUsage = tokenUsage; }
        public Long getDuration() { return duration; }
        public void setDuration(Long duration) { this.duration = duration; }
    }
}
