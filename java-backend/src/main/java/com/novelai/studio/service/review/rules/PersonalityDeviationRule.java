package com.novelai.studio.service.review.rules;

import com.novelai.studio.entity.Chapter;
import com.novelai.studio.entity.ReviewIssue;
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
 * Level B 规则：性格偏离检测（AI辅助）
 * 使用AI检测角色行为与设定性格不符的情况
 */
@Component
public class PersonalityDeviationRule extends AbstractReviewRule {

    private static final Logger log = LoggerFactory.getLogger(PersonalityDeviationRule.class);

    @Autowired
    private AIService aiService;

    public PersonalityDeviationRule() {
        super(
            "性格偏离检测",
            "使用AI检测角色行为与设定性格不符的情况",
            ReviewLevel.WARNING,
            ReviewType.PERSONALITY_DEVIATION,
            45
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

        // 如果没有角色设定，跳过检测
        if (context.getCharacters() == null || context.getCharacters().isEmpty()) {
            return noIssues();
        }

        List<ReviewIssue> issues = new ArrayList<>();

        try {
            // 构建角色性格摘要
            String characterSummary = buildCharacterSummary(context.getCharacters());

            // 截取章节内容（避免超长）
            String truncatedContent = content.length() > 3000 ? content.substring(0, 3000) + "..." : content;

            // 构建AI审查提示
            String prompt = buildReviewPrompt(characterSummary, truncatedContent);

            // 调用AI进行审查
            GenerateOptions options = GenerateOptions.builder()
                    .maxTokens(1000)
                    .temperature(0.3)
                    .build();

            GenerateResult result = aiService.generate(prompt, null, options);

            if (result != null && result.getContent() != null) {
                issues.addAll(parseAIResponse(result.getContent(), context));
            }

        } catch (Exception e) {
            log.error("AI personality deviation check failed: {}", e.getMessage(), e);
        }

        return issues;
    }

    private String buildCharacterSummary(List<com.novelai.studio.entity.Character> characters) {
        StringBuilder sb = new StringBuilder();
        sb.append("【角色性格设定】\n");

        for (com.novelai.studio.entity.Character character : characters) {
            sb.append("\n## ").append(character.getName());
            if (character.getAliases() != null && !character.getAliases().isEmpty()) {
                sb.append("（").append(String.join("、", character.getAliases())).append("）");
            }
            sb.append("\n");
            sb.append("- 类型：").append(getTypeName(character.getType())).append("\n");

            if (character.getProfile() != null) {
                Map<String, Object> profile = character.getProfile();
                if (profile.get("personality") != null) {
                    sb.append("- 性格：").append(profile.get("personality")).append("\n");
                }
                if (profile.get("goals") != null) {
                    sb.append("- 目标：").append(profile.get("goals")).append("\n");
                }
                if (profile.get("background") != null) {
                    sb.append("- 背景：").append(profile.get("background")).append("\n");
                }
            }
        }

        return sb.toString();
    }

    private String getTypeName(String type) {
        switch (type) {
            case "protagonist": return "主角";
            case "supporting": return "配角";
            case "antagonist": return "反派";
            default: return "其他";
        }
    }

    private String buildReviewPrompt(String characterSummary, String content) {
        return String.format("""
            你是一个小说逻辑审查助手。请检查以下章节中角色的行为是否符合其性格设定。

            %s

            【待审查章节内容】
            %s

            【任务】
            请检查章节中出现的角色行为是否与其性格设定相符。如果发现明显偏离，请按以下格式输出：

            [偏离1]
            角色：<角色名称>
            问题：<具体描述行为与性格的矛盾>
            位置：<问题出现的原文片段>
            建议：<修改建议或解释如何合理化>
            置信度：<0.0-1.0之间的数值>

            如果没有发现明显偏离，请输出：
            [无偏离]
            所有角色行为与性格设定相符。

            请注意：
            1. 角色成长和变化是正常的，需要有合理铺垫
            2. 极端情况下的非常规行为可以理解
            3. 只报告明显的、没有合理解释的性格偏离
            """, characterSummary, content);
    }

    private List<ReviewIssue> parseAIResponse(String response, ReviewContext context) {
        List<ReviewIssue> issues = new ArrayList<>();

        if (response.contains("[无偏离]")) {
            return issues;
        }

        String[] parts = response.split("\\[偏离\\d+\\]");
        for (int i = 1; i < parts.length; i++) {
            String part = parts[i].trim();
            if (part.isEmpty()) continue;

            String characterName = extractField(part, "角色");
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
                        .type(ReviewType.PERSONALITY_DEVIATION)
                        .title("性格偏离：" + (characterName != null ? characterName : "未知角色"))
                        .description(problem)
                        .location(Map.of(
                            "originalText", location != null ? location : "",
                            "characterName", characterName != null ? characterName : ""
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
