package com.novelai.studio.entity;

import com.baomidou.mybatisplus.annotation.*;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 故事事件实体（L3长期记忆）
 */
@Data
@TableName(value = "story_events", autoResultMap = true)
public class StoryEvent {

    @TableId(type = IdType.ASSIGN_UUID)
    private String id;

    /**
     * 所属书籍ID
     */
    private String bookId;

    /**
     * 所属章节ID
     */
    private String chapterId;

    /**
     * 章节序号
     */
    private Integer chapterOrder;

    /**
     * 事件标题
     */
    private String title;

    /**
     * 事件描述
     */
    private String description;

    /**
     * 事件类型：major/minor/background
     */
    private String eventType;

    /**
     * 涉及角色ID列表
     */
    @TableField(typeHandler = JacksonTypeHandler.class)
    private List<String> involvedCharacters;

    /**
     * 发生地点
     */
    private String location;

    /**
     * 故事内时间顺序
     */
    private Integer timelineOrder;

    /**
     * 事件影响
     */
    private String impact;

    /**
     * 创建时间
     */
    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;
}
