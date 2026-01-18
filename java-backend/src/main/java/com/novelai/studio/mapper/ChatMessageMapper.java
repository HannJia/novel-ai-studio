package com.novelai.studio.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.novelai.studio.entity.ChatMessageEntity;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

/**
 * 对话消息 Mapper
 */
@Mapper
public interface ChatMessageMapper extends BaseMapper<ChatMessageEntity> {

    /**
     * 获取会话的所有消息
     */
    @Select("SELECT * FROM chat_messages WHERE session_id = #{sessionId} ORDER BY created_at ASC")
    List<ChatMessageEntity> selectBySessionId(@Param("sessionId") String sessionId);

    /**
     * 获取会话的最近N条消息
     */
    @Select("SELECT * FROM chat_messages WHERE session_id = #{sessionId} " +
            "ORDER BY created_at DESC LIMIT #{limit}")
    List<ChatMessageEntity> selectRecentBySessionId(@Param("sessionId") String sessionId, @Param("limit") int limit);

    /**
     * 删除会话的所有消息
     */
    @Delete("DELETE FROM chat_messages WHERE session_id = #{sessionId}")
    int deleteBySessionId(@Param("sessionId") String sessionId);

    /**
     * 统计会话的消息数量
     */
    @Select("SELECT COUNT(*) FROM chat_messages WHERE session_id = #{sessionId}")
    int countBySessionId(@Param("sessionId") String sessionId);

    /**
     * 统计会话的Token总数
     */
    @Select("SELECT COALESCE(SUM(token_count), 0) FROM chat_messages WHERE session_id = #{sessionId}")
    int sumTokensBySessionId(@Param("sessionId") String sessionId);
}
