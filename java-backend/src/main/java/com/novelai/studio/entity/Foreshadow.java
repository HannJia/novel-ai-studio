package com.novelai.studio.entity;

import com.baomidou.mybatisplus.annotation.*;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import lombok.Data;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

/**
 * 伏笔实体
 */
@Data
@TableName(value = "foreshadows", autoResultMap = true)
public class Foreshadow {

    @TableId(type = IdType.ASSIGN_UUID)
    private String id;

    /**
     * 所属书籍ID
     */
    private String bookId;

    /**
     * 伏笔标题
     */
    private String title;

    /**
     * 类型：prophecy/item/character/event/hint
     */
    private String type;

    /**
     * 重要性：major/minor/subtle
     */
    private String importance;

    /**
     * 状态：planted/partial/resolved/abandoned
     */
    private String status;

    /**
     * 埋设章节序号
     */
    private Integer plantedChapter;

    /**
     * 埋设章节ID
     */
    private String plantedChapterId;

    /**
     * 埋设原文
     */
    private String plantedText;

    /**
     * 预期回收点
     */
    private String expectedResolve;

    /**
     * 相关角色ID列表
     */
    @TableField(typeHandler = JacksonTypeHandler.class)
    private List<String> relatedCharacters;

    /**
     * 回收章节序号列表
     */
    @TableField(typeHandler = JacksonTypeHandler.class)
    private List<Integer> resolutionChapters;

    /**
     * 回收说明
     */
    private String resolutionNotes;

    /**
     * 来源：manual/ai_detected
     */
    private String source;

    /**
     * AI识别置信度
     */
    private BigDecimal confidence;

    /**
     * 创建时间
     */
    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    /**
     * 更新时间
     */
    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;
}
