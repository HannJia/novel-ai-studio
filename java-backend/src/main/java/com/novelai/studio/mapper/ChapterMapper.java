package com.novelai.studio.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.novelai.studio.entity.Chapter;
import org.apache.ibatis.annotations.Mapper;

/**
 * 章节Mapper
 */
@Mapper
public interface ChapterMapper extends BaseMapper<Chapter> {
}
