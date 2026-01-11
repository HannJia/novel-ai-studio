package com.novelai.studio.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.novelai.studio.entity.Book;
import org.apache.ibatis.annotations.Mapper;

/**
 * 书籍Mapper
 */
@Mapper
public interface BookMapper extends BaseMapper<Book> {
}
