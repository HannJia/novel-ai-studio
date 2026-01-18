package com.novelai.studio.entity;

import com.baomidou.mybatisplus.annotation.*;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 世界观设定实体
 */
@Data
@TableName(value = "world_settings", autoResultMap = true)
public class WorldSetting {

    @TableId(type = IdType.ASSIGN_UUID)
    private String id;

    /**
     * 所属书籍ID
     */
    private String bookId;

    /**
     * 分类：power_system/item/location/organization/other
     */
    private String category;

    /**
     * 设定名称
     */
    private String name;

    /**
     * 设定内容
     */
    private String content;

    /**
     * 标签列表
     */
    @TableField(typeHandler = JacksonTypeHandler.class)
    private List<String> tags;

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
