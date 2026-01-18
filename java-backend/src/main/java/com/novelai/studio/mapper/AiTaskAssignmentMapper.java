package com.novelai.studio.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.novelai.studio.entity.AiTaskAssignment;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

/**
 * AI任务分配 Mapper
 */
@Mapper
public interface AiTaskAssignmentMapper extends BaseMapper<AiTaskAssignment> {

    /**
     * 根据任务类型获取启用的配置（按优先级排序）
     */
    @Select("SELECT * FROM ai_task_assignments WHERE task_type = #{taskType} AND is_enabled = 1 " +
            "ORDER BY priority DESC")
    List<AiTaskAssignment> selectByTaskType(@Param("taskType") String taskType);

    /**
     * 获取所有启用的配置
     */
    @Select("SELECT * FROM ai_task_assignments WHERE is_enabled = 1 ORDER BY task_type, priority DESC")
    List<AiTaskAssignment> selectAllEnabled();
}
