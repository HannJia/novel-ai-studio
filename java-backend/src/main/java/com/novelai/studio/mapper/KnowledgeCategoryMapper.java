package com.novelai.studio.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.novelai.studio.entity.KnowledgeCategory;
import org.apache.ibatis.annotations.Mapper;

/**
 * 知识库分类Mapper
 */
@Mapper
public interface KnowledgeCategoryMapper extends BaseMapper<KnowledgeCategory> {
}
