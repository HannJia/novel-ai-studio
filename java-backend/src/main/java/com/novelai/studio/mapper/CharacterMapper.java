package com.novelai.studio.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.novelai.studio.entity.Character;
import org.apache.ibatis.annotations.Mapper;

/**
 * 角色Mapper
 */
@Mapper
public interface CharacterMapper extends BaseMapper<Character> {
}
