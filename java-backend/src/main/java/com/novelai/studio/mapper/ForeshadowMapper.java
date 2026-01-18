package com.novelai.studio.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.novelai.studio.entity.Foreshadow;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

/**
 * 伏笔Mapper
 */
@Mapper
public interface ForeshadowMapper extends BaseMapper<Foreshadow> {

    /**
     * 获取书籍的所有伏笔
     */
    @Select("SELECT * FROM foreshadows WHERE book_id = #{bookId} ORDER BY planted_chapter ASC")
    List<Foreshadow> selectByBookId(@Param("bookId") String bookId);

    /**
     * 按状态获取书籍的伏笔
     */
    @Select("SELECT * FROM foreshadows WHERE book_id = #{bookId} AND status = #{status} ORDER BY planted_chapter ASC")
    List<Foreshadow> selectByBookIdAndStatus(@Param("bookId") String bookId, @Param("status") String status);

    /**
     * 获取未回收的伏笔（planted或partial状态）
     */
    @Select("SELECT * FROM foreshadows WHERE book_id = #{bookId} AND status IN ('planted', 'partial') ORDER BY importance DESC, planted_chapter ASC")
    List<Foreshadow> selectUnresolvedByBookId(@Param("bookId") String bookId);

    /**
     * 获取章节中埋设的伏笔
     */
    @Select("SELECT * FROM foreshadows WHERE planted_chapter_id = #{chapterId} ORDER BY created_at ASC")
    List<Foreshadow> selectByPlantedChapter(@Param("chapterId") String chapterId);

    /**
     * 获取重要的未回收伏笔
     */
    @Select("SELECT * FROM foreshadows WHERE book_id = #{bookId} AND importance = 'major' AND status IN ('planted', 'partial') ORDER BY planted_chapter ASC")
    List<Foreshadow> selectMajorUnresolved(@Param("bookId") String bookId);

    /**
     * 获取与角色相关的伏笔
     */
    @Select("SELECT * FROM foreshadows WHERE book_id = #{bookId} AND JSON_CONTAINS(related_characters, JSON_QUOTE(#{characterId})) ORDER BY planted_chapter ASC")
    List<Foreshadow> selectByCharacter(@Param("bookId") String bookId, @Param("characterId") String characterId);

    /**
     * 统计各状态的伏笔数量
     */
    @Select("SELECT status, COUNT(*) as count FROM foreshadows WHERE book_id = #{bookId} GROUP BY status")
    List<java.util.Map<String, Object>> countByStatus(@Param("bookId") String bookId);
}
