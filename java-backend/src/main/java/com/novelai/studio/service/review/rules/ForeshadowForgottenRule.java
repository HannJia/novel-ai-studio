package com.novelai.studio.service.review.rules;

import com.novelai.studio.entity.Foreshadow;
import com.novelai.studio.entity.ReviewIssue;
import com.novelai.studio.service.review.ReviewContext;
import com.novelai.studio.service.review.ReviewLevel;
import com.novelai.studio.service.review.ReviewType;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.*;

/**
 * Level C 规则：伏笔遗忘检测
 * 检测埋设的伏笔长期未回收的情况
 */
@Component
public class ForeshadowForgottenRule extends AbstractReviewRule {

    // 警告阈值：超过多少章未回收就发出警告
    private static final int WARNING_THRESHOLD_CHAPTERS = 30;
    // 提醒阈值：超过多少章发出提醒
    private static final int REMIND_THRESHOLD_CHAPTERS = 15;

    public ForeshadowForgottenRule() {
        super(
            "伏笔遗忘检测",
            "检测埋设的伏笔长期未回收的情况",
            ReviewLevel.SUGGESTION,
            ReviewType.FORESHADOW_FORGOTTEN,
            60
        );
    }

    @Override
    public List<ReviewIssue> check(ReviewContext context) {
        if (context.getCurrentChapter() == null) {
            return noIssues();
        }

        int currentChapterOrder = context.getCurrentChapter().getOrderNum();
        List<ReviewIssue> issues = new ArrayList<>();

        // 检查所有未回收的伏笔
        for (Foreshadow foreshadow : context.getForeshadows()) {
            // 只检查已埋设但未完全回收的伏笔
            if (!"resolved".equals(foreshadow.getStatus()) && !"abandoned".equals(foreshadow.getStatus())) {
                int chaptersSincePlanted = currentChapterOrder - foreshadow.getPlantedChapter();

                // 根据重要性和时间确定是否需要提醒
                String importance = foreshadow.getImportance();
                boolean shouldWarn = false;
                String warningLevel = ReviewLevel.SUGGESTION;

                if ("major".equals(importance)) {
                    // 重大伏笔：15章提醒，30章警告
                    if (chaptersSincePlanted >= WARNING_THRESHOLD_CHAPTERS) {
                        shouldWarn = true;
                        warningLevel = ReviewLevel.WARNING;
                    } else if (chaptersSincePlanted >= REMIND_THRESHOLD_CHAPTERS) {
                        shouldWarn = true;
                    }
                } else if ("minor".equals(importance)) {
                    // 次要伏笔：30章提醒，50章警告
                    if (chaptersSincePlanted >= 50) {
                        shouldWarn = true;
                        warningLevel = ReviewLevel.WARNING;
                    } else if (chaptersSincePlanted >= 30) {
                        shouldWarn = true;
                    }
                }

                if (shouldWarn) {
                    issues.add(ReviewIssue.builder()
                            .level(warningLevel)
                            .type(ReviewType.FORESHADOW_FORGOTTEN)
                            .title("伏笔待回收：" + foreshadow.getTitle())
                            .description(String.format(
                                "伏笔「%s」于第%d章埋设，已过%d章仍未回收。" +
                                "重要性：%s，当前状态：%s。",
                                foreshadow.getTitle(),
                                foreshadow.getPlantedChapter(),
                                chaptersSincePlanted,
                                getImportanceText(importance),
                                getStatusText(foreshadow.getStatus())
                            ))
                            .location(Map.of(
                                "foreshadowId", foreshadow.getId(),
                                "plantedChapter", foreshadow.getPlantedChapter(),
                                "plantedText", foreshadow.getPlantedText() != null ? foreshadow.getPlantedText() : ""
                            ))
                            .suggestion(buildSuggestion(foreshadow, chaptersSincePlanted))
                            .reference(Map.of(
                                "expectedResolve", foreshadow.getExpectedResolve() != null ? foreshadow.getExpectedResolve() : ""
                            ))
                            .confidence(new BigDecimal("0.90"))
                            .build());
                }
            }
        }

        return issues;
    }

    private String getImportanceText(String importance) {
        switch (importance) {
            case "major": return "重大";
            case "minor": return "次要";
            case "subtle": return "微妙";
            default: return importance;
        }
    }

    private String getStatusText(String status) {
        switch (status) {
            case "planted": return "已埋设";
            case "partial": return "部分回收";
            case "resolved": return "已回收";
            case "abandoned": return "已废弃";
            default: return status;
        }
    }

    private String buildSuggestion(Foreshadow foreshadow, int chaptersSincePlanted) {
        StringBuilder sb = new StringBuilder();
        sb.append("建议在近期章节中安排回收此伏笔");

        if (foreshadow.getExpectedResolve() != null && !foreshadow.getExpectedResolve().isEmpty()) {
            sb.append("。原计划回收点：").append(foreshadow.getExpectedResolve());
        }

        if (chaptersSincePlanted > WARNING_THRESHOLD_CHAPTERS) {
            sb.append("。如果决定不再使用此伏笔，建议将其标记为废弃。");
        }

        return sb.toString();
    }
}
