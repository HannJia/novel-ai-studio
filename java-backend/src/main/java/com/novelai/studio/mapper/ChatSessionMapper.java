package com.novelai.studio.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.novelai.studio.entity.ChatSession;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;

/**
 * 对话会话 Mapper
 */
@Mapper
public interface ChatSessionMapper extends BaseMapper<ChatSession> {

    /**
     * 获取书籍相关的会话列表
     */
    @Select("SELECT * FROM chat_sessions WHERE book_id = #{bookId} ORDER BY is_pinned DESC, updated_at DESC")
    List<ChatSession> selectByBookId(@Param("bookId") String bookId);

    /**
     * 获取所有会话列表（按更新时间排序）
     */
    @Select("SELECT * FROM chat_sessions ORDER BY is_pinned DESC, updated_at DESC LIMIT #{limit}")
    List<ChatSession> selectRecent(@Param("limit") int limit);

    /**
     * 更新消息计数
     */
    @Update("UPDATE chat_sessions SET message_count = message_count + #{delta}, " +
            "token_count = token_count + #{tokenDelta} WHERE id = #{sessionId}")
    int updateMessageCount(@Param("sessionId") String sessionId,
                           @Param("delta") int delta,
                           @Param("tokenDelta") int tokenDelta);

    /**
     * 切换置顶状态
     */
    @Update("UPDATE chat_sessions SET is_pinned = #{isPinned} WHERE id = #{sessionId}")
    int updatePinned(@Param("sessionId") String sessionId, @Param("isPinned") boolean isPinned);
}
