package com.novelai.studio.entity;

import com.baomidou.mybatisplus.annotation.*;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 知识库文件实体
 */
@Data
@TableName(value = "knowledge_files", autoResultMap = true)
public class KnowledgeFile {

    @TableId(type = IdType.ASSIGN_UUID)
    private String id;

    /**
     * 所属书籍ID，NULL表示全局知识库
     */
    private String bookId;

    /**
     * 所属分类ID
     */
    private String categoryId;

    /**
     * 存储文件名
     */
    private String filename;

    /**
     * 原始文件名
     */
    private String originalName;

    /**
     * 文件类型：txt/pdf/docx/epub/md
     */
    private String fileType;

    /**
     * 文件大小(字节)
     */
    private Long fileSize;

    /**
     * 文件存储路径
     */
    private String filePath;

    /**
     * 是否已向量化
     */
    private Boolean isIndexed;

    /**
     * 分块数量
     */
    private Integer chunkCount;

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
