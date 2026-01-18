package com.novelai.studio.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.novelai.studio.entity.StoryEvent;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

/**
 * 故事事件Mapper
 */
@Mapper
public interface StoryEventMapper extends BaseMapper<StoryEvent> {

    /**
     * 获取书籍的所有事件（按时间线排序）
     */
    @Select("SELECT * FROM story_events WHERE book_id = #{bookId} ORDER BY timeline_order ASC, chapter_order ASC")
    List<StoryEvent> selectByBookId(@Param("bookId") String bookId);

    /**
     * 获取章节的所有事件
     */
    @Select("SELECT * FROM story_events WHERE chapter_id = #{chapterId} ORDER BY timeline_order ASC")
    List<StoryEvent> selectByChapterId(@Param("chapterId") String chapterId);

    /**
     * 获取书籍的主要事件
     */
    @Select("SELECT * FROM story_events WHERE book_id = #{bookId} AND event_type = 'major' ORDER BY timeline_order ASC")
    List<StoryEvent> selectMajorEvents(@Param("bookId") String bookId);

    /**
     * 获取涉及特定角色的事件
     */
    @Select("SELECT * FROM story_events WHERE book_id = #{bookId} AND JSON_CONTAINS(involved_characters, JSON_QUOTE(#{characterId})) ORDER BY timeline_order ASC")
    List<StoryEvent> selectByCharacter(@Param("bookId") String bookId, @Param("characterId") String characterId);

    /**
     * 获取指定章节之前的所有事件
     */
    @Select("SELECT * FROM story_events WHERE book_id = #{bookId} AND chapter_order < #{beforeOrder} ORDER BY timeline_order ASC")
    List<StoryEvent> selectBeforeChapter(@Param("bookId") String bookId, @Param("beforeOrder") int beforeOrder);

    /**
     * 获取下一个时间线序号
     */
    @Select("SELECT IFNULL(MAX(timeline_order), 0) + 1 FROM story_events WHERE book_id = #{bookId}")
    Integer getNextTimelineOrder(@Param("bookId") String bookId);
}
