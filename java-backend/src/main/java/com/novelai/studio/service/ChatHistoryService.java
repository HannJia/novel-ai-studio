package com.novelai.studio.service;

import com.novelai.studio.entity.ChatMessageEntity;
import com.novelai.studio.entity.ChatSession;
import com.novelai.studio.mapper.ChatMessageMapper;
import com.novelai.studio.mapper.ChatSessionMapper;
import com.novelai.studio.service.ai.AIContextEnhancer;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * 对话历史服务
 */
@Service
public class ChatHistoryService {

    @Autowired
    private ChatSessionMapper sessionMapper;

    @Autowired
    private ChatMessageMapper messageMapper;

    @Autowired(required = false)
    private AIContextEnhancer contextEnhancer;

    // ==================== 会话管理 ====================

    /**
     * 创建新会话
     */
    @Transactional
    public ChatSession createSession(String bookId, String title, String contextType,
                                      String contextRefId, String aiConfigId) {
        ChatSession session = new ChatSession();
        session.setBookId(bookId);
        session.setTitle(title != null ? title : "新对话");
        session.setContextType(contextType != null ? contextType : ChatSession.CONTEXT_GENERAL);
        session.setContextRefId(contextRefId);
        session.setAiConfigId(aiConfigId);
        session.setMessageCount(0);
        session.setTokenCount(0);
        session.setIsPinned(false);

        sessionMapper.insert(session);
        return session;
    }

    /**
     * 获取会话详情
     */
    public ChatSession getSession(String sessionId) {
        return sessionMapper.selectById(sessionId);
    }

    /**
     * 获取书籍相关的会话列表
     */
    public List<ChatSession> getSessionsByBook(String bookId) {
        return sessionMapper.selectByBookId(bookId);
    }

    /**
     * 获取所有会话列表
     */
    public List<ChatSession> getAllSessions(int limit) {
        return sessionMapper.selectRecent(limit > 0 ? limit : 50);
    }

    /**
     * 更新会话标题
     */
    @Transactional
    public void updateSessionTitle(String sessionId, String title) {
        ChatSession session = sessionMapper.selectById(sessionId);
        if (session != null) {
            session.setTitle(title);
            sessionMapper.updateById(session);
        }
    }

    /**
     * 切换会话置顶状态
     */
    @Transactional
    public void togglePinned(String sessionId) {
        ChatSession session = sessionMapper.selectById(sessionId);
        if (session != null) {
            sessionMapper.updatePinned(sessionId, !session.getIsPinned());
        }
    }

    /**
     * 删除会话（包括所有消息）
     */
    @Transactional
    public void deleteSession(String sessionId) {
        messageMapper.deleteBySessionId(sessionId);
        sessionMapper.deleteById(sessionId);
    }

    // ==================== 消息管理 ====================

    /**
     * 添加消息
     */
    @Transactional
    public ChatMessageEntity addMessage(String sessionId, String role, String content,
                                   String reasoning, Integer tokenCount, String model, Integer duration) {
        ChatMessageEntity message = new ChatMessageEntity();
        message.setSessionId(sessionId);
        message.setRole(role);
        message.setContent(content);
        message.setReasoning(reasoning);
        message.setTokenCount(tokenCount != null ? tokenCount : 0);
        message.setModel(model);
        message.setDuration(duration);
        message.setIsError(false);

        messageMapper.insert(message);

        // 更新会话统计
        sessionMapper.updateMessageCount(sessionId, 1, message.getTokenCount());

        return message;
    }

    /**
     * 添加用户消息
     */
    @Transactional
    public ChatMessageEntity addUserMessage(String sessionId, String content) {
        return addMessage(sessionId, ChatMessageEntity.ROLE_USER, content, null, null, null, null);
    }

    /**
     * 添加AI回复消息
     */
    @Transactional
    public ChatMessageEntity addAssistantMessage(String sessionId, String content, String reasoning,
                                            int tokenCount, String model, int duration) {
        return addMessage(sessionId, ChatMessageEntity.ROLE_ASSISTANT, content, reasoning,
                tokenCount, model, duration);
    }

