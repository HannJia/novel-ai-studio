package com.novelai.studio.entity;

import com.baomidou.mybatisplus.annotation.*;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import lombok.Data;
import org.apache.ibatis.type.Alias;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 角色实体
 */
@Data
@Alias("NovelCharacter")
@TableName(value = "characters", autoResultMap = true)
public class Character {

    @TableId(type = IdType.ASSIGN_UUID)
    private String id;

    /**
     * 所属书籍ID
     */
    private String bookId;

    /**
     * 角色名
     */
    private String name;

    /**
     * 别名列表
     */
    @TableField(typeHandler = JacksonTypeHandler.class)
    private List<String> aliases;

    /**
     * 类型：protagonist/supporting/antagonist/other
     */
    private String type;

    /**
     * 角色档案
     */
    @TableField(typeHandler = JacksonTypeHandler.class)
    private Map<String, Object> profile;

    /**
     * 角色状态
     */
    @TableField(typeHandler = JacksonTypeHandler.class)
    private Map<String, Object> state;

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
