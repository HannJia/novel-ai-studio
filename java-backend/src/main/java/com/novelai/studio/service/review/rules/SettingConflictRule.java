package com.novelai.studio.service.review.rules;

import com.novelai.studio.entity.Chapter;
import com.novelai.studio.entity.ReviewIssue;
import com.novelai.studio.entity.WorldSetting;
import com.novelai.studio.service.ai.AIService;
import com.novelai.studio.service.ai.dto.GenerateOptions;
import com.novelai.studio.service.ai.dto.GenerateResult;
import com.novelai.studio.service.review.ReviewContext;
import com.novelai.studio.service.review.ReviewLevel;
import com.novelai.studio.service.review.ReviewType;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.*;

/**
 * Level B 规则：设定冲突检测（AI辅助）
 * 使用AI检测内容与世界观设定的矛盾
 */
@Component
public class SettingConflictRule extends AbstractReviewRule {

    private static final Logger log = LoggerFactory.getLogger(SettingConflictRule.class);

    @Autowired
    private AIService aiService;

    public SettingConflictRule() {
        super(
            "设定冲突检测",
            "使用AI检测内容与世界观设定的矛盾",
            ReviewLevel.WARNING,
            ReviewType.SETTING_CONFLICT,
            40
        );
    }

    @Override
    public boolean requiresAI() {
        return true;
    }

    @Override
    public List<ReviewIssue> check(ReviewContext context) {
        if (context.getCurrentChapter() == null) {
            return noIssues();
        }

        Chapter currentChapter = context.getCurrentChapter();
        String content = currentChapter.getContent();
        if (content == null || content.isEmpty()) {
            return noIssues();
        }

        // 如果没有世界观设定，跳过检测
        if (context.getWorldSettings() == null || context.getWorldSettings().isEmpty()) {
            return noIssues();
        }

        List<ReviewIssue> issues = new ArrayList<>();

        try {
            // 构建世界观设定摘要
            String settingSummary = buildSettingSummary(context.getWorldSettings());

            // 截取章节内容（避免超长）
            String truncatedContent = content.length() > 3000 ? content.substring(0, 3000) + "..." : content;

            // 构建AI审查提示
            String prompt = buildReviewPrompt(settingSummary, truncatedContent);

            // 调用AI进行审查
            GenerateOptions options = GenerateOptions.builder()
                    .maxTokens(1000)
                    .temperature(0.3)
                    .build();

            GenerateResult result = aiService.generate(prompt, null, options);

            if (result != null && result.getContent() != null) {
                // 解析AI返回的结果
                issues.addAll(parseAIResponse(result.getContent(), context));
            }

        } catch (Exception e) {
            log.error("AI setting conflict check failed: {}", e.getMessage(), e);
        }

        return issues;
    }

    private String buildSettingSummary(List<WorldSetting> settings) {
        StringBuilder sb = new StringBuilder();
        sb.append("【世界观设定】\n");

        Map<String, List<WorldSetting>> byCategory = new HashMap<>();
        for (WorldSetting setting : settings) {
            byCategory.computeIfAbsent(setting.getCategory(), k -> new ArrayList<>()).add(setting);
        }

        for (Map.Entry<String, List<WorldSetting>> entry : byCategory.entrySet()) {
            sb.append("\n## ").append(getCategoryName(entry.getKey())).append("\n");
            for (WorldSetting setting : entry.getValue()) {
                sb.append("- ").append(setting.getName()).append("：").append(setting.getContent()).append("\n");
            }
        }

        return sb.toString();
    }

    private String getCategoryName(String category) {
        switch (category) {
            case "power_system": return "力量体系";
            case "item": return "物品道具";
            case "location": return "地点场景";
            case "organization": return "组织势力";
            case "rule": return "世界规则";
            default: return "其他设定";
        }
    }

    private String buildReviewPrompt(String settingSummary, String content) {
        return String.format("""
            你是一个小说逻辑审查助手。请检查以下章节内容是否与世界观设定存在矛盾。

            %s

            【待审查章节内容】
            %s

            【任务】
            请检查章节内容是否违反了上述世界观设定。如果发现矛盾，请按以下格式输出：

            [冲突1]
            类型：设定冲突
            问题：<具体描述发现的问题>
            位置：<问题出现的原文片段>
            建议：<修改建议>
            置信度：<0.0-1.0之间的数值>

            如果没有发现明显冲突，请输出：
            [无冲突]
            未发现与世界观设定的明显矛盾。

            请注意：
            1. 只报告确信的冲突，不要过度解读
            2. 小说中的合理艺术处理不算冲突
            3. 置信度反映你对该问题判断的确信程度
            """, settingSummary, content);
    }

    private List<ReviewIssue> parseAIResponse(String response, ReviewContext context) {
        List<ReviewIssue> issues = new ArrayList<>();

        if (response.contains("[无冲突]")) {
            return issues;
        }

        // 解析冲突报告
        String[] parts = response.split("\\[冲突\\d+\\]");
        for (int i = 1; i < parts.length; i++) {
            String part = parts[i].trim();
            if (part.isEmpty()) continue;

            String problem = extractField(part, "问题");
            String location = extractField(part, "位置");
            String suggestion = extractField(part, "建议");
            String confidenceStr = extractField(part, "置信度");

            BigDecimal confidence = new BigDecimal("0.70");
            try {
                if (confidenceStr != null && !confidenceStr.isEmpty()) {
                    confidence = new BigDecimal(confidenceStr.replaceAll("[^0-9.]", ""));
                }
            } catch (Exception e) {
                // 使用默认置信度
            }

            if (problem != null && !problem.isEmpty()) {
                issues.add(ReviewIssue.builder()
                        .level(ReviewLevel.WARNING)
                        .type(ReviewType.SETTING_CONFLICT)
                        .title("设定冲突")
                        .description(problem)
                        .location(Map.of(
                            "originalText", location != null ? location : ""
                        ))
                        .suggestion(suggestion)
                        .confidence(confidence)
                        .build());
            }
        }

        return issues;
    }

    private String extractField(String text, String fieldName) {
        String pattern = fieldName + "[:：]";
        int start = text.indexOf(pattern);
        if (start < 0) return null;

        start += fieldName.length() + 1;
        int end = text.indexOf("\n", start);
        if (end < 0) end = text.length();

        return text.substring(start, end).trim();
    }
}