    /**
     * 添加错误消息
     */
    @Transactional
    public ChatMessageEntity addErrorMessage(String sessionId, String errorContent) {
        ChatMessageEntity message = new ChatMessageEntity();
        message.setSessionId(sessionId);
        message.setRole(ChatMessageEntity.ROLE_ASSISTANT);
        message.setContent(errorContent);
        message.setIsError(true);

        messageMapper.insert(message);
        sessionMapper.updateMessageCount(sessionId, 1, 0);

        return message;
    }

    /**
     * 获取会话的所有消息
     */
    public List<ChatMessageEntity> getMessages(String sessionId) {
        return messageMapper.selectBySessionId(sessionId);
    }

    /**
     * 获取会话的最近N条消息
     */
    public List<ChatMessageEntity> getRecentMessages(String sessionId, int limit) {
        List<ChatMessageEntity> messages = messageMapper.selectRecentBySessionId(sessionId, limit);
        // 反转顺序，使其按时间正序排列
        Collections.reverse(messages);
        return messages;
    }

    /**
     * 清空会话消息
     */
    @Transactional
    public void clearMessages(String sessionId) {
        messageMapper.deleteBySessionId(sessionId);
        ChatSession session = sessionMapper.selectById(sessionId);
        if (session != null) {
            session.setMessageCount(0);
            session.setTokenCount(0);
            sessionMapper.updateById(session);
        }
    }

    // ==================== 上下文构建 ====================

    /**
     * 构建会话的系统提示词（包含上下文注入）
     */
    public String buildSystemPrompt(ChatSession session) {
        StringBuilder prompt = new StringBuilder();
        prompt.append("你是一个专业的AI小说创作助手，擅长帮助作者进行小说创作、角色设计、剧情构思等工作。\n\n");

        // 根据上下文类型注入相关信息
        if (session.getBookId() != null && contextEnhancer != null) {
            String contextType = session.getContextType();

            if (ChatSession.CONTEXT_BOOK.equals(contextType) ||
                ChatSession.CONTEXT_CHAPTER.equals(contextType)) {
                // 注入书籍上下文
                String bookContext = contextEnhancer.buildCharacterContextCached(session.getBookId());
                if (bookContext != null && !bookContext.isEmpty()) {
                    prompt.append("【当前书籍相关信息】\n");
                    prompt.append(bookContext).append("\n\n");
                }

                String settingContext = contextEnhancer.buildSettingContextCached(session.getBookId());
                if (settingContext != null && !settingContext.isEmpty()) {
                    prompt.append(settingContext).append("\n\n");
                }
            }

            if (ChatSession.CONTEXT_CHAPTER.equals(contextType) && session.getContextRefId() != null) {
                // 注入章节上下文
                prompt.append("【当前章节ID】").append(session.getContextRefId()).append("\n\n");
            }

            if (ChatSession.CONTEXT_CHARACTER.equals(contextType) && session.getContextRefId() != null) {
                // 注入角色上下文
                prompt.append("【正在讨论的角色ID】").append(session.getContextRefId()).append("\n\n");
            }
        }

        prompt.append("请根据以上信息，为用户提供专业的创作建议和帮助。");

        return prompt.toString();
    }

    /**
     * 将对话消息转换为AI接口所需的格式
     */
    public List<com.novelai.studio.service.ai.dto.ChatMessage> buildChatMessages(
            String sessionId, String systemPrompt, int maxHistory) {
        List<com.novelai.studio.service.ai.dto.ChatMessage> result = new ArrayList<>();

        // 添加系统提示词
        if (systemPrompt != null && !systemPrompt.isEmpty()) {
            result.add(com.novelai.studio.service.ai.dto.ChatMessage.system(systemPrompt));
        }

        // 获取历史消息
        List<ChatMessageEntity> historyMessages = getRecentMessages(sessionId, maxHistory);

        for (ChatMessageEntity msg : historyMessages) {
            if (ChatMessageEntity.ROLE_USER.equals(msg.getRole())) {
                result.add(com.novelai.studio.service.ai.dto.ChatMessage.user(msg.getContent()));
            } else if (ChatMessageEntity.ROLE_ASSISTANT.equals(msg.getRole()) && !msg.getIsError()) {
                result.add(com.novelai.studio.service.ai.dto.ChatMessage.assistant(msg.getContent()));
            }
        }

        return result;
    }
}
