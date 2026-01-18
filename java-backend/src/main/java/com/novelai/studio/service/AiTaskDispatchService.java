package com.novelai.studio.service;

import com.novelai.studio.entity.AiConfig;
import com.novelai.studio.entity.AiTaskAssignment;
import com.novelai.studio.mapper.AiTaskAssignmentMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * AI任务分配服务
 * 根据任务类型分配不同的AI配置
 */
@Service
public class AiTaskDispatchService {

    private static final Logger log = LoggerFactory.getLogger(AiTaskDispatchService.class);

    @Autowired
    private AiTaskAssignmentMapper taskAssignmentMapper;

    @Autowired
    private AiConfigService aiConfigService;

    // 缓存任务分配
    private final Map<String, List<AiTaskAssignment>> assignmentCache = new ConcurrentHashMap<>();

    // 缓存过期时间（毫秒）
    private static final long CACHE_TTL = 60000; // 1分钟
    private long lastCacheTime = 0;

    /**
     * 获取指定任务类型的最佳AI配置ID
     */
    public String getConfigIdForTask(String taskType) {
        List<AiTaskAssignment> assignments = getAssignmentsForTask(taskType);

        if (assignments.isEmpty()) {
            // 没有特定配置，返回默认配置
            AiConfig defaultConfig = aiConfigService.getDefaultConfig();
            return defaultConfig != null ? defaultConfig.getId() : null;
        }

        // 返回优先级最高的配置ID
        return assignments.get(0).getAiConfigId();
    }

    /**
     * 获取指定任务类型的AI配置
     */
    public AiConfig getConfigForTask(String taskType) {
        String configId = getConfigIdForTask(taskType);
        if (configId == null) {
            return null;
        }
        return aiConfigService.getById(configId);
    }

    /**
     * 获取指定任务类型的所有分配（按优先级排序）
     */
    public List<AiTaskAssignment> getAssignmentsForTask(String taskType) {
        refreshCacheIfNeeded();

        List<AiTaskAssignment> assignments = assignmentCache.get(taskType);
        if (assignments == null) {
            assignments = taskAssignmentMapper.selectByTaskType(taskType);
            assignmentCache.put(taskType, assignments);
        }

        return assignments;
    }

    /**
     * 获取所有任务分配
     */
    public List<AiTaskAssignment> getAllAssignments() {
        return taskAssignmentMapper.selectAllEnabled();
    }

    /**
     * 创建任务分配
     */
    @Transactional
    public AiTaskAssignment createAssignment(String taskType, String aiConfigId, int priority) {
        AiTaskAssignment assignment = new AiTaskAssignment();
        assignment.setTaskType(taskType);
        assignment.setAiConfigId(aiConfigId);
        assignment.setPriority(priority);
        assignment.setIsEnabled(true);

        taskAssignmentMapper.insert(assignment);
        clearCache();

        return assignment;
    }

    /**
     * 更新任务分配
     */
    @Transactional
    public void updateAssignment(String id, String aiConfigId, Integer priority, Boolean isEnabled) {
        AiTaskAssignment assignment = taskAssignmentMapper.selectById(id);
        if (assignment == null) {
            return;
        }

        if (aiConfigId != null) {
            assignment.setAiConfigId(aiConfigId);
        }
        if (priority != null) {
            assignment.setPriority(priority);
        }
        if (isEnabled != null) {
            assignment.setIsEnabled(isEnabled);
        }

        taskAssignmentMapper.updateById(assignment);
        clearCache();
    }

    /**
     * 删除任务分配
     */
    @Transactional
    public void deleteAssignment(String id) {
        taskAssignmentMapper.deleteById(id);
        clearCache();
    }

    /**
     * 为任务类型设置AI配置（简便方法）
     */
    @Transactional
    public void setConfigForTask(String taskType, String aiConfigId) {
        // 先删除该任务类型的所有分配
        List<AiTaskAssignment> existing = taskAssignmentMapper.selectByTaskType(taskType);
        for (AiTaskAssignment assignment : existing) {
            taskAssignmentMapper.deleteById(assignment.getId());
        }

        // 创建新分配
        if (aiConfigId != null && !aiConfigId.isEmpty()) {
            createAssignment(taskType, aiConfigId, 1);
        }

        clearCache();
    }

    /**
     * 清除缓存
     */
    public void clearCache() {
        assignmentCache.clear();
        lastCacheTime = 0;
    }

    /**
     * 如果缓存过期，刷新缓存
     */
    private void refreshCacheIfNeeded() {
        long now = System.currentTimeMillis();
        if (now - lastCacheTime > CACHE_TTL) {
            assignmentCache.clear();
            lastCacheTime = now;
        }
    }

    /**
     * 任务类型常量
     */
    public static final String TASK_GENERATE = "generate";
    public static final String TASK_REVIEW = "review";
    public static final String TASK_SUMMARY = "summary";
    public static final String TASK_CHAT = "chat";
    public static final String TASK_OUTLINE = "outline";
}
