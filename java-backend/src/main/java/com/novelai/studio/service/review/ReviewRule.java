package com.novelai.studio.service.review;

import com.novelai.studio.entity.ReviewIssue;
import java.util.List;

/**
 * 审查规则接口
 * 所有审查规则都需要实现此接口
 */
public interface ReviewRule {

    /**
     * 获取规则名称
     */
    String getName();

    /**
     * 获取规则描述
     */
    String getDescription();

    /**
     * 获取规则级别
     * @return error(A级)/warning(B级)/suggestion(C级)/info(D级)
     */
    String getLevel();

    /**
     * 获取规则类型
     * @return 具体的问题类型代码，如 character_death_conflict
     */
    String getType();

    /**
     * 执行规则检查
     * @param context 审查上下文，包含所有必要的数据
     * @return 发现的问题列表，如果没有问题则返回空列表
     */
    List<ReviewIssue> check(ReviewContext context);

    /**
     * 是否需要AI辅助（默认不需要）
     */
    default boolean requiresAI() {
        return false;
    }

    /**
     * 规则是否启用（默认启用）
     */
    default boolean isEnabled() {
        return true;
    }

    /**
     * 规则优先级（数字越小优先级越高）
     */
    default int getPriority() {
        return 100;
    }
}
