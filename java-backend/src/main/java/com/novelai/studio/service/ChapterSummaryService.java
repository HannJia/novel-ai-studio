package com.novelai.studio.service;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.novelai.studio.entity.Chapter;
import com.novelai.studio.entity.ChapterSummary;
import com.novelai.studio.mapper.ChapterSummaryMapper;
import com.novelai.studio.service.ai.AIService;
import com.novelai.studio.service.ai.dto.GenerateResult;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

/**
 * 章节摘要服务（L2短期记忆）
 */
@Service
public class ChapterSummaryService extends ServiceImpl<ChapterSummaryMapper, ChapterSummary> {

    @Autowired
    private ChapterSummaryMapper chapterSummaryMapper;

    @Autowired
    private ChapterService chapterService;

    @Autowired
    private AIService aiService;

    /**
     * 根据章节ID获取摘要
     */
    public ChapterSummary getByChapterId(String chapterId) {
        return chapterSummaryMapper.selectByChapterId(chapterId);
    }

    /**
     * 获取书籍的所有章节摘要
     */
    public List<ChapterSummary> getByBookId(String bookId) {
        return chapterSummaryMapper.selectByBookId(bookId);
    }

    /**
     * 获取指定章节之前的所有摘要
     */
    public List<ChapterSummary> getBeforeChapter(String bookId, int beforeOrder) {
        return chapterSummaryMapper.selectBeforeChapter(bookId, beforeOrder);
    }

    /**
     * 获取最近N章的摘要
     */
    public List<ChapterSummary> getRecentSummaries(String bookId, int limit) {
        return chapterSummaryMapper.selectRecentSummaries(bookId, limit);
    }

    /**
     * 为章节生成AI摘要
     */
    public ChapterSummary generateSummary(String chapterId) {
        // 获取章节信息
        Chapter chapter = chapterService.getById(chapterId);
        if (chapter == null || chapter.getContent() == null || chapter.getContent().isEmpty()) {
            return null;
        }

        // 构建AI提示
        String prompt = buildSummaryPrompt(chapter);

        // 调用AI生成摘要
        GenerateResult result = aiService.generate(prompt);
        if (result == null || result.getContent() == null || result.getContent().isEmpty()) {
            return null;
        }
        String aiResponse = result.getContent();

        // 解析AI响应
        ChapterSummary summary = parseSummaryResponse(aiResponse, chapter);

        // 检查是否已存在摘要
        ChapterSummary existing = getByChapterId(chapterId);
        if (existing != null) {
            summary.setId(existing.getId());
            updateById(summary);
        } else {
            save(summary);
        }

        return summary;
    }

    /**
     * 手动保存/更新摘要
     */
    public ChapterSummary saveSummary(ChapterSummary summary) {
        ChapterSummary existing = getByChapterId(summary.getChapterId());
        if (existing != null) {
            summary.setId(existing.getId());
            updateById(summary);
        } else {
            save(summary);
        }
        return summary;
    }

    /**
     * 构建摘要生成的AI提示
     */
    private String buildSummaryPrompt(Chapter chapter) {
        StringBuilder prompt = new StringBuilder();
        prompt.append("请为以下小说章节生成结构化摘要。\n\n");
        prompt.append("【章节标题】").append(chapter.getTitle()).append("\n\n");
        prompt.append("【章节内容】\n").append(chapter.getContent()).append("\n\n");
        prompt.append("请按以下格式输出（使用JSON格式）：\n");
        prompt.append("{\n");
        prompt.append("  \"summary\": \"章节摘要（500-800字，概述主要情节发展）\",\n");
        prompt.append("  \"keyEvents\": [\"关键事件1\", \"关键事件2\", ...],\n");
        prompt.append("  \"charactersAppeared\": [\"出场角色名1\", \"出场角色名2\", ...],\n");
        prompt.append("  \"emotionalTone\": \"情感基调（如：紧张、温馨、悲伤、热血等）\"\n");
        prompt.append("}\n\n");
        prompt.append("注意：\n");
        prompt.append("1. 摘要要精炼但完整，涵盖章节的主要情节转折\n");
        prompt.append("2. 关键事件按重要性排序，最多5个\n");
        prompt.append("3. 只列出在本章实际出场的角色\n");
        prompt.append("4. 情感基调用简短词语描述\n");
        return prompt.toString();
    }

    /**
     * 解析AI响应为摘要对象
     */
    private ChapterSummary parseSummaryResponse(String response, Chapter chapter) {
        ChapterSummary summary = new ChapterSummary();
        summary.setChapterId(chapter.getId());
        summary.setBookId(chapter.getBookId());
        summary.setChapterOrder(chapter.getOrderNum());

        try {
            // 尝试从JSON解析
            // 提取JSON部分
            int jsonStart = response.indexOf("{");
            int jsonEnd = response.lastIndexOf("}") + 1;
            if (jsonStart >= 0 && jsonEnd > jsonStart) {
                String jsonStr = response.substring(jsonStart, jsonEnd);
                com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
                java.util.Map<String, Object> json = mapper.readValue(jsonStr, java.util.Map.class);

                summary.setSummary((String) json.get("summary"));

                Object keyEvents = json.get("keyEvents");
                if (keyEvents instanceof List) {
                    summary.setKeyEvents(((List<?>) keyEvents).stream()
                            .map(Object::toString)
                            .collect(Collectors.toList()));
                }

                Object characters = json.get("charactersAppeared");
                if (characters instanceof List) {
                    summary.setCharactersAppeared(((List<?>) characters).stream()
                            .map(Object::toString)
                            .collect(Collectors.toList()));
                }

                summary.setEmotionalTone((String) json.get("emotionalTone"));
            }
        } catch (Exception e) {
            // 如果JSON解析失败，使用整个响应作为摘要
            summary.setSummary(response);
            summary.setKeyEvents(new ArrayList<>());
            summary.setCharactersAppeared(new ArrayList<>());
        }

        return summary;
    }

    /**
     * 构建前文摘要上下文（用于AI生成）
     */
    public String buildPreviousContext(String bookId, int currentChapterOrder, int maxChapters) {
        List<ChapterSummary> summaries = getBeforeChapter(bookId, currentChapterOrder);
        if (summaries.isEmpty()) {
            return "";
        }

        // 限制数量
        if (summaries.size() > maxChapters) {
            summaries = summaries.subList(summaries.size() - maxChapters, summaries.size());
        }

        StringBuilder context = new StringBuilder();
        context.append("【前文摘要】\n\n");

        for (ChapterSummary s : summaries) {
            context.append("第").append(s.getChapterOrder()).append("章：\n");
            context.append(s.getSummary()).append("\n\n");
        }

        return context.toString();
    }

    /**
     * 删除章节的摘要
     */
    public void deleteByChapterId(String chapterId) {
        ChapterSummary existing = getByChapterId(chapterId);
        if (existing != null) {
            removeById(existing.getId());
        }
    }
}
