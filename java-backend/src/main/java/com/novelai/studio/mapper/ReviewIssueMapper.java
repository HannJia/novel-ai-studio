package com.novelai.studio.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.novelai.studio.entity.ReviewIssue;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;
import java.util.Map;

/**
 * 审查问题 Mapper
 */
@Mapper
public interface ReviewIssueMapper extends BaseMapper<ReviewIssue> {

    /**
     * 获取书籍的所有审查问题
     */
    @Select("SELECT * FROM review_issues WHERE book_id = #{bookId} ORDER BY created_at DESC")
    List<ReviewIssue> selectByBookId(@Param("bookId") String bookId);

    /**
     * 获取章节的所有审查问题
     */
    @Select("SELECT * FROM review_issues WHERE chapter_id = #{chapterId} ORDER BY created_at DESC")
    List<ReviewIssue> selectByChapterId(@Param("chapterId") String chapterId);

    /**
     * 获取书籍特定级别的审查问题
     */
    @Select("SELECT * FROM review_issues WHERE book_id = #{bookId} AND level = #{level} ORDER BY created_at DESC")
    List<ReviewIssue> selectByBookIdAndLevel(@Param("bookId") String bookId, @Param("level") String level);

    /**
     * 获取书籍特定状态的审查问题
     */
    @Select("SELECT * FROM review_issues WHERE book_id = #{bookId} AND status = #{status} ORDER BY created_at DESC")
    List<ReviewIssue> selectByBookIdAndStatus(@Param("bookId") String bookId, @Param("status") String status);

    /**
     * 获取书籍未解决的审查问题数量
     */
    @Select("SELECT level, COUNT(*) as count FROM review_issues WHERE book_id = #{bookId} AND status = 'open' GROUP BY level")
    List<Map<String, Object>> countOpenByBookIdGroupByLevel(@Param("bookId") String bookId);

    /**
     * 删除章节的所有审查问题（重新审查前调用）
     */
    @Delete("DELETE FROM review_issues WHERE chapter_id = #{chapterId}")
    void deleteByChapterId(@Param("chapterId") String chapterId);

    /**
     * 删除书籍的所有审查问题
     */
    @Delete("DELETE FROM review_issues WHERE book_id = #{bookId}")
    void deleteByBookId(@Param("bookId") String bookId);
}
