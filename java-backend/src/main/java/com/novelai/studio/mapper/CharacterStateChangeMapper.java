package com.novelai.studio.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.novelai.studio.entity.CharacterStateChange;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

/**
 * 角色状态变更Mapper
 */
@Mapper
public interface CharacterStateChangeMapper extends BaseMapper<CharacterStateChange> {

    /**
     * 获取角色的所有状态变更记录
     */
    @Select("SELECT * FROM character_state_changes WHERE character_id = #{characterId} ORDER BY chapter_order ASC")
    List<CharacterStateChange> selectByCharacterId(@Param("characterId") String characterId);

    /**
     * 获取书籍的所有状态变更记录
     */
    @Select("SELECT * FROM character_state_changes WHERE book_id = #{bookId} ORDER BY chapter_order ASC, created_at ASC")
    List<CharacterStateChange> selectByBookId(@Param("bookId") String bookId);

    /**
     * 获取章节中的所有状态变更
     */
    @Select("SELECT * FROM character_state_changes WHERE chapter_id = #{chapterId} ORDER BY created_at ASC")
    List<CharacterStateChange> selectByChapterId(@Param("chapterId") String chapterId);

    /**
     * 获取角色在指定章节之前的所有状态变更
     */
    @Select("SELECT * FROM character_state_changes WHERE character_id = #{characterId} AND chapter_order <= #{chapterOrder} ORDER BY chapter_order ASC")
    List<CharacterStateChange> selectBeforeChapter(@Param("characterId") String characterId, @Param("chapterOrder") int chapterOrder);

    /**
     * 获取角色的最新状态变更（按字段分组）
     */
    @Select("SELECT csc.* FROM character_state_changes csc " +
            "INNER JOIN (SELECT field, MAX(chapter_order) as max_order FROM character_state_changes WHERE character_id = #{characterId} GROUP BY field) latest " +
            "ON csc.field = latest.field AND csc.chapter_order = latest.max_order " +
            "WHERE csc.character_id = #{characterId}")
    List<CharacterStateChange> selectLatestByCharacter(@Param("characterId") String characterId);
}
