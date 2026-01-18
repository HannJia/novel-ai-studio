package com.novelai.studio.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.novelai.studio.entity.KnowledgeFile;
import org.apache.ibatis.annotations.Mapper;

/**
 * 知识库文件Mapper
 */
@Mapper
public interface KnowledgeFileMapper extends BaseMapper<KnowledgeFile> {
}
