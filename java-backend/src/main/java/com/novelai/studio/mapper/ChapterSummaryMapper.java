package com.novelai.studio.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.novelai.studio.entity.ChapterSummary;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

/**
 * 章节摘要Mapper
 */
@Mapper
public interface ChapterSummaryMapper extends BaseMapper<ChapterSummary> {

    /**
     * 根据章节ID获取摘要
     */
    @Select("SELECT * FROM chapter_summaries WHERE chapter_id = #{chapterId}")
    ChapterSummary selectByChapterId(@Param("chapterId") String chapterId);

    /**
     * 获取书籍的所有章节摘要（按章节序号排序）
     */
    @Select("SELECT * FROM chapter_summaries WHERE book_id = #{bookId} ORDER BY chapter_order ASC")
    List<ChapterSummary> selectByBookId(@Param("bookId") String bookId);

    /**
     * 获取指定章节序号之前的所有摘要
     */
    @Select("SELECT * FROM chapter_summaries WHERE book_id = #{bookId} AND chapter_order < #{beforeOrder} ORDER BY chapter_order ASC")
    List<ChapterSummary> selectBeforeChapter(@Param("bookId") String bookId, @Param("beforeOrder") int beforeOrder);

    /**
     * 获取最近N章的摘要
     */
    @Select("SELECT * FROM chapter_summaries WHERE book_id = #{bookId} ORDER BY chapter_order DESC LIMIT #{limit}")
    List<ChapterSummary> selectRecentSummaries(@Param("bookId") String bookId, @Param("limit") int limit);
}
