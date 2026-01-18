package com.novelai.studio.service.review.rules;

import com.novelai.studio.entity.ReviewIssue;
import com.novelai.studio.service.review.ReviewRule;

import java.util.Collections;
import java.util.List;

/**
 * 规则基类
 * 提供通用的规则实现
 */
public abstract class AbstractReviewRule implements ReviewRule {

    protected final String name;
    protected final String description;
    protected final String level;
    protected final String type;
    protected final int priority;
    protected boolean enabled = true;

    protected AbstractReviewRule(String name, String description, String level, String type) {
        this(name, description, level, type, 100);
    }

    protected AbstractReviewRule(String name, String description, String level, String type, int priority) {
        this.name = name;
        this.description = description;
        this.level = level;
        this.type = type;
        this.priority = priority;
    }

    @Override
    public String getName() {
        return name;
    }

    @Override
    public String getDescription() {
        return description;
    }

    @Override
    public String getLevel() {
        return level;
    }

    @Override
    public String getType() {
        return type;
    }

    @Override
    public int getPriority() {
        return priority;
    }

    @Override
    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    /**
     * 快速返回空结果
     */
    protected List<ReviewIssue> noIssues() {
        return Collections.emptyList();
    }

    /**
     * 返回单个问题
     */
    protected List<ReviewIssue> singleIssue(ReviewIssue issue) {
        return Collections.singletonList(issue);
    }
}
